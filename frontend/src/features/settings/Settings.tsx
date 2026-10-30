import { Button, Spinner } from '../../design'
import { ErrorBanner } from '../auth/FormBanner'
import { useSettings } from '../../lib/settings'
import { GuardianForm, PasswordForm, ProfileForm } from '../account/AccountForms'
import { AccessibilitySection, AiSection, CameraSection, EmergencySection, HardwareSection, VoiceSection } from './sections'

const SECTIONS = [
  ['settings-account', 'Account'],
  ['settings-camera', 'Camera'],
  ['settings-hardware', 'Hardware'],
  ['settings-ai', 'AI'],
  ['settings-voice', 'Voice'],
  ['settings-accessibility', 'Accessibility'],
  ['settings-emergency', 'Emergency'],
] as const

export function Settings() {
  const q = useSettings()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Settings</h1>
        <p className="mt-1 text-base text-muted">Every section has its own Save button.</p>
      </div>

      <nav aria-label="Settings sections">
        <ul className="flex flex-wrap gap-2">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="bw flex min-h-[var(--control-h)] items-center rounded-xl border-line-strong bg-surface px-4 font-semibold text-ink hover:bg-surface-muted"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <section id="settings-account" aria-labelledby="settings-account-title" className="scroll-mt-24 space-y-6">
        <h2 id="settings-account-title" className="text-xl font-bold text-ink">
          Account
        </h2>
        <ProfileForm id="settings-profile" />
        <GuardianForm id="settings-guardian" />
        <PasswordForm id="settings-password" />
      </section>

      {q.isPending && <Spinner label="Loading settings" />}
      {q.isError && (
        <div className="space-y-3">
          <ErrorBanner message="Could not load your settings." />
          <Button variant="secondary" onClick={() => q.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {q.data && (
        <>
          <CameraSection settings={q.data.camera} />
          <HardwareSection settings={q.data.hardware} />
          <AiSection settings={q.data.ai} />
          <VoiceSection settings={q.data.voice} />
          <AccessibilitySection settings={q.data.accessibility} />
          <EmergencySection settings={q.data.emergency} />
        </>
      )}
    </div>
  )
}
