export type BuildEvent =
  | { type: 'build:start'; label?: string }
  | { type: 'build:working'; nodeIds: string[] }
  | { type: 'build:reveal'; nodeIds: string[] }
  | { type: 'build:finish'; nodeIds?: string[] }
  | { type: 'mcp:status'; running: boolean; url: string; port: number }
  | { type: 'ui:open-coding-agent'; agentId: string; projectName?: string }
  | { type: 'ui:set-page'; pageId: string }

type Listener = (event: BuildEvent) => void

const listeners = new Set<Listener>()
const working = new Set<string>()
const clearTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function onBuildEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emitBuild(event: BuildEvent): void {
  if (event.type === 'build:working') {
    for (const id of event.nodeIds) working.add(id)
  }
  if (event.type === 'build:finish') {
    if (event.nodeIds?.length) {
      for (const id of event.nodeIds) {
        working.delete(id)
        const timer = clearTimers.get(id)
        if (timer) {
          clearTimeout(timer)
          clearTimers.delete(id)
        }
      }
    } else {
      working.clear()
      for (const timer of clearTimers.values()) clearTimeout(timer)
      clearTimers.clear()
    }
  }
  for (const listener of listeners) listener(event)
}

export function getWorkingNodeIds(): string[] {
  return [...working]
}

export function markWorking(nodeIds: string[]): void {
  if (!nodeIds.length) return
  emitBuild({ type: 'build:working', nodeIds })
  for (const id of nodeIds) {
    const prev = clearTimers.get(id)
    if (prev) clearTimeout(prev)
    clearTimers.set(
      id,
      setTimeout(() => {
        emitBuild({ type: 'build:finish', nodeIds: [id] })
        clearTimers.delete(id)
      }, 12000)
    )
  }
}

export function revealNodes(nodeIds: string[]): void {
  if (!nodeIds.length) return
  emitBuild({ type: 'build:reveal', nodeIds })
}

export function finishWorking(nodeIds?: string[]): void {
  emitBuild({ type: 'build:finish', nodeIds })
}

/**
 * Stage a create: only host artboards get the working indicator.
 * Created nodes still reveal; they do not all light up blue.
 */
export async function stageCreate(nodeIds: string[], hostIds: string[] = []): Promise<void> {
  const hosts = [...new Set(hostIds)]
  if (hosts.length) markWorking(hosts)
  await new Promise((resolve) => setTimeout(resolve, 700))
  revealNodes(nodeIds)
  if (hosts.length) markWorking(hosts)
}
