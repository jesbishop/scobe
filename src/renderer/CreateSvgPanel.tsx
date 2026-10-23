import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowUpwardIcon, AutoAwesomeOutlinedIcon, CheckRoundedIcon, CloseRoundedIcon, ContentCopyOutlinedIcon, KeyboardArrowDownIcon, KeyboardOutlinedIcon, MenuRoundedIcon, MicNoneOutlinedIcon } from './lucideIcons'
import {
  QUIVER_MODELS,
  type QuiverGenerateInput,
  type QuiverModelId,
  type QuiverStreamEvent
} from '../shared/quiver'

export type CreateSvgOptions = {
  n: number
  temperature: number
  reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh'
  instructions: string
}

export type CreateSvgReference = {
  id: string
  dataUrl: string
}

export type CreateSvgTextChip = {
  id: string
  label: string
}

const DEFAULT_OPTIONS: CreateSvgOptions = {
  n: 1,
  temperature: 0.4,
  reasoningEffort: 'medium',
  instructions:
    'Clean vector illustration, flat shapes, no raster effects. Fill the entire viewBox edge-to-edge — no white margins or padding around the artwork.'
}

/** Paper-style ghost prompts — shown as animated overlay, never auto-committed as real input. */
const GHOST_PROMPTS_WITH_REF = [
  'An illustration of a lake in the same style',
  'A poster version of this',
  'Simplify this into a flat icon',
  'Turn this into a logo mark',
  'A sticker pack frame of this'
]

const GHOST_PROMPTS_EMPTY = [
  'An illustration of a whale',
  'A geometric mountain logo',
  'A cute robot mascot',
  'A tropical fruit pattern',
  'A minimal city skyline'
]

const MENU_ACTIONS = [
  { id: 'vectorize' as const, label: 'Vectorize', requiresImages: true },
  { id: 'extract-colors' as const, label: 'Extract colors', requiresImages: true },
  { id: 'remove-background' as const, label: 'Remove background', requiresImages: true }
]

export type CreateSvgMenuAction = (typeof MENU_ACTIONS)[number]['id']

/** Paper “Start over from this prompt” — curved path ending in a down arrow. */
function StartOverPromptIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 6.5h8.5a4.5 4.5 0 0 1 4.5 4.5V17"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M14.5 13.5 18 17l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function svgToDataUrl(svg: string): string {
  const trimmed = svg.trim()
  if (trimmed.startsWith('data:')) return trimmed
  try {
    const encoded = btoa(unescape(encodeURIComponent(trimmed)))
    return `data:image/svg+xml;base64,${encoded}`
  } catch {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(trimmed)}`
  }
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const lr = lin(r)
  const lg = lin(g)
  const lb = lin(b)
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047
  const y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(x)
  const fy = f(y)
  const fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/**
 * Sample the distinct colors in an image for Magic Swatches. Returns at most
 * `count`, but only as many as the image actually has — anti-aliased edges and
 * near-identical shades are merged or dropped.
 */
export async function sampleImageColors(dataUrl: string, count = 6): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const size = 96
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve([])
        return
      }
      ctx.drawImage(img, 0, 0, size, size)
      const { data } = ctx.getImageData(0, 0, size, size)
      const buckets = new Map<string, { count: number; r: number; g: number; b: number }>()
      let total = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 200) continue
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const key = `${r >> 4},${g >> 4},${b >> 4}`
        const prev = buckets.get(key)
        if (prev) {
          prev.count += 1
          prev.r += r
          prev.g += g
          prev.b += b
        } else {
          buckets.set(key, { count: 1, r, g, b })
        }
        total += 1
      }
      if (!total) {
        resolve([])
        return
      }

      // Greedy perceptual merge, most common first, so shades collapse into one swatch.
      const MERGE_DELTA_E = 14
      type Cluster = { count: number; r: number; g: number; b: number; lab: [number, number, number] }
      const clusters: Cluster[] = []
      for (const bucket of [...buckets.values()].sort((a, b) => b.count - a.count)) {
        const lab = rgbToLab(bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count)
        const match = clusters.find(
          (cluster) =>
            Math.hypot(cluster.lab[0] - lab[0], cluster.lab[1] - lab[1], cluster.lab[2] - lab[2]) <
            MERGE_DELTA_E
        )
        if (match) {
          match.count += bucket.count
          match.r += bucket.r
          match.g += bucket.g
          match.b += bucket.b
        } else {
          clusters.push({ ...bucket, lab })
        }
      }

      const MIN_SHARE = 0.03
      const significant = clusters
        .filter((cluster) => cluster.count / total >= MIN_SHARE)
        .sort((a, b) => b.count - a.count)
      const picked = (significant.length ? significant : clusters.slice(0, 1)).slice(0, count)
      resolve(
        picked.map((item) => {
          const r = Math.round(item.r / item.count)
          const g = Math.round(item.g / item.count)
          const b = Math.round(item.b / item.count)
          return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
        })
      )
    }
    img.onerror = () => reject(new Error('image load failed'))
    img.src = dataUrl
  })
}

export async function shrinkImageDataUrl(dataUrl: string, maxEdge = 1024): Promise<string> {
  return new Promise((resolve) => {
    if (!dataUrl.startsWith('data:image/') || dataUrl.startsWith('data:image/svg')) {
      resolve(dataUrl)
      return
    }
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
      if (scale >= 0.98 && dataUrl.length < 400_000) {
        resolve(dataUrl)
        return
      }
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(dataUrl)
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.86))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

/** Rasterize any image/SVG data URL to PNG — required by the cutout model. */
export async function rasterizeToPngDataUrl(
  dataUrl: string,
  opts?: { maxEdge?: number; width?: number; height?: number; background?: string }
): Promise<string> {
  const src = dataUrl.trim()
  if (!src) throw new Error('No image provided.')
  const maxEdge = opts?.maxEdge ?? 2048

  // Already a compact raster PNG — keep it.
  if (
    src.startsWith('data:image/png') &&
    src.length < 900_000 &&
    !opts?.width &&
    !opts?.height &&
    !opts?.background
  ) {
    return src
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const naturalW = Math.max(1, img.naturalWidth || opts?.width || 512)
      const naturalH = Math.max(1, img.naturalHeight || opts?.height || 512)
      const targetW = opts?.width || naturalW
      const targetH = opts?.height || naturalH
      const scale = Math.min(1, maxEdge / Math.max(targetW, targetH))
      const w = Math.max(1, Math.round(targetW * scale))
      const h = Math.max(1, Math.round(targetH * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Could not rasterize image.'))
        return
      }
      ctx.clearRect(0, 0, w, h)
      if (opts?.background) {
        ctx.fillStyle = opts.background
        ctx.fillRect(0, 0, w, h)
      }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('Could not load image for background removal.'))
    img.src = src
  })
}

/**
 * Soften an over-aggressive cutout: dilate the alpha mask and restore RGB from
 * the original so subject edges aren’t chewed away.
 */
export async function expandCutoutAlpha(
  originalDataUrl: string,
  cutoutDataUrl: string,
  dilatePx = 4
): Promise<string> {
  const load = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Could not load cutout image.'))
      img.src = src
    })

  const [original, cutout] = await Promise.all([load(originalDataUrl), load(cutoutDataUrl)])
  const w = Math.max(1, cutout.naturalWidth || original.naturalWidth)
  const h = Math.max(1, cutout.naturalHeight || original.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return cutoutDataUrl

  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(cutout, 0, 0, w, h)
  const cut = ctx.getImageData(0, 0, w, h)

  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(original, 0, 0, w, h)
  const orig = ctx.getImageData(0, 0, w, h)

  const n = w * h
  const alpha = new Uint8ClampedArray(n)
  // Faint model haze would otherwise get dilated into visible blobs.
  for (let i = 0, p = 0; i < cut.data.length; i += 4, p++) {
    const a = cut.data[i + 3]
    alpha[p] = a < 32 ? 0 : a
  }

  // Drop small disconnected islands of "subject" that aren't part of the cutout.
  const label = new Int32Array(n)
  const sizes: number[] = [0]
  const stack = new Int32Array(n)
  for (let start = 0; start < n; start++) {
    if (alpha[start] < 128 || label[start]) continue
    const id = sizes.length
    let top = 0
    let size = 0
    stack[top++] = start
    label[start] = id
    while (top > 0) {
      const p = stack[--top]
      size++
      const x = p % w
      for (let k = 0; k < 4; k++) {
        const q = k === 0 ? (x > 0 ? p - 1 : -1) : k === 1 ? (x < w - 1 ? p + 1 : -1) : k === 2 ? p - w : p + w
        if (q < 0 || q >= n || label[q] || alpha[q] < 128) continue
        label[q] = id
        stack[top++] = q
      }
    }
    sizes.push(size)
  }
  let largest = 0
  for (const size of sizes) if (size > largest) largest = size
  const minIsland = Math.min(largest * 0.02, n * 0.001)
  const strong = new Uint8Array(n)
  for (let p = 0; p < n; p++) {
    if (!label[p]) continue
    if (sizes[label[p]] < minIsland) alpha[p] = 0
    else strong[p] = 1
  }

  const radius = Math.max(1, Math.min(12, Math.round(dilatePx)))

  // Soft pixels only survive near a kept strong region.
  const reach = radius + 2
  const rowNear = new Uint8Array(n)
  for (let y = 0; y < h; y++) {
    let last = -Infinity
    for (let x = 0; x < w; x++) {
      if (strong[y * w + x]) last = x
      if (x - last <= reach) rowNear[y * w + x] = 1
    }
    last = Infinity
    for (let x = w - 1; x >= 0; x--) {
      if (strong[y * w + x]) last = x
      if (last - x <= reach) rowNear[y * w + x] = 1
    }
  }
  for (let x = 0; x < w; x++) {
    let last = -Infinity
    const near = new Uint8Array(h)
    for (let y = 0; y < h; y++) {
      if (rowNear[y * w + x]) last = y
      if (y - last <= reach) near[y] = 1
    }
    last = Infinity
    for (let y = h - 1; y >= 0; y--) {
      if (rowNear[y * w + x]) last = y
      if (last - y <= reach) near[y] = 1
    }
    for (let y = 0; y < h; y++) {
      const p = y * w + x
      if (!near[y] && alpha[p] < 128) alpha[p] = 0
    }
  }

  // Dilate alpha so thin/chewed edges grow back toward the subject.
  const dilated = new Uint8ClampedArray(alpha)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (alpha[i] >= 250) continue
      let maxA = alpha[i]
      for (let dy = -radius; dy <= radius && maxA < 255; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          if (dx * dx + dy * dy > radius * radius) continue
          const a = alpha[yy * w + xx]
          if (a > maxA) maxA = a
        }
      }
      dilated[i] = maxA
    }
  }

  const out = ctx.createImageData(w, h)
  for (let i = 0, p = 0; i < out.data.length; i += 4, p++) {
    const a = dilated[p]
    // Prefer original RGB wherever the expanded mask says “subject”.
    out.data[i] = orig.data[i]
    out.data[i + 1] = orig.data[i + 1]
    out.data[i + 2] = orig.data[i + 2]
    // Slightly raise mid alphas so soft edges don’t vanish, but never exceed the
    // original’s alpha — transparent source pixels must stay transparent.
    const raised = a < 18 ? 0 : Math.min(255, Math.round(a * 1.08))
    out.data[i + 3] = Math.min(raised, orig.data[i + 3])
  }
  ctx.putImageData(out, 0, 0)
  return canvas.toDataURL('image/png')
}

export function CreateSvgPanel({
  open,
  prompt,
  onPrompt,
  lastPrompt = '',
  onCopyPrompt,
  onStartOverPrompt,
  references = [],
  onRemoveReference,
  textChips = [],
  onRemoveTextChip,
  model,
  onModel,
  busy,
  status,
  configured,
  onSaveKey,
  onCreate,
  onAbort,
  onClose,
  onMenuAction,
  micOn = false,
  onMic,
  hearing = false
}: {
  open: boolean
  prompt: string
  onPrompt: (value: string) => void
  lastPrompt?: string
  onCopyPrompt?: () => void
  onStartOverPrompt?: () => void
  references?: CreateSvgReference[]
  onRemoveReference?: (id: string) => void
  textChips?: CreateSvgTextChip[]
  onRemoveTextChip?: (id: string) => void
  model: QuiverModelId
  onModel: (model: QuiverModelId) => void
  busy: boolean
  status?: string | null
  configured: boolean
  onSaveKey: (key: string) => void
  onCreate: (input: QuiverGenerateInput) => void
  onAbort?: () => void
  onClose?: () => void
  onMenuAction?: (action: CreateSvgMenuAction) => void
  micOn?: boolean
  onMic?: () => void
  hearing?: boolean
}) {
  const reduceMotion = useReducedMotion()
  const [modelOpen, setModelOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [options] = useState<CreateSvgOptions>(DEFAULT_OPTIONS)
  const [keyDraft, setKeyDraft] = useState('')
  const [ghostIndex, setGhostIndex] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const current = QUIVER_MODELS.find((item) => item.id === model) || QUIVER_MODELS[0]
  const primaryRef = references[0]?.dataUrl || null
  const hasImages = references.length > 0
  const hasChips = textChips.length > 0
  /** Real prompt that produced the selected/created SVG — never ghost text. */
  const savedPrompt = lastPrompt.trim()
  const hasSavedPrompt = Boolean(savedPrompt)
  const hasContext = hasImages || hasChips || hasSavedPrompt
  const menuActions = MENU_ACTIONS.filter((item) => !item.requiresImages || hasImages)
  // Paper: Copy / Start over only when there is a real generation prompt.
  const showPromptActions = hasSavedPrompt
  const ghostOptions = hasImages ? GHOST_PROMPTS_WITH_REF : GHOST_PROMPTS_EMPTY
  const showGhost = !prompt.trim() && !busy && !micOn
  const ghostPrompt = ghostOptions[ghostIndex % ghostOptions.length] || ghostOptions[0]
  const effectivePrompt = prompt.trim() || (showGhost ? ghostPrompt : '')
  const canCreate = Boolean(effectivePrompt) && !busy

  useEffect(() => {
    if (!open) {
      setModelOpen(false)
      setMenuOpen(false)
      setGhostIndex(0)
      return
    }
    const id = window.requestAnimationFrame(() => promptRef.current?.focus())
    return () => window.cancelAnimationFrame(id)
  }, [open])

  useEffect(() => {
    setGhostIndex(0)
  }, [hasImages, open])

  useEffect(() => {
    if (!showGhost || reduceMotion || ghostOptions.length < 2) return
    const id = window.setInterval(() => {
      setGhostIndex((value) => (value + 1) % ghostOptions.length)
    }, 3200)
    return () => window.clearInterval(id)
  }, [showGhost, reduceMotion, ghostOptions.length])

  useEffect(() => {
    const el = promptRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(140, Math.max(40, el.scrollHeight))}px`
  }, [prompt, open, textChips.length, references.length, showGhost, ghostPrompt])

  useEffect(() => {
    if (!modelOpen && !menuOpen) return
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setModelOpen(false)
        setMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [modelOpen, menuOpen])

  const transition = reduceMotion
    ? { duration: 0.08 }
    : { duration: 0.16, ease: [0.22, 1, 0.36, 1] as const }

  const ghostTransition = reduceMotion
    ? { duration: 0.01 }
    : { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const }

  const acceptGhost = () => {
    if (!showGhost || !ghostPrompt) return
    onPrompt(ghostPrompt)
  }

  const run = () => {
    const nextPrompt = effectivePrompt
    if (!nextPrompt || busy) return
    if (!prompt.trim() && showGhost) onPrompt(nextPrompt)
    const chipContext = textChips.map((chip) => chip.label).filter(Boolean)
    const instructions = [
      options.instructions,
      chipContext.length ? `Incorporate these design texts/labels where relevant: ${chipContext.join(' · ')}` : ''
    ]
      .filter(Boolean)
      .join('\n')
    onCreate({
      model,
      prompt: nextPrompt,
      instructions,
      referenceBase64: primaryRef,
      references: references.map((item) => item.dataUrl),
      n: options.n,
      temperature: options.temperature,
      reasoningEffort: options.reasoningEffort
    })
  }

  if (!open) return null

  if (!configured) {
    return (
      <div className="cursor-composer is-jev is-compact create-svg-composer" ref={root} data-chrome-overlay="">
        <div className="jev-composer-key">
          <span>QuiverAI needs an API key</span>
          <input
            type="password"
            placeholder="qv_… QuiverAI key"
            value={keyDraft}
            onChange={(event) => setKeyDraft(event.target.value)}
          />
          <button
            type="button"
            disabled={!keyDraft.trim()}
            onClick={() => {
              onSaveKey(keyDraft.trim())
              setKeyDraft('')
            }}
          >
            Save
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`cursor-composer is-jev is-compact create-svg-composer${busy ? ' is-busy' : ''}${hearing ? ' is-hearing' : ''}${micOn ? ' is-mic-on' : ''}${hasContext ? ' has-context' : ' is-empty'}`}
      ref={root}
      data-chrome-overlay=""
    >
      {hearing && !reduceMotion ? (
        <span className="cursor-composer-mic-ring" aria-hidden>
          <span className="cursor-composer-mic-ring-glow" />
          <span className="cursor-composer-mic-ring-stroke" />
        </span>
      ) : hearing ? (
        <span className="cursor-composer-mic-ring is-static" aria-hidden>
          <span className="cursor-composer-mic-ring-stroke" />
        </span>
      ) : null}

      {hasImages || showPromptActions ? (
        <div className="create-svg-top">
          <div className="create-svg-refs-row">
            {references.map((item) => (
              <div key={item.id} className="create-svg-ref-thumb">
                <img src={item.dataUrl} alt="" />
                <button
                  type="button"
                  className="create-svg-ref-x"
                  title="Remove image"
                  aria-label="Remove image"
                  disabled={busy}
                  onClick={() => onRemoveReference?.(item.id)}
                >
                  <CloseRoundedIcon sx={{ fontSize: 12 }} />
                </button>
              </div>
            ))}
            {hasSavedPrompt ? (
              <span className="create-svg-last-prompt" title={savedPrompt}>
                {savedPrompt}
              </span>
            ) : null}
          </div>
          <div className="create-svg-head-actions">
            {showPromptActions ? (
              <>
                <button
                  type="button"
                  className="cursor-composer-icon"
                  title="Start over from this prompt"
                  aria-label="Start over from this prompt"
                  disabled={busy}
                  onClick={() => {
                    onStartOverPrompt?.()
                    onPrompt(savedPrompt)
                    window.requestAnimationFrame(() => {
                      const el = promptRef.current
                      if (!el) return
                      el.focus()
                      el.setSelectionRange(savedPrompt.length, savedPrompt.length)
                    })
                  }}
                >
                  <StartOverPromptIcon size={18} />
                </button>
                <button
                  type="button"
                  className="cursor-composer-icon"
                  title="Copy prompt"
                  aria-label="Copy prompt"
                  disabled={busy}
                  onClick={() => {
                    void navigator.clipboard.writeText(savedPrompt).catch(() => undefined)
                    onCopyPrompt?.()
                  }}
                >
                  <ContentCopyOutlinedIcon sx={{ fontSize: 17 }} />
                </button>
              </>
            ) : null}
            {menuActions.length > 0 ? (
              <>
                <button
                  type="button"
                  className={`cursor-composer-icon${menuOpen ? ' is-on' : ''}`}
                  title="Options"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => {
                    setMenuOpen((value) => !value)
                    setModelOpen(false)
                  }}
                >
                  <MenuRoundedIcon sx={{ fontSize: 18 }} />
                </button>
                <AnimatePresence>
                  {menuOpen ? (
                    <motion.div
                      key="create-svg-options"
                      className="layer-menu create-svg-menu create-svg-options-menu"
                      role="menu"
                      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 2, scale: 0.99 }}
                      transition={transition}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <div className="layer-menu-section">
                        {menuActions.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            role="menuitem"
                            className="layer-menu-item"
                            disabled={busy}
                            onClick={() => {
                              setMenuOpen(false)
                              onMenuAction?.(item.id)
                            }}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {hasChips ? (
        <div className="create-svg-chips">
          {textChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className="create-svg-chip"
              title={`Remove “${chip.label}”`}
              disabled={busy}
              onClick={() => onRemoveTextChip?.(chip.id)}
            >
              <span>{chip.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className={`create-svg-prompt-shell${showGhost ? ' has-ghost' : ''}`}>
        {showGhost ? (
          <div className="create-svg-ghost" aria-hidden>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={ghostPrompt}
                className="create-svg-ghost-text"
                initial={reduceMotion ? { opacity: 0.55 } : { opacity: 0, y: 5, filter: 'blur(3px)' }}
                animate={{ opacity: 0.48, y: 0, filter: 'blur(0px)' }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, filter: 'blur(2px)' }}
                transition={ghostTransition}
              >
                {ghostPrompt}
              </motion.span>
            </AnimatePresence>
          </div>
        ) : null}
        <textarea
          ref={promptRef}
          className="cursor-composer-input"
          value={prompt}
          rows={2}
          placeholder={micOn ? 'Speak a change. Pause to create…' : ''}
          disabled={busy}
          spellCheck={!showGhost}
          onChange={(event) => onPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Tab' && showGhost) {
              event.preventDefault()
              acceptGhost()
              return
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              run()
            }
            if (event.key === 'Escape') onClose?.()
          }}
        />
      </div>

      {status && !busy && !/cancel|terminat|abort/i.test(status) ? (
        <div className="create-svg-status">{status}</div>
      ) : null}

      <div className="cursor-composer-row">
        <div className="cursor-composer-left">
          <div className="cursor-composer-mode" role="group" aria-label="Input mode">
            <button
              type="button"
              className={!micOn ? 'is-on' : ''}
              title="Typing"
              aria-pressed={!micOn}
              disabled={busy}
              onClick={() => {
                if (micOn) onMic?.()
              }}
            >
              <KeyboardOutlinedIcon sx={{ fontSize: 15 }} />
              <span>Typing</span>
            </button>
            <button
              type="button"
              className={micOn ? 'is-on' : ''}
              title="Microphone"
              aria-pressed={micOn}
              disabled={busy}
              onClick={() => {
                if (!micOn) onMic?.()
              }}
            >
              <MicNoneOutlinedIcon sx={{ fontSize: 15 }} />
              <span>Microphone</span>
            </button>
          </div>

          <div className="create-svg-model-wrap">
            <button
              type="button"
              className={`create-svg-model${modelOpen ? ' is-on' : ''}`}
              disabled={busy}
              onClick={() => {
                setModelOpen((value) => !value)
                setMenuOpen(false)
              }}
            >
              <AutoAwesomeOutlinedIcon sx={{ fontSize: 16 }} />
              <span>{current.label}</span>
              <KeyboardArrowDownIcon sx={{ fontSize: 18, opacity: 0.55 }} />
            </button>
            <AnimatePresence>
              {modelOpen ? (
                <motion.div
                  key="create-svg-models"
                  className="layer-menu create-svg-menu create-svg-model-menu"
                  role="menu"
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 2, scale: 0.99 }}
                  transition={transition}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <div className="layer-menu-section">
                    {QUIVER_MODELS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        className={`layer-menu-item create-svg-model-item${item.id === model ? ' is-on' : ''}`}
                        onClick={() => {
                          onModel(item.id)
                          setModelOpen(false)
                        }}
                      >
                        <span>
                          <strong>{item.label}</strong>
                          <em>{item.detail}</em>
                        </span>
                        {item.id === model ? <CheckRoundedIcon sx={{ fontSize: 16 }} /> : null}
                      </button>
                    ))}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>

        <div className="cursor-composer-right">
          {busy ? (
            <button type="button" className="cursor-send is-ready is-stop" title="Stop" onClick={() => onAbort?.()}>
              <span className="create-svg-stop-dot" />
            </button>
          ) : (
            <button
              type="button"
              className={`cursor-send${canCreate ? ' is-ready' : ''}`}
              title="Create SVG"
              disabled={!canCreate}
              onClick={run}
            >
              <ArrowUpwardIcon sx={{ fontSize: 18 }} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function useQuiverStream(onEvent: (event: QuiverStreamEvent) => void) {
  useEffect(() => {
    return window.vanta.onQuiver(onEvent)
  }, [onEvent])
}
