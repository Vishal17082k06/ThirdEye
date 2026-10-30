import { FlaskConical, MailWarning, MapPin, Phone } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Card, CardHeader, Spinner, buttonClasses } from '../../design'
import { cn } from '../../lib/cn'
import { ErrorBanner } from '../auth/FormBanner'
import { telHref } from './api'
import { locationText } from './location'
import { SosHistory } from './SosHistory'
import { useSosFlow } from './SosProvider'
import { SosResult } from './SosResult'

export function SosPage() {
  const flow = useSosFlow()
  const { live, status, guardian, guardianPhone, geo, state } = flow
  const { setLocationWanted } = flow

  useEffect(() => {
    setLocationWanted(true)
    return () => setLocationWanted(false)
  }, [setLocationWanted])

  const noGuardian = live && !!status && !status.guardian_ready
  const mailMissing = live && !!status && !status.email_configured
  const canPress = !live || flow.ready
  const callHref = telHref(guardianPhone)
  const dialogOpen = state.open
  const sending = state.phase === 'sending'
  // What the dialog last announced. When it closes, the page shows the same content without announcing it again;
  // a later change (for example pending to sent) has a new key and is announced.
  const key = `${state.error?.kind ?? ''}|${state.result ? `${state.result.id}:${state.result.status}:${state.result.attempts}` : ''}`
  const announced = useRef<string | null>(null)
  useEffect(() => {
    if (dialogOpen) announced.current = key
  }, [dialogOpen, key])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Emergency SOS</h1>
        <p className="mt-1 text-base text-muted">Alert your guardian by email with your location. You are asked to confirm before anything is sent.</p>
      </div>

      {!live && (
        <div role="note" className="bw flex items-start gap-3 rounded-xl border-sim bg-sim-soft p-4 text-sim">
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p className="font-semibold">
            SIMULATION MODE. The button below runs a practice alert only: no email is sent and no location is read. Real emergency alerts are only available in Live mode.
          </p>
        </div>
      )}

      {live && flow.statusError && <ErrorBanner message="Could not check whether SOS is ready. Reload the page. If this is an emergency, call your guardian directly." />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card className="flex flex-col items-center gap-4 text-center">
          <button
            type="button"
            onClick={flow.requestSend}
            disabled={!canPress || flow.statusLoading || flow.statusError || sending}
            className="bw flex h-48 w-48 flex-col items-center justify-center gap-1 rounded-full border-danger bg-danger p-4 text-white shadow-pop transition hover:brightness-90 focus-visible:outline-4 focus-visible:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-50 sm:h-56 sm:w-56"
          >
            <span className="text-5xl font-black tracking-wider">SOS</span>
            <span className="text-base font-bold leading-tight">{live ? 'Send emergency alert' : 'Practice alert (nothing is sent)'}</span>
          </button>
          <p className="text-sm text-muted">{live ? 'You will be asked to confirm first.' : 'Switch to Live mode to send a real alert.'}</p>
          {live && callHref && (
            <a href={callHref} className={cn(buttonClasses('secondary', true), 'min-h-14 text-lg')}>
              <Phone className="h-5 w-5" aria-hidden="true" />
              Call guardian
            </a>
          )}
        </Card>

        <div className="space-y-4">
          <div className="space-y-4">
            <SosResult
              silent={!dialogOpen && announced.current === key}
              record={dialogOpen ? null : state.result}
              error={dialogOpen ? null : state.error}
              busy={sending}
              sending={!dialogOpen && sending && !state.result ? { startedAt: state.startedAt, waitingForLocation: state.waitingForLocation } : null}
              guardianPhone={guardianPhone}
              onRetry={(id) => void flow.retry(id)}
              onSendAgain={() => void flow.sendAgain()}
            />
          </div>

          {live && (
            <Card as="section" aria-labelledby="ready-h">
              <CardHeader id="ready-h" title="Readiness" description="What will happen when you press SOS" />
              {flow.statusLoading ? (
                <p className="flex items-center gap-2 text-muted">
                  <Spinner size="sm" label="Checking readiness" /> Checking…
                </p>
              ) : (
                <ul className="space-y-3 text-base text-ink">
                  <li>
                    <span className="font-semibold">Guardian: </span>
                    {noGuardian ? (
                      <span>none with an email address</span>
                    ) : (
                      <span>
                        {status?.guardian_name || guardian?.name} {guardian?.email && <>({guardian.email})</>}
                      </span>
                    )}
                  </li>
                  <li className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                    <span>{locationText(geo.status, geo.position)}</span>
                  </li>
                </ul>
              )}

              {noGuardian && (
                <div className="bw mt-4 space-y-3 rounded-xl border-warning bg-warning-soft p-4 text-warning">
                  <p className="font-semibold">
                    You have not added a guardian email yet, so an emergency alert has nobody to go to. Add your guardian's name, phone and email in Profile first.
                  </p>
                  <Link to="/profile" className={cn(buttonClasses('primary'), 'min-h-14 text-lg')}>
                    Go to Profile
                  </Link>
                </div>
              )}

              {mailMissing && (
                <div role="note" className="bw mt-4 flex items-start gap-3 rounded-xl border-warning bg-warning-soft p-4 text-warning">
                  <MailWarning className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                  <p className="font-semibold">
                    Email service is not configured on the server — SOS emails cannot be sent. See setup instructions in the README. You can still try; the result will be shown honestly as failed, so call your guardian directly.
                  </p>
                </div>
              )}
              {status && status.email_configured && !noGuardian && (
                <p className="mt-3">
                  <Badge tone="success">Email service configured</Badge>
                </p>
              )}
            </Card>
          )}
        </div>
      </div>

      {live && <SosHistory onRetry={(id) => void flow.retry(id)} retryingId={state.retryingId} />}
    </div>
  )
}
