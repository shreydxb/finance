import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { describe, expect, it, vi } from 'vitest'
import { presentationForRoute, resolveAppHref } from '../lib/routes'
import AppShell from './AppShell'
import { shouldHandleInApp } from './appLinkEvents'

vi.mock('../lib/PrefsContext', () => ({
  usePrefs: () => ({
    currency: 'AED',
    setCurrency: vi.fn(),
    theme: 'system',
    setTheme: vi.fn(),
  }),
}))

function shellProps(href, overrides = {}) {
  const route = resolveAppHref(href)
  return {
    identity: 'member@example.com',
    navigate: vi.fn(() => true),
    onSignOut: vi.fn().mockResolvedValue(true),
    presentation: presentationForRoute(route),
    route,
    takePendingFocusTarget: vi.fn(() => null),
    ...overrides,
  }
}

function renderShell(href, overrides) {
  const props = shellProps(href, overrides)
  return { props, ...render(<AppShell {...props}><p>Preserved screen body</p></AppShell>) }
}

describe('application shell', () => {
  it('renders exactly four primary destinations per responsive surface and route-aware secondary navigation', () => {
    renderShell('/money/budget')

    const primaryNavs = screen.getAllByRole('navigation', { name: /primary navigation/ })
    expect(primaryNavs).toHaveLength(2)
    for (const nav of primaryNavs) {
      expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual([
        'Overview', 'Money', 'Wealth', 'Planning',
      ])
      expect(within(nav).getByRole('link', { name: /Money/ })).toHaveAttribute('aria-current', 'page')
    }

    const secondary = screen.getByRole('navigation', { name: 'Section navigation' })
    expect(within(secondary).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Activity', 'Budget', 'Recurring', 'Insights',
    ])
    expect(within(secondary).getByRole('link', { name: 'Budget' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Budget')
    expect(screen.getByText('Give this month a plan and see where it is drifting.')).toBeInTheDocument()
    expect(screen.getByText('Preserved screen body')).toBeInTheDocument()
  })

  it('keeps Settings and preferences outside the primary destination set', async () => {
    const user = userEvent.setup()
    const { props } = renderShell('/overview')
    expect(screen.getAllByRole('link', { name: 'Settings' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /Preferences|Account and preferences/ })).toHaveLength(2)

    await user.click(screen.getAllByRole('button', { name: 'Preferences' })[1])
    const dialog = document.querySelector('dialog')
    expect(dialog).toHaveAttribute('aria-labelledby')
    expect(within(dialog).getByText('member@example.com')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Settings' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('link', { name: 'Settings' }))
    expect(props.navigate).toHaveBeenCalledWith('/settings')
  })

  it('focuses the route h1, restores a surviving detail invoker, and removes mobile primary nav during focused detail', async () => {
    const initial = shellProps('/money/activity')
    const { rerender } = render(<AppShell {...initial}><button type="button">Open transaction</button></AppShell>)
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
    expect(document.title).toBe('Activity · Our Money')

    const invoker = screen.getByRole('button', { name: 'Open transaction' })
    const detail = shellProps('/money/activity/123e4567-e89b-42d3-a456-426614174000')
    rerender(<AppShell {...detail}><button type="button">Open transaction</button></AppShell>)
    expect(screen.getAllByRole('navigation', { name: /primary navigation/ })).toHaveLength(1)

    const returned = shellProps('/money/activity', { takePendingFocusTarget: vi.fn(() => invoker) })
    rerender(<AppShell {...returned}><button type="button">Open transaction</button></AppShell>)
    await waitFor(() => expect(invoker).toHaveFocus())
  })

  it('intercepts only unmodified same-origin primary clicks', () => {
    const anchor = document.createElement('a')
    anchor.href = '/money/activity'
    const event = {
      altKey: false, button: 0, ctrlKey: false, currentTarget: anchor,
      defaultPrevented: false, metaKey: false, shiftKey: false,
    }
    expect(shouldHandleInApp(event, '/money/activity')).toBe(true)
    expect(shouldHandleInApp({ ...event, ctrlKey: true }, '/money/activity')).toBe(false)
    expect(shouldHandleInApp({ ...event, button: 1 }, '/money/activity')).toBe(false)
    expect(shouldHandleInApp(event, 'https://example.com')).toBe(false)
  })

  it('has no automated accessibility violations in representative shell hierarchy', async () => {
    const { container } = renderShell('/planning/goals')
    fireEvent.focus(screen.getByRole('heading', { level: 1 }))
    expect(await axe(container)).toHaveNoViolations()
  })
})
