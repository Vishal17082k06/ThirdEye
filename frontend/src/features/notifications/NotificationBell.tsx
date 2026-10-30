import { Bell, Car, Cpu, FlaskConical, Info, Navigation, ShieldAlert, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { Badge, Button, Modal, Popover, useToast } from '../../design'
import { ApiError } from '../../lib/api'
import { absoluteTime, relativeTime } from '../../lib/relativeTime'
import { useNotificationActions, useNotifications, type AppNotification } from './useNotifications'

function kindIcon(kind: string): LucideIcon {
  const k = kind.toLowerCase()
  if (k.includes('obstacle')) return TriangleAlert
  if (k.includes('device') || k.includes('camera') || k.includes('sensor')) return Cpu
  if (k.includes('nav')) return Navigation
  if (k.includes('ride') || k.includes('book')) return Car
  if (k.includes('sos') || k.includes('emergency')) return ShieldAlert
  return Info
}

function Item({ n, onRead, busy }: { n: AppNotification; onRead: (id: number) => void; busy: boolean }) {
  const Icon = kindIcon(n.kind)
  return (
    <li className={`flex gap-3 py-3 ${n.read ? '' : 'bg-primary-soft/40 rounded-xl px-2'}`}>
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm text-ink ${n.read ? 'font-medium' : 'font-bold'}`}>
          {!n.read && <span className="sr-only">Unread: </span>}
          {n.title}
        </p>
        {n.body && <p className="text-sm text-muted">{n.body}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
          <time dateTime={n.created_at} title={absoluteTime(n.created_at)}>
            {relativeTime(n.created_at)}
          </time>
          {n.source === 'simulation' && (
            <Badge tone="simulation" icon={<FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />}>
              Simulation
            </Badge>
          )}
        </p>
        {!n.read && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRead(n.id)}
            aria-label={`Mark as read: ${n.title}`}
            className="mt-1 flex min-h-[var(--control-h)] items-center text-sm font-bold text-primary underline underline-offset-4 disabled:opacity-60"
          >
            Mark as read
          </button>
        )}
      </div>
    </li>
  )
}

export function NotificationBell() {
  const q = useNotifications()
  const { markRead, markAllRead, clearAll } = useNotificationActions()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const bellRef = useRef<HTMLButtonElement>(null)
  const unread = q.data?.unread_count ?? 0
  const items = q.data?.items ?? []

  const fail = (err: unknown) =>
    toast.show({ tone: 'error', title: 'Could not update notifications', message: err instanceof ApiError ? err.message : undefined })

  async function confirmClear() {
    try {
      await clearAll.mutateAsync()
      toast.show({ tone: 'success', title: 'Notifications cleared' })
    } catch (err) {
      fail(err)
    } finally {
      setConfirming(false)
      window.setTimeout(() => bellRef.current?.focus(), 0)
    }
  }

  return (
    <>
      {/* Announces the count politely whenever it changes. */}
      <span role="status" className="sr-only">
        {unread > 0 ? `${unread} unread notification${unread === 1 ? '' : 's'}` : ''}
      </span>
      <Popover
        label="Notifications"
        className="w-[min(24rem,calc(100vw-2rem))]"
        trigger={(props) => (
          <button
            ref={bellRef}
            type="button"
            {...props}
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications, none unread'}
            className="bw relative flex h-[var(--control-h)] w-[var(--control-h)] items-center justify-center rounded-xl border-line-strong bg-surface text-ink hover:bg-surface-muted"
          >
            <Bell className="h-5 w-5" aria-hidden="true" />
            {unread > 0 && (
              <span
                aria-hidden="true"
                className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-danger px-1 text-xs font-bold text-white"
              >
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>
        )}
      >
        {(close) => (
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold text-ink">Notifications</p>
              <p className="text-sm text-muted">{unread > 0 ? `${unread} unread` : 'All read'}</p>
            </div>
            {q.isError && !q.data && <p className="mt-2 text-sm font-semibold text-danger">Could not load notifications.</p>}
            {q.isPending && <p className="mt-2 text-sm text-muted">Loading</p>}
            {q.data && items.length === 0 && (
              <p className="mt-2 text-sm text-muted">
                You have no notifications. Alerts about devices, obstacles, rides and SOS will appear here.
              </p>
            )}
            {items.length > 0 && (
              <ul className="mt-2 max-h-80 divide-y divide-line overflow-y-auto">
                {items.map((n) => (
                  <Item
                    key={n.id}
                    n={n}
                    busy={markRead.isPending}
                    onRead={(id) => markRead.mutate(id, { onError: fail })}
                  />
                ))}
              </ul>
            )}
            {items.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                <Button
                  variant="secondary"
                  className="min-h-[var(--control-h)] px-3 text-sm"
                  disabled={unread === 0}
                  loading={markAllRead.isPending}
                  onClick={() => markAllRead.mutate(undefined, { onError: fail })}
                >
                  Mark all read
                </Button>
                <Button
                  variant="ghost"
                  className="px-3 text-sm"
                  onClick={() => {
                    close()
                    setConfirming(true)
                  }}
                >
                  Clear all
                </Button>
              </div>
            )}
          </div>
        )}
      </Popover>
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Clear all notifications?"
        description="This permanently removes every notification, read or unread. Your activity history is not affected."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={clearAll.isPending} onClick={confirmClear}>
              Clear all
            </Button>
          </>
        }
      />
    </>
  )
}
