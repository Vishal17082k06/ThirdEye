import { useEffect, useRef } from 'react'
import { drawDetections, type Detection } from './detect'

interface Props {
  detections: Detection[]
  /** Natural size of the analysed image; the canvas is drawn at this size and scaled by CSS. */
  width: number
  height: number
  /** True over a mirrored preview: the canvas is flipped the same way so boxes stay on their objects. */
  mirrored?: boolean
}

/** Transparent overlay laid exactly over a video or image. Decorative: the same data is in the results list. */
export function DetectionCanvas({ detections, width, height, mirrored = false }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx) drawDetections(ctx, width, height, detections, mirrored)
  }, [detections, width, height, mirrored])
  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" style={mirrored ? { transform: 'scaleX(-1)' } : undefined} />
}
