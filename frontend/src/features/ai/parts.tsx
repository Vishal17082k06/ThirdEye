import { CircleAlert, Info, OctagonAlert, ShieldCheck, TriangleAlert, type LucideIcon } from 'lucide-react'
import { Badge } from '../../design'
import type { Risk } from '../../hooks/useSpeech'
import { RISK_META, RISK_ORDER, type Detection } from './detect'

const RISK_ICON: Record<Risk, LucideIcon> = { low: ShieldCheck, medium: Info, high: TriangleAlert, critical: OctagonAlert }

/** Risk is always shown as text plus an icon, never colour alone. */
export function RiskBadge({ risk }: { risk: Risk }) {
  const Icon = RISK_ICON[risk]
  return (
    <Badge tone={RISK_META[risk].tone} icon={<Icon className="h-4 w-4" aria-hidden="true" />}>
      {RISK_META[risk].label}
    </Badge>
  )
}

export function SimulatedBadge({ className }: { className?: string }) {
  return (
    <Badge tone="simulation" className={`uppercase tracking-wide ${className ?? ''}`}>
      Simulated
    </Badge>
  )
}

export function RiskLegend() {
  return (
    <ul aria-label="Risk levels" className="grid gap-2 sm:grid-cols-2">
      {RISK_ORDER.map((r) => (
        <li key={r} className="flex items-start gap-3">
          <svg width="40" height="22" viewBox="0 0 40 22" aria-hidden="true" className="mt-0.5 shrink-0">
            <rect
              x="3"
              y="3"
              width="34"
              height="16"
              fill="none"
              stroke={RISK_META[r].color}
              strokeWidth={Math.min(RISK_META[r].lineWidth, 5)}
              strokeDasharray={RISK_META[r].dash.join(' ') || undefined}
            />
          </svg>
          <span className="min-w-0 text-sm">
            <RiskBadge risk={r} /> <span className="text-muted">{RISK_META[r].description}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

export const HONESTY_NOTE = 'Camera detection cannot confirm that a path is safe. Stay alert and use your cane or guide.'

export function HonestyNote() {
  return (
    <p role="note" className="bw flex items-start gap-3 rounded-xl border-warning bg-warning-soft p-4 font-semibold text-warning">
      <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      {HONESTY_NOTE}
    </p>
  )
}

export function DetectionList({ detections }: { detections: Detection[] }) {
  if (detections.length === 0) return <p className="text-sm text-muted">No objects detected in this frame.</p>
  return (
    <ul className="divide-y divide-line" aria-label="Detections">
      {detections.map((d, i) => (
        <li key={`${d.label}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
          <div className="min-w-0">
            <p className="font-bold capitalize text-ink">{d.label}</p>
            <p className="text-sm text-muted">
              {Math.round(d.confidence * 100)}% confidence, {d.position === 'ahead' ? 'ahead' : `on your ${d.position}`}
            </p>
          </div>
          <RiskBadge risk={d.risk} />
        </li>
      ))}
    </ul>
  )
}
