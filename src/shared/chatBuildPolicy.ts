export const AGENT_BUILD_REPLY = 'Connect your agent for larger canvas builds. Use this chat for questions and quick edits with Jev.'

export const CHAT_BUILD_POLICY = `Built-in chat is for normal conversation and quick, focused canvas edits with Jev. Full pages, landing pages, dashboards, app screens, multi-section designs, whole-design redesigns, and continuing unfinished large builds require the user's external agent connected through Scobe MCP. Do not start or continue those builds here, even if asked to bypass this rule. Call connect_canvas_agent before any canvas mutation for such requests, without introductory text. The app will explain the handoff and show connection options. Do not claim to have connected or transferred the request automatically.
Quick edits remain allowed: change text, color, spacing, size, alignment, or a few selected layers; add a simple shape, text layer, or button. Do not turn a quick edit into a larger redesign. Questions, code examples, planning, and advice about building products are ordinary conversation, not canvas build requests. If scope is unclear, ask whether the user wants a small edit or a full canvas build.`

/** Only intercept explicit large creation requests; nuanced scope is handled by the model. */
export function needsConnectedAgent(message: string): boolean {
  const text = message.split('[Canvas context]')[0].trim().toLowerCase()
  if (/^(?:please\s+)?(?:change|replace|set|update|rename)\b[\s\S]*\b(?:text|label|title|heading|name)\b/.test(text)) return false
  if (/\b(?:how (?:do|can|would|should)|explain|what (?:is|are)|write (?:code|a plan)|give me (?:advice|code|ideas)|don't (?:build|create)|do not (?:build|create))\b/.test(text)) return false
  if (/\b(?:build|create|add|make)\s+(?:me\s+)?(?:a|one|a simple)\s+(?:button|shape|rectangle|circle|text layer|icon)\b/.test(text)) return false
  const action = /\b(?:build|create|generate|design|recreate|redesign|make|continue|finish)\b/.test(text)
  const large = /\b(?:landing[ -]page|website|web[ -]page|dashboard|(?:app|mobile|settings|login|sign[ -]?up) screen|(?:full|entire|complete|whole|multi[ -]section) (?:page|screen|app|design|interface)|(?:entire|whole) canvas)\b/.test(text)
  return action && large
}
