import type { Message, MessageParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages'
import type { AgentEvent } from '../shared/types'
import { toolAnnotations } from './canvasToolRegistry'

type ToolOutput = { content: string; image?: string; reviewedId?: string }
type Options = {
  messages: Array<{ role: 'user' | 'assistant'; text: string }>
  emit: (event: AgentEvent) => void
  summarize: (name: string, input: unknown) => string
  request: (messages: MessageParam[], onText: (text: string) => void) => Promise<Message>
  execute: (name: string, input: Record<string, unknown>) => Promise<ToolOutput>
  maxSteps?: number
  remember?: (notes: string[]) => void
}

const clip = (text: string, size: number) => text.length <= size ? text : text.slice(0, size) + '\n[Shortened for context. Read the relevant layer again with get_node_info or get_tree_summary.]'

/** Keep tool-call/result pairs intact. Old images and verbose results need not be sent every step. */
export function compactAgentThread(thread: MessageParam[]): MessageParam[] {
  // Opus 5.5 binds thinking signatures to the entire preceding conversation.
  // Shortening any earlier result/image/input invalidates those signatures.
  // Keep signed turns append-only; scoped reads already bound new tool output.
  if (thread.some(message => Array.isArray(message.content) && message.content.some(block => ['thinking', 'redacted_thinking'].includes(block.type)))) return thread
  return thread.map((message, index) => {
    if (!Array.isArray(message.content)) return message
    const old = index < thread.length - 4
    return { ...message, content: message.content.map(block => {
      if (block.type === 'tool_result') {
        const content = typeof block.content === 'string'
          ? clip(block.content, old ? 1600 : 14000)
          : block.content?.map(part => {
            if (part.type === 'image' && old) return { type: 'text' as const, text: '[Earlier image reviewed; render_node can inspect the current design.]' }
            if (part.type === 'text') return { ...part, text: clip(part.text, old ? 1600 : 14000) }
            return part
          })
        return { ...block, content }
      }
      if (old && block.type === 'tool_use' && JSON.stringify(block.input).length > 2000) {
        const input = block.input as Record<string, unknown>
        return { ...block, input: { id: input.id, parentId: input.parentId, name: input.name, note: 'Large arguments omitted from earlier tool call; inspect live layers for current state.' } }
      }
      return block
    }) }
  })
}

export function friendlyAgentError(error: unknown): string {
  const source = error as { status?: number; error?: { error?: { message?: string }; message?: string }; message?: string }
  const message = source?.error?.error?.message || source?.error?.message || source?.message || String(error)
  if (/timeout|timed out|aborted due to timeout/i.test(message) || ['TimeoutError', 'APIConnectionTimeoutError'].includes((error as Error)?.name)) {
    return 'The connection to Scobe AI timed out. The hosted service may be waking up. Your canvas changes are saved; try again shortly to continue.'
  }
  if (source?.status === 429 || /usage limit|rate.limit/i.test(message)) {
    return /usage limit/i.test(message)
      ? 'Scobe’s AI allowance was reached before this task finished. Your canvas changes are saved. Try again after the allowance resets.'
      : 'AI is busy right now. Your canvas changes are saved; try again shortly.'
  }
  if (source?.status === 401) return 'Your Scobe sign-in expired. Sign in again to continue.'
  return clip(message.replace(/^Error invoking a remote method[^:]*: Error:\s*/, ''), 600)
}

/** Same executor as MCP; bounded work, recoverable tool errors, and an enforced review pass. */
export async function runCanvasAgentLoop(options: Options): Promise<void> {
  let thread: MessageParam[] = options.messages.map(message => ({ role: message.role, content: message.text }))
  let revision = 0
  let renderedRevision = -1
  let reviewPrompts = 0
  let created = false
  const notes: string[] = []
  const parents = new Map<string, string | null>()
  const knownFrames = new Set<string>()
  const pendingFrames = new Set<string>()
  try {
    for (let step = 0; step < (options.maxSteps ?? 80); step++) {
      thread = compactAgentThread(thread)
      const response = await options.request(thread, text => options.emit({ type: 'text', text }))
      if (response.stop_reason === 'max_tokens') {
        // Preserve the partial answer and ask for continuation; never execute truncated tool inputs.
        const partial = response.content.filter(block => block.type !== 'tool_use')
        thread.push({ role: 'assistant', content: partial.length ? partial : 'Output interrupted before the tool call completed.' })
        thread.push({ role: 'user', content: 'Your answer reached its output limit. Continue the unfinished task. Reissue any incomplete tool call with complete arguments.' })
        continue
      }
      const tools = response.content.filter(block => block.type === 'tool_use')
      thread.push({ role: 'assistant', content: response.content })
      if (!tools.length) {
        const needsReview = pendingFrames.size > 0 || ((created || revision > 1) && renderedRevision < revision)
        if (needsReview && reviewPrompts < 3) {
          reviewPrompts++
          thread.push({ role: 'user', content: 'Before finishing, render_node on each frame you built or edited.' + (pendingFrames.size ? ' Frames still needing review: ' + [...pendingFrames].join(', ') + '.' : '') + ' Inspect the returned images using the design guide, fix visible issues, and render again after fixes. Do not rebuild unrelated layers. If rendering fails, disclose that limitation.' })
          continue
        }
        if (needsReview) {
          options.emit({ type: 'error', message: 'Canvas changes are saved, but the final visual review did not complete. Ask me to inspect and finish the design.' })
        } else options.emit({ type: 'done' })
        return
      }
      const results: ToolResultBlockParam[] = []
      // Preserve model order: reparenting, layout, and creation can depend on earlier calls.
      for (const tool of tools) {
        if (tool.type !== 'tool_use') continue
        options.emit({ type: 'tool', name: tool.name, summary: options.summarize(tool.name, tool.input) })
        try {
          const result = await options.execute(tool.name, tool.input as Record<string, unknown>)
          if (!toolAnnotations(tool.name).readOnlyHint) notes.push(`${tool.name}: ${clip(result.content, 800)}`)
          const mutates = !toolAnnotations(tool.name).readOnlyHint && !['finish_working_on_nodes', 'open_coding_agent', 'open_browser', 'navigate'].includes(tool.name)
          if (mutates) {
            revision++
            try {
              const node = JSON.parse(result.content) as { id?: string; parentId?: string; type?: string }
              if (node.id) {
                parents.set(node.id, node.parentId || null)
                let root = node.id
                const visited = new Set<string>()
                while (parents.get(root) && !visited.has(root)) { visited.add(root); root = parents.get(root)! }
                if (['frame', 'section'].includes(node.type || '') && !node.parentId) knownFrames.add(node.id)
                if (knownFrames.has(root)) pendingFrames.add(root)
              }
            } catch { /* Non-node results still invalidate the general review revision. */ }
            if (tool.name === 'delete_nodes') {
              const input = tool.input as { id?: string; ids?: string[] }
              for (const id of input.ids || (input.id ? [input.id] : [])) { pendingFrames.delete(id); knownFrames.delete(id) }
            }
          }
          if (['create_artboard', 'add_design_frame', 'snapshot_browser_to_frame', 'snapshot_to_canvas'].includes(tool.name)) created = true
          if (tool.name === 'render_node' && result.image) {
            renderedRevision = revision
            const reviewedId = result.reviewedId || (tool.input as { id?: string }).id
            if (reviewedId) pendingFrames.delete(reviewedId)
          }
          results.push({ type: 'tool_result', tool_use_id: tool.id, content: result.image
            ? [{ type: 'text', text: clip(result.content, 14000) }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: result.image } }]
            : clip(result.content, 14000) })
        } catch (error) {
          results.push({ type: 'tool_result', tool_use_id: tool.id, is_error: true, content: clip(error instanceof Error ? error.message : String(error), 2000) })
        }
      }
      thread.push({ role: 'user', content: results })
    }
    options.emit({ type: 'error', message: 'This build reached its step limit. Canvas changes are saved, but the task is unfinished. Ask me to continue from the current design.' })
  } catch (error) {
    options.emit({ type: 'error', message: friendlyAgentError(error) })
  } finally {
    options.remember?.(notes.slice(-30))
    await options.execute('finish_working_on_nodes', {}).catch(() => undefined)
  }
}
