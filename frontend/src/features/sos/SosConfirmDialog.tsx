import { MapPin } from 'lucide-react'
import { useState } from 'react'
import { Button, Modal, Spinner } from '../../design'
import type { SosFlow } from './SosProvider'
import { locationText } from './location'
import { SosResult } from './SosResult'

/**
 * One dialog for the whole flow: confirm, sending, outcome. It is mounted once by SosProvider (in the Shell)
 * so the topbar shortcut and, later, the voice assistant can open it from any page.
 */
export function SosConfirmDialog({ flow }: { flow: SosFlow }) {
  const { state, status, guardian, guardianPhone, geo } = flow
  const [note, setNote] = useState('')
  const name = status?.guardian_name || guardian?.name || 'your guardian'
  const email = guardian?.email || state.result?.guardian_email || ''
  const confirming = state.phase === 'confirming'
  const sending = state.phase === 'sending'

  function close() {
    setNote('')
    flow.cancel()
  }

  const title = confirming ? 'Send emergency alert?' : sending ? 'Sending emergency alert' : 'Emergency alert result'

  return (
    <Modal
      open={state.open}
      onClose={close}
      title={title}
      description={
        confirming ? `Send emergency alert to ${name}${email ? ` ${email}` : ''}? This will email them your location if available.` : undefined
      }
      footer={
        confirming ? (
          <>
            <Button variant="secondary" className="min-h-14 text-lg" onClick={close}>
              Cancel
            </Button>
            <Button variant="danger" className="min-h-14 text-lg" onClick={() => {
                const n = note
                setNote('')
                void flow.confirm(n)
              }}>
              Send now
            </Button>
          </>
        ) : sending ? undefined : (
          <Button variant="secondary" className="min-h-14 text-lg" onClick={close}>
            Close
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {confirming && (
          <>
            <p className="bw flex items-start gap-2 rounded-xl border-line bg-surface-muted p-3 text-base font-semibold text-ink">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              {locationText(geo.status, geo.position)}
            </p>
            <label className="block">
              <span className="text-base font-semibold text-ink">Optional note (max 300 characters)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                rows={2}
                className="bw mt-1 w-full rounded-xl border-line-strong bg-surface p-3 text-base text-ink"
              />
            </label>
          </>
        )}
        {sending && !state.result && (
          <p role="status" className="flex items-center gap-3 text-lg font-bold text-ink">
            <Spinner size="md" label="" /> Sending your alert… Getting your location, then contacting the mail server.
          </p>
        )}
        {(state.result || state.error || (sending && state.result)) && (
          <SosResult record={state.result} error={state.error} busy={sending} guardianPhone={guardianPhone} onRetry={(id) => void flow.retry(id)} />
        )}
      </div>
    </Modal>
  )
}
