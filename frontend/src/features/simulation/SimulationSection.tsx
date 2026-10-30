import { FlaskConical, Layers, Navigation, ShieldAlert, Volume2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, buttonClasses, Card, CardHeader, Select, Switch } from '../../design'
import { useSpeech } from '../../hooks/useSpeech'
import { postEvent } from '../../lib/events'
import type { DetectResult } from '../ai/detect'
import { SimulatedBadge } from '../ai/parts'
import { DeviceSim } from './DeviceSim'
import { DistanceSim } from './DistanceSim'
import { scenarioResult, SCENARIOS } from './scenarios'
import { SosDryRun } from './SosDryRun'

export const TEST_VOICE_TEXT = 'This is a Third Eye test announcement. Obstacle ahead, please slow down.'

/** Simulation-only tools. Shown by the AI page in Simulation mode; nothing here calls the detector or device endpoints. */
export function SimulationSection({ onScenario }: { onScenario: (result: DetectResult) => void }) {
  const { speak, supported } = useSpeech()
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id)
  const [record, setRecord] = useState(true)
  const [sos, setSos] = useState(false)
  const [voiceNote, setVoiceNote] = useState<string | null>(null)
  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0]

  function runScenario() {
    onScenario(scenarioResult(scenario))
    if (record) {
      const high = scenario.highest === 'high' || scenario.highest === 'critical'
      void postEvent({
        // Not 'obstacle': scenario events must never appear in obstacle lists or counts.
        type: 'ai_analysis',
        source: 'simulation',
        title: `Simulated scenario: ${scenario.name}`,
        details: { kind: 'scenario', simulated: true, scenario: scenario.id, highest_risk: scenario.highest, count: scenario.detections.length },
        notify: high,
      })
    }
  }

  function testVoice() {
    const spoke = speak(TEST_VOICE_TEXT, { force: true })
    setVoiceNote(spoke ? 'Speaking the test announcement now.' : 'This browser could not speak.')
  }

  return (
    <section aria-labelledby="sim-tools-heading" className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="sim-tools-heading" className="text-xl font-bold text-ink">Simulation tools</h2>
        <SimulatedBadge />
      </div>
      <p className="-mt-3 text-base text-muted">Everything below is simulated. None of it is sent to the detector or counted as live or hardware data.</p>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card as="section" aria-labelledby="scenario-heading">
          <CardHeader
            id="scenario-heading"
            headingLevel={3}
            title="Scenarios"
            description="Run a made-up scene through the same announcements and history."
            icon={<Layers className="h-5 w-5" aria-hidden="true" />}
            action={<SimulatedBadge />}
          />
          <div className="space-y-4">
            <Select label="Scenario" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} hint={scenario.description}>
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
            <Switch
              label="Record in Activity History"
              description="Saved as a simulation event. High risk scenarios also create a notification."
              checked={record}
              onChange={setRecord}
            />
            <Button onClick={runScenario} leftIcon={<FlaskConical className="h-5 w-5" aria-hidden="true" />}>
              Run scenario
            </Button>
          </div>
        </Card>

        <DistanceSim />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card as="section" aria-labelledby="tools-heading">
          <CardHeader id="tools-heading" headingLevel={3} title="Try the interface" description="Test voice, SOS and navigation." icon={<Volume2 className="h-5 w-5" aria-hidden="true" />} />
          <div className="space-y-4">
            <div className="space-y-1">
              <Button variant="secondary" onClick={testVoice} disabled={!supported} leftIcon={<Volume2 className="h-5 w-5" aria-hidden="true" />}>
                Test voice announcement
              </Button>
              {!supported && <p className="text-sm text-muted">This browser does not support speech.</p>}
              {voiceNote && <p role="status" className="text-sm text-muted">{voiceNote}</p>}
            </div>
            <div className="space-y-1">
              <Button variant="secondary" onClick={() => setSos(true)} leftIcon={<ShieldAlert className="h-5 w-5" aria-hidden="true" />}>
                Test SOS workflow
              </Button>
              <p className="text-sm text-muted">A dry run. No email is sent.</p>
            </div>
            <div className="space-y-1">
              <Link to="/navigation" className={buttonClasses('secondary')}>
                <Navigation className="h-5 w-5" aria-hidden="true" /> Test navigation interface
              </Link>
              <p className="text-sm text-muted">Opens the Navigation page. Route steps and your position are not simulated hardware data.</p>
            </div>
          </div>
        </Card>

        <DeviceSim />
      </div>

      <SosDryRun open={sos} onClose={() => setSos(false)} />
    </section>
  )
}
