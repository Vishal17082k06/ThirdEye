import { ApiError, normaliseDetail } from '../../lib/api'
import { getToken } from '../../lib/token'
import type { ClientEventSource } from '../../lib/events'
import type { Risk } from '../../hooks/useSpeech'

export type Position = 'left' | 'ahead' | 'right'

export interface Detection {
  label: string
  /** 0..1 */
  confidence: number
  /** Normalised 0..1, top-left origin. */
  box: { x: number; y: number; w: number; h: number }
  position: Position
  risk: Risk
  announcement: string
}

export interface DetectResult {
  detections: Detection[]
  summary: { text: string; highest_risk: Risk | null }
  image: { width: number; height: number }
  inference_ms: number
  source: string
  model: string
}

/** The model file is missing on the server (HTTP 503). Never replaced by fabricated detections. */
export class EngineUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineUnavailableError'
  }
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png']

/** Returns a message if the file cannot be sent, otherwise undefined. */
export function validateImageFile(file: File): string | undefined {
  if (!ACCEPTED_TYPES.includes(file.type)) return 'Choose a JPEG or PNG image.'
  if (file.size > MAX_UPLOAD_BYTES) return 'That image is larger than 10 MB. Choose a smaller one.'
  if (file.size === 0) return 'That file is empty.'
  return undefined
}

export interface DetectOptions {
  source: ClientEventSource
  record: boolean
  signal?: AbortSignal
}

/** POST /api/detect (multipart). `conf` is deliberately omitted so the server uses the user's saved threshold. */
export async function detectImage(image: Blob, { source, record, signal }: DetectOptions): Promise<DetectResult> {
  const form = new FormData()
  const name = image.type === 'image/png' ? 'frame.png' : 'frame.jpg'
  form.append('file', image, name)
  form.append('source', source)
  form.append('record', record ? 'true' : 'false')

  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch('/api/detect', { method: 'POST', headers, body: form, signal })
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') throw err
    throw new ApiError(0, 'Cannot reach the Third Eye server. Check your connection and try again.')
  }
  let data: unknown = null
  try {
    data = JSON.parse(await res.text())
  } catch {
    data = null
  }
  if (!res.ok) {
    const message = normaliseDetail((data as { detail?: unknown } | null)?.detail, `Detection failed (${res.status}).`)
    if (res.status === 503) throw new EngineUnavailableError(message)
    throw new ApiError(res.status, message)
  }
  return data as DetectResult
}

export interface RiskMeta {
  label: string
  /** Badge tone from the design system. */
  tone: 'success' | 'info' | 'warning' | 'danger'
  /** Box colour on the canvas (all pass 3:1 on dark and light video via the white label plate). */
  color: string
  /** Canvas line dash: pattern as well as colour, so risk is never colour-only. */
  dash: number[]
  lineWidth: number
  description: string
}

export const RISK_ORDER: Risk[] = ['low', 'medium', 'high', 'critical']

export const RISK_META: Record<Risk, RiskMeta> = {
  low: { label: 'Low', tone: 'success', color: '#15803d', dash: [], lineWidth: 3, description: 'Small or distant object, or off to one side.' },
  medium: { label: 'Medium', tone: 'info', color: '#1d4ed8', dash: [10, 6], lineWidth: 4, description: 'Object that may need attention soon.' },
  high: { label: 'High', tone: 'warning', color: '#b45309', dash: [3, 4], lineWidth: 5, description: 'Large or close object, or a person or vehicle ahead.' },
  critical: { label: 'Critical', tone: 'danger', color: '#b91c1c', dash: [], lineWidth: 7, description: 'Person or vehicle very close and ahead. Stop.' },
}

export function boxLabel(d: Detection): string {
  return `${RISK_META[d.risk].label.toUpperCase()} ${d.label} ${Math.round(d.confidence * 100)}% ${d.position}`
}

/** Draws every detection box with colour, line style, and a text plate (label, confidence, position, risk). */
export function drawDetections(ctx: CanvasRenderingContext2D, width: number, height: number, detections: Detection[], mirrored = false): void {
  ctx.clearRect(0, 0, width, height)
  const font = Math.max(14, Math.round(width / 48))
  ctx.font = `700 ${font}px system-ui, sans-serif`
  ctx.textBaseline = 'top'
  for (const d of detections) {
    const meta = RISK_META[d.risk]
    const x = d.box.x * width
    const y = d.box.y * height
    const w = d.box.w * width
    const h = d.box.h * height
    ctx.setLineDash(meta.dash)
    ctx.lineWidth = meta.lineWidth
    ctx.strokeStyle = meta.color
    ctx.strokeRect(x, y, w, h)
    if (d.risk === 'critical') {
      // A second inner outline makes critical boxes distinguishable without colour.
      ctx.setLineDash([])
      ctx.lineWidth = 2
      ctx.strokeStyle = '#ffffff'
      ctx.strokeRect(x + meta.lineWidth, y + meta.lineWidth, Math.max(0, w - meta.lineWidth * 2), Math.max(0, h - meta.lineWidth * 2))
    }
    ctx.setLineDash([])
    const text = boxLabel(d)
    const pad = 4
    const textW = ctx.measureText(text).width + pad * 2
    const plateY = y - font - pad * 2 >= 0 ? y - font - pad * 2 : y
    // When the whole canvas is flipped by CSS, flip each plate back about its own centre so text reads normally.
    ctx.save()
    if (mirrored) {
      ctx.translate(x + textW / 2, 0)
      ctx.scale(-1, 1)
      ctx.translate(-(x + textW / 2), 0)
    }
    ctx.fillStyle = meta.color
    ctx.fillRect(x, plateY, textW, font + pad * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(text, x + pad, plateY + pad)
    ctx.restore()
  }
}
