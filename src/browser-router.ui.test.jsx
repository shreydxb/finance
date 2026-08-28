import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useBrowserRouter from './lib/useBrowserRouter'
import { NavigationSafetyProvider } from './lib/NavigationSafety'
import { useNavigationSafety } from './lib/navigationSafetyContext'

const ID = '123e4567-e89b-42d3-a456-426614174000'

function RouterHarness() {
  const router = useBrowserRouter()
  const safety = useNavigationSafety()
  return (
    <div>
      <output aria-label="Current route">{router.route.href}</output>
      <button type="button" onClick={() => router.navigate('/planning/goals')}>Planning</button>
      <button type="button" onClick={() => router.updateQuery({ search: 'rent', sort: 'amount', unsafe: 'discard' })}>Filter</button>
      <button type="button" onClick={() => router.openDetail('transaction', ID)}>Open transaction</button>
      <button type="button" onClick={() => router.closeDetail()}>Close detail</button>
      <button type="button" onClick={() => safety.setFormDirty('fixture', true)}>Make dirty</button>
    </div>
  )
}

function renderRouter() {
  return render(
    <NavigationSafetyProvider>
      <RouterHarness />
    </NavigationSafetyProvider>,
  )
}

describe('browser router integration', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/money/activity?search=groceries')
    vi.restoreAllMocks()
  })

  it('preserves query state and UUID identity through push, refresh resolution, and direct-open close replacement', async () => {
    const user = userEvent.setup()
    renderRouter()

    await user.click(screen.getByRole('button', { name: 'Filter' }))
    expect(window.location.pathname + window.location.search).toBe('/money/activity?search=rent&sort=amount')
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/money/activity?search=rent&sort=amount')

    const invoker = screen.getByRole('button', { name: 'Open transaction' })
    invoker.focus()
    await user.click(invoker)
    expect(window.location.pathname + window.location.search).toBe(`/money/activity/${ID}?search=rent&sort=amount`)
    expect(window.history.state).toEqual({ routeParent: '/money/activity?search=rent&sort=amount' })
    expect(screen.getByLabelText('Current route')).toHaveTextContent(ID)

    act(() => window.history.replaceState({}, '', `/money/activity/${ID}?search=rent&sort=amount`))
    await user.click(screen.getByRole('button', { name: 'Close detail' }))
    expect(window.location.pathname + window.location.search).toBe('/money/activity?search=rent&sort=amount')
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/money/activity?search=rent&sort=amount')
  })

  it('routes every shell transition through dirty-form confirmation', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderRouter()

    await user.click(screen.getByRole('button', { name: 'Make dirty' }))
    await user.click(screen.getByRole('button', { name: 'Planning' }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(window.location.pathname + window.location.search).toBe('/money/activity?search=groceries')

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Planning' }))
    await waitFor(() => expect(window.location.pathname).toBe('/planning/goals'))
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/planning/goals')
  })
})
