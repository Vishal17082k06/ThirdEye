import { useEffect, useRef } from 'react'
import { drawDetections, type Detection } from './detect'

interface Props {
  detections: Detection[]
  /** Natural size of the analysed image; the canvas is drawn at this size and scaled by CSS. */
  width: number
  height: number
}

/** Transparent overlay laid exactly over a video or image. Decorative: the same data is in the results list. */
export function DetectionCanvas({ detections, width, height }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx) drawDetections(ctx, width, height, detections)
  }, [detections, width, height])
  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
}
