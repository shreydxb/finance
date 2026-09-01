import { readFileSync } from 'node:fs'

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { describe, expect, it, vi } from 'vitest'

import AppShell from '../../shell/AppShell'
import { presentationForRoute, resolveAppHref, sanitizeQuery } from '../../lib/routes'
import InsightsScreen from '../InsightsScreen'
import {
  INSIGHTS_FIXTURE_TODAY,
  insightsFixtureReads,
  insightsFixtureReadsWith,
} from '../fixtures/insightsFixture'

vi.mock('../../lib/PrefsContext', () => ({
  usePrefs: () => ({ currency: 'AED', setCurrency: vi.fn(), theme: 'system', setTheme: vi.fn() }),
}))
vi.mock('../../lib/useRealtime', () => ({ useRealtimeRefresh: () => {} }))

const BASE_QUERY = { year: '2026', month: '8', quarter: '3' }

function renderInsights({ query = {}, reads = insightsFixtureReads } = {}) {
  const onRouteQueryChange = vi.fn()
  const result = render(
    <InsightsScreen
      routeQuery={{ ...BASE_QUERY, ...query }}
      onRouteQueryChange={onRouteQueryChange}
      today={INSIGHTS_FIXTURE_TODAY}
      reads={reads}
    />,
  )
  return { ...result, onRouteQueryChange }
}

async function renderLoaded(options) {
  const result = renderInsights(options)
  await waitFor(() => expect(screen.getAllByText('15,536').length).toBeGreaterThan(0))
  return result
}

function claimedText(container) {
  const clone = container.cloneNode(true)
  for (const region of clone.querySelectorAll('.v6-unavailable')) region.remove()
  return clone.textContent
}

describe('V6 Insights — route and fresh boundary', () => {
  it('mounts the fresh V6 screen at /money/insights', async () => {
    const route = resolveAppHref('/money/insights')
    expect(route.kind).toBe('screen')
    expect(route.screen).toBe('Insights')
    const { container } = await renderLoaded()
    expect(container.querySelector('[data-testid="v6-insights"]')).toBeInTheDocument()
    expect(container.querySelector('[data-read-only="true"]')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Insights for August 2026.')
  })

  it('does not import or mount legacy Reports presentation', async () => {
    const app = readFileSync('src/App.jsx', 'utf8')
    expect(app).not.toMatch(/from '\.\/screens\/Reports'/)
    expect(app).toMatch(/import InsightsScreen from '\.\/v6\/InsightsScreen'/)
    const { container } = await renderLoaded()
    expect(container.querySelector('[data-testid="v6-insights"]')).toBeInTheDocument()
    const legacyCardClass = ['shadow', 'card'].join('-')
    expect(container.innerHTML).not.toContain(legacyCardClass)
    expect(container.innerHTML).not.toMatch(/rounded-2xl|tnum/)
  })

  it('imports no legacy analytical reader or writer in the Insights production tree', () => {
    const modules = [
      'src/v6/InsightsScreen.jsx',
      'src/v6/data/composeInsights.js',
      'src/v6/data/insightsModel.js',
      'src/v6/data/useInsightsData.js',
      'src/v6/insights/InsightsBreakdown.jsx',
      'src/v6/insights/InsightsHistory.jsx',
      'src/v6/insights/InsightsCompare.jsx',
    ]
    for (const path of modules) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).not.toMatch(/from '[^']*\/lib\/(?:reports|spendingComparison|transactions|income|budgets|recurring)'/)
      expect(source, path).not.toMatch(/\b(?:upsert|insert|update|delete)(?:Transaction|Budget|Recurring|Category|Rule)\b/)
    }
  })
})

describe('V6 Insights — canonical facts and fail-closed analytics', () => {
  it('shows only direct selected-period spend and posted-income metrics', async () => {
    await renderLoaded()
    expect(screen.getAllByText('15,536').length).toBeGreaterThan(0)
    expect(screen.getAllByText('28,400').length).toBeGreaterThan(0)
    expect(screen.getByText(/canonical_period_metrics\.consumption_spend_aed/)).toBeInTheDocument()
    expect(screen.getByText(/canonical_period_metrics\.posted_income_aed/)).toBeInTheDocument()
    expect(screen.getByText(/not expected income or an income forecast/)).toBeInTheDocument()
  })

  it('reads no ledger, raw transaction or raw income rows', async () => {
    const forbidden = vi.fn(async () => { throw new Error('forbidden raw read') })
    await renderLoaded({
      reads: {
        ...insightsFixtureReads,
        listLedgerRows: forbidden,
        listCanonicalLedgerRows: forbidden,
        listIncomeRows: forbidden,
        listCanonicalIncomeRows: forbidden,
      },
    })
    expect(forbidden).not.toHaveBeenCalled()
  })

  it('renders every category actual exactly as reported and keeps labels honest', async () => {
    await renderLoaded()
    expect(screen.getByText('6,120.50')).toBeInTheDocument()
    expect(screen.getByText('3,884.25')).toBeInTheDocument()
    expect(screen.getByText(/Categories are reported labels, not stable analytical identity/)).toBeInTheDocument()
    expect(screen.getAllByText(/SHR-157 \/ SHR-198/).length).toBeGreaterThan(0)
  })

  it('keeps Uncategorised separate from a category literally named Other', async () => {
    await renderLoaded()
    const uncategorised = screen.getByText('Uncategorised')
    const other = screen.getByText('Other')
    expect(uncategorised).not.toBe(other)
    expect(uncategorised.parentElement).toHaveTextContent('no category recorded; distinct from Other')
    expect(other.parentElement).not.toHaveTextContent('no category recorded')
  })

  it('withholds category comparisons, description/payee analysis, merchants and explanations under SHR-169', async () => {
    await renderLoaded()
    expect(screen.getByText(/Category comparison is not available yet/)).toBeInTheDocument()
    expect(screen.getByText(/Description and payee analysis is not available yet/)).toBeInTheDocument()
    expect(screen.getByText(/Top merchants are not available yet/)).toBeInTheDocument()
    expect(screen.getByText(/Explanatory insights are not available yet/)).toBeInTheDocument()
    expect(screen.getAllByText(/SHR-169/).length).toBeGreaterThanOrEqual(4)
  })

  it('withholds income breakdown and comparison under SHR-167', async () => {
    await renderLoaded()
    expect(screen.getByText(/Income breakdown and comparison are not available yet/)).toBeInTheDocument()
    expect(screen.getByText(/Awaiting SHR-167/)).toBeInTheDocument()
  })

  it('withholds per-person and shared allocation under SHR-195/SHR-156', async () => {
    await renderLoaded()
    expect(screen.getByText(/Per-person and shared-versus-personal analysis is not available/)).toBeInTheDocument()
    expect(screen.getByText(/Awaiting SHR-195 \/ SHR-156/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Me|Partner|Shared/ })).toBeNull()
  })

  it('labels quality as evidence and never turns it into attention or anomaly truth', async () => {
    const { container } = await renderLoaded()
    expect(screen.getByText(/These are completeness fields returned by canonical contracts/)).toBeInTheDocument()
    expect(screen.getByText(/3 needs-review entries; this is evidence, not a ranked alert/)).toBeInTheDocument()
    expect(screen.getByText('No combined status')).toBeInTheDocument()
    expect(screen.getByText(/It does not publish one set-level quality status, so none is inferred/)).toBeInTheDocument()
    expect(screen.getAllByText(/published quality: complete/).length).toBeGreaterThan(0)
    const text = claimedText(container)
    expect(text).not.toMatch(/needs attention|unusual spend|anomaly|spending problem/i)
  })

  it('draws category magnitude as aria-hidden geometry without exposing a percentage or share', async () => {
    const { container } = await renderLoaded()
    const bars = container.querySelectorAll('.v6-insights-category-list .v6-bar-track')
    expect(bars.length).toBeGreaterThan(0)
    for (const bar of bars) expect(bar).toHaveAttribute('aria-hidden', 'true')
    expect(claimedText(container)).not.toMatch(/\d+(?:\.\d+)?%/)
    expect(claimedText(container)).not.toMatch(/share of|percentage change|six-month average:/i)
  })

  it('contains no client-side heuristic conclusion or prototype conclusion', async () => {
    const { container } = await renderLoaded()
    const text = claimedText(container)
    expect(text).not.toMatch(/increased this month|biggest spending problem|spent more than usual|trending upward|unusually high|could save AED/i)
    expect(text).not.toMatch(/third month rising|grocery switch|fuel prices eased|term fee lands|no dental/i)
  })
})

describe('V6 Insights — history and comparison views', () => {
  it('renders six canonical monthly facts with no computed trend, average or change', async () => {
    await renderLoaded({ query: { view: 'trends' } })
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(7)
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Month', 'Consumption spend (AED)', 'Posted income (AED)', 'Quality',
    ])
    expect(screen.getByText(/Category trends and judgements are not available yet/)).toBeInTheDocument()
    expect(screen.getByText(/Bar height is drawing-only geometry/)).toBeInTheDocument()
  })

  it('keeps chart geometry out of the accessibility tree and exposes the exact table instead', async () => {
    const { container } = await renderLoaded({ query: { view: 'trends' } })
    expect(container.querySelector('.v6-insights-history-drawing')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('region', { name: 'Published monthly facts table' })).toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveAccessibleName(/Posted income and consumption spend/)
  })

  it('shows current category facts but withholds comparison values in Compare', async () => {
    const { container } = await renderLoaded({ query: { view: 'compare' } })
    expect(screen.getByText('6,120.50')).toBeInTheDocument()
    expect(screen.getByText(/Category comparison is not available yet/)).toBeInTheDocument()
    expect(screen.getByText(/Household scope comparison/)).toBeInTheDocument()
    expect(claimedText(container)).not.toMatch(/[+−-]\d+(?:\.\d+)?%/)
  })
})

describe('V6 Insights — loading, empty, incomplete and error states', () => {
  it('shows an honest loading state without estimating', () => {
    const pending = new Promise(() => {})
    renderInsights({ reads: { getPeriodMetrics: () => pending, listBudgetActuals: () => pending } })
    expect(screen.getByText(/Reading canonical contracts/)).toBeInTheDocument()
    expect(screen.getByText(/Nothing is grouped, compared, averaged or estimated/)).toBeInTheDocument()
  })

  it('shows a true empty state when the category contract reports no rows', async () => {
    renderInsights({ reads: insightsFixtureReadsWith('empty') })
    await waitFor(() => expect(screen.getByText(/No category spending was reported/)).toBeInTheDocument())
    expect(screen.getAllByText(/reports no category consumption spend/).length).toBeGreaterThan(0)
  })

  it('withholds incomplete money and category values rather than showing zero', async () => {
    renderInsights({ reads: insightsFixtureReadsWith('incomplete') })
    await waitFor(() => expect(screen.getByText('Travel')).toBeInTheDocument())
    const travel = screen.getByText('Travel').closest('li')
    expect(within(travel).getByText('Incomplete')).toBeInTheDocument()
    expect(travel).not.toHaveTextContent(/^0$/)
    expect(screen.getAllByText(/withheld/).length).toBeGreaterThan(0)
  })

  it('settles failed canonical reads and preserves the page hierarchy', async () => {
    renderInsights({ reads: insightsFixtureReadsWith('failed') })
    await waitFor(() => expect(screen.getByText(/Category actuals are not available/)).toBeInTheDocument())
    expect(screen.getAllByText(/No legacy or estimated value is substituted/).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})

describe('V6 Insights — read-only controls, URL state and accessibility', () => {
  it('has no financial writer, editable field, form, or enabled write action', async () => {
    const { container } = await renderLoaded()
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.querySelector('select')).toBeNull()
    expect(container.querySelector('form')).toBeNull()
    expect(screen.queryByRole('button', { name: /Add|Edit|Save|Delete|Create|Apply/ })).toBeNull()
  })

  it('sanitizes and preserves period and view query state through direct open', () => {
    expect(Object.fromEntries(sanitizeQuery('/money/insights', 'period=quarter&view=trends&year=2026&month=8&quarter=3&unsafe=1'))).toEqual({
      period: 'quarter', year: '2026', month: '8', quarter: '3', view: 'trends',
    })
    const first = resolveAppHref('/money/insights?period=quarter&year=2026&month=8&quarter=3&view=trends')
    const route = first.kind === 'redirect' ? resolveAppHref(first.to) : first
    expect(route.kind).toBe('screen')
    expect(route.screen).toBe('Insights')
    expect(route.searchParams.get('period')).toBe('quarter')
    expect(route.searchParams.get('view')).toBe('trends')
  })

  it('writes view, period type and stepped period changes through the router callback', async () => {
    const user = userEvent.setup()
    const { onRouteQueryChange } = await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'History' }))
    expect(onRouteQueryChange).toHaveBeenCalledWith(expect.objectContaining({ view: 'trends' }))
    await user.click(screen.getByRole('button', { name: 'Quarter' }))
    expect(onRouteQueryChange).toHaveBeenCalledWith(expect.objectContaining({ period: 'quarter' }))
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(onRouteQueryChange).toHaveBeenCalledWith(expect.objectContaining({ year: '2026', month: '7', quarter: '3' }))
  })

  it('opens a deep-linked quarter and view rather than resetting to the current month', async () => {
    renderInsights({ query: { period: 'quarter', view: 'compare', year: '2026', quarter: '2' } })
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Insights for Q2 2026.'))
    expect(screen.getByRole('button', { name: 'Compare' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Quarter' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('mounts in the V6 shell with one h1 and Insights current in section navigation', async () => {
    const route = resolveAppHref('/money/insights')
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
        <InsightsScreen routeQuery={BASE_QUERY} onRouteQueryChange={vi.fn()} today={INSIGHTS_FIXTURE_TODAY} reads={insightsFixtureReads} />
      </AppShell>,
    )
    await waitFor(() => expect(screen.getByText('6,120.50')).toBeInTheDocument())
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('main')).toHaveAttribute('aria-labelledby', 'page-title')
    const nav = screen.getByRole('navigation', { name: 'Section navigation' })
    expect(within(nav).getByRole('link', { name: 'Insights' })).toHaveAttribute('aria-current', 'page')
  })

  it.each(['breakdown', 'trends', 'compare'])('has no automated accessibility violations in %s view', async (view) => {
    const result = await renderLoaded({ query: { view } })
    expect(await axe(result.container)).toHaveNoViolations()
  })

  it('has no automated accessibility violations in loading, empty, incomplete and error states', async () => {
    const pending = new Promise(() => {})
    const loading = renderInsights({ reads: { getPeriodMetrics: () => pending, listBudgetActuals: () => pending } })
    expect(await axe(loading.container)).toHaveNoViolations()
    loading.unmount()
    for (const fixture of ['empty', 'incomplete', 'failed']) {
      const state = renderInsights({ reads: insightsFixtureReadsWith(fixture) })
      await waitFor(() => expect(screen.queryByText(/Reading canonical contracts/)).not.toBeInTheDocument())
      expect(await axe(state.container)).toHaveNoViolations()
      state.unmount()
    }
  })
})

describe('V6 Insights — no prototype demo truth', () => {
  it('renders none of the frozen prototype financial values or conclusions', async () => {
    for (const view of ['breakdown', 'trends', 'compare']) {
      const state = await renderLoaded({ query: { view } })
      const text = claimedText(state.container)
      for (const demo of ['14,500', '9,600', '7,320', '7,240', '3,180', '2,860', '1,420', '2,140', '1,180']) {
        expect(text, `${view} carries prototype value ${demo}`).not.toContain(demo)
      }
      expect(text).not.toMatch(/Carrefour|Talabat|ENOC|Amazon\.ae|Noon\.com|DEWA/)
      state.unmount()
    }
  })
})
