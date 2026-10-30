import { useQuery } from '@tanstack/react-query'
import { MailX } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Modal, Spinner } from '../../design'
import { api } from '../../lib/api'
import { postEvent } from '../../lib/events'
import { guardianIsSet, GUARDIAN_KEY, type Guardian } from '../account/useAccount'
import { SimulatedBadge } from '../ai/parts'

const STEPS = [
  'You press the SOS button (or say "Emergency SOS" and confirm).',
  'Third Eye would find your current location.',
  'Third Eye would email your guardian a message with your name and a map link.',
  'A notification and an Activity History entry would be created for you.',
]

/**
 * Dry run of the emergency workflow. It explains each step and who would be contacted, and the only thing it
 * records is a simulation event. Nothing is emailed and no location is read. The real SOS page can reuse it.
 */
export function SosDryRun({ open, onClose }: { open: boolean; onClose: () => void }) {
  const guardian = useQuery({ queryKey: GUARDIAN_KEY, queryFn: () => api.get<Guardian>('/guardian'), enabled: open })
  const [done, setDone] = useState<'idle' | 'saved' | 'unsaved'>('idle')
  const [running, setRunning] = useState(false)
  const g = guardian.data

  async function run() {
    setRunning(true)
    const saved = await postEvent({
      type: 'ai_analysis',
      source: 'simulation',
      title: 'SOS dry run (simulated, nothing sent)',
      details: { kind: 'sos_dry_run', simulated: true, emailSent: false, guardianConfigured: guardianIsSet(g) },
      status: 'dry_run',
    })
    setDone(saved ? 'saved' : 'unsaved')
    setRunning(false)
  }

  function close() {
    setDone('idle')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      wide
      title="Test SOS workflow (dry run)"
      description="See what an emergency alert would do. Nothing is sent."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
          <Button onClick={() => void run()} loading={running} disabled={done !== 'idle'}>
            Run dry-run
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <SimulatedBadge />
          <span className="text-sm font-semibold text-ink">This is a rehearsal only.</span>
        </div>
        <ol className="list-decimal space-y-1.5 pl-5 text-base text-ink">
          {STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>

        <div className="bw rounded-xl border-line bg-surface-muted p-4">
          <p className="text-sm font-semibold text-muted">Guardian who would be contacted</p>
          {guardian.isPending && <Spinner label="Loading guardian" />}
          {guardian.isError && <p className="text-ink">Your guardian could not be loaded.</p>}
          {g && guardianIsSet(g) && (
            <p className="text-ink">
              <span className="font-bold">{g.name}</span>
              {g.relationship ? ` (${g.relationship})` : ''}
              <br />
              {g.email} · {g.phone}
            </p>
          )}
          {g && !guardianIsSet(g) && (
            <p className="text-ink">
              No guardian is set up, so a real alert could not be sent.{' '}
              <Link to="/profile" onClick={close} className="font-bold text-primary underline underline-offset-4">
                Add a guardian in Profile
              </Link>
            </p>
          )}
          <p className="mt-3 text-sm font-semibold text-muted">Message that would be sent</p>
          <p className="text-ink">
            "Emergency alert from your Third Eye contact: they have asked for help. Their location link would be included here."
          </p>
        </div>

        <p className="bw flex items-start gap-3 rounded-xl border-line-strong p-3 font-semibold text-ink">
          <MailX className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          No email will be sent and no location is read. The dry run only records one simulation entry in Activity History.
        </p>

        {done === 'saved' && (
          <p role="status" className="bw rounded-xl border-success bg-success-soft p-3 font-semibold text-success">
            Dry run recorded as a simulation event. No email was sent.
          </p>
        )}
        {done === 'unsaved' && (
          <p role="status" className="bw rounded-xl border-warning bg-warning-soft p-3 font-semibold text-warning">
            Dry run finished. No email was sent, but the simulation entry could not be saved.
          </p>
        )}
      </div>
    </Modal>
  )
}
