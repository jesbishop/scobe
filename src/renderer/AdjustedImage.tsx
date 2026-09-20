import { imageAdjustCss, type ImageAdjust } from '../shared/imageAdjust'

export type ImageFit = 'stretch' | 'cover' | 'contain' | 'tile'

/** Renders an image with live exposure / contrast / color adjustments. */
export function AdjustedImage({
  src,
  adjust,
  fit = 'cover',
  className,
  opacity = 1
}: {
  src?: string
  adjust?: ImageAdjust | null
  fit?: ImageFit
  className?: string
  opacity?: number
}) {
  if (!src) return null
  const filter = imageAdjustCss(adjust)

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
