import { Cpu } from 'lucide-react'
import { useState } from 'react'
import { Card, CardHeader, Select } from '../../design'
import { SimulatedBadge } from '../ai/parts'

const DEVICES = [
  { key: 'laptop_camera', name: 'Laptop/USB Camera' },
  { key: 'esp32_cam', name: 'ESP32-CAM' },
  { key: 'vl53l0x', name: 'VL53L0X Distance Sensor' },
  { key: 'vibration_motor', name: 'Vibration Motor' },
  { key: 'battery', name: 'Battery Monitoring' },
] as const

type Pretend = 'connected' | 'disconnected' | 'error'
const LABEL: Record<Pretend, string> = { connected: 'Connected', disconnected: 'Disconnected', error: 'Error' }

/** Pretend device statuses for trying the interface. Local to this panel: nothing is sent and real cards are unaffected. */
export function DeviceSim() {
  const [state, setState] = useState<Record<string, Pretend>>(() => Object.fromEntries(DEVICES.map((d) => [d.key, 'connected'])))
  return (
    <Card as="section" aria-labelledby="devsim-heading">
      <CardHeader
        id="devsim-heading"
        headingLevel={3}
        title="Device status simulation"
        description="Pretend a device is connected or has failed."
        icon={<Cpu className="h-5 w-5" aria-hidden="true" />}
        action={<SimulatedBadge />}
      />
      <ul className="space-y-3">
        {DEVICES.map((d) => (
          <li key={d.key} className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Select
                label={`${d.name} (simulated)`}
                value={state[d.key]}
                onChange={(e) => setState((s) => ({ ...s, [d.key]: e.target.value as Pretend }))}
              >
                {(Object.keys(LABEL) as Pretend[]).map((k) => (
                  <option key={k} value={k}>{LABEL[k]}</option>
                ))}
              </Select>
            </div>
            <span className="pb-2 text-sm font-semibold text-sim" data-testid={`sim-${d.key}`}>
              <SimulatedBadge /> {LABEL[state[d.key]]}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-muted">These are not real statuses. Nothing here is sent to the server and Device Management is not changed.</p>
    </Card>
  )
}
