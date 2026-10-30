import { MapPin } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Modal } from '../../design'
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

  // The note is kept through a rejection or an unknown outcome so it can be sent again; cleared once a record exists.
  useEffect(() => {
    if (state.result) setNote('')
  }, [state.result])

  function close() {
    // Esc, overlay click and the X do nothing while a send is in flight with no outcome yet.
    if (sending && !state.result) return
    if (confirming) setNote('')
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
            <Button variant="danger" className="min-h-14 text-lg" onClick={() => void flow.confirm(note)}>
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
        <SosResult
          record={state.result}
          error={state.error}
          busy={sending}
          sending={sending && !state.result ? { startedAt: state.startedAt, waitingForLocation: state.waitingForLocation } : null}
          guardianPhone={guardianPhone}
          onRetry={(id) => void flow.retry(id)}
          onSendAgain={() => void flow.sendAgain()}
        />
      </div>
    </Modal>
  )
}
