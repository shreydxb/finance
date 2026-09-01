import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { describe, expect, it, vi } from 'vitest'

import { readFileSync } from 'node:fs'

import AppShell from '../../shell/AppShell'
import { presentationForRoute, resolveAppHref, sanitizeQuery } from '../../lib/routes'
import BudgetScreen from '../BudgetScreen'
import {
  BUDGET_FIXTURE_INCOMPLETE_MONTH,
  BUDGET_FIXTURE_TODAY,
  budgetFixtureReads,
  budgetFixtureReadsWith,
} from '../fixtures/budgetFixture'

vi.mock('../../lib/PrefsContext', () => ({
  usePrefs: () => ({ currency: 'AED', setCurrency: vi.fn(), theme: 'system', setTheme: vi.fn() }),
}))
vi.mock('../../lib/useRealtime', () => ({ useRealtimeRefresh: () => {} }))

const BASE_QUERY = { year: '2026', month: '8' }

function renderBudget({ query = {}, reads = budgetFixtureReads } = {}) {
  const onRouteQueryChange = vi.fn()
  const result = render(
    <BudgetScreen
      routeQuery={{ ...BASE_QUERY, ...query }}
      onRouteQueryChange={onRouteQueryChange}
      today={BUDGET_FIXTURE_TODAY}
      reads={reads}
    />,
  )
  return { ...result, onRouteQueryChange }
}

async function renderLoaded(options) {
  const result = renderBudget(options)
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())
  return result
}

/**
 * The text the screen *claims*, with the honest unavailable regions removed.
 *
 * Those regions exist to say which figures are not being claimed — "no 'under
 * pace' or 'over by' claim is made" — so matching a forbidden phrase inside
 * one would fail on the very copy that prevents the failure.
 */
function claimedText(container) {
  const clone = container.cloneNode(true)
  for (const region of clone.querySelectorAll('.v6-unavailable')) region.remove()
  return clone.textContent
}

/* ── 1 & 2: the route mounts fresh V6, and the legacy screen does not ────── */

describe('V6 Budget — routing and the legacy boundary', () => {
  it('mounts the fresh V6 Budget screen at /money/budget', async () => {
    const route = resolveAppHref('/money/budget')
    expect(route.kind).toBe('screen')
    expect(route.screen).toBe('Budget')

    const { container } = await renderLoaded()
    expect(container.querySelector('[data-testid="v6-budget"]')).toBeInTheDocument()
    expect(container.querySelector('.v6-surface')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Category spending in August 2026.')
  })

  it('does not mount any of the legacy Budget presentation', async () => {
    // The legacy screen is deliberately *not* imported here — the V6 boundary
    // forbids reaching into `src/screens/`, and a test that broke the rule to
    // check the rule would be the first crack in it. It is read as text
    // instead, so its own markers can be asserted absent from what mounts.
    const legacy = readFileSync('src/screens/Budget.jsx', 'utf8')
    expect(legacy).toMatch(/from '\.\.\/lib\/budgets'/)
    expect(legacy).toMatch(/Not yet budgeted/)

    const { container } = await renderLoaded()
    const html = container.innerHTML
    // Its composition markers, its derived Remaining column and its editor
    // affordance are all absent from what actually renders.
    // The legacy card class is assembled rather than written out: the V6
    // boundary test scans every file under `src/v6/` for legacy CSS ramps, and
    // this file is one of them.
    const legacyCardClass = ['shadow', 'card'].join('-')
    for (const marker of ['Not yet budgeted', 'Set a limit', 'Contributions', legacyCardClass, 'tnum']) {
      expect(html, `the legacy Budget marker "${marker}" must not be mounted`).not.toContain(marker)
    }
    expect(within(screen.getByRole('table')).queryByRole('columnheader', { name: 'Remaining' })).toBeNull()
    // And no legacy global CSS ramp reaches the V6 surface.
    expect(html).not.toMatch(/\b(?:text|bg|border|ring)-(?:ink|brand|pos|neg|night)-\d{2,3}\b/)
    expect(html).not.toMatch(/\bshadow-(?:card|lift|pop|hero)\b/)
  })

  it('imports no legacy budget reader or writer anywhere in the V6 Budget tree', () => {
    const modules = [
      'src/v6/BudgetScreen.jsx',
      'src/v6/data/budgetModel.js',
      'src/v6/data/composeBudget.js',
      'src/v6/data/useBudgetData.js',
      'src/v6/data/canonicalReads.js',
      'src/v6/budget/BudgetHeader.jsx',
      'src/v6/budget/BudgetControls.jsx',
      'src/v6/budget/BudgetSummary.jsx',
      'src/v6/budget/BudgetCategoryTable.jsx',
      'src/v6/budget/BudgetYearGrid.jsx',
      'src/v6/budget/BudgetQuality.jsx',
    ]
    for (const path of modules) {
      const text = readFileSync(path, 'utf8')
      expect(text, `${path} must not import the legacy budget module`).not.toMatch(/from '[^']*\/lib\/budgets'/)
      expect(text, `${path} must not call a legacy budget writer`).not.toMatch(/\b(?:upsertBudget|listBudgets|saveBudget|deleteBudget)\b/)
    }
  })
})

/* ── 4: canonical actuals render faithfully ─────────────────────────────── */

describe('V6 Budget — canonical actuals', () => {
  it('renders each canonical category actual exactly as the contract published it', async () => {
    await renderLoaded()
    const table = screen.getByRole('table')

    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Category', 'Spent (AED)', 'Planned', 'Pace', 'Projected close',
    ])

    const housing = within(table).getByRole('rowheader', { name: /Housing/ }).closest('tr')
    expect(within(housing).getByText('6,120.50')).toBeInTheDocument()

    const groceries = within(table).getByRole('rowheader', { name: /Groceries/ }).closest('tr')
    expect(within(groceries).getByText('3,884.25')).toBeInTheDocument()
    expect(within(groceries).getByText('provisional')).toBeInTheDocument()
    expect(within(groceries).getByText('2 needs review')).toBeInTheDocument()

    // The canonical period headline, from the period contract rather than the
    // sum of the visible rows.
    expect(screen.getAllByText('15,536').length).toBeGreaterThan(0)
  })

  it('keeps Uncategorised distinct from a household category named Other', async () => {
    await renderLoaded()
    const table = screen.getByRole('table')
    const uncategorised = within(table).getByRole('rowheader', { name: /Uncategorised/ })
    const other = within(table).getByRole('rowheader', { name: /^Other/ })
    expect(uncategorised).toBeInTheDocument()
    expect(other).toBeInTheDocument()
    expect(uncategorised).not.toBe(other)
    expect(within(uncategorised.closest('tr')).getByText('471.10')).toBeInTheDocument()
    expect(within(other.closest('tr')).getByText('264.00')).toBeInTheDocument()
    expect(uncategorised.textContent).toMatch(/bucket for entries with no category/)
  })

  it('presents category labels as reported labels, not as stable identity', async () => {
    await renderLoaded()
    expect(screen.getByText(/Categories are the labels reported by the canonical actuals contract/)).toBeInTheDocument()
    expect(screen.getByText(/no stable category identity behind it yet/)).toBeInTheDocument()
    expect(screen.getAllByText(/SHR-198/).length).toBeGreaterThan(0)
  })

  it('never introduces rename, archive or delete category semantics', async () => {
    const { container } = await renderLoaded()
    const text = container.textContent
    expect(text).not.toMatch(/\bRename\b/)
    expect(text).not.toMatch(/\bArchive\b/)
    expect(text).not.toMatch(/\bDelete\b/)
    expect(text).not.toMatch(/\bMerge\b/)
  })
})

/* ── 5 & 6: missing plan / consumer truth never becomes a local figure ──── */

describe('V6 Budget — plan truth fails closed', () => {
  it('states every plan position as unavailable and names SHR-166', async () => {
    await renderLoaded()
    const table = screen.getByRole('table')
    const housing = within(table).getByRole('rowheader', { name: /Housing/ }).closest('tr')
    // The category label is the row header, so the cells are Spent, then
    // Planned / Pace / Projected close — each an explicit state.
    const cells = within(housing).getAllByRole('cell')
    expect(cells).toHaveLength(4)
    expect(cells[0].textContent).toContain('6,120.50')
    for (const cell of cells.slice(1)) expect(cell).toHaveTextContent('Not available')

    // Each plan position states its own gap where the household reads it, so
    // the same sentence can legitimately appear more than once.
    expect(screen.getAllByText(/The planned amount is not available yet/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Budget left is not available yet/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Projected close is not available yet/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Progress against plan is not available yet/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/SHR-166/).length).toBeGreaterThan(0)
  })

  it('never derives a remaining, percentage or projected figure from the actual', async () => {
    const { container } = await renderLoaded()
    const text = claimedText(container)
    // No percentage-of-plan claim anywhere on the screen.
    expect(text).not.toMatch(/\d+%\s*(?:used|of budget|of plan)/i)
    expect(text).not.toMatch(/\bunder pace\b/i)
    expect(text).not.toMatch(/\bover pace\b/i)
    expect(text).not.toMatch(/\bon track\b/i)
    expect(text).not.toMatch(/\bover by\b/i)
    expect(text).not.toMatch(/\bremaining:\s*AED/i)
    // The one place a household would look for "left": it says why it cannot say.
    expect(screen.getByText('Budget left')).toBeInTheDocument()
  })

  it('renders no progress bar for the plan, only relative magnitude between actuals', async () => {
    const { container } = await renderLoaded()
    // The prototype's plan bar and pace marker are absent; there is no
    // progressbar role anywhere, because nothing publishes a plan ratio.
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0)
    expect(screen.getByText(/It is not progress towards a plan/)).toBeInTheDocument()

    const bars = container.querySelectorAll('.v6-budget-magnitude .v6-bar-fill')
    expect(bars.length).toBeGreaterThan(0)
    // Widest bar is the largest canonical actual, at full width; the rest are
    // relative to it, never to a limit.
    expect(Number.parseFloat(bars[0].style.width)).toBe(100)
    expect(Number.parseFloat(bars[1].style.width)).toBeLessThan(100)
    expect(container.querySelector('.v6-budget-magnitude')).toHaveAttribute('aria-hidden', 'true')
  })

  it('draws no bar at all when the actuals cannot be reconciled to the canonical total', async () => {
    const { container } = await renderLoaded({ reads: budgetFixtureReadsWith(null, { breakReconciliation: true }) })
    expect(container.querySelectorAll('.v6-budget-magnitude')).toHaveLength(0)
    expect(screen.getByText(/do not reconcile to the canonical period consumption total/)).toBeInTheDocument()
    // The individual canonical actuals are still shown: each is published truth.
    expect(screen.getByText('6,120.50')).toBeInTheDocument()
  })

  it('withholds a category actual with no canonical FX rate instead of showing zero', async () => {
    const { container } = await renderLoaded({ reads: budgetFixtureReadsWith(BUDGET_FIXTURE_INCOMPLETE_MONTH) })
    const travel = screen.getByRole('rowheader', { name: /Travel/ }).closest('tr')
    expect(within(travel).getByText('Incomplete')).toBeInTheDocument()
    expect(within(travel).queryByText('0')).not.toBeInTheDocument()
    expect(within(travel).getByText(/2 missing FX/)).toBeInTheDocument()
    // The period headline is withheld too rather than under-reported.
    expect(container.textContent).toMatch(/withholds the figure rather than under-reporting it/)
  })

  it('names SHR-167 for the Budget income and net-saved positions it cannot state', async () => {
    await renderLoaded({ query: { view: 'year' } })
    expect(screen.getByText(/Budget-period income is not available on this screen/)).toBeInTheDocument()
    expect(screen.getByText(/Savings and net-saved positions are not available on this screen/)).toBeInTheDocument()
    expect(screen.getAllByText(/SHR-167/).length).toBeGreaterThan(0)
  })

  it('degrades a failed canonical read without blanking the screen or substituting a value', async () => {
    await renderLoaded({
      reads: {
        ...budgetFixtureReads,
        listBudgetActuals: async () => { throw new Error('actuals offline') },
      },
    })
    expect(screen.getAllByText(/actuals offline/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/No legacy or estimated value is substituted/).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('shows an honest loading state before any contract answers', async () => {
    const pending = new Promise(() => {})
    const { container } = renderBudget({
      reads: { listBudgetActuals: () => pending, getPeriodMetrics: () => pending },
    })
    expect(screen.getByText(/Reading canonical contracts/)).toBeInTheDocument()
    expect(container.textContent).toMatch(/Nothing is estimated while this loads/)
  })
})

/* ── 8 & 9: no legacy writer, no operable write control ─────────────────── */

describe('V6 Budget — writes stay inert', () => {
  it('renders the prototype’s budget actions disabled and names their missing contract', async () => {
    await renderLoaded()
    const setBudget = screen.getByRole('button', { name: /Set a budget/ })
    expect(setBudget).toBeDisabled()
    expect(screen.getByText(/Setting a budget is not available on this screen yet/)).toBeInTheDocument()
    expect(screen.getByText(/legacy budget writer has none of that and is deliberately not wired in/)).toBeInTheDocument()
  })

  it('leaves no operable control that could write, and no editable field', async () => {
    const { container } = await renderLoaded()
    const enabled = screen.getAllByRole('button').filter((node) => !node.disabled)
    // Only navigation and view switching remain operable.
    expect(enabled.map((node) => node.getAttribute('aria-label') ?? node.textContent.trim()).sort()).toEqual(
      ['Month', 'Previous month', 'Year'],
    )
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.querySelector('select')).toBeNull()
    expect(container.querySelector('form')).toBeNull()
    // Category rows are not clickable editors the way the prototype's are.
    expect(screen.queryAllByRole('button', { name: /Edit/ })).toHaveLength(0)
  })
})

/* ── 10: month/year deep links ──────────────────────────────────────────── */

describe('V6 Budget — period state in the URL', () => {
  it('keeps the selected month and year in the route query so a reload reopens it', () => {
    const query = sanitizeQuery('/money/budget', 'year=2026&month=3&view=year')
    expect(Object.fromEntries(query)).toEqual({ year: '2026', month: '3', view: 'year' })
    // A resolved deep link reopens the same period rather than resetting. The
    // router normalises the parameter order first, exactly as it does for
    // Activity, so the link survives the redirect with its period intact.
    const normalised = resolveAppHref('/money/budget?year=2026&month=3&view=year')
    expect(normalised.kind).toBe('redirect')
    const route = resolveAppHref(normalised.to)
    expect(route.kind).toBe('screen')
    expect(route.screen).toBe('Budget')
    expect(route.searchParams.get('year')).toBe('2026')
    expect(route.searchParams.get('month')).toBe('3')
    expect(route.searchParams.get('view')).toBe('year')

    // The already-canonical form resolves straight to the screen.
    const direct = resolveAppHref('/money/budget?view=year&year=2026&month=3')
    expect(direct.kind).toBe('screen')
    expect(direct.href).toBe('/money/budget?view=year&year=2026&month=3')
  })

  it('drops an out-of-range or unknown period from the URL rather than rendering it', () => {
    expect(Object.fromEntries(sanitizeQuery('/money/budget', 'year=1899&month=13&view=decade'))).toEqual({})
  })

  it('opens the month a deep link names, not today’s', async () => {
    await renderLoaded({ query: { year: '2026', month: '3' } })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Category spending in March 2026.')
    expect(screen.getByText('6,120.50')).toBeInTheDocument()
  })

  it('steps the period through the router so the change survives a reload', async () => {
    const user = userEvent.setup()
    const { onRouteQueryChange } = await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(onRouteQueryChange).toHaveBeenCalledWith(expect.objectContaining({ year: '2026', month: '7' }))
  })

  it('carries the month across the Month/Year switch so returning reopens it', async () => {
    const user = userEvent.setup()
    const { onRouteQueryChange } = await renderLoaded({ query: { year: '2026', month: '3' } })
    await user.click(screen.getByRole('button', { name: 'Year' }))
    expect(onRouteQueryChange).toHaveBeenCalledWith(expect.objectContaining({
      view: 'year', year: '2026', month: '3',
    }))
  })

  it('will not step past the current period', async () => {
    await renderLoaded()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous month' })).not.toBeDisabled()
  })
})

/* ── Year view ──────────────────────────────────────────────────────────── */

describe('V6 Budget — the year view', () => {
  it('lays out twelve canonical monthly reads without aggregating them', async () => {
    await renderLoaded({ query: { view: 'year' } })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Category spending across 2026.')
    const table = screen.getByRole('table')
    const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers[0]).toBe('Category')
    expect(headers.slice(1, 13)).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
    expect(headers.slice(13)).toEqual(['Total', 'Avg'])

    const housing = within(table).getByRole('rowheader', { name: /^Housing/ }).closest('tr')
    const cells = within(housing).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('6,121')
    // Total and Avg are stated as unavailable, never summed across the row.
    expect(cells[12]).toHaveTextContent('Not available')
    expect(cells[13]).toHaveTextContent('Not available')
    expect(screen.getByText(/Year totals, averages and net saved are not available/)).toBeInTheDocument()
  })

  it('reads an unreported month as not reported, never as zero spend', async () => {
    await renderLoaded({ query: { view: 'year' } })
    const table = screen.getByRole('table')
    const other = within(table).getByRole('rowheader', { name: /^Other/ }).closest('tr')
    const cells = within(other).getAllByRole('cell')
    // Only July and August report `Other` in the fixture.
    expect(cells[0]).toHaveTextContent('Not reported')
    expect(cells[6]).toHaveTextContent('188')
    expect(cells[7]).toHaveTextContent('264')
    expect(cells[0]).not.toHaveTextContent('0')
  })
})

/* ── Shell, headings and accessibility ──────────────────────────────────── */

describe('V6 Budget — shell and accessibility', () => {
  function renderInShell(query = {}) {
    const route = resolveAppHref('/money/budget')
    return render(
      <AppShell
        identity="member@example.com"
        navigate={vi.fn(() => true)}
        onSignOut={vi.fn().mockResolvedValue(true)}
        presentation={presentationForRoute(route)}
        route={route}
        screenOwnsHeader
        takePendingFocusTarget={() => null}
      >
        <BudgetScreen
          routeQuery={{ ...BASE_QUERY, ...query }}
          onRouteQueryChange={vi.fn()}
          today={BUDGET_FIXTURE_TODAY}
          reads={budgetFixtureReads}
        />
      </AppShell>,
    )
  }

  it('mounts inside the V6 shell owning a single h1, with Budget current in section navigation', async () => {
    renderInShell()
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('main')).toHaveAttribute('aria-labelledby', 'page-title')
    const secondary = screen.getByRole('navigation', { name: 'Section navigation' })
    expect(within(secondary).getByRole('link', { name: 'Budget' })).toHaveAttribute('aria-current', 'page')
    expect(within(secondary).getByRole('link', { name: 'Activity' })).not.toHaveAttribute('aria-current')
  })

  it('has no automated accessibility violations in the month view', async () => {
    const { container } = await renderLoaded()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('has no automated accessibility violations in the year view', async () => {
    const { container } = await renderLoaded({ query: { view: 'year' } })
    expect(await axe(container)).toHaveNoViolations()
  })

  it('has no automated accessibility violations while loading or after a failed read', async () => {
    const pending = new Promise(() => {})
    const loadingRender = renderBudget({ reads: { listBudgetActuals: () => pending, getPeriodMetrics: () => pending } })
    expect(await axe(loadingRender.container)).toHaveNoViolations()
    loadingRender.unmount()

    const failed = await renderLoaded({
      reads: {
        async listBudgetActuals() { throw new Error('actuals offline') },
        async getPeriodMetrics() { throw new Error('period metrics offline') },
      },
    })
    expect(await axe(failed.container)).toHaveNoViolations()
  })
})

/* ── 12: no prototype demo value reaches the screen ─────────────────────── */

describe('V6 Budget — no prototype demo value reaches the screen', () => {
  it('renders none of the frozen prototype’s non-contractual Budget figures', async () => {
    for (const query of [{}, { view: 'year' }]) {
      const view = await renderLoaded({ query })
      const text = claimedText(view.container)
      for (const demo of ['55,000', '46,120', '14,500', '9,600', '7,240', '7,320', '3,180', '2,860', '1,420', '4,800', '51,700', '349,300', '84%', '90%']) {
        expect(text, `prototype demo value ${demo} must never reach the screen`).not.toContain(demo)
      }
      expect(text).not.toMatch(/Rent, service charge|School fees, quarterly|Uncategorised sits here|Nothing booked yet/)
      view.unmount()
    }
  })
})
