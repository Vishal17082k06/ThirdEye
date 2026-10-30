import { AlertCircle, CheckCircle2 } from 'lucide-react'

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="bw flex items-start gap-3 rounded-xl border-danger bg-danger-soft p-4 text-danger">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <p className="font-semibold">{message}</p>
    </div>
  )
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <div role="status" className="bw flex items-start gap-3 rounded-xl border-success bg-success-soft p-4 text-success">
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <p className="font-semibold">{message}</p>
    </div>
  )
}
