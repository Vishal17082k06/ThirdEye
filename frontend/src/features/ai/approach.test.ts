import { describe, expect, it } from 'vitest'
import { APPROACH_TEXT, findApproaching, iou, withApproach } from './approach'
import type { Detection, DetectResult } from './detect'

const det = (label: string, x: number, y: number, w: number, h: number, position: Detection['position'] = 'ahead'): Detection => ({
  label,
  confidence: 0.9,
  box: { x, y, w, h },
  position,
  risk: 'high',
  announcement: `${label} ahead.`,
})

describe('findApproaching', () => {
  it('needs earlier frames: a single frame never says approaching', () => {
    expect(findApproaching([], [det('car', 0.3, 0.3, 0.4, 0.4)])).toEqual([])
  })
  it('flags a matched vehicle whose area grew by 15% or more', () => {
    const prev = [[det('car', 0.3, 0.3, 0.2, 0.2)], [det('car', 0.3, 0.3, 0.2, 0.2)]]
    expect(findApproaching(prev, [det('car', 0.28, 0.28, 0.26, 0.26)])).toEqual([0])
  })
  it('does not flag small growth, shrinking, or a different class', () => {
    const prev = [[det('car', 0.3, 0.3, 0.2, 0.2)]]
    expect(findApproaching(prev, [det('car', 0.3, 0.3, 0.21, 0.21)])).toEqual([])
    expect(findApproaching(prev, [det('car', 0.3, 0.3, 0.1, 0.1)])).toEqual([])
    expect(findApproaching(prev, [det('person', 0.28, 0.28, 0.3, 0.3)])).toEqual([])
    expect(findApproaching([[det('person', 0.3, 0.3, 0.2, 0.2)]], [det('person', 0.28, 0.28, 0.3, 0.3)])).toEqual([])
  })
  it('requires ahead or box height above 0.35', () => {
    const prev = [[det('bus', 0.0, 0.5, 0.1, 0.1, 'left')]]
    expect(findApproaching(prev, [det('bus', 0.0, 0.5, 0.2, 0.2, 'left')])).toEqual([])
    const tall = [[det('bus', 0.0, 0.1, 0.1, 0.3, 'left')]]
    expect(findApproaching(tall, [det('bus', 0.0, 0.1, 0.15, 0.4, 'left')])).toEqual([0])
  })
  it('does not match a vehicle far from the earlier one', () => {
    const prev = [[det('car', 0.0, 0.0, 0.1, 0.1)]]
    expect(findApproaching(prev, [det('car', 0.7, 0.7, 0.3, 0.3)])).toEqual([])
  })
  it('iou is 0 for disjoint boxes and 1 for identical', () => {
    expect(iou({ x: 0, y: 0, w: 0.1, h: 0.1 }, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 })).toBe(0)
    expect(iou({ x: 0, y: 0, w: 0.1, h: 0.1 }, { x: 0, y: 0, w: 0.1, h: 0.1 })).toBe(1)
  })
})

describe('withApproach', () => {
  const result = { summary: { text: 'Vehicle ahead.', highest_risk: 'medium' } } as DetectResult
  it('keeps the server text when nothing approaches', () => {
    expect(withApproach(result, [])).toEqual({ text: 'Vehicle ahead.', risk: 'medium' })
  })
  it('says Vehicle approaching with at least high risk when evidence exists', () => {
    expect(withApproach(result, [0])).toEqual({ text: APPROACH_TEXT, risk: 'high' })
  })
})
