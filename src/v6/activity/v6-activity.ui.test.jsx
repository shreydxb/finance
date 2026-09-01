import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { describe, expect, it, vi } from 'vitest'

import AppShell from '../../shell/AppShell'
import { presentationForRoute, resolveAppHref } from '../../lib/routes'
import ActivityScreen from '../ActivityScreen'
import { ACTIVITY_FIXTURE_TODAY, activityFixtureReads } from '../fixtures/activityFixture'

vi.mock('../../lib/PrefsContext', () => ({
  usePrefs: () => ({ currency: 'AED', setCurrency: vi.fn(), theme: 'system', setTheme: vi.fn() }),
}))
vi.mock('../../lib/useRealtime', () => ({ useRealtimeRefresh: () => {} }))

const REVIEW_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001'
const BASE_QUERY = { year: '2026', month: '8' }

function renderActivity({ query = {}, reads = activityFixtureReads, detailId = null } = {}) {
  const onRouteQueryChange = vi.fn()
  const onOpenDetail = vi.fn(() => true)
  const onCloseDetail = vi.fn(() => true)
  const result = render(
    <ActivityScreen
      routeQuery={{ ...BASE_QUERY, ...query }}
      onRouteQueryChange={onRouteQueryChange}
      detailId={detailId}
      onOpenDetail={onOpenDetail}
      onCloseDetail={onCloseDetail}
      today={ACTIVITY_FIXTURE_TODAY}
      reads={reads}
    />,
  )
  return { ...result, onRouteQueryChange, onOpenDetail, onCloseDetail }
}

async function renderLoaded(options) {
  const result = renderActivity(options)
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())
  return result
}

describe('V6 Activity — composition and canonical rows', () => {
  it('mounts the fresh V6 Activity screen at the canonical route', async () => {
    const route = resolveAppHref('/money/activity')
    expect(route.screen).toBe('Activity')

    const { container } = await renderLoaded()
    expect(container.querySelector('[data-testid="v6-activity"]')).toBeInTheDocument()
    expect(container.querySelector('.v6-surface')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Everything recorded in August 2026.')
  })

  it('renders canonical ledger rows faithfully with their recorded labels', async () => {
    await renderLoaded()
    const table = screen.getByRole('table')

    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Date', 'Description', 'Category', 'Owner', 'Account', 'Amount (AED)',
    ])

    const row = within(table).getByRole('button', { name: 'Fixture grocery run' }).closest('tr')
    expect(within(row).getByText('Groceries')).toBeInTheDocument()
    expect(within(row).getByText('Fixture Current Account')).toBeInTheDocument()
    expect(within(row).getByText('437.00')).toBeInTheDocument()
    // Review and quality are text, never colour alone.
    expect(within(row).getByText('Needs review')).toBeInTheDocument()
    expect(within(row).getByText('provisional')).toBeInTheDocument()

    expect(within(table).getByText('Uncategorised')).toBeInTheDocument()
    expect(within(table).getByText('Unassigned')).toBeInTheDocument()
    expect(within(table).getByText('No description recorded')).toBeInTheDocument()
  })

  it('shows period totals from the canonical period contract, not from the visible rows', async () => {
    const { container } = await renderLoaded()
    expect(screen.getAllByText(/12 canonical entries/).length).toBeGreaterThan(0)
    expect(container.textContent).toMatch(/Consumption spend/)
    expect(container.textContent).toMatch(/Posted income/)
  })

  it('never renders a prototype demo value', async () => {
    const { container } = await renderLoaded()
    for (const demo of [
      '46,120', '78,400', '6,850', '8,940', '2,450,000', '486,200', '212,400', '84,300',
      '42,000', '14,500', '9,600', '1,180', '12,400', '9.99',
    ]) {
      expect(container.textContent).not.toMatch(new RegExp(`(?<![\\d,])${demo}(?![\\d,])`))
    }
  })
})

describe('V6 Activity — fail-closed contracts', () => {
  it('withholds an amount with no canonical FX rate instead of showing the native figure', async () => {
    await renderLoaded()
    const row = screen.getByRole('button', { name: 'Fixture overseas order' }).closest('tr')
    expect(within(row).getByText('Incomplete')).toBeInTheDocument()
    expect(within(row).queryByText('129')).not.toBeInTheDocument()
    expect(within(row).queryByText('129.00')).not.toBeInTheDocument()
  })

  it('states an account missing from the canonical view instead of printing its identifier', async () => {
    const { container } = await renderLoaded()
    const row = screen.getByRole('button', { name: 'Fixture stationery' }).closest('tr')
    expect(within(row).getByText(/not present in the canonical account view/)).toBeInTheDocument()
    expect(container.textContent).not.toContain('fixture-account-missing')
  })

  it('names the search, attribution and category-identity gaps on the screen', async () => {
    await renderLoaded()
    expect(screen.getByText(/Search and filters cover the loaded period only/)).toBeInTheDocument()
    expect(screen.getByText(/SHR-163/)).toBeInTheDocument()
  })

  it('degrades a failed canonical read without blanking the screen', async () => {
    await renderLoaded({
      reads: { ...activityFixtureReads, listLedgerRows: async () => { throw new Error('ledger offline') } },
    })
    expect(screen.getByText(/ledger offline/)).toBeInTheDocument()
    expect(screen.getByText(/No legacy or estimated value is substituted/)).toBeInTheDocument()
    // The period header and its canonical totals survive.
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})

describe('V6 Activity — mutations stay inert', () => {
  it('renders every write affordance disabled and names its missing contract', async () => {
    await renderLoaded()
    const add = screen.getByRole('button', { name: /Add transaction/ })
    expect(add).toBeDisabled()
    expect(screen.getByText(/Adding a transaction is not available on this screen yet/)).toBeInTheDocument()
    expect(screen.getByText(/SHR-126 \/ SHR-159 \/ SHR-165/)).toBeInTheDocument()
  })

  it('renders the drawer read-only with no enabled mutation control', async () => {
    await renderLoaded({ detailId: REVIEW_ID })
    const dialog = await screen.findByRole('dialog')

    for (const label of ['Edit', 'Split by category', 'Mark reviewed', 'Delete']) {
      expect(within(dialog).getByRole('button', { name: label })).toBeDisabled()
    }
    // Nothing in the drawer is an enabled control that could write.
    const enabled = within(dialog).getAllByRole('button').filter((node) => !node.disabled)
    expect(enabled.map((node) => node.textContent.trim())).toEqual(['← Back to Activity'])
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('shows the canonical facts of an entry and the contracts it cannot resolve', async () => {
    await renderLoaded({ detailId: REVIEW_ID })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Groceries')).toBeInTheDocument()
    expect(within(dialog).getByText('provisional')).toBeInTheDocument()
    expect(within(dialog).getByText('Needs review')).toBeInTheDocument()
    expect(within(dialog).getByText(/categorised_consumption/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Owner is the label recorded on the entry/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Provenance and audit history are not available/)).toBeInTheDocument()
  })

  it('reports an unknown deep-linked entry as unavailable rather than inventing one', async () => {
    await renderLoaded({ detailId: 'aaaaaaaa-bbbb-4ccc-8ddd-999999999999' })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Record unavailable/)).toBeInTheDocument()
  })
})

describe('V6 Activity — query state and interaction', () => {
  it('drives search, filters and sort through the route query', async () => {
    const user = userEvent.setup()
    const { onRouteQueryChange } = await renderLoaded()

    await user.click(screen.getByRole('button', { name: /Needs review/ }))
    expect(onRouteQueryChange).toHaveBeenCalledWith(expect.objectContaining({
      needsReview: '1', year: '2026', month: '8',
    }))

    onRouteQueryChange.mockClear()
    await user.selectOptions(screen.getByLabelText('Category'), 'Dining Out')
    expect(onRouteQueryChange).toHaveBeenCalledWith(expect.objectContaining({ category: 'Dining Out' }))

    onRouteQueryChange.mockClear()
    await user.selectOptions(screen.getByLabelText('Sort'), 'amount')
    expect(onRouteQueryChange).toHaveBeenCalledWith(expect.objectContaining({ sort: 'amount' }))
  })

  it('applies a deep-linked filter to the loaded rows', async () => {
    await renderLoaded({ query: { needsReview: '1' } })
    expect(screen.getByRole('button', { name: /Needs review/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/Showing 1 of 12 canonical entries/)).toBeInTheDocument()
  })

  it('distinguishes a filtered-empty result from an empty period', async () => {
    await renderLoaded({ query: { search: 'no such entry' } })
    expect(screen.getByText('No entries match these filters.')).toBeInTheDocument()
    cleanup()

    await renderLoaded({ reads: { ...activityFixtureReads, listLedgerRows: async () => [] } })
    expect(screen.getByText('No entries in this period.')).toBeInTheDocument()
  })

  it('switches to the calendar through the route query', async () => {
    const user = userEvent.setup()
    const { onRouteQueryChange } = await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Calendar' }))
    expect(onRouteQueryChange).toHaveBeenCalledWith(expect.objectContaining({ view: 'calendar' }))
  })

  it('reports what the calendar cannot say, and counts rather than money', async () => {
    await renderLoaded({ query: { view: 'calendar' } })
    expect(screen.getByText(/Daily monetary totals are not available/)).toBeInTheDocument()
    expect(screen.getByText(/Scheduled bills and expected income are not marked/)).toBeInTheDocument()
    expect(screen.getAllByText(/1 needs review/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/2 entries/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('moves month through the route and refuses to step past the current month', async () => {
    const user = userEvent.setup()
    const { onRouteQueryChange } = await renderLoaded()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(onRouteQueryChange).toHaveBeenCalledWith(expect.objectContaining({ year: '2026', month: '7' }))
  })

  it('opens a row through the router rather than local state', async () => {
    const user = userEvent.setup()
    const { onOpenDetail } = await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Fixture grocery run' }))
    expect(onOpenDetail).toHaveBeenCalledWith('transaction', REVIEW_ID)
  })
})

describe('V6 Activity — shell, drawer behaviour and accessibility', () => {
  it('mounts inside the V6 shell owning a single h1', async () => {
    const route = resolveAppHref('/money/activity')
    render(
      <AppShell
        identity="member@example.com"
        navigate={vi.fn(() => true)}
        onSignOut={vi.fn().mockResolvedValue(true)}
        presentation={presentationForRoute(route)}
        route={route}
        screenOwnsHeader
        takePendingFocusTarget={() => null}
      >
        <ActivityScreen
          routeQuery={BASE_QUERY}
          onRouteQueryChange={vi.fn()}
          onOpenDetail={vi.fn()}
          onCloseDetail={vi.fn()}
          today={ACTIVITY_FIXTURE_TODAY}
          reads={activityFixtureReads}
        />
      </AppShell>,
    )
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(document.getElementById('page-title')).toHaveTextContent('Everything recorded in August 2026.')
    expect(screen.getByRole('main')).toHaveAttribute('aria-labelledby', 'page-title')
    // Section navigation still reaches the other Money tabs.
    const secondary = screen.getByRole('navigation', { name: 'Section navigation' })
    expect(within(secondary).getByRole('link', { name: 'Activity' })).toHaveAttribute('aria-current', 'page')
  })

  it('moves focus into the drawer, closes on Escape and asks the router to go back', async () => {
    const user = userEvent.setup()
    const { onCloseDetail } = await renderLoaded({ detailId: REVIEW_ID })
    const dialog = await screen.findByRole('dialog')

    await waitFor(() => expect(within(dialog).getByText('Fixture grocery run')).toHaveFocus())

    await user.keyboard('{Escape}')
    expect(onCloseDetail).toHaveBeenCalled()
  })

  it('closes the drawer from its back control', async () => {
    const user = userEvent.setup()
    const { onCloseDetail } = await renderLoaded({ detailId: REVIEW_ID })
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /Back to Activity/ }))
    expect(onCloseDetail).toHaveBeenCalled()
  })

  it('has no automated accessibility violations in the list view', async () => {
    const { container } = await renderLoaded()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('has no automated accessibility violations in the calendar view', async () => {
    const { container } = await renderLoaded({ query: { view: 'calendar' } })
    expect(await axe(container)).toHaveNoViolations()
  })

  it('has no automated accessibility violations while still loading', async () => {
    const pending = new Promise(() => {})
    const { container } = renderActivity({
      reads: { listLedgerRows: () => pending, listAccounts: () => pending, getPeriodMetrics: () => pending },
    })
    expect(screen.getByText(/Reading canonical contracts/)).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })
})
