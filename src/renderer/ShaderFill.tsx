import type { CSSProperties } from 'react'
import {
  ColorPanels,
  Dithering,
  DotGrid,
  DotOrbit,
  GemSmoke,
  GodRays,
  GrainGradient,
  Heatmap,
  LiquidMetal,
  MeshGradient,
  Metaballs,
  NeuroNoise,
  PaperTexture,
  PerlinNoise,
  PulsingBorder,
  SimplexNoise,
  SmokeRing,
  Spiral,
  StaticMeshGradient,
  StaticRadialGradient,
  Swirl,
  Voronoi,
  Warp,
  Waves
} from '@paper-design/shaders-react'
import type { ShaderPaint } from '../shared/paint'
import { shaderOption } from '../shared/shaderControls'
import { shaderShapeUrl } from './shaderShapes'

function sizingProps(p: Record<string, number>) {
  return {
    scale: p.scale ?? 1,
    rotation: p.rotation ?? 0,
    offsetX: p.offsetX ?? 0,
    offsetY: p.offsetY ?? 0
  }
}

export function ShaderFill({
  paint,
  style,
  className,
  frame,
  maxPixelCount,
  minPixelRatio
}: {
  paint: ShaderPaint
  style?: CSSProperties
  className?: string
  /** Optional Paper frame (ms) for frozen previews */
  frame?: number
  maxPixelCount?: number
  minPixelRatio?: number
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
  const speed = paint.speed ?? 1
  const colors = paint.colors
  const p = paint.params || {}
  const sizing = sizingProps(p)
  const colorBack = paint.colorBack || '#000000'
  const c0 = colors[0] || '#5100ff'
  const c1 = colors[1] || '#00ff80'
  const c2 = colors[2] || '#ffcc00'
  const mountExtras = {
    ...(frame !== undefined ? { frame } : null),
    ...(maxPixelCount !== undefined ? { maxPixelCount } : null),
    ...(minPixelRatio !== undefined ? { minPixelRatio } : null)
  }

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
          {...sizing}
          {...mountExtras}
        />
      )
    case 'static-mesh-gradient':
      return (
        <StaticMeshGradient
          className={className}
          style={commonStyle}
          colors={colors}
          positions={Math.max(1, Math.round(p.positions ?? 2))}
          waveX={p.waveX ?? 1}
          waveXShift={p.waveXShift ?? 0.6}
          waveY={p.waveY ?? 1}
          waveYShift={p.waveYShift ?? 0.21}
          mixing={p.mixing ?? 0.93}
          grainMixer={p.grainMixer ?? 0}
          grainOverlay={p.grainOverlay ?? 0}
          {...sizing}
          {...mountExtras}
        />
      )
    case 'static-radial-gradient':
      return (
        <StaticRadialGradient
          className={className}
          style={commonStyle}
          colors={colors}
          colorBack={colorBack}
          radius={p.radius ?? 0.8}
          focalDistance={p.focalDistance ?? 0.99}
          focalAngle={p.focalAngle ?? 0}
          falloff={p.falloff ?? 0.24}
          mixing={p.mixing ?? 0.5}
          distortion={p.distortion ?? 0}
          distortionShift={p.distortionShift ?? 0}
          distortionFreq={p.distortionFreq ?? 8}
          grainMixer={p.grainMixer ?? 0}
          grainOverlay={p.grainOverlay ?? 0}
          {...sizing}
          {...mountExtras}
        />
      )
    case 'grain-gradient':
      return (
        <GrainGradient
          className={className}
          style={commonStyle}
          speed={speed}
          colors={colors}
          colorBack={colorBack}
          softness={p.softness ?? 0.5}
          intensity={p.intensity ?? 0.5}
          noise={p.noise ?? 0.25}
          shape={shaderOption(paint, 'shape', 'corners') as 'corners'}
          {...sizing}
          {...mountExtras}
        />
      )
    case 'dot-orbit':
      return (
        <DotOrbit
          className={className}
          style={commonStyle}
          speed={speed}
          colors={colors}
          colorBack={colorBack}
          size={p.size ?? 0.4}
          sizeRange={p.sizeRange ?? 0}
          spreading={p.spreading ?? 0.5}
          stepsPerColor={Math.max(1, Math.round(p.stepsPerColor ?? 1))}
          {...sizing}
          {...mountExtras}
        />
      )
    case 'dot-grid':
      return (
        <DotGrid
          className={className}
          style={commonStyle}
          colorBack={colorBack}
          colorFill={c0}
          colorStroke={c1}
          size={Math.max(1, p.size ?? 2)}
          gapX={Math.max(2, p.gapX ?? 32)}
          gapY={Math.max(2, p.gapY ?? 32)}
          strokeWidth={p.strokeWidth ?? 0}
          sizeRange={p.sizeRange ?? 0}
          opacityRange={p.opacityRange ?? 0}
          shape={shaderOption(paint, 'shape', 'circle') as 'circle'}
          {...sizing}
          {...mountExtras}
        />
      )
    case 'metaballs':
      return (
        <Metaballs
          className={className}
          style={commonStyle}
          speed={speed}
          colors={colors}
          colorBack={colorBack}
          count={Math.max(1, Math.round(p.count ?? 10))}
          size={p.size ?? 0.83}
          {...sizing}
          {...mountExtras}
        />
      )
    case 'waves':
      return (
        <Waves
          className={className}
          style={commonStyle}
          colorFront={c0}
          colorBack={colorBack || c1}
          shape={p.shape ?? 1}
          frequency={p.frequency ?? 0.5}
          amplitude={p.amplitude ?? 0.45}
          softness={p.softness ?? 0.3}
          spacing={p.spacing ?? 0.5}
          proportion={p.proportion ?? 0.5}
          {...sizing}
          {...mountExtras}
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
          stepsPerColor={Math.max(1, Math.round(p.stepsPerColor ?? 1))}
          {...sizing}
          {...mountExtras}
        />
      )
    case 'perlin-noise':
      return (
        <PerlinNoise
          className={className}
          style={commonStyle}
          speed={speed}
          colorBack={colorBack}
          colorFront={c0}
          proportion={p.proportion ?? 0.35}
          softness={p.softness ?? 0.1}
          octaveCount={Math.max(1, Math.round(p.octaveCount ?? 2))}
          persistence={p.persistence ?? 1}
          lacunarity={p.lacunarity ?? 2}
          {...sizing}
          {...mountExtras}
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
          colorBack={colorBack || c2}
          brightness={p.brightness ?? 0.7}
          contrast={p.contrast ?? 0.5}
          {...sizing}
          {...mountExtras}
        />
      )
    case 'voronoi':
      return (
        <Voronoi
          className={className}
          style={commonStyle}
          speed={speed}
          colors={colors}
          colorGlow={paint.options?.colorGlow || '#ffffff'}
          colorGap={paint.options?.colorGap || '#2e0000'}
          stepsPerColor={Math.max(1, Math.round(p.stepsPerColor ?? 2))}
          distortion={p.distortion ?? 0.4}
          gap={p.gap ?? 0.04}
          glow={p.glow ?? 0}
          {...sizing}
          {...mountExtras}
        />
      )
    case 'warp':
      return (
        <Warp
          className={className}
          style={commonStyle}
          speed={speed}
          colors={colors}
          proportion={p.proportion ?? 0.45}
          softness={p.softness ?? 1}
          distortion={p.distortion ?? 0.25}
          swirl={p.swirl ?? 0.8}
          swirlIterations={Math.max(0, Math.round(p.swirlIterations ?? 10))}
          shapeScale={p.shapeScale ?? 0.1}
          shape={shaderOption(paint, 'shape', 'checks') as 'checks'}
          {...sizing}
          {...mountExtras}
        />
      )
    case 'swirl':
      return (
        <Swirl
          className={className}
          style={commonStyle}
          speed={speed}
          colors={colors}
          colorBack={colorBack}
          bandCount={Math.max(0, Math.round(p.bandCount ?? 6))}
          twist={p.twist ?? 0.6}
          center={p.center ?? 0}
          proportion={p.proportion ?? 0.5}
          softness={p.softness ?? 0.4}
          noise={p.noise ?? 0}
          noiseFrequency={p.noiseFrequency ?? 0}
          {...sizing}
          {...mountExtras}
        />
      )
    case 'spiral':
      return (
        <Spiral
          className={className}
          style={commonStyle}
          speed={speed}
          colorBack={colorBack}
          colorFront={c0}
          density={p.density ?? 1}
          distortion={p.distortion ?? 0}
          strokeWidth={p.strokeWidth ?? 0.5}
          strokeTaper={p.strokeTaper ?? 0}
          strokeCap={p.strokeCap ?? 0}
          noise={p.noise ?? 0}
          noiseFrequency={p.noiseFrequency ?? 0}
          softness={p.softness ?? 0}
          {...sizing}
          {...mountExtras}
        />
      )
    case 'god-rays':
      return (
        <GodRays
          className={className}
          style={commonStyle}
          speed={speed}
          colors={colors}
          colorBack={colorBack}
          colorBloom={paint.options?.colorBloom || '#ffffff'}
          density={p.density ?? 0.5}
          spotty={p.spotty ?? 0.3}
          midSize={p.midSize ?? 0.4}
          midIntensity={p.midIntensity ?? 0.5}
          intensity={p.intensity ?? 0.7}
          bloom={p.bloom ?? 0.3}
          {...sizing}
          {...mountExtras}
        />
      )
    case 'smoke-ring':
      return (
        <SmokeRing
          className={className}
          style={commonStyle}
          speed={speed}
          colors={colors}
          colorBack={colorBack}
          thickness={p.thickness ?? 0.45}
          radius={p.radius ?? 0.55}
          innerShape={p.innerShape ?? 1}
          noiseScale={p.noiseScale ?? 0.5}
          noiseIterations={Math.max(1, Math.round(p.noiseIterations ?? 4))}
          {...sizing}
          {...mountExtras}
        />
      )
    case 'dithering':
      return (
        <Dithering
          className={className}
          style={commonStyle}
          speed={speed}
          colorBack={colorBack}
          colorFront={c0}
          size={Math.max(0.5, p.size ?? 2)}
          shape={shaderOption(paint, 'shape', 'sphere') as 'sphere'}
          type={shaderOption(paint, 'type', '4x4') as '4x4'}
          {...sizing}
          {...mountExtras}
        />
      )
    case 'color-panels':
      return (
        <ColorPanels
          className={className}
          style={commonStyle}
          speed={speed}
          colors={colors}
          colorBack={colorBack}
          angle1={p.angle1 ?? 0}
          angle2={p.angle2 ?? 0}
          length={p.length ?? 1.1}
          blur={p.blur ?? 0.25}
          fadeIn={p.fadeIn ?? 1}
          fadeOut={p.fadeOut ?? 0.3}
          gradient={p.gradient ?? 0.5}
          density={p.density ?? 3}
          {...sizing}
          {...mountExtras}
        />
      )
    case 'pulsing-border':
      return (
        <PulsingBorder
          className={className}
          style={commonStyle}
          speed={speed}
          colors={colors}
          colorBack={colorBack}
          roundness={p.roundness ?? 0.25}
          thickness={p.thickness ?? 0.1}
          softness={p.softness ?? 0.75}
          intensity={p.intensity ?? 0.2}
          bloom={p.bloom ?? 0.25}
          spots={Math.max(1, Math.round(p.spots ?? 4))}
          spotSize={p.spotSize ?? 0.5}
          pulse={p.pulse ?? 0.25}
          smoke={p.smoke ?? 0.3}
          smokeSize={p.smokeSize ?? 0.5}
          margin={p.margin ?? 0}
          {...sizing}
          {...mountExtras}
        />
      )
    case 'gem-smoke':
      return (
        <GemSmoke
          className={className}
          style={commonStyle}
          speed={speed}
          colors={colors}
          colorBack={colorBack}
          colorInner={paint.options?.colorInner || '#fafaf5'}
          outerGlow={p.outerGlow ?? 0.55}
          innerGlow={p.innerGlow ?? 1}
          innerDistortion={p.innerDistortion ?? 0.3}
          outerDistortion={p.outerDistortion ?? 0.3}
          size={p.size ?? 0.8}
          angle={p.angle ?? 0}
          offset={p.offset ?? 0}
          shape={shaderOption(paint, 'shape', 'diamond') as 'diamond'}
          image={paint.image || undefined}
          {...sizing}
          {...mountExtras}
        />
      )
    case 'heatmap':
      return (
        <Heatmap
          className={className}
          style={commonStyle}
          speed={speed}
          colors={colors}
          colorBack={colorBack}
          image={paint.image || shaderShapeUrl(shaderOption(paint, 'shape', 'diamond'))}
          contour={p.contour ?? 0.5}
          angle={p.angle ?? 0}
          noise={p.noise ?? 0}
          innerGlow={p.innerGlow ?? 0.5}
          outerGlow={p.outerGlow ?? 0.5}
          {...sizing}
          {...mountExtras}
        />
      )
    case 'liquid-metal':
      return (
        <LiquidMetal
          className={className}
          style={commonStyle}
          speed={speed}
          colorBack={colorBack}
          colorTint={c0}
          image={paint.image || undefined}
          shape={shaderOption(paint, 'shape', 'diamond') as 'diamond'}
          repetition={p.repetition ?? 2}
          softness={p.softness ?? 0.1}
          shiftRed={p.shiftRed ?? 0.3}
          shiftBlue={p.shiftBlue ?? 0.3}
          distortion={p.distortion ?? 0.07}
          contour={p.contour ?? 0.4}
          angle={p.angle ?? 70}
          {...sizing}
          {...mountExtras}
        />
      )
    case 'paper-texture':
      return (
        <PaperTexture
          className={className}
          style={commonStyle}
          colorFront={c0}
          colorBack={colorBack || c1}
          fiber={p.fiber ?? 0.5}
          fiberSize={p.fiberSize ?? 0.5}
          crumples={p.crumples ?? 0.35}
          crumpleSize={p.crumpleSize ?? 0.5}
          contrast={p.contrast ?? 0.4}
          roughness={p.roughness ?? 0.3}
          folds={p.folds ?? 0.25}
          foldCount={Math.max(1, Math.round(p.foldCount ?? 5))}
          fade={p.fade ?? 0}
          drops={p.drops ?? 0}
          seed={p.seed ?? 0}
          {...sizing}
          {...mountExtras}
        />
      )
    default:
      return (
        <MeshGradient className={className} style={commonStyle} speed={speed} colors={colors} {...sizing}
          {...mountExtras} />
      )
  }
}
