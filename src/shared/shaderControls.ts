import type { ShaderKind, ShaderPaint } from './paint'

export type ShaderControl =
  | {
      kind: 'slider'
      key: string
      label: string
      min: number
      max: number
      step?: number
      /** Display as percent of 0–1 range */
      unit?: '%' | '°' | ''
      /** How value is stored vs displayed */
      scale?: 'unit' | 'raw'
    }
  | {
      kind: 'select'
      key: string
      label: string
      options: Array<{ id: string; label: string }>
    }

const SIZING: ShaderControl[] = [
  { kind: 'slider', key: 'scale', label: 'Scale', min: 0.01, max: 4, step: 0.01, unit: '%', scale: 'unit' },
  { kind: 'slider', key: 'rotation', label: 'Rotation', min: 0, max: 360, step: 1, unit: '°', scale: 'raw' },
  { kind: 'slider', key: 'offsetX', label: 'Offset X', min: -1, max: 1, step: 0.01, unit: '%', scale: 'unit' },
  { kind: 'slider', key: 'offsetY', label: 'Offset Y', min: -1, max: 1, step: 0.01, unit: '%', scale: 'unit' }
]

const GRAIN_SHAPES = [
  { id: 'wave', label: 'Wave' },
  { id: 'dots', label: 'Dots' },
  { id: 'truchet', label: 'Truchet' },
  { id: 'corners', label: 'Corners' },
  { id: 'ripple', label: 'Ripple' },
  { id: 'blob', label: 'Blob' },
  { id: 'sphere', label: 'Sphere' }
]

const DOT_GRID_SHAPES = [
  { id: 'circle', label: 'Circle' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'square', label: 'Square' },
  { id: 'triangle', label: 'Triangle' }
]

const WARP_SHAPES = [
  { id: 'checks', label: 'Checks' },
  { id: 'stripes', label: 'Stripes' },
  { id: 'edge', label: 'Edge' }
]

const DITHER_SHAPES = [
  { id: 'simplex', label: 'Simplex' },
  { id: 'warp', label: 'Warp' },
  { id: 'dots', label: 'Dots' },
  { id: 'wave', label: 'Wave' },
  { id: 'ripple', label: 'Ripple' },
  { id: 'swirl', label: 'Swirl' },
  { id: 'sphere', label: 'Sphere' }
]

const DITHER_TYPES = [
  { id: 'random', label: 'Random' },
  { id: '2x2', label: '2×2' },
  { id: '4x4', label: '4×4' },
  { id: '8x8', label: '8×8' }
]

const GEM_SHAPES = [
  { id: 'none', label: 'None' },
  { id: 'circle', label: 'Circle' },
  { id: 'daisy', label: 'Daisy' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'metaballs', label: 'Metaballs' }
]

/** Built-in outlines for Heatmap, which always needs a shape image. */
export const HEATMAP_SHAPES = [
  { id: 'circle', label: 'Circle' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'square', label: 'Square' },
  { id: 'star', label: 'Star' },
  { id: 'heart', label: 'Heart' }
]

/** Shaders that can trace a custom shape image (file or captured layer). */
export function shaderAcceptsImage(kind: ShaderKind): boolean {
  return kind === 'heatmap' || kind === 'liquid-metal' || kind === 'gem-smoke'
}

/** Per-shader Paper controls (plus shared sizing where applicable). */
export const SHADER_CONTROLS: Record<ShaderKind, ShaderControl[]> = {
  'mesh-gradient': [
    { kind: 'slider', key: 'distortion', label: 'Distortion', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'swirl', label: 'Swirl', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'grainMixer', label: 'Grain mixer', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'grainOverlay', label: 'Grain overlay', min: 0, max: 1, unit: '%', scale: 'unit' },
    ...SIZING
  ],
  'static-mesh-gradient': [
    { kind: 'slider', key: 'positions', label: 'Positions', min: 1, max: 10, step: 1, scale: 'raw' },
    { kind: 'slider', key: 'waveX', label: 'Wave X', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'waveXShift', label: 'Wave X shift', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'waveY', label: 'Wave Y', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'waveYShift', label: 'Wave Y shift', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'mixing', label: 'Mixing', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'grainMixer', label: 'Grain mixer', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'grainOverlay', label: 'Grain overlay', min: 0, max: 1, unit: '%', scale: 'unit' },
    ...SIZING
  ],
  'static-radial-gradient': [
    { kind: 'slider', key: 'radius', label: 'Radius', min: 0, max: 2, unit: '%', scale: 'raw' },
    { kind: 'slider', key: 'focalDistance', label: 'Focal distance', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'focalAngle', label: 'Focal angle', min: 0, max: 360, unit: '°', scale: 'raw' },
    { kind: 'slider', key: 'falloff', label: 'Falloff', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'mixing', label: 'Mixing', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'distortion', label: 'Distortion', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'distortionShift', label: 'Distortion shift', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'distortionFreq', label: 'Distortion freq', min: 1, max: 24, step: 1, scale: 'raw' },
    { kind: 'slider', key: 'grainMixer', label: 'Grain mixer', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'grainOverlay', label: 'Grain overlay', min: 0, max: 1, unit: '%', scale: 'unit' },
    ...SIZING
  ],
  'grain-gradient': [
    { kind: 'select', key: 'shape', label: 'Shape', options: GRAIN_SHAPES },
    { kind: 'slider', key: 'softness', label: 'Softness', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'intensity', label: 'Intensity', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'noise', label: 'Noise', min: 0, max: 1, unit: '%', scale: 'unit' },
    ...SIZING
  ],
  'dot-orbit': [
    { kind: 'slider', key: 'size', label: 'Size', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'sizeRange', label: 'Size range', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'spreading', label: 'Spreading', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'stepsPerColor', label: 'Steps', min: 1, max: 4, step: 1, scale: 'raw' },
    ...SIZING
  ],
  'dot-grid': [
    { kind: 'select', key: 'shape', label: 'Shape', options: DOT_GRID_SHAPES },
    { kind: 'slider', key: 'size', label: 'Size', min: 1, max: 24, step: 0.5, scale: 'raw' },
    { kind: 'slider', key: 'gapX', label: 'Gap X', min: 4, max: 80, step: 1, scale: 'raw' },
    { kind: 'slider', key: 'gapY', label: 'Gap Y', min: 4, max: 80, step: 1, scale: 'raw' },
    { kind: 'slider', key: 'strokeWidth', label: 'Stroke', min: 0, max: 8, step: 0.5, scale: 'raw' },
    { kind: 'slider', key: 'sizeRange', label: 'Size range', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'opacityRange', label: 'Opacity range', min: 0, max: 1, unit: '%', scale: 'unit' },
    ...SIZING
  ],
  metaballs: [
    { kind: 'slider', key: 'count', label: 'Count', min: 2, max: 20, step: 1, scale: 'raw' },
    { kind: 'slider', key: 'size', label: 'Size', min: 0, max: 1, unit: '%', scale: 'unit' },
    ...SIZING
  ],
  waves: [
    { kind: 'slider', key: 'shape', label: 'Shape', min: 0, max: 3, step: 0.01, scale: 'raw' },
    { kind: 'slider', key: 'frequency', label: 'Frequency', min: 0, max: 2, step: 0.01, scale: 'raw' },
    { kind: 'slider', key: 'amplitude', label: 'Amplitude', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'spacing', label: 'Spacing', min: 0, max: 2, step: 0.01, scale: 'raw' },
    { kind: 'slider', key: 'proportion', label: 'Proportion', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'softness', label: 'Softness', min: 0, max: 1, unit: '%', scale: 'unit' },
    ...SIZING
  ],
  'simplex-noise': [
    { kind: 'slider', key: 'softness', label: 'Softness', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'stepsPerColor', label: 'Steps', min: 1, max: 10, step: 1, scale: 'raw' },
    ...SIZING
  ],
  'perlin-noise': [
    { kind: 'slider', key: 'proportion', label: 'Proportion', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'softness', label: 'Softness', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'octaveCount', label: 'Octaves', min: 1, max: 8, step: 1, scale: 'raw' },
    { kind: 'slider', key: 'persistence', label: 'Persistence', min: 0.3, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'lacunarity', label: 'Lacunarity', min: 1.5, max: 10, step: 0.1, scale: 'raw' },
    ...SIZING
  ],
  'neuro-noise': [
    { kind: 'slider', key: 'brightness', label: 'Brightness', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'contrast', label: 'Contrast', min: 0, max: 1, unit: '%', scale: 'unit' },
    ...SIZING
  ],
  voronoi: [
    { kind: 'slider', key: 'stepsPerColor', label: 'Steps', min: 1, max: 3, step: 1, scale: 'raw' },
    { kind: 'slider', key: 'distortion', label: 'Distortion', min: 0, max: 0.5, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'gap', label: 'Gap', min: 0, max: 0.1, step: 0.001, scale: 'raw' },
    { kind: 'slider', key: 'glow', label: 'Glow', min: 0, max: 1, unit: '%', scale: 'unit' },
    ...SIZING
  ],
  warp: [
    { kind: 'select', key: 'shape', label: 'Shape', options: WARP_SHAPES },
    { kind: 'slider', key: 'proportion', label: 'Proportion', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'softness', label: 'Softness', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'distortion', label: 'Distortion', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'swirl', label: 'Swirl', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'swirlIterations', label: 'Swirl iterations', min: 0, max: 20, step: 1, scale: 'raw' },
    { kind: 'slider', key: 'shapeScale', label: 'Shape scale', min: 0, max: 1, unit: '%', scale: 'unit' },
    ...SIZING
  ],
  swirl: [
    { kind: 'slider', key: 'bandCount', label: 'Bands', min: 0, max: 15, step: 1, scale: 'raw' },
    { kind: 'slider', key: 'twist', label: 'Twist', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'center', label: 'Center', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'proportion', label: 'Proportion', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'softness', label: 'Softness', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'noise', label: 'Noise', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'noiseFrequency', label: 'Noise freq', min: 0, max: 1, unit: '%', scale: 'unit' },
    ...SIZING
  ],
  spiral: [
    { kind: 'slider', key: 'density', label: 'Density', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'distortion', label: 'Distortion', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'strokeWidth', label: 'Stroke', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'strokeTaper', label: 'Taper', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'strokeCap', label: 'Cap', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'noise', label: 'Noise', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'noiseFrequency', label: 'Noise freq', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'softness', label: 'Softness', min: 0, max: 1, unit: '%', scale: 'unit' },
    ...SIZING
  ],
  'god-rays': [
    { kind: 'slider', key: 'density', label: 'Density', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'spotty', label: 'Spotty', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'midSize', label: 'Mid size', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'midIntensity', label: 'Mid intensity', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'intensity', label: 'Intensity', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'bloom', label: 'Bloom', min: 0, max: 1, unit: '%', scale: 'unit' },
    ...SIZING
  ],
  'smoke-ring': [
    { kind: 'slider', key: 'thickness', label: 'Thickness', min: 0.01, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'radius', label: 'Radius', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'innerShape', label: 'Inner shape', min: 0, max: 4, step: 0.01, scale: 'raw' },
    { kind: 'slider', key: 'noiseScale', label: 'Noise scale', min: 0.01, max: 5, step: 0.01, scale: 'raw' },
    { kind: 'slider', key: 'noiseIterations', label: 'Noise layers', min: 1, max: 8, step: 1, scale: 'raw' },
    ...SIZING
  ],
  dithering: [
    { kind: 'select', key: 'shape', label: 'Shape', options: DITHER_SHAPES },
    { kind: 'select', key: 'type', label: 'Type', options: DITHER_TYPES },
    { kind: 'slider', key: 'size', label: 'Size', min: 0.5, max: 20, step: 0.5, scale: 'raw' },
    ...SIZING
  ],
  'color-panels': [
    { kind: 'slider', key: 'angle1', label: 'Angle 1', min: -1, max: 1, step: 0.01, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'angle2', label: 'Angle 2', min: -1, max: 1, step: 0.01, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'length', label: 'Length', min: 0, max: 3, step: 0.01, scale: 'raw' },
    { kind: 'slider', key: 'blur', label: 'Blur', min: 0, max: 0.5, step: 0.01, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'fadeIn', label: 'Fade in', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'fadeOut', label: 'Fade out', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'gradient', label: 'Gradient', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'density', label: 'Density', min: 0.25, max: 7, step: 0.05, scale: 'raw' },
    ...SIZING
  ],
  'pulsing-border': [
    { kind: 'slider', key: 'roundness', label: 'Roundness', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'thickness', label: 'Thickness', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'softness', label: 'Softness', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'intensity', label: 'Intensity', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'bloom', label: 'Bloom', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'spots', label: 'Spots', min: 1, max: 20, step: 1, scale: 'raw' },
    { kind: 'slider', key: 'spotSize', label: 'Spot size', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'pulse', label: 'Pulse', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'smoke', label: 'Smoke', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'smokeSize', label: 'Smoke size', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'margin', label: 'Margin', min: 0, max: 1, unit: '%', scale: 'unit' },
    ...SIZING
  ],
  'gem-smoke': [
    { kind: 'select', key: 'shape', label: 'Shape', options: GEM_SHAPES },
    { kind: 'slider', key: 'outerGlow', label: 'Outer glow', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'innerGlow', label: 'Inner glow', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'innerDistortion', label: 'Inner distortion', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'outerDistortion', label: 'Outer distortion', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'size', label: 'Size', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'angle', label: 'Angle', min: 0, max: 360, unit: '°', scale: 'raw' },
    { kind: 'slider', key: 'offset', label: 'Offset', min: -1, max: 1, unit: '%', scale: 'unit' },
    ...SIZING
  ],
  'paper-texture': [
    { kind: 'slider', key: 'fiber', label: 'Fiber', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'fiberSize', label: 'Fiber size', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'crumples', label: 'Crumples', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'crumpleSize', label: 'Crumple size', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'folds', label: 'Folds', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'foldCount', label: 'Fold count', min: 1, max: 15, step: 1, scale: 'raw' },
    { kind: 'slider', key: 'contrast', label: 'Contrast', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'roughness', label: 'Roughness', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'fade', label: 'Fade', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'drops', label: 'Drops', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'seed', label: 'Seed', min: 0, max: 1000, step: 1, scale: 'raw' },
    ...SIZING
  ],
  heatmap: [
    { kind: 'select', key: 'shape', label: 'Shape', options: HEATMAP_SHAPES },
    { kind: 'slider', key: 'angle', label: 'Angle', min: 0, max: 360, unit: '°', scale: 'raw' },
    { kind: 'slider', key: 'noise', label: 'Noise', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'innerGlow', label: 'Inner glow', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'outerGlow', label: 'Outer glow', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'contour', label: 'Contour', min: 0, max: 1, unit: '%', scale: 'unit' },
    ...SIZING
  ],
  'liquid-metal': [
    { kind: 'select', key: 'shape', label: 'Shape', options: GEM_SHAPES },
    { kind: 'slider', key: 'repetition', label: 'Repetition', min: 1, max: 10, step: 0.1, scale: 'raw' },
    { kind: 'slider', key: 'softness', label: 'Softness', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'shiftRed', label: 'Red shift', min: -1, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'shiftBlue', label: 'Blue shift', min: -1, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'distortion', label: 'Distortion', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'contour', label: 'Contour', min: 0, max: 1, unit: '%', scale: 'unit' },
    { kind: 'slider', key: 'angle', label: 'Angle', min: 0, max: 360, unit: '°', scale: 'raw' },
    ...SIZING
  ]
}

export const ANIMATED_SHADERS = new Set<ShaderKind>([
  'mesh-gradient',
  'grain-gradient',
  'dot-orbit',
  'metaballs',
  'simplex-noise',
  'perlin-noise',
  'neuro-noise',
  'voronoi',
  'warp',
  'swirl',
  'spiral',
  'god-rays',
  'smoke-ring',
  'dithering',
  'color-panels',
  'pulsing-border',
  'gem-smoke',
  'heatmap',
  'liquid-metal'
])

export function shaderOption(paint: ShaderPaint, key: string, fallback: string): string {
  return paint.options?.[key] || fallback
}

export function formatShaderControlValue(control: Extract<ShaderControl, { kind: 'slider' }>, value: number): string {
  if (control.unit === '°') return `${Math.round(value)}°`
  if (control.unit === '%') return `${Math.round(value * 100)}%`
  if (control.step && control.step < 1) return Number(value).toFixed(2)
  return `${Math.round(value)}`
}

export function maxShaderColors(kind: ShaderKind): number {
  if (kind === 'liquid-metal') return 1
  if (kind === 'heatmap') return 10
  if (kind === 'mesh-gradient' || kind === 'static-mesh-gradient' || kind === 'static-radial-gradient') return 10
  if (kind === 'grain-gradient') return 7
  if (kind === 'color-panels') return 7
  if (kind === 'metaballs') return 8
  if (kind === 'gem-smoke') return 6
  if (kind === 'voronoi') return 5
  if (kind === 'swirl' || kind === 'simplex-noise' || kind === 'dot-orbit' || kind === 'warp' || kind === 'smoke-ring')
    return 10
  if (kind === 'pulsing-border' || kind === 'god-rays') return 5
  return 4
}
