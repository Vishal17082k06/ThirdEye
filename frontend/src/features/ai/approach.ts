import { RISK_RANK, type Risk } from '../../hooks/useSpeech'
import type { Detection, DetectResult } from './detect'

export const VEHICLE_CLASSES = ['car', 'bus', 'truck', 'motorcycle', 'bicycle', 'train']
/** A vehicle counts as approaching when its box area grew by at least this fraction between frames. */
export const GROWTH_THRESHOLD = 0.15
export const APPROACH_TEXT = 'Vehicle approaching.'

type Box = Detection['box']

const area = (b: Box) => b.w * b.h

export function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = area(a) + area(b) - inter
  return union > 0 ? inter / union : 0
}

function centreDistance(a: Box, b: Box): number {
  return Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2))
}

/** The same vehicle class in an earlier frame whose box overlaps, or whose centre is close to, this one. */
function match(d: Detection, earlier: Detection[]): Detection | null {
  let best: Detection | null = null
  let bestScore = 0
  for (const e of earlier) {
    if (e.label !== d.label) continue
    const overlap = iou(d.box, e.box)
    const near = centreDistance(d.box, e.box) < 0.2
    if (overlap < 0.1 && !near) continue
    const score = overlap + (near ? 0.1 : 0)
    if (score > bestScore) {
      best = e
      bestScore = score
    }
  }
  return best
}

/**
 * Temporal evidence for "Vehicle approaching": indices of current vehicle detections that were matched in an
 * earlier frame (about 2 frames back; the oldest available if fewer) and whose area grew >= 15 %, while
 * ahead of the user or tall in the frame (height > 0.35). A single frame can never produce this.
 * `previous` is oldest first.
 */
export function findApproaching(previous: Detection[][], current: Detection[]): number[] {
  if (previous.length === 0) return []
  const earlier = previous[Math.max(0, previous.length - 2)]
  const out: number[] = []
  current.forEach((d, i) => {
    if (!VEHICLE_CLASSES.includes(d.label)) return
    if (d.position !== 'ahead' && d.box.h <= 0.35) return
    const before = match(d, earlier)
    if (!before) return
    const base = area(before.box)
    if (base > 0 && (area(d.box) - base) / base >= GROWTH_THRESHOLD) out.push(i)
  })
  return out
}

/** Server announcement unchanged, unless temporal evidence says a vehicle is approaching. */
export function withApproach(result: DetectResult, approaching: number[]): { text: string; risk: Risk | null } {
  if (approaching.length === 0) return { text: result.summary.text, risk: result.summary.highest_risk }
  const server = result.summary.highest_risk
  const risk: Risk = server && RISK_RANK[server] > RISK_RANK.high ? server : 'high'
  return { text: APPROACH_TEXT, risk }
}
