import { useEffect, useRef } from 'react'

/**
 * Single owner for the Escape key. Every overlay (modal, popover, mobile drawer)
 * registers a layer while it is open; one document listener hands Escape only to
 * the most recently opened layer, so stacked overlays never close together.
 */
type Layer = { current: () => void }
const stack: Layer[] = []

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || stack.length === 0) return
  e.preventDefault()
  stack[stack.length - 1].current()
}

export function useEscapeLayer(active: boolean, onEscape: () => void): void {
  const handlerRef = useRef(onEscape)
  useEffect(() => {
    handlerRef.current = onEscape
  })

  useEffect(() => {
    if (!active) return
    const layer: Layer = { current: () => handlerRef.current() }
    if (stack.length === 0) document.addEventListener('keydown', onKeyDown)
    stack.push(layer)
    return () => {
      const i = stack.indexOf(layer)
      if (i >= 0) stack.splice(i, 1)
      if (stack.length === 0) document.removeEventListener('keydown', onKeyDown)
    }
  }, [active])
}
