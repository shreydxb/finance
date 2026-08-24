import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button, ConfirmDialog, Dialog, Field, Input } from './index'

function ConfirmFixture({ onConfirm = () => {} }) {
  const [open, setOpen] = useState(false)
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      trigger={<Button intent="danger">Delete fixture</Button>}
      title="Delete fixture record?"
      description="This cannot affect production data."
      cancelLabel="Keep fixture"
      confirmLabel="Delete fixture"
      onConfirm={onConfirm}
    />
  )
}

describe('accessible overlay foundation', () => {
  it('enters focus, traps Tab, closes on Escape, and restores trigger focus', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Dialog
          title="Fixture details"
          description="Keyboard contract"
          trigger={<Button>Open fixture dialog</Button>}
          footer={<Button>Done</Button>}
        >
          <Field label="Dialog note"><Input /></Field>
        </Dialog>
        <Button>Outside action</Button>
      </>,
    )

    const trigger = screen.getByRole('button', { name: 'Open fixture dialog' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Fixture details' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Close dialog' })).toHaveFocus()

    await user.tab({ shift: true })
    expect(dialog).toContainElement(document.activeElement)
    await user.tab()
    expect(dialog).toContainElement(document.activeElement)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('puts initial focus on the safe ConfirmDialog action', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(<ConfirmFixture onConfirm={onConfirm} />)

    const trigger = screen.getByRole('button', { name: 'Delete fixture' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Delete fixture record?' })
    expect(within(dialog).getByRole('button', { name: 'Keep fixture' })).toHaveFocus()
    expect(onConfirm).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
  })
})
