/**
 * Number of unread notifications. Returns 0 until Task 7 adds the notifications
 * API; the Topbar bell already reads from this hook, so only this body changes.
 */
export function useUnreadCount(): number {
  return 0
}
