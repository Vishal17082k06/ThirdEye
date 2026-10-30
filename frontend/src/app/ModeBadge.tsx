import { FlaskConical, Radio } from 'lucide-react'
import { Badge } from '../design'
import { useMode } from '../lib/mode'

/** Permanent operating-mode indicator (spec section 2): never hidden, never ambiguous. */
export function ModeBadge() {
  const { mode } = useMode()
  if (mode === 'simulation') {
    return (
      <Badge tone="simulation" icon={<FlaskConical className="h-4 w-4" aria-hidden="true" />} className="uppercase tracking-wide">
        Simulation mode
      </Badge>
    )
  }
  return (
    <Badge tone="live" icon={<Radio className="h-4 w-4" aria-hidden="true" />} className="uppercase tracking-wide">
      Live mode
    </Badge>
  )
}
