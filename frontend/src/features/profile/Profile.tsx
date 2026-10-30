import { GuardianForm, PasswordForm, ProfileForm } from '../account/AccountForms'

export function Profile() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Profile</h1>
        <p className="mt-1 text-base text-muted">Each section below saves on its own.</p>
      </div>
      <ProfileForm />
      <GuardianForm />
      <PasswordForm />
    </div>
  )
}
