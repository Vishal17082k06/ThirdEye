import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useEscapeLayer } from './escapeStack'

function Layer({ onEsc, active = true }: { onEsc: () => void; active?: boolean }) {
  useEscapeLayer(active, onEsc)
  return null
}

describe('useEscapeLayer', () => {
  it('only the topmost layer receives Escape', async () => {
    const bottom = vi.fn()
    const top = vi.fn()
    render(
      <>
        <Layer onEsc={bottom} />
        <Layer onEsc={top} />
      </>,
    )
    await userEvent.keyboard('{Escape}')
    expect(top).toHaveBeenCalledTimes(1)
    expect(bottom).not.toHaveBeenCalled()
  })

  it('after the top layer closes, the next layer receives Escape', async () => {
    const bottom = vi.fn()
    function Harness() {
      const [topOpen, setTopOpen] = useState(true)
      return (
        <>
          <Layer onEsc={bottom} />
          <Layer active={topOpen} onEsc={() => setTopOpen(false)} />
        </>
      )
    }
    render(<Harness />)
    await userEvent.keyboard('{Escape}')
    expect(bottom).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(bottom).toHaveBeenCalledTimes(1)
  })
})
