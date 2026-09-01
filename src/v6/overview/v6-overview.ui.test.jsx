import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { describe, expect, it, vi } from 'vitest'

import AppShell from '../../shell/AppShell'
import { presentationForRoute, resolveAppHref } from '../../lib/routes'
import { FIXTURE_TODAY, fixtureReads } from '../fixtures/canonicalFixture'
import OverviewScreen from '../OverviewScreen'

vi.mock('../../lib/PrefsContext', () => ({
  usePrefs: () => ({ currency: 'AED', setCurrency: vi.fn(), theme: 'system', setTheme: vi.fn() }),
}))

vi.mock('../../lib/useRealtime', () => ({ useRealtimeRefresh: () => {} }))

function renderOverview({ href = '/overview', reads = fixtureReads } = {}) {
  const route = resolveAppHref(href)
  const onRouteQueryChange = vi.fn()
  const navigate = vi.fn(() => true)
  const result = render(
    <OverviewScreen
      navigate={navigate}
      routeQuery={Object.fromEntries(route.searchParams)}
      onRouteQueryChange={onRouteQueryChange}
      today={FIXTURE_TODAY}
      reads={reads}
    />,
  )
  return { ...result, navigate, onRouteQueryChange }
}

async function renderLoaded(options) {
  const result = renderOverview(options)
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Net worth' })).toBeInTheDocument())
  return result
}

describe('V6 Overview — composition', () => {
  it('renders the prototype section hierarchy in reading order, not the legacy dashboard', async () => {
    await renderLoaded()

    const headings = screen.getAllByRole('heading').map((node) => node.textContent)
    expect(headings[0]).toMatch(/Whole household, month to date/)
    expect(headings).toEqual(expect.arrayContaining([
      'Net worth',
      'Month to date',
      'Cash flow',
      'Needs attention',
      'Next 30 days',
      'Top spend · month to date',
      'Recent activity',
      'Accounts',
      'Data quality and freshness',
    ]))
    // Hero → KPIs → cash flow → attention → obligations → detail columns.
    expect(headings.indexOf('Net worth')).toBeLessThan(headings.indexOf('Cash flow'))
    expect(headings.indexOf('Cash flow')).toBeLessThan(headings.indexOf('Next 30 days'))
    expect(headings.indexOf('Next 30 days')).toBeLessThan(headings.indexOf('Recent activity'))
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('renders canonical figures from the read contracts', async () => {
    const { container } = await renderLoaded()
    // Net worth, assets and liabilities as the balance-sheet contract returns them.
    expect(screen.getByText('871,700')).toBeInTheDocument()
    expect(screen.getByText('1,284,300')).toBeInTheDocument()
    expect(screen.getByText('412,600')).toBeInTheDocument()
    // Period KPIs from canonical_period_metrics.
    const cells = Array.from(container.querySelectorAll('.v6-kpi-cell'))
    const cellFor = (label) => cells.find((cell) => cell.querySelector('.v6-kpi-label')?.textContent === label)
    expect(within(cellFor('Income')).getByText('34,200')).toBeInTheDocument()
    expect(within(cellFor('Spend')).getByText('18,825')).toBeInTheDocument()
    expect(within(cellFor('Savings rate')).getByText('45.0%')).toBeInTheDocument()
  })

  it('never renders a prototype demo value', async () => {
    const { container } = await renderLoaded()
    // Values lifted straight from the frozen prototype's Overview.
    for (const demo of [
      '6,850', '8,940', '2,450,000', '486,200', '212,400', '84,300', '460,060',
      '96,600', '42,000', '14,500', '9,600', '7,320', '7,240', '3,180', '20,860', '12,400',
    ]) {
      // Bounded so a legitimate figure that merely ends in a demo value's
      // digits (1,284,300 vs 84,300) does not read as a false positive.
      expect(container.textContent).not.toMatch(new RegExp(`(?<![\\d,])${demo}(?![\\d,])`))
    }
  })
})

describe('V6 Overview — honest unavailable states', () => {
  it('states the missing contract for runway, change, equity share and upcoming', async () => {
    await renderLoaded()
    expect(screen.getByText(/Runway is not available yet/)).toBeInTheDocument()
    expect(screen.getAllByText(/Change over the period is not available yet/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Per-person share is not available/)).toBeInTheDocument()
    expect(screen.getByText(/Upcoming obligations are not available yet/)).toBeInTheDocument()
    expect(screen.getByText(/SHR-171/)).toBeInTheDocument()
    expect(screen.getAllByText(/SHR-153/).length).toBeGreaterThan(0)
  })

  it('shows Budget left as an unavailable slot rather than a number', async () => {
    await renderLoaded()
    const budgetLabel = screen.getByText('Budget left')
    const cell = budgetLabel.closest('.v6-kpi-cell')
    expect(within(cell).getByText('Not available')).toBeInTheDocument()
    expect(within(cell).getByText(/versioned monthly budget plan/)).toBeInTheDocument()
  })

  it('keeps Needs attention empty but for its gap until SHR-192 exists', async () => {
    const { container } = await renderLoaded()
    const heading = screen.getByRole('heading', { name: 'Needs attention' })
    const section = heading.closest('section')

    expect(within(section).getByText(/ranked attention feed is not available yet/)).toBeInTheDocument()
    expect(within(section).getByText(/SHR-192/)).toBeInTheDocument()
    // No canonical counter, and no resolve affordance, inside this surface:
    // placing one here would be a frontend-authored attention interpretation.
    expect(within(section).queryByText(/flagged for review/)).not.toBeInTheDocument()
    expect(within(section).queryByText(/stale price/)).not.toBeInTheDocument()
    expect(within(section).queryByText(/canonical_/)).not.toBeInTheDocument()
    expect(within(section).queryAllByRole('link')).toHaveLength(0)
    expect(within(section).queryAllByRole('button')).toHaveLength(0)
    expect(container.textContent).not.toMatch(/canonical quality signal/)
  })

  it('lists canonical counters as data-health evidence under quality and freshness', async () => {
    await renderLoaded()
    const section = screen.getByRole('heading', { name: 'Data quality and freshness' }).closest('section')

    expect(within(section).getByText(/not an attention feed/)).toBeInTheDocument()
    expect(within(section).getByText(/3 transactions flagged for review/)).toBeInTheDocument()
    expect(within(section).getByText(/canonical_period_metrics\.needs_review_count/)).toBeInTheDocument()
    expect(within(section).getByText(/2 holdings with a stale price/)).toBeInTheDocument()
    // Evidence rows report; they do not offer to resolve anything.
    const rows = section.querySelectorAll('.v6-attention-item')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.querySelector('a, button')).toBeNull()
    }
  })

  it('makes no integration or sync health claim', async () => {
    const { container } = await renderLoaded()
    expect(screen.getByText(/Integration and sync status is not available/)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/Synced \d/)
  })

  it('degrades a single failed canonical read without blanking the screen', async () => {
    const reads = { ...fixtureReads, getBalanceSheet: async () => { throw new Error('rpc offline') } }
    await renderLoaded({ reads })
    expect(screen.getAllByText(/could not be read \(rpc offline\)/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/No legacy or estimated value is substituted/).length).toBeGreaterThan(0)
    // The rest of the screen is still there.
    expect(screen.getByRole('heading', { name: 'Recent activity' })).toBeInTheDocument()
    expect(screen.getByText('Fixture Savings Account')).toBeInTheDocument()
  })
})

describe('V6 Overview — interaction and deep links', () => {
  it('keeps the period in the URL so a shared link reopens the same period', async () => {
    const user = userEvent.setup()
    const { onRouteQueryChange } = await renderLoaded()

    const control = screen.getByRole('group', { name: 'Overview period' })
    const mtd = within(control).getByRole('button', { name: 'Month to date' })
    expect(mtd).toHaveAttribute('aria-pressed', 'true')

    await user.click(within(control).getByRole('button', { name: 'Quarter to date' }))
    expect(onRouteQueryChange).toHaveBeenCalledWith({ period: 'qtd' })
  })

  it('opens on the deep-linked period and sanitises an unknown one back to MTD', async () => {
    await renderLoaded({ href: '/overview?period=ytd' })
    const control = screen.getByRole('group', { name: 'Overview period' })
    expect(within(control).getByRole('button', { name: 'Year to date' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('year to date')

    // The route contract redirects an unsupported value away before the
    // screen ever sees it, rather than passing it through.
    const sanitised = resolveAppHref('/overview?period=decade')
    expect(sanitised.kind).toBe('redirect')
    expect(sanitised.to).toBe('/overview')
  })

  it('exposes chart data as a table rather than only as an SVG', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByText('Cash-flow data table'))
    const table = screen.getByRole('table', { name: /canonical period contract/ })
    expect(within(table).getAllByRole('row')).toHaveLength(7)
    expect(within(table).getByRole('columnheader', { name: 'Savings rate' })).toBeInTheDocument()
  })
})

describe('V6 Overview — shell integration and accessibility', () => {
  it('mounts inside the V6 shell with a single h1 owned by the screen', async () => {
    const route = resolveAppHref('/overview')
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
        <OverviewScreen
          navigate={vi.fn(() => true)}
          routeQuery={{}}
          onRouteQueryChange={vi.fn()}
          today={FIXTURE_TODAY}
          reads={fixtureReads}
        />
      </AppShell>,
    )
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(document.getElementById('page-title')).toHaveTextContent(/Whole household/)
    expect(screen.getByRole('main')).toHaveAttribute('aria-labelledby', 'page-title')
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
  })

  it('has no automated accessibility violations', async () => {
    const { container } = await renderLoaded()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('has no automated accessibility violations while still loading', async () => {
    const pending = new Promise(() => {})
    const { container } = renderOverview({
      reads: {
        getBalanceSheet: () => pending, getInvestments: () => pending, getPeriodMetrics: () => pending,
        listBudgetActuals: () => pending, listLedgerRows: () => pending, listAccounts: () => pending,
      },
    })
    expect(screen.getByText(/Reading canonical contracts/)).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })
})
