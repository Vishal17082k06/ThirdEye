const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const HOSTNAME = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

/** Empty is allowed (means "not configured"). Otherwise an IPv4 address or a hostname such as esp32.local. */
export function validateHost(value: string): string | undefined {
  const v = value.trim()
  if (!v) return undefined
  const m = IPV4.exec(v)
  if (m) {
    return m.slice(1).every((o) => Number(o) <= 255) ? undefined : 'Each part of an IP address must be between 0 and 255.'
  }
  // Something that looks numeric-dotted but is not a valid IPv4 must not pass as a hostname.
  if (/^[\d.]+$/.test(v)) return 'Enter a valid IPv4 address such as 192.168.1.50.'
  return HOSTNAME.test(v) ? undefined : 'Enter an IPv4 address (192.168.1.50) or a hostname (esp32.local).'
}
