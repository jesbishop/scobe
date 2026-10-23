import { imageAdjustCss, type ImageAdjust } from '../shared/imageAdjust'
import type { ImageBox } from '../shared/paint'

export type ImageFit = 'stretch' | 'cover' | 'contain' | 'tile'

/** Renders an image with live exposure / contrast / color adjustments. */
export function AdjustedImage({
  src,
  adjust,
  fit = 'cover',
  className,
  opacity = 1,
  box
}: {
  src?: string
  adjust?: ImageAdjust | null
  fit?: ImageFit
  className?: string
  opacity?: number
  /** Crop mode: explicit image placement inside the layer (fractions of its box). */
  box?: ImageBox
}) {
  if (!src) return null
  const filter = imageAdjustCss(adjust)

  if (box) {
    return (
      <div
        className={className}
        style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity, borderRadius: 'inherit' }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            left: `${box.x * 100}%`,
            top: `${box.y * 100}%`,
            width: `${box.w * 100}%`,
            height: `${box.h * 100}%`,
            maxWidth: 'none',
            objectFit: 'fill',
            filter,
            pointerEvents: 'none'
          }}
        />
      </div>
    )
  }

  if (fit === 'tile') {
    return (
      <div
        className={className}
        style={{
          opacity,
          filter,
          borderRadius: 'inherit',
          backgroundImage: `url("${src}")`,
          backgroundRepeat: 'repeat',
          backgroundSize: '160px 160px',
          backgroundPosition: 'center'
        }}
      />
    )
  }

  const objectFit = fit === 'stretch' ? 'fill' : fit === 'contain' ? 'contain' : 'cover'
  return (
    <img
      className={className}
      src={src}
      alt=""
      draggable={false}
      style={{ objectFit, opacity, filter, borderRadius: 'inherit' }}
    />
  )
}
