/** Figma-style layer effects (multi-stack). */

import { defaultShader, SHADER_OPTIONS, type ShaderPaint } from './paint'

export type EffectType =
  | 'GLASS'
  | 'DROP_SHADOW'
  | 'INNER_SHADOW'
  | 'LAYER_BLUR'
  | 'BACKGROUND_BLUR'
  | 'NOISE'
  | 'TEXTURE'
  | 'SHADER'

export type EffectBlurMode = 'UNIFORM' | 'PROGRESSIVE'
export type NoiseType = 'MONOTONE' | 'DUOTONE' | 'MULTITONE'

export type DesignEffect = {
  id: string
  type: EffectType
  visible: boolean
  /** Shadow / noise primary color (#RRGGBB). */
  color?: string
  /** 0–1 opacity for color-bearing effects. */
  opacity?: number
  offsetX?: number
  offsetY?: number
  /** Blur radius (shadow / uniform blur / glass frost). */
  radius?: number
  spread?: number
  blendMode?: string
  showShadowBehindNode?: boolean
  blurMode?: EffectBlurMode
  /** Progressive blur start radius. */
  startRadius?: number
  /** Progressive blur line, as fractions of the layer box (default: top centre → bottom centre). */
  progressStart?: { x: number; y: number }
  progressEnd?: { x: number; y: number }
  noiseType?: NoiseType
  noiseSizeX?: number
  noiseSizeY?: number
  /** 0–1 noise density. */
  density?: number
  secondaryColor?: string
  secondaryOpacity?: number
  clipToShape?: boolean
  /** Glass (stub for later). */
  lightIntensity?: number
  lightAngle?: number
  refraction?: number
  depth?: number
  dispersion?: number
  splay?: number
  /** Shader overlay drawn on top of the layer. */
  shader?: ShaderPaint
}

/** Menu order; `separated` items sit below a divider. */
export const EFFECT_TYPE_OPTIONS: Array<{ type: EffectType; label: string; separated?: boolean }> = [
  { type: 'INNER_SHADOW', label: 'Inner shadow' },
  { type: 'DROP_SHADOW', label: 'Drop shadow' },
  { type: 'LAYER_BLUR', label: 'Layer blur' },
  { type: 'BACKGROUND_BLUR', label: 'Background blur' },
  { type: 'NOISE', label: 'Noise' },
  { type: 'TEXTURE', label: 'Texture' },
  { type: 'GLASS', label: 'Glass' },
  { type: 'SHADER', label: 'Shader', separated: true }
]

export function effectLabel(type: EffectType): string {
  return EFFECT_TYPE_OPTIONS.find((item) => item.type === type)?.label || type
}

export function newEffectId(): string {
  return `fx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function defaultEffect(type: EffectType): DesignEffect {
  switch (type) {
    case 'DROP_SHADOW':
      return {
        id: newEffectId(),
        type,
        visible: true,
        color: '#000000',
        opacity: 0.25,
        offsetX: 0,
        offsetY: 4,
        radius: 4,
        spread: 0,
        blendMode: 'Normal',
        showShadowBehindNode: false
      }
    case 'INNER_SHADOW':
      return {
        id: newEffectId(),
        type,
        visible: true,
        color: '#000000',
        opacity: 0.25,
        offsetX: 0,
        offsetY: 4,
        radius: 4,
        spread: 0,
        blendMode: 'Normal'
      }
    case 'LAYER_BLUR':
      return {
        id: newEffectId(),
        type,
        visible: true,
        blurMode: 'UNIFORM',
        radius: 4,
        startRadius: 0
      }
    case 'BACKGROUND_BLUR':
      return {
        id: newEffectId(),
        type,
        visible: true,
        blurMode: 'UNIFORM',
        radius: 4,
        startRadius: 0
      }
    case 'NOISE':
      return {
        id: newEffectId(),
        type,
        visible: true,
        noiseType: 'MONOTONE',
        noiseSizeX: 0.5,
        noiseSizeY: 0.5,
        density: 1,
        color: '#000000',
        opacity: 0.25,
        secondaryColor: '#FFFFFF',
        secondaryOpacity: 0,
        blendMode: 'Normal'
      }
    case 'TEXTURE':
      return {
        id: newEffectId(),
        type,
        visible: true,
        noiseSizeX: 0.5,
        noiseSizeY: 0.5,
        radius: 2,
        clipToShape: false
      }
    case 'GLASS':
      return {
        id: newEffectId(),
        type,
        visible: true,
        lightIntensity: 0.8,
        lightAngle: -45,
        refraction: 0.8,
        depth: 20,
        dispersion: 0.5,
        radius: 2,
        splay: 0
      }
    case 'SHADER':
      return {
        id: newEffectId(),
        type,
        visible: true,
        blendMode: 'Normal',
        shader: { ...defaultShader('mesh-gradient'), opacity: 0.5 }
      }
  }
}

function fmt(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** Compact one-line summary shown under the effect name in the inspector. */
export function effectSummary(fx: DesignEffect): string {
  switch (fx.type) {
    case 'DROP_SHADOW':
    case 'INNER_SHADOW':
      return `X ${fmt(fx.offsetX ?? 0)} · Y ${fmt(fx.offsetY ?? 4)} · B ${fmt(fx.radius ?? 4)} · S ${fmt(fx.spread ?? 0)}`
    case 'LAYER_BLUR':
    case 'BACKGROUND_BLUR':
      return fx.blurMode === 'PROGRESSIVE'
        ? `Progressive · ${fmt(fx.startRadius ?? 0)} → ${fmt(fx.radius ?? 0)}`
        : `Uniform · ${fmt(fx.radius ?? 0)}`
    case 'NOISE': {
      const kind = fx.noiseType === 'DUOTONE' ? 'Duo' : fx.noiseType === 'MULTITONE' ? 'Multi' : 'Mono'
      return `${kind} · S ${fmt(fx.noiseSizeX ?? 0.5)} · D ${Math.round((fx.density ?? 1) * 100)}%`
    }
    case 'TEXTURE':
      return `S ${fmt(fx.noiseSizeX ?? 0.5)} · R ${fmt(fx.radius ?? 0)}`
    case 'GLASS':
      return `A ${fmt(fx.lightAngle ?? -45)}° · I ${Math.round((fx.lightIntensity ?? 0.8) * 100)}%`
    case 'SHADER': {
      const kind = fx.shader?.shader
      return SHADER_OPTIONS.find((option) => option.id === kind)?.label || 'Mesh Gradient'
    }
  }
}

type LegacyShadowSource = {
  effects?: DesignEffect[]
  shadow?: boolean
  shadowType?: 'drop' | 'inner'
  shadowX?: number
  shadowY?: number
  shadowBlur?: number
  shadowSpread?: number
  shadowColor?: string
  shadowOpacity?: number
  layerBlur?: number
  backgroundBlur?: number
}

/** Resolve effect stack, migrating legacy single-shadow / layerBlur fields. */
export function getNodeEffects(node: LegacyShadowSource): DesignEffect[] {
  if (node.effects?.length) return node.effects
  const list: DesignEffect[] = []
  if (node.shadow) {
    list.push({
      id: 'legacy-shadow',
      type: node.shadowType === 'inner' ? 'INNER_SHADOW' : 'DROP_SHADOW',
      visible: true,
      color: node.shadowColor || '#000000',
      opacity: node.shadowOpacity ?? 0.25,
      offsetX: node.shadowX ?? 0,
      offsetY: node.shadowY ?? 4,
      radius: node.shadowBlur ?? 16,
      spread: node.shadowSpread ?? 0,
      blendMode: 'Normal'
    })
  }
  if (node.layerBlur && node.layerBlur > 0) {
    list.push({
      id: 'legacy-layer-blur',
      type: 'LAYER_BLUR',
      visible: true,
      blurMode: 'UNIFORM',
      radius: node.layerBlur,
      startRadius: 0
    })
  }
  if (node.backgroundBlur && node.backgroundBlur > 0) {
    list.push({
      id: 'legacy-bg-blur',
      type: 'BACKGROUND_BLUR',
      visible: true,
      blurMode: 'UNIFORM',
      radius: node.backgroundBlur,
      startRadius: 0
    })
  }
  return list
}

/** Keep legacy fields in sync for older code paths (export / copy). */
export function syncLegacyEffectFields(effects: DesignEffect[]): Partial<LegacyShadowSource> {
  const drop = effects.find((fx) => fx.visible && fx.type === 'DROP_SHADOW')
  const inner = effects.find((fx) => fx.visible && fx.type === 'INNER_SHADOW')
  const shadow = drop || inner
  const layerBlur = effects.find((fx) => fx.visible && fx.type === 'LAYER_BLUR')
  const bgBlur = effects.find((fx) => fx.visible && fx.type === 'BACKGROUND_BLUR')
  return {
    effects,
    shadow: Boolean(shadow),
    shadowType: inner && !drop ? 'inner' : 'drop',
    shadowX: shadow?.offsetX ?? 0,
    shadowY: shadow?.offsetY ?? 4,
    shadowBlur: shadow?.radius ?? 16,
    shadowSpread: shadow?.spread ?? 0,
    shadowColor: shadow?.color || '#000000',
    shadowOpacity: shadow?.opacity ?? 0.25,
    layerBlur: layerBlur?.radius ?? 0,
    backgroundBlur: bgBlur?.radius ?? 0
  }
}

export function progressiveLine(effect: DesignEffect): { start: { x: number; y: number }; end: { x: number; y: number } } {
  return {
    start: effect.progressStart || { x: 0.5, y: 0 },
    end: effect.progressEnd || { x: 0.5, y: 1 }
  }
}

export function blurRadius(effect: DesignEffect): number {
  if (effect.blurMode === 'PROGRESSIVE') {
    const start = effect.startRadius ?? 0
    const end = effect.radius ?? 0
    return Math.max(start, end)
  }
  return Math.max(0, effect.radius ?? 0)
}
