import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { describe, expect, it, vi } from 'vitest'
import DetailShell from './DetailShell'

describe('DetailShell', () => {
  it('provides focused-detail title, visible Back semantics, focus containment, and accessible structure', async () => {
    const user = userEvent.setup()
    const onRequestClose = vi.fn()
    const { container } = render(
      <DetailShell backLabel="Activity" title="Coffee transaction" onRequestClose={onRequestClose}>
        <label htmlFor="detail-note">Note</label>
        <input id="detail-note" />
      </DetailShell>,
    )

    const title = await screen.findByText('Coffee transaction')
    await waitFor(() => expect(title).toHaveFocus())
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', title.id)
    await user.click(screen.getByRole('button', { name: '← Back to Activity' }))
    expect(onRequestClose).toHaveBeenCalledOnce()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('distinguishes loading, load failure, and unavailable-after-load states', () => {
    const { rerender } = render(
      <DetailShell backLabel="Accounts" title="Account" loading onRequestClose={vi.fn()} />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(screen.queryByText('Record unavailable')).not.toBeInTheDocument()

    rerender(<DetailShell backLabel="Accounts" title="Account" error="Could not load accounts." onRequestClose={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load accounts.')
    expect(screen.queryByText('Record unavailable')).not.toBeInTheDocument()

    rerender(<DetailShell backLabel="Accounts" title="Account" unavailable onRequestClose={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Record unavailable')
  })
})
