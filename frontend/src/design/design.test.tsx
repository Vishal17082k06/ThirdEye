import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { Input } from './Input'
import { Modal } from './Modal'

describe('Input', () => {
  it('wires hint and error to the field with aria-describedby', () => {
    render(<Input label="Phone" hint="Digits only" error="Too short" />)
    const field = screen.getByLabelText('Phone')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    const ids = field.getAttribute('aria-describedby')!.split(' ')
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual(['Digits only', 'Too short'])
  })
})

describe('Button', () => {
  it('is disabled and busy while loading', () => {
    render(<Button loading>Save</Button>)
    const b = screen.getByRole('button', { name: /save/i })
    expect(b).toBeDisabled()
    expect(b).toHaveAttribute('aria-busy', 'true')
  })
})

describe('Modal', () => {
  it('closes on Escape, traps Tab inside, and restores focus to the opener', async () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <>
        <button>opener</button>
        <Modal open={false} onClose={onClose} title="Confirm" footer={<button>Yes</button>} />
      </>,
    )
    const opener = screen.getByRole('button', { name: 'opener' })
    opener.focus()
    rerender(
      <>
        <button>opener</button>
        <Modal open onClose={onClose} title="Confirm" footer={<button>Yes</button>} />
      </>,
    )
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeInTheDocument()
    // Tab from the last control wraps to the first one inside the dialog.
    screen.getByRole('button', { name: 'Yes' }).focus()
    await userEvent.tab()
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    rerender(
      <>
        <button>opener</button>
        <Modal open={false} onClose={onClose} title="Confirm" />
      </>,
    )
    expect(opener).toHaveFocus()
  })
})
