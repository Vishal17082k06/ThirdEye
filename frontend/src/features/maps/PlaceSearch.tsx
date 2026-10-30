import { Loader2, MapPin } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { fieldClasses } from '../../design/Input'
import { cn } from '../../lib/cn'
import { useGeocode, type GeocodeResult, type Place } from './api'

interface PlaceSearchProps {
  label: string
  /** The chosen place, shown in the box. Typing replaces it. */
  value: Place | null
  onSelect: (place: Place) => void
  /** Called when the person edits the text after a place was chosen. */
  onEdit?: () => void
  disabled?: boolean
  placeholder?: string
}

/**
 * Place search as an ARIA combobox: type, Arrow Up/Down move through the suggestions, Enter chooses, Escape closes.
 * Focus stays in the text box the whole time; the highlighted suggestion is announced through aria-activedescendant.
 */
export function PlaceSearch({ label, value, onSelect, onEdit, disabled, placeholder = 'Search a place in Coimbatore' }: PlaceSearchProps) {
  const uid = useId()
  const inputId = `${uid}-input`
  const listId = `${uid}-list`
  const [text, setText] = useState(value?.label ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const lastValue = useRef(value)

  // A place chosen elsewhere (map click, "use my location") is mirrored into the box.
  useEffect(() => {
    if (value !== lastValue.current) {
      lastValue.current = value
      setText(value?.label ?? '')
      setOpen(false)
      setActive(-1)
    }
  }, [value])

  // Do not search for the label of a place that is already chosen.
  const searching = value && text === value.label ? '' : text
  const { status, results, note, error } = useGeocode(searching)
  const showList = open && searching.trim().length >= 2

  function choose(r: GeocodeResult) {
    setText(r.label)
    setOpen(false)
    setActive(-1)
    onSelect({ lat: r.lat, lon: r.lon, label: r.label })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      if (results.length === 0) return
      e.preventDefault()
      setOpen(true)
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      if (results.length === 0) return
      e.preventDefault()
      setOpen(true)
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (e.key === 'Home' && showList && active >= 0) {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End' && showList && active >= 0) {
      e.preventDefault()
      setActive(results.length - 1)
    } else if (e.key === 'Enter') {
      if (showList && active >= 0 && results[active]) {
        e.preventDefault()
        choose(results[active])
      }
    } else if (e.key === 'Escape') {
      if (showList) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        setActive(-1)
      }
    }
  }

  let statusText = ''
  if (searching.trim().length >= 2) {
    if (status === 'loading') statusText = 'Searching places'
    else if (status === 'error') statusText = error ?? 'Place search failed.'
    else if (status === 'ok') {
      statusText =
        results.length > 0
          ? `${results.length} ${results.length === 1 ? 'suggestion' : 'suggestions'} available. Use the up and down arrow keys, then Enter.`
          : (note ?? 'No matching places inside Coimbatore')
    }
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-base font-semibold text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={showList && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${uid}-opt-${active}` : undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
            setActive(-1)
            if (value) onEdit?.()
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className={cn(fieldClasses, 'border-line-strong pr-10')}
        />
        {status === 'loading' && searching.trim().length >= 2 && (
          <Loader2
            className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          hidden={!(showList && results.length > 0)}
          className="absolute z-[1100] mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-pop"
        >
          {results.map((r, i) => (
            <li
              key={`${r.lat},${r.lon},${i}`}
              id={`${uid}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown (not click) so the input does not blur and close the list before the choice registers
              onMouseDown={(e) => {
                e.preventDefault()
                choose(r)
              }}
              onMouseEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-start gap-2 px-3 py-2 text-base text-ink', i === active && 'bg-primary-soft')}
            >
              <MapPin className="mt-1 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
              <span>{r.label}</span>
            </li>
          ))}
        </ul>
      </div>
      <p
        role="status"
        aria-live="polite"
        className={cn('text-sm', status === 'error' ? 'font-semibold text-danger' : 'text-muted', !statusText && 'sr-only')}
      >
        {statusText}
      </p>
    </div>
  )
}
