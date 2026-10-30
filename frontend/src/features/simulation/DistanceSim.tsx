import { Play, Radar, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, Card, CardHeader, Slider } from '../../design'
import { useSpeech } from '../../hooks/useSpeech'
import { postEvent } from '../../lib/events'
import { RiskBadge, SimulatedBadge } from '../ai/parts'
import { MAX_CM, MIN_CM, proximityBand } from './proximity'

/** Distance readings are logged at most this often. */
export const LOG_EVERY_MS = 5000
const STREAM_MS = 800

/**
 * Simulated distance sensor. Readings are generated here by a slider or a random walk, are labelled as simulated,
 * and never call the device heartbeat/report endpoints, so real sensor status is unaffected.
 */
export function DistanceSim() {
  const { announce } = useSpeech()
  const [cm, setCm] = useState(250)
  const [streaming, setStreaming] = useState(false)
  const lastLog = useRef(0)
  const walk = useRef(250)
  const band = proximityBand(cm)

  function update(next: number) {
    const value = Math.min(MAX_CM, Math.max(MIN_CM, Math.round(next)))
    walk.current = value
    setCm(value)
    const b = proximityBand(value)
    if (b.speak) announce(b.warning, b.risk)
    const now = Date.now()
    if (now - lastLog.current >= LOG_EVERY_MS) {
      lastLog.current = now
      void postEvent({
        type: 'distance_reading',
        source: 'simulation',
        title: `Simulated distance reading: ${value} cm`,
        details: { distanceCm: value, band: b.label, simulated: true },
      })
    }
  }
  const updateRef = useRef(update)
  updateRef.current = update

  useEffect(() => {
    if (!streaming) return
    const id = window.setInterval(() => {
      const step = (Math.random() - 0.5) * 120
      updateRef.current(walk.current + step)
    }, STREAM_MS)
    return () => window.clearInterval(id)
  }, [streaming])

  return (
    <Card as="section" aria-labelledby="distance-heading">
      <CardHeader
        id="distance-heading"
        headingLevel={3}
        title="Simulated distance sensor"
        description="Move the slider or start a stream of made-up readings."
        icon={<Radar className="h-5 w-5" aria-hidden="true" />}
        action={<SimulatedBadge />}
      />
      <div className="bw rounded-xl border-line bg-surface-muted p-4 text-center">
        <p className="text-sm font-semibold text-muted">Simulated reading</p>
        <p className="text-4xl font-extrabold text-ink" data-testid="distance-value">{cm} cm</p>
        <p className="mt-2 flex items-center justify-center gap-2">
          <RiskBadge risk={band.risk} />
          <span className="font-semibold text-ink">{band.label}</span>
        </p>
        <p role="status" aria-live="polite" className="mt-2 font-semibold text-ink">{band.warning}</p>
      </div>
      <div className="mt-4 space-y-4">
        <Slider
          label="Distance"
          min={MIN_CM}
          max={MAX_CM}
          step={5}
          value={cm}
          display={`${cm} cm`}
          onChange={(v) => update(v)}
          disabled={streaming}
          hint={streaming ? 'Stop the stream to set a distance by hand.' : undefined}
        />
        {streaming ? (
          <Button variant="danger" onClick={() => setStreaming(false)} leftIcon={<Square className="h-5 w-5" aria-hidden="true" />}>
            Stop simulated stream
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setStreaming(true)} leftIcon={<Play className="h-5 w-5" aria-hidden="true" />}>
            Start simulated stream
          </Button>
        )}
        <p className="text-sm text-muted">
          This does not change the real sensor status. Readings are saved to Activity History at most every 5 seconds, labelled as simulation.
        </p>
      </div>
    </Card>
  )
}
