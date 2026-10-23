export type QuiverModelId = 'arrow-2' | 'arrow-2-telos'

export type QuiverStatus = {
  configured: boolean
}

export type QuiverGenerateInput = {
  model: QuiverModelId
  prompt: string
  instructions?: string
  referenceBase64?: string | null
  /** Multiple reference image data URLs or raw base64 strings. */
  references?: string[] | null
  n?: number
  temperature?: number
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
  viewBox?: { width: number; height: number }
}

/** Dedicated Quiver image→SVG vectorization (`POST /v1/svgs/vectorizations`). */
export type QuiverVectorizeInput = {
  model: QuiverModelId
  /** Raw base64 or data URL of the image to vectorize. */
  imageBase64: string
  autoCrop?: boolean
  targetSize?: number
  temperature?: number
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
  viewBox?: { width: number; height: number }
}

export type QuiverStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'reasoning'; text: string; index?: number; id?: string }
  | { type: 'draft'; svg: string; index?: number; id?: string }
  | { type: 'content'; svg: string; index?: number; id?: string }
  | { type: 'done'; svg: string; id?: string }
  | { type: 'error'; message: string }

export const QUIVER_MODELS: Array<{
  id: QuiverModelId
  label: string
  detail: string
}> = [
  {
    id: 'arrow-2',
    label: 'QuiverAI Arrow 2',
    detail: 'Balanced SVG quality and speed'
  },
  {
    id: 'arrow-2-telos',
    label: 'QuiverAI Arrow 2 Telos',
    detail: 'For detailed SVGs, takes more time'
  }
]
