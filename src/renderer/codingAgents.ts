import { type CodingAgentBinding, type CodingAgentId } from '../shared/codingAgents'

const STORAGE_KEY = 'vanta-coding-agents'
const MAX_RECENTS = 12

type Stored = {
  active: CodingAgentBinding | null
  recents: CodingAgentBinding[]
}

export function loadCodingAgents(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { active: null, recents: [] }
    const data = JSON.parse(raw) as Stored
    return {
      active: data.active ?? null,
      recents: Array.isArray(data.recents) ? data.recents : []
    }
  } catch {
    return { active: null, recents: [] }
  }
}

function write(next: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

export function rememberCodingAgent(
  recents: CodingAgentBinding[],
  input: { agentId: CodingAgentId; projectName: string; id?: string }
): Stored {
  const now = Date.now()
  const existing =
    recents.find((item) => item.id === input.id) ||
    recents.find((item) => item.agentId === input.agentId && item.projectName === input.projectName)
  const binding: CodingAgentBinding = {
    id: existing?.id || crypto.randomUUID(),
    agentId: input.agentId,
    projectName: input.projectName,
    lastUsed: now
  }
  const next = {
    active: binding,
    recents: [binding, ...recents.filter((item) => item.id !== binding.id)].slice(0, MAX_RECENTS)
  }
  write(next)
  return next
}
