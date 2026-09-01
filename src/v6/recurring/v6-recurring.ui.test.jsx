import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { describe, expect, it, vi } from 'vitest'

import { readFileSync } from 'node:fs'

import AppShell from '../../shell/AppShell'
import { presentationForRoute, resolveAppHref, sanitizeQuery } from '../../lib/routes'
import RecurringScreen from '../RecurringScreen'
import {
  RECURRING_FIXTURE_TODAY,
  recurringFixtureReads,
  recurringFixtureReadsFailed,
  recurringFixtureReadsIncomplete,
  recurringFixtureReadsProvisional,
} from '../fixtures/recurringFixture'

vi.mock('../../lib/PrefsContext', () => ({
  usePrefs: () => ({ currency: 'AED', setCurrency: vi.fn(), theme: 'system', setTheme: vi.fn() }),
}))
vi.mock('../../lib/useRealtime', () => ({ useRealtimeRefresh: () => {} }))

const BASE_QUERY = { year: '2026', month: '8' }

function renderRecurring({ query = {}, reads = recurringFixtureReads } = {}) {
  const onRouteQueryChange = vi.fn()
  const result = render(
    <RecurringScreen
      routeQuery={{ ...BASE_QUERY, ...query }}
      onRouteQueryChange={onRouteQueryChange}
      today={RECURRING_FIXTURE_TODAY}
      reads={reads}
    />,
  )
  return { ...result, onRouteQueryChange }
}

async function renderLoaded(options) {
  const result = renderRecurring(options)
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())
  return result
}

/**
 * The text the screen *claims*, with the honest unavailable regions removed.
 *
 * Those regions exist to say what is not being claimed — "nothing is marked
 * paid, unpaid, due, overdue or missed" — so matching a forbidden phrase
 * inside one would fail on the very copy that prevents the failure.
 */
function claimedText(container) {
  const clone = container.cloneNode(true)
  for (const region of clone.querySelectorAll('.v6-unavailable')) region.remove()
  for (const hint of clone.querySelectorAll('.v6-kpi-hint')) hint.remove()
  return clone.textContent
}

/* ── 1 & 2: the route mounts fresh V6, and the legacy screen does not ────── */

describe('V6 Recurring — routing and the legacy boundary', () => {
  it('mounts the fresh V6 Recurring screen at /money/recurring', async () => {
    const route = resolveAppHref('/money/recurring')
    expect(route.kind).toBe('screen')
    expect(route.screen).toBe('Recurring')

    const { container } = await renderLoaded()
    expect(container.querySelector('[data-testid="v6-recurring"]')).toBeInTheDocument()
    expect(container.querySelector('.v6-surface')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 }))
      .toHaveTextContent('Bills, EMIs and expected income for August 2026.')
  })

  it('does not mount any of the legacy Recurring presentation', async () => {
    // The legacy screen is deliberately *not* imported here — the V6 boundary
    // forbids reaching into `src/screens/`, and a test that broke the rule to
    // check the rule would be the first crack in it. It is read as text
    // instead, so its own markers can be asserted absent from what mounts.
    const legacy = readFileSync('src/screens/Recurring.jsx', 'utf8')
    expect(legacy).toMatch(/from '\.\.\/lib\/recurring'/)

    const { container } = await renderLoaded()
    const html = container.innerHTML
    // The legacy card class is assembled rather than written out: the V6
    // boundary test scans every file under `src/v6/` for legacy CSS ramps, and
    // this file is one of them.
    const legacyCardClass = ['shadow', 'card'].join('-')
    for (const marker of [legacyCardClass, 'tnum', 'text-ink-']) {
      expect(html, `the legacy marker "${marker}" must not be mounted`).not.toContain(marker)
    }
  })

  it('the app no longer imports the legacy Recurring screen for this route', () => {
    const app = readFileSync('src/App.jsx', 'utf8')
    expect(app).toMatch(/import RecurringScreen from '\.\/v6\/RecurringScreen'/)
    expect(app).toMatch(/Recurring: RecurringScreen,/)
    expect(app).not.toMatch(/from '\.\/screens\/Recurring'/)
  })

  /* ── 11: no legacy writer is imported or called ───────────────────────── */
  it('imports no legacy recurring or transaction reader or writer anywhere in the V6 Recurring tree', () => {
    const tree = [
      'src/v6/RecurringScreen.jsx',
      'src/v6/data/recurringModel.js',
      'src/v6/data/recurringGaps.js',
      'src/v6/data/recurringPeriods.js',
      'src/v6/data/composeRecurring.js',
      'src/v6/data/useRecurringData.js',
      'src/v6/fixtures/recurringFixture.js',
      'src/v6/recurring/RecurringHeader.jsx',
      'src/v6/recurring/RecurringControls.jsx',
      'src/v6/recurring/RecurringPlanList.jsx',
      'src/v6/recurring/RecurringCalendar.jsx',
      'src/v6/recurring/RecurringCommitmentSplit.jsx',
      'src/v6/recurring/RecurringMatching.jsx',
    ]
    for (const path of tree) {
      const source = readFileSync(path, 'utf8')
      expect(source, `${path} must not import a legacy reader or writer`)
        .not.toMatch(/from\s+'[^']*\/(?:lib\/(?:recurring|transactions|budgets|goals|income|accounts)|screens|components)\//)
      expect(source, `${path} must not import a legacy lib module`)
        .not.toMatch(/from\s+'[^']*\/lib\/(?:recurring|transactions|budgets|goals|income)(?:\.js)?'/)
      // The names of the legacy writers themselves never appear, so no call
      // site can exist even by dynamic dispatch.
      expect(source).not.toMatch(/\b(?:upsertRecurring|deleteRecurring|createTransaction|updateTransaction|saveRecurring)\b/)
    }
  })
})

/* ── 6, 7 & 8: plan truth, posted facts and matching ────────────────────── */

describe('V6 Recurring — plan truth fails closed', () => {
  it('states the bills list as unavailable and names SHR-171 rather than listing anything', async () => {
    await renderLoaded()
    expect(screen.getAllByText(/Recurring bills and EMIs are not available yet/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/SHR-171 — recurring and expected-income plan contract/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Reconstructing it from posted transactions/)).toBeInTheDocument()
  })

  it('states expected income as unavailable rather than borrowing a posted total', async () => {
    await renderLoaded({ query: { type: 'income' } })
    expect(screen.getAllByText(/Expected income is not available yet/).length).toBeGreaterThan(0)
    expect(screen.getByText(/deriving it from posted income would state an expectation the household never set/))
      .toBeInTheDocument()
  })

  it('never turns a posted transaction into an expected recurring item', async () => {
    // The screen is handed reads that would happily answer a ledger question.
    // It never asks one, so no row can appear from them.
    const ledger = vi.fn()
    const income = vi.fn()
    await renderLoaded({
      reads: {
        ...recurringFixtureReads,
        listLedgerRows: ledger,
        listCanonicalLedgerRows: ledger,
        listCanonicalIncomeRows: income,
        listTransactions: ledger,
      },
    })
    expect(ledger).not.toHaveBeenCalled()
    expect(income).not.toHaveBeenCalled()
    expect(screen.queryAllByRole('row')).toHaveLength(0)
  })

  it('makes no cadence, due-date, paid or missed claim anywhere it renders', async () => {
    for (const query of [{}, { type: 'income' }, { view: 'calendar' }, { type: 'income', view: 'calendar' }]) {
      const view = await renderLoaded({ query })
      const claimed = claimedText(view.container)
      expect(claimed).not.toMatch(/\b(?:overdue|unpaid|past due|due in \d|paid on|missed (?:bill|payment))\b/i)
      expect(claimed).not.toMatch(/\brepeats (?:monthly|weekly|quarterly|annually)\b/i)
      expect(claimed).not.toMatch(/\bnext due\b\s*[:·]/i)
      expect(claimed).not.toMatch(/\bautopay\b\s*(?:on|off|enabled)/i)
      view.unmount()
    }
  })

  it('creates no automatic matching semantics and offers no suggested match', async () => {
    await renderLoaded()
    expect(screen.getByText(/Suggested matches between commitments and posted entries are not available/))
      .toBeInTheDocument()
    expect(screen.getByText(/fuzzy merchant similarity, an amount-and-date heuristic/)).toBeInTheDocument()
    expect(screen.getAllByText(/Paid and unpaid status is not available/).length).toBeGreaterThan(0)
    // Nothing is offered as a candidate to accept.
    expect(screen.queryAllByRole('button', { name: /Accept|Confirm match|Looks right/ })).toHaveLength(0)
  })

  /* ── 9: attribution ───────────────────────────────────────────────────── */
  it('never presents recorded owner text as stable economic attribution', async () => {
    for (const query of [{}, { type: 'income' }]) {
      const view = await renderLoaded({ query })
      expect(screen.getAllByText(/Who pays or earns a commitment is not available/).length).toBeGreaterThan(0)
      expect(screen.getByText(/Legacy owner text on a posted transaction is a recorded label, not a stable economic party/))
        .toBeInTheDocument()
      const claimed = claimedText(view.container)
      // No person, no household split, no share.
      expect(claimed).not.toMatch(/\b(?:Shrey|Tarika|Joint|Partner|Both)\b/)
      expect(claimed).not.toMatch(/\d+\s*%\s*(?:shared|split|of the household)/i)
      view.unmount()
    }
  })

  it('names SHR-167 for the budget-period posted-income position it will not state', async () => {
    await renderLoaded()
    expect(screen.getByText(/Posted income for this period is not stated on this screen/)).toBeInTheDocument()
    expect(screen.getAllByText(/SHR-167 — canonical Budget consumer migration and posted-income truth/).length)
      .toBeGreaterThan(0)
  })
})

/* ── posted facts that are genuinely canonical ──────────────────────────── */

describe('V6 Recurring — the one canonical position', () => {
  it('publishes the period’s consumption spend and labels it as posted, not committed', async () => {
    await renderLoaded()
    expect(screen.getByText('Consumption spend posted this period')).toBeInTheDocument()
    expect(screen.getByText('21,486')).toBeInTheDocument()
    expect(screen.getByText(/Whole-period posted spend from canonical_period_metrics/)).toBeInTheDocument()
    // The committed half of the prototype's split stays unavailable beside it.
    expect(screen.getByText('Committed before the month started')).toBeInTheDocument()
    expect(screen.getAllByText(/The fixed-versus-variable split is not available yet/).length).toBeGreaterThan(0)
  })

  it('draws no fixed-versus-variable bar and states no committed percentage', async () => {
    const { container } = await renderLoaded()
    expect(container.querySelector('.v6-bar-track')).toBeNull()
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
    expect(claimedText(container)).not.toMatch(/\d+%\s*(?:of spend|committed|fixed|variable)/i)
  })

  it('states a withheld canonical spend rather than rendering it as zero', async () => {
    const { container } = await renderLoaded({ reads: recurringFixtureReadsIncomplete })
    const figure = container.querySelector('.v6-recurring-split-figure .v6-missing-figure')
    expect(figure).toHaveTextContent('Incomplete')
    expect(claimedText(container)).not.toMatch(/AED\s*0\b/)
    expect(screen.getByText(/2 without a canonical FX rate \(JPY\)/)).toBeInTheDocument()
  })

  it('reports the canonical quality and review counters beside the figure', async () => {
    await renderLoaded({ reads: recurringFixtureReadsProvisional })
    expect(screen.getByText(/Period quality: provisional · 3 flagged for review/)).toBeInTheDocument()
  })

  it('degrades a failed canonical read without blanking the screen or substituting a value', async () => {
    const { container } = await renderLoaded({ reads: recurringFixtureReadsFailed })
    expect(screen.getByText(/could not be read/)).toBeInTheDocument()
    expect(screen.getByText(/No legacy or estimated value is substituted/)).toBeInTheDocument()
    // The plan positions are unaffected: they were never going to be filled.
    expect(screen.getAllByText(/Recurring bills and EMIs are not available yet/).length).toBeGreaterThan(0)
    expect(claimedText(container)).not.toMatch(/AED\s*0\b/)
  })

  it('shows an honest loading state before any contract answers', () => {
    const pending = new Promise(() => {})
    renderRecurring({ reads: { getPeriodMetrics: () => pending } })
    expect(screen.getByText('Reading canonical contracts…')).toBeInTheDocument()
    expect(screen.getByText(/Nothing is estimated while this loads/)).toBeInTheDocument()
  })
})

/* ── calendar ───────────────────────────────────────────────────────────── */

describe('V6 Recurring — the calendar', () => {
  it('renders the real month and places nothing on any day', async () => {
    const { container } = await renderLoaded({ query: { view: 'calendar' } })
    const cells = container.querySelectorAll('.v6-calendar-cell')
    // 1 Aug 2026 is a Saturday: five leading blanks plus 31 days fills 36 of
    // 42 cells in a six-row Monday-first grid.
    expect(cells.length % 7).toBe(0)
    const inMonth = container.querySelectorAll('.v6-calendar-cell[data-outside="false"]')
    expect(inMonth).toHaveLength(31)
    expect(screen.getByText(/No event is placed on a day/)).toBeInTheDocument()
    expect(screen.getByText(/Expected recurring events are not available on the calendar/)).toBeInTheDocument()
  })

  it('invents no calendar amount and plots no posted entry', async () => {
    const { container } = await renderLoaded({ query: { view: 'calendar' } })
    const grid = container.querySelector('.v6-calendar-grid')
    // Every visible token inside the grid is a day number or an em dash.
    const tokens = Array.from(grid.querySelectorAll('.v6-calendar-day, .v6-calendar-count'))
      .map((node) => node.textContent.replace(/\s*\(today\)\s*/, '').replace(/No .*$/, '').trim())
    for (const token of tokens) {
      expect(token === '—' || /^\d{1,2}$/.test(token), `calendar cell token "${token}"`).toBe(true)
    }
    expect(container.querySelector('.v6-calendar-grid').textContent).not.toMatch(/AED|\d{3},\d{3}|\d+\.\d{2}/)
  })

  it('marks today from the household date only in the month that contains it', async () => {
    const august = await renderLoaded({ query: { view: 'calendar' } })
    expect(august.container.querySelectorAll('.v6-calendar-cell[data-today="true"]')).toHaveLength(1)
    august.unmount()
    const march = await renderLoaded({ query: { view: 'calendar', month: '3' } })
    expect(march.container.querySelectorAll('.v6-calendar-cell[data-today="true"]')).toHaveLength(0)
  })
})

/* ── 10: writes stay inert ──────────────────────────────────────────────── */

describe('V6 Recurring — writes stay inert', () => {
  it('renders every prototype action disabled and names its missing contract', async () => {
    await renderLoaded()
    for (const name of ['Add a bill', 'Edit a commitment', 'Archive a commitment', 'Mark paid', 'Match a posted entry']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    expect(screen.getByText(/Adding a bill or an expected income is not available on this screen yet/)).toBeInTheDocument()
    expect(screen.getByText(/Editing a commitment is not available on this screen yet/)).toBeInTheDocument()
    expect(screen.getByText(/Archiving or ending a commitment is not available on this screen yet/)).toBeInTheDocument()
    expect(screen.getByText(/Marking a bill paid is not available on this screen yet/)).toBeInTheDocument()
    expect(screen.getByText(/Linking a posted entry to a commitment is not available on this screen yet/)).toBeInTheDocument()
  })

  it('renames the add action with the mode without ever enabling it', async () => {
    await renderLoaded({ query: { type: 'income' } })
    expect(screen.getByRole('button', { name: 'Add an expected income' })).toBeDisabled()
  })

  it('leaves no operable control that could write, and no editable field', async () => {
    const { container } = await renderLoaded()
    const enabled = screen.getAllByRole('button').filter((node) => !node.disabled)
    // Only navigation, the type switch and the view switch remain operable.
    // Everything that could write is present and inert.
    expect(enabled.map((node) => node.getAttribute('aria-label') ?? node.textContent.trim()).sort()).toEqual(
      ['Bills and EMIs', 'Calendar', 'Expected income', 'List', 'Previous month'],
    )
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.querySelector('select')).toBeNull()
    expect(container.querySelector('form')).toBeNull()
  })

  it('does not fire a route change or a write when a disabled action is clicked', async () => {
    const user = userEvent.setup()
    const { onRouteQueryChange } = await renderLoaded()
    onRouteQueryChange.mockClear()
    await user.click(screen.getByRole('button', { name: 'Mark paid' }))
    await user.click(screen.getByRole('button', { name: 'Add a bill' }))
    expect(onRouteQueryChange).not.toHaveBeenCalled()
  })
})

/* ── 3, 4 & 5: route state survives a reload ────────────────────────────── */

describe('V6 Recurring — type, view and period state in the URL', () => {
  it('keeps type, view, year and month in the route query so a reload reopens them', () => {
    const query = sanitizeQuery('/money/recurring', 'type=income&view=calendar&year=2026&month=3')
    expect(Object.fromEntries(query)).toEqual({
      type: 'income', view: 'calendar', year: '2026', month: '3',
    })
    // And the sanitised query round-trips through a resolved href unchanged.
    const route = resolveAppHref('/money/recurring?type=income&view=calendar&year=2026&month=3')
    expect(route.href).toContain('type=income')
    expect(route.href).toContain('view=calendar')
    expect(route.href).toContain('year=2026')
    expect(route.href).toContain('month=3')
  })

  it('drops an unknown type, view or out-of-range period rather than rendering it', () => {
    const query = sanitizeQuery('/money/recurring', 'type=both&view=gantt&year=1066&month=13')
    expect(Object.fromEntries(query)).toEqual({})
  })

  it('opens the type, view and month a deep link names, not the defaults', async () => {
    const { container } = await renderLoaded({ query: { type: 'income', view: 'calendar', month: '3' } })
    expect(screen.getByRole('heading', { level: 1 }))
      .toHaveTextContent('Bills, EMIs and expected income for March 2026.')
    expect(screen.getByRole('button', { name: 'Expected income' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Calendar' })).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelector('.v6-calendar-grid')).toBeInTheDocument()
  })

  it('switches type through the router so the change survives a reload', async () => {
    const user = userEvent.setup()
    const { onRouteQueryChange } = await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Expected income' }))
    expect(onRouteQueryChange).toHaveBeenCalledWith(expect.objectContaining({
      type: 'income', year: '2026', month: '8',
    }))
  })

  it('switches view through the router so the change survives a reload', async () => {
    const user = userEvent.setup()
    const { onRouteQueryChange } = await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Calendar' }))
    expect(onRouteQueryChange).toHaveBeenCalledWith(expect.objectContaining({
      view: 'calendar', year: '2026', month: '8',
    }))
  })

  it('steps the month through the router, carrying type and view with it', async () => {
    const user = userEvent.setup()
    const { onRouteQueryChange } = await renderLoaded({ query: { type: 'income', view: 'calendar' } })
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(onRouteQueryChange).toHaveBeenCalledWith({
      type: 'income', view: 'calendar', year: '2026', month: '7',
    })
  })

  it('will not step past the current period', async () => {
    const current = await renderLoaded()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
    current.unmount()
    await renderLoaded({ query: { month: '3' } })
    expect(screen.getByRole('button', { name: 'Next month' })).not.toBeDisabled()
  })

  it('resolves a commitment deep link to an honest state rather than the list it was not written for', async () => {
    render(
      <RecurringScreen
        routeQuery={BASE_QUERY}
        onRouteQueryChange={vi.fn()}
        detailId="8f2a1c34-5b6d-4e7f-8a9b-0c1d2e3f4a5b"
        today={RECURRING_FIXTURE_TODAY}
        reads={recurringFixtureReads}
      />,
    )
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())
    expect(screen.getByLabelText('Recurring commitment detail')).toBeInTheDocument()
  })
})

/* ── 13, 14 & 15: shell, keyboard and accessibility ─────────────────────── */

describe('V6 Recurring — shell and accessibility', () => {
  function renderInShell(query = {}) {
    const route = resolveAppHref('/money/recurring')
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
        <RecurringScreen
          routeQuery={{ ...BASE_QUERY, ...query }}
          onRouteQueryChange={vi.fn()}
          today={RECURRING_FIXTURE_TODAY}
          reads={recurringFixtureReads}
        />
      </AppShell>,
    )
  }

  it('mounts inside the V6 shell owning a single h1, with Recurring current in section navigation', async () => {
    renderInShell()
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('main')).toHaveAttribute('aria-labelledby', 'page-title')
    const secondary = screen.getByRole('navigation', { name: 'Section navigation' })
    expect(within(secondary).getByRole('link', { name: 'Recurring' })).toHaveAttribute('aria-current', 'page')
    expect(within(secondary).getByRole('link', { name: 'Budget' })).not.toHaveAttribute('aria-current')
  })

  it('operates the type and view switches from the keyboard alone', async () => {
    const user = userEvent.setup()
    const { onRouteQueryChange } = await renderLoaded()
    screen.getByRole('button', { name: 'Expected income' }).focus()
    await user.keyboard('{Enter}')
    expect(onRouteQueryChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'income' }))

    screen.getByRole('button', { name: 'Calendar' }).focus()
    await user.keyboard('{Enter}')
    expect(onRouteQueryChange).toHaveBeenCalledWith(expect.objectContaining({ view: 'calendar' }))
  })

  it('announces the state of the screen without relying on colour', async () => {
    await renderLoaded()
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/No recurring plan is published for this period/)
    // Every unavailable position states itself in words, not as a bare dash.
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0)
  })

  it('has no automated accessibility violations across both modes and both views', async () => {
    for (const query of [{}, { type: 'income' }, { view: 'calendar' }, { type: 'income', view: 'calendar' }]) {
      const view = await renderLoaded({ query })
      expect(await axe(view.container), JSON.stringify(query)).toHaveNoViolations()
      view.unmount()
    }
  })

  it('has no automated accessibility violations while loading, incomplete or after a failed read', async () => {
    const pending = new Promise(() => {})
    const loadingRender = renderRecurring({ reads: { getPeriodMetrics: () => pending } })
    expect(await axe(loadingRender.container)).toHaveNoViolations()
    loadingRender.unmount()

    for (const reads of [recurringFixtureReadsIncomplete, recurringFixtureReadsFailed]) {
      const view = await renderLoaded({ reads })
      expect(await axe(view.container)).toHaveNoViolations()
      view.unmount()
    }
  })
})

/* ── 16: no prototype demo value reaches the screen ─────────────────────── */

describe('V6 Recurring — no prototype demo value reaches the screen', () => {
  it('renders none of the frozen prototype’s non-contractual Recurring figures or merchants', async () => {
    for (const query of [{}, { type: 'income' }, { view: 'calendar' }]) {
      const view = await renderLoaded({ query })
      // The honest unavailable regions are removed first: several of them
      // quote the prototype's own demo headline ("Committed AED … · 3 without
      // autopay") in order to say it cannot be stated, and that quotation is
      // the safeguard, not a breach of it.
      const text = claimedText(view.container)
      // Only the thousands-formatted demo figures are asserted. The
      // prototype's bare three-digit ones (610, 420, 96) cannot be checked
      // against concatenated text — "10 August 2026" contains "610" — and a
      // money figure on this screen always renders with a separator anyway.
      for (const demo of ['29,400', '78,400', '20,860', '25,260', '6,850', '8,940', '2,410', '1,180', '9,600', '42,000', '24,000', '12,400']) {
        expect(text, `prototype demo value ${demo} must never reach the screen`).not.toContain(demo)
      }
      expect(text).not.toMatch(/Mortgage|NBD credit card|Car loan|DEWA|School fee|Health insurance|Etisalat|Salary · primary|Rental income/)
      expect(text).not.toMatch(/45% of spend is committed|3 without autopay|2 manual/)
      view.unmount()
    }
  })
})
