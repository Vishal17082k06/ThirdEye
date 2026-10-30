/** "5 min ago" style text. Pair it with the absolute time in a title attribute for precision. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'Never'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 'Unknown'
  const sec = Math.round((now - t) / 1000)
  if (sec < 10) return 'just now'
  if (sec < 60) return `${sec} s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`
  return new Date(t).toLocaleDateString()
}

export function absoluteTime(iso: string | null | undefined): string {
  if (!iso) return 'No communication yet'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'Unknown' : d.toLocaleString()
}
