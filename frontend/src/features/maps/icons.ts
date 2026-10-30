import L from 'leaflet'

/**
 * Leaflet's default marker images are looked up by URL relative to its CSS, which breaks under Vite bundling.
 * Third Eye draws its own pins as divIcons (inline SVG) so nothing depends on those files.
 */
type PinKind = 'pickup' | 'destination' | 'start' | 'current'

const COLOURS: Record<PinKind, string> = {
  pickup: '#0f766e',
  start: '#0f766e',
  destination: '#b91c1c',
  current: '#1d4ed8',
}

const LETTERS: Record<PinKind, string> = { pickup: 'A', start: 'A', destination: 'B', current: '' }

export function pinIcon(kind: PinKind, label: string): L.DivIcon {
  const colour = COLOURS[kind]
  const letter = LETTERS[kind]
  const body =
    kind === 'current'
      ? `<circle cx="16" cy="16" r="9" fill="${colour}" stroke="#fff" stroke-width="3"/>`
      : `<path d="M16 2C9.4 2 4 7.2 4 13.7 4 22.5 16 38 16 38s12-15.5 12-24.3C28 7.2 22.6 2 16 2z" fill="${colour}" stroke="#fff" stroke-width="2"/>` +
        `<text x="16" y="19" text-anchor="middle" font-size="13" font-weight="700" fill="#fff" font-family="sans-serif">${letter}</text>`
  const safe = label.replace(/[<>&"]/g, '')
  return L.divIcon({
    className: 'te-pin',
    html: `<svg role="img" aria-label="${safe}" width="32" height="40" viewBox="0 0 32 40" xmlns="http://www.w3.org/2000/svg">${body}</svg>`,
    iconSize: kind === 'current' ? [32, 32] : [32, 40],
    iconAnchor: kind === 'current' ? [16, 16] : [16, 38],
  })
}
