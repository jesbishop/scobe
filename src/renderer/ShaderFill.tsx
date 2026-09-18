import type { CSSProperties } from 'react'
import {
  DotOrbit,
  GodRays,
  GrainGradient,
  MeshGradient,
  NeuroNoise,
  PaperTexture,
  SimplexNoise,
  SmokeRing,
  Swirl,
  Waves
} from '@paper-design/shaders-react'
import type { ShaderPaint } from '../shared/paint'

export function ShaderFill({
  paint,
  style,
  className
}: {
  paint: ShaderPaint
  style?: CSSProperties
  className?: string
}) {
  const commonStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    opacity: paint.opacity,
    pointerEvents: 'none',
    ...style
  }
  const speed = paint.speed ?? 0.3
  const colors = paint.colors
  const p = paint.params || {}
  const c0 = colors[0] || '#5100ff'
  const c1 = colors[1] || '#00ff80'
  const c2 = colors[2] || '#ffcc00'

  switch (paint.shader) {
    case 'mesh-gradient':
      return (
        <MeshGradient
          className={className}
          style={commonStyle}
          speed={speed}
          colors={colors}
          distortion={p.distortion ?? 0.8}
          swirl={p.swirl ?? 0.5}
          grainMixer={p.grainMixer ?? 0}
          grainOverlay={p.grainOverlay ?? 0}
        />
      )
    case 'grain-gradient':
      return (
        <GrainGradient
          className={className}
          style={commonStyle}
          speed={speed}
          colors={colors}
          softness={p.softness ?? 0.5}
          intensity={p.intensity ?? 0.55}
          noise={p.noise ?? 0.35}
        />
      )
    case 'dot-orbit':
      return (
        <DotOrbit
          className={className}
          style={commonStyle}
          speed={speed}
          colors={colors}
          colorBack="#000000"
          scale={Math.max(0.05, p.scale ?? 0.35)}
          size={p.size ?? 0.4}
          spreading={p.spreading ?? 0.5}
        />
      )
    case 'waves':
      return (
        <Waves
          className={className}
          style={commonStyle}
          colorFront={c0}
          colorBack={c1}
          frequency={p.frequency ?? 0.5}
          amplitude={p.amplitude ?? 0.45}
          softness={p.softness ?? 0.3}
          spacing={p.spacing ?? 0.5}
        />
      )
    case 'simplex-noise':
      return (
        <SimplexNoise
          className={className}
          style={commonStyle}
          speed={speed}
          colors={colors}
          softness={p.softness ?? 0.4}
          scale={Math.max(0.05, p.scale ?? 0.6)}
        />
      )
    case 'neuro-noise':
      return (
        <NeuroNoise
          className={className}
          style={commonStyle}
          speed={speed}
          colorFront={c0}
          colorMid={c1}
          colorBack={c2}
          scale={Math.max(0.05, p.scale ?? 0.55)}
          brightness={p.brightness ?? 0.7}
          contrast={p.contrast ?? 0.5}
        />
      )
    case 'swirl':
      return (
        <Swirl
          className={className}
          style={commonStyle}
          speed={speed}
          colors={colors}
          bandCount={Math.max(0, Math.round((p.bandCount ?? 0.5) * 12))}
          twist={p.twist ?? 0.6}
          softness={p.softness ?? 0.4}
        />
      )
    case 'god-rays':
      return (
        <GodRays
          className={className}
          style={commonStyle}
          speed={speed}
          colors={colors}
          density={p.density ?? 0.5}
          spotty={p.spotty ?? 0.3}
          midSize={p.midSize ?? 0.4}
          intensity={p.intensity ?? 0.7}
        />
      )
    case 'smoke-ring':
      return (
        <SmokeRing
          className={className}
          style={commonStyle}
          speed={speed}
          colors={colors}
          thickness={p.thickness ?? 0.45}
          radius={p.radius ?? 0.55}
          noiseScale={p.noiseScale ?? 0.5}
        />
      )
    case 'paper-texture':
      return (
        <PaperTexture
          className={className}
          style={commonStyle}
          colorFront={c0}
          colorBack={c1}
          fiber={p.fiber ?? 0.5}
          crumples={p.crumples ?? 0.35}
          contrast={p.contrast ?? 0.4}
          roughness={p.roughness ?? 0.3}
          folds={p.folds ?? 0.25}
        />
      )
    default:
      return (
        <MeshGradient className={className} style={commonStyle} speed={speed} colors={colors} />
      )
  }
}
