/** Models supported by Scobe's Anthropic chat transport. */
export const CHAT_MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
  { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5' }
] as const
export type ChatModelId = typeof CHAT_MODELS[number]['id']
// Preserve the existing default; choosing a different model is explicit.
export const DEFAULT_CHAT_MODEL: ChatModelId = 'claude-sonnet-4-5'
export function resolveChatModel(value: unknown): ChatModelId {
  return CHAT_MODELS.find(model => model.id === value)?.id ?? DEFAULT_CHAT_MODEL
}
