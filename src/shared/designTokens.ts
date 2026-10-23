/** Neutral v1 design tokens — beauty without freeform LLM styling. */
export type DesignTokens = {
  background: string
  foreground: string
  muted: string
  border: string
  input: string
  placeholder: string
  primary: string
  primaryForeground: string
  secondary: string
  destructive: string
  radius: { sm: number; md: number; lg: number; full: number }
  type: { xs: number; sm: number; md: number; lg: number; xl: number }
  space: { xs: number; sm: number; md: number; lg: number; xl: number }
  shadow: { color: string; opacity: number; x: number; y: number; blur: number }
}

export const DEFAULT_TOKENS: DesignTokens = {
  background: '#ffffff',
  foreground: '#0a0a0a',
  muted: '#737373',
  border: '#e5e5e5',
  input: '#f5f5f5',
  placeholder: '#a3a3a3',
  primary: '#171717',
  primaryForeground: '#fafafa',
  secondary: '#f5f5f5',
  destructive: '#dc2626',
  radius: { sm: 6, md: 8, lg: 12, full: 999 },
  type: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22 },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  shadow: { color: '#000000', opacity: 0.06, x: 0, y: 4, blur: 16 }
}

export function densityPadding(density: 'compact' | 'comfortable' | 'spacious', tokens = DEFAULT_TOKENS): number {
  if (density === 'compact') return tokens.space.sm + 4
  if (density === 'spacious') return tokens.space.lg + 8
  return tokens.space.lg
}

export function densityGap(density: 'compact' | 'comfortable' | 'spacious', tokens = DEFAULT_TOKENS): number {
  if (density === 'compact') return tokens.space.sm
  if (density === 'spacious') return tokens.space.md + 4
  return tokens.space.md - 4
}
