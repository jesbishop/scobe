/** The Tokens panel's current tokens, kept outside the panel so agents can read them while it's closed. */

export type StoredToken = {
  id: string
  name: string
  kind: string
  value?: string
  hex?: string
  opacity?: number
  aliasId?: string | null
}

export type StoredTokenGroup = { id: string; label: string; kind: string; tokens: StoredToken[] }

let groups: StoredTokenGroup[] | null = null

export function readTokenGroups(): StoredTokenGroup[] | null {
  return groups
}

export function writeTokenGroups(next: StoredTokenGroup[]): void {
  groups = next
}

/** Plain list for agents: name, kind, and resolved value (aliases followed). */
export function tokensForAgents(): Array<{ name: string; kind: string; value: string }> {
  if (!groups) return []
  const all = groups.flatMap((group) => group.tokens)
  const byId = new Map(all.map((token) => [token.id, token]))
  const valueOf = (token: StoredToken, seen = new Set<string>()): string => {
    if (token.aliasId && !seen.has(token.id)) {
      const target = byId.get(token.aliasId)
      if (target) return valueOf(target, seen.add(token.id))
    }
    if (token.kind === 'color') {
      const hex = token.hex || token.value || ''
      return token.opacity != null && token.opacity < 1 ? `${hex} @ ${Math.round(token.opacity * 100)}%` : hex
    }
    return token.value ?? ''
  }
  return all.map((token) => ({ name: token.name, kind: token.kind, value: valueOf(token) }))
}
