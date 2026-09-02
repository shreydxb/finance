import { readFileSync } from 'node:fs'

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { describe, expect, it, vi } from 'vitest'

import AppShell from '../../shell/AppShell'
import { presentationForRoute, resolveAppHref } from '../../lib/routes'
import InvestmentsScreen from '../InvestmentsScreen'
import {
  INVESTMENTS_FIXTURE_LEGACY_OWNER_LABELS,
  INVESTMENTS_FIXTURE_POSITIONS,
  investmentsFixtureReads,
  investmentsFixtureReadsWith,
} from '../fixtures/investmentsFixture'

vi.mock('../../lib/PrefsContext', () => ({
  usePrefs: () => ({ currency: 'AED', setCurrency: vi.fn(), theme: 'system', setTheme: vi.fn() }),
}))
vi.mock('../../lib/useRealtime', () => ({ useRealtimeRefresh: () => {} }))

const PRODUCTION_TREE = [
  'src/v6/InvestmentsScreen.jsx',
  'src/v6/investments/InvestmentsHeader.jsx',
  'src/v6/investments/InvestmentsControls.jsx',
  'src/v6/investments/InvestmentsSummary.jsx',
  'src/v6/investments/InvestmentsAllocation.jsx',
  'src/v6/investments/InvestmentsTable.jsx',
  'src/v6/investments/InvestmentsQuality.jsx',
  'src/v6/investments/HoldingDrawer.jsx',
  'src/v6/data/investmentsModel.js',
  'src/v6/data/investmentsGaps.js',
  'src/v6/data/composeInvestments.js',
  'src/v6/data/useInvestmentsData.js',
]

function renderInvestments({ detailId = null, reads = investmentsFixtureReads } = {}) {
  const onOpenDetail = vi.fn()
  const onCloseDetail = vi.fn()
  const result = render(
    <InvestmentsScreen
      detailId={detailId}
      onOpenDetail={onOpenDetail}
      onCloseDetail={onCloseDetail}
      reads={reads}
    />,
  )
  return { ...result, onOpenDetail, onCloseDetail }
}

async function renderLoaded(options) {
  const result = renderInvestments(options)
  await waitFor(() => expect(screen.getByText('Fixture Index Tracker')).toBeInTheDocument())
  return result
}

/** Text the screen actually claims — every honest unavailable region removed. */
function claimedText(container) {
  const clone = container.cloneNode(true)
  for (const region of clone.querySelectorAll('.v6-unavailable')) region.remove()
  return clone.textContent
}

function productionCode(path) {
  return readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * Executable code only.
 *
 * Comments, string literals and JSX text are all stripped, because every gap
 * on this screen states in prose exactly what it refuses to do — "no lot
 * matching, FIFO, weighted-average pass", "not an alert, a score, an anomaly
 * claim or a recommendation", "dividing each position's AED value by the
 * published total". Naming a forbidden operation in the product copy is the
 * opposite of performing it, so the structural guards below read past it.
 */
function executableCode(path) {
  return productionCode(path)
    .replace(/>[^<>{}]+</g, '><')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/\u2019/g, "'")
}

describe('V6 Investments — route, fresh boundary and no legacy presentation', () => {
  it('mounts the fresh V6 screen at /wealth/investments and leaves every other V6 route intact', async () => {
    expect(resolveAppHref('/wealth/investments').screen).toBe('Investments')
    expect(resolveAppHref('/overview').screen).toBe('Overview')
    expect(resolveAppHref('/money/activity').screen).toBe('Activity')
    expect(resolveAppHref('/money/budget').screen).toBe('Budget')
    expect(resolveAppHref('/money/recurring').screen).toBe('Recurring')
    expect(resolveAppHref('/money/insights').screen).toBe('Insights')
    expect(resolveAppHref('/wealth/net-worth').screen).toBe('NetWorth')
    expect(resolveAppHref('/wealth/accounts').screen).toBe('Accounts')
    const { container } = await renderLoaded()
    expect(container.querySelector('[data-testid="v6-investments"]')).toBeInTheDocument()
    expect(container.querySelector('[data-read-only="true"]')).toBeInTheDocument()
  })

  it('binds the Investments route to the V6 screen and no longer mounts legacy Investments presentation', async () => {
    const app = readFileSync('src/App.jsx', 'utf8')
    expect(app).toMatch(/import InvestmentsScreen from '\.\/v6\/InvestmentsScreen'/)
    expect(app).toMatch(/Investments: InvestmentsScreen,/)
    // The legacy module is no longer imported at all.
    expect(app).not.toMatch(/from '\.\/screens\/Investments'/)
    expect(app).not.toMatch(/^\s*Investments,\s*$/m)
  })

  it('preserves the SHR-180 Planning Forecasts binding and the Accounts route', () => {
    const app = readFileSync('src/App.jsx', 'utf8')
    expect(app).toMatch(/Forecasts: LegacyForecastsPlaceholder,/)
    expect(app).toMatch(/Accounts: AccountsScreen,/)
    expect(resolveAppHref('/planning/forecasts').screen).toBe('Forecasts')
    expect(resolveAppHref('/wealth/accounts').screen).toBe('Accounts')
    expect(resolveAppHref('/wealth/investments').screen).not.toBe('Forecasts')
  })

  it('imports no legacy presentation, legacy reader or investment writer anywhere in its tree', () => {
    for (const path of PRODUCTION_TREE) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).not.toMatch(/from '[^']*\/(?:screens|components)\//)
      expect(source, path).not.toMatch(/from '[^']*\/lib\/(?:accounts|transactions|snapshots|forecast|fire|cards|money|investments|prices)(?:\.js)?'/)
      // `refreshPrices` and `recordTrade` are the names of unsupported-
      // capability slots, not calls to writers. The capability record's own
      // keys and any property access on it are normalised away first, so the
      // guard still catches every real writer spelling — including one
      // smuggled in under a capability-shaped name.
      const callable = readFileSync(path, 'utf8')
        .replace(/capabilities\.\w+/g, 'capabilitySlot')
        .replace(/^\s*\w+:\s*investmentsGapSlot\('[\w-]+'\),$/gm, '  capabilitySlot,')
      expect(callable, path).not.toMatch(/\b(?:createAccount|updateAccount|deleteAccount|saveAccount|upsert|insert\(|recordDailyNetWorth|refreshPrices|refreshFx|buyHolding|sellHolding|recordTrade|updateQuantity|updatePrice)\b/)
    }
  })
})

describe('V6 Investments — canonical valuation truth', () => {
  it('reads only the canonical portfolio metrics and canonical investment positions', async () => {
    const called = []
    const forbidden = vi.fn(async () => { throw new Error('forbidden') })
    await renderLoaded({ reads: {
      getInvestments: async () => { called.push('metrics'); return investmentsFixtureReads.getInvestments() },
      listInvestmentPositions: async () => { called.push('positions'); return investmentsFixtureReads.listInvestmentPositions() },
      listLedgerRows: forbidden, listTransactions: forbidden, listIncomeRows: forbidden,
      listNetWorthHistory: forbidden, listAccounts: forbidden, getBalanceSheet: forbidden,
      listBudgetActuals: forbidden,
    } })
    expect([...called].sort()).toEqual(['metrics', 'positions'])
    expect(forbidden).not.toHaveBeenCalled()
  })

  it('performs no financial mutation or snapshot when the screen opens', async () => {
    const write = vi.fn()
    await renderLoaded({ reads: {
      getInvestments: investmentsFixtureReads.getInvestments,
      listInvestmentPositions: investmentsFixtureReads.listInvestmentPositions,
      createAccount: write, updateAccount: write, deleteAccount: write,
      recordDailyNetWorth: write, refreshPrices: write, refreshFx: write,
    } })
    expect(write).not.toHaveBeenCalled()
  })

  it('shows the published portfolio value, cost basis and unrealized profit', async () => {
    await renderLoaded()
    const hero = screen.getByRole('region', { name: 'Portfolio value' })
    expect(within(hero).getByText('741,821')).toBeInTheDocument()
    expect(within(hero).getByText('612,430')).toBeInTheDocument()
    expect(within(hero).getByText('+129,390')).toBeInTheDocument()
    expect(within(hero).getByText(/not a sum of the table below/)).toBeInTheDocument()
  })

  it('withholds the portfolio total rather than summing the rows when the contract withholds it', async () => {
    const { container } = renderInvestments({ reads: investmentsFixtureReadsWith('incomplete') })
    await waitFor(() => expect(screen.getAllByText('Fixture Overseas Holding').length).toBeGreaterThan(0))
    const hero = screen.getByRole('region', { name: 'Portfolio value' })
    expect(within(hero).getAllByText('Incomplete').length).toBeGreaterThan(0)
    // Four positions still publish AED values and still render, so a
    // browser-side sum had every operand it needed. No such figure appears.
    expect(claimedText(container)).not.toMatch(/741,82|521,3|615,4/)
  })

  it('never derives unrealized profit locally when value and cost basis are both present', async () => {
    const { container } = renderInvestments({ reads: investmentsFixtureReadsWith('pnl-withheld') })
    await waitFor(() => expect(screen.getByText('Fixture Index Tracker')).toBeInTheDocument())
    const hero = screen.getByRole('region', { name: 'Portfolio value' })
    expect(within(hero).getByText('741,821')).toBeInTheDocument()
    expect(within(hero).getByText('612,430')).toBeInTheDocument()
    // 741,820.55 − 612,430.18 is sitting there for the taking. It is not taken.
    expect(claimedText(container)).not.toMatch(/129,390/)
  })

  it('renders native and AED as separate published columns and never conflates them', async () => {
    await renderLoaded()
    const usdRow = screen.getByRole('button', { name: 'Fixture Global Equity Fund' }).closest('tr')
    expect(usdRow).toHaveTextContent('USD')
    expect(usdRow).toHaveTextContent('48,780.80')
    expect(usdRow).toHaveTextContent('179,147.99')
    const inrRow = screen.getByRole('button', { name: 'Fixture India Portfolio' }).closest('tr')
    expect(inrRow).toHaveTextContent('2,871,400.00')
    expect(inrRow).toHaveTextContent('126,341.60')
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toContain('Native value')
    expect(headers).toContain('Value AED')
  })

  it('fails a missing AED valuation closed rather than converting the native figure', async () => {
    const { container } = renderInvestments({ reads: investmentsFixtureReadsWith('incomplete') })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fixture Overseas Holding' })).toBeInTheDocument())
    const row = screen.getByRole('button', { name: 'Fixture Overseas Holding' }).closest('tr')
    expect(row).toHaveTextContent('CHF')
    expect(row).toHaveTextContent('39,416.50')
    expect(row).toHaveTextContent('Incomplete')
    expect(screen.getAllByText(/No published FX rate for CHF/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/It is not converted here/).length).toBeGreaterThan(0)
    // No AED figure exists anywhere for a row whose contract published none.
    // A CHF→AED conversion at any plausible rate would land near 160,000.
    expect(container.textContent).not.toMatch(/1[456]\d,\d{3}\.\d{2}/)
  })

  it('introduces no browser-side FX engine, quantity × price valuation or transaction-derived figure', () => {
    for (const path of PRODUCTION_TREE) {
      const code = productionCode(path)
      expect(code, path).not.toMatch(/toAED|convertCurrency|exchangeRate|rates\[/)
      expect(code, path).not.toMatch(/fxRate\s*[*/]|[*/]\s*fxRate|fx_rate_to_aed\s*[*/]|[*/]\s*fx_rate_to_aed/)
      // The valuation engine: quantity × price, in any spelling or order.
      expect(code, path).not.toMatch(/\b(?:quantity|units|qty)\b[^\n;]{0,40}\*|\*[^\n;]{0,40}\b(?:last_price|lastPrice|unitPrice)\b/i)
      expect(code, path).not.toMatch(/\b(?:listLedgerRows|listCanonicalLedgerRows|listTransactions|listIncomeRows|listCanonicalIncomeRows)\b/)
      expect(code, path).not.toMatch(/contributions?\s*[-+]\s*withdrawals?|sumTransactions|deriveBalance|runningBalance/i)
    }
  })

  it('reconstructs no cost basis and implements no lot-matching engine', () => {
    for (const path of PRODUCTION_TREE) {
      const code = productionCode(path)
      const executable = code.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/’/g, "'")
      expect(executable, path).not.toMatch(/\bFIFO\b|\bLIFO\b|lotMatch|matchLots|weightedAverage|averageCost|avg_cost|acquisitionPrice|purchasePrice/i)
      // The subtraction itself, in either direction.
      expect(executable, path).not.toMatch(/\b\w*(?:value|marketValue)\w*\s*-\s*\w*(?:cost|costBasis|basis)\w*\b/i)
      expect(executable, path).not.toMatch(/\b\w*(?:cost|basis)\w*\s*-\s*\w*value\w*\b/i)
    }
  })

  it('invents no percentage, return or performance arithmetic', () => {
    for (const path of PRODUCTION_TREE) {
      const code = productionCode(path)
      const executable = code.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/’/g, "'")
      expect(executable, path).not.toMatch(/\bCAGR\b|\bIRR\b|\bXIRR\b|\bTWR\b|timeWeighted|moneyWeighted|annualis|annualiz|benchmark|\balpha\b|attribution/i)
      expect(executable, path).not.toMatch(/percentChange|pctChange|returnPct|gainPct|profitPct|allocationShare|weightPct|shareOf/i)
      expect(executable, path).not.toMatch(/interpolat|extrapolat|projectValue|forecastValue/i)
      // No division that could turn two published amounts into a share.
      expect(executable, path).not.toMatch(/\*\s*100\b|\/\s*total\b|\btotal\s*\)?\s*\)?\s*\*/i)
      expect(executable, path).not.toMatch(/formatPercent/)
    }
  })
})

describe('V6 Investments — allocation, performance and history boundaries', () => {
  it('keeps allocation as an honest unavailable region naming SHR-174, never a computed share', async () => {
    const { container } = await renderLoaded()
    const allocation = screen.getByRole('region', { name: 'Allocation' })
    expect(within(allocation).getByText(/Portfolio allocation is not available yet/)).toBeInTheDocument()
    expect(within(allocation).getByText(/Asset-class grouping is not available yet/)).toBeInTheDocument()
    expect(within(allocation).getAllByText(/SHR-174/).length).toBeGreaterThan(0)
    // No percentage of any kind is claimed anywhere on the screen.
    expect(claimedText(container)).not.toMatch(/\d+(?:\.\d+)?\s?%/)
  })

  it('keeps the Weight column present and unavailable rather than dividing values by the total', async () => {
    await renderLoaded()
    expect(screen.getByRole('columnheader', { name: 'Weight' })).toBeInTheDocument()
    const row = screen.getByRole('button', { name: 'Fixture Index Tracker' }).closest('tr')
    const weightCell = row.querySelector('.v6-col-weight')
    expect(weightCell).toHaveTextContent('Not available')
    // 215,854.86 / 741,820.55 ≈ 29.1% — the number a division would print.
    expect(weightCell).not.toHaveTextContent(/29/)
  })

  it('draws no performance history and names SHR-176 in its place', async () => {
    const { container } = await renderLoaded()
    expect(screen.getAllByText(/Portfolio performance history is not available yet/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/SHR-176/).length).toBeGreaterThan(0)
    expect(screen.getByText(/a convincing chart drawn from those inputs would be a fabricated track record/)).toBeInTheDocument()
    // No line, area or point is plotted: an empty frame, not a drawn curve.
    expect(container.querySelectorAll('svg, polyline, path[d], canvas')).toHaveLength(0)
  })

  it('gives the empty performance frame an accessible description rather than silence', async () => {
    const { container } = await renderLoaded()
    const frame = container.querySelector('.v6-investments-performance-frame')
    expect(frame).toHaveAttribute('role', 'img')
    expect(frame.getAttribute('aria-label')).toMatch(/not available/i)
  })

  it('renders the range selector visibly disabled instead of wiring it to invented history', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    const ranges = screen.getByRole('group', { name: 'Performance range' })
    for (const label of ['1W', '1M', '3M', '6M', '1Y', 'All']) {
      const button = within(ranges).getByRole('button', { name: label })
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).toHaveAttribute('aria-describedby')
      await user.click(button)
    }
    // Clicking every range changes nothing: there is no history to select from.
    expect(screen.getAllByText(/Portfolio performance history is not available yet/).length).toBeGreaterThan(0)
  })

  it('claims no daily change, return percentage or period movement anywhere', async () => {
    const { container } = await renderLoaded()
    const claimed = claimedText(container)
    expect(claimed).not.toMatch(/today|since yesterday|day change|this week|this month|this year|1Y return|all time/i)
    expect(screen.getAllByText(/Daily change is not available/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Return percentage is not available/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Return figures are not available/).length).toBeGreaterThan(0)
  })

  it('reproduces no prototype demo value as runtime data', async () => {
    const { container } = await renderLoaded()
    const text = container.textContent
    // Figures lifted straight from the frozen prototype's Investments screen.
    for (const demo of ['611,200', '1,840', '+0.38', '18.4%', '72,400', '166,300', '3,409,091', '+19.1']) {
      expect(text, demo).not.toContain(demo)
    }
    for (const demo of ['Interactive Brokers', 'Zerodha', 'VWRA', 'CSPX', 'Global equity', 'India mutual funds', 'Self-custody']) {
      expect(text, demo).not.toContain(demo)
    }
  })
})

describe('V6 Investments — price, FX and freshness evidence', () => {
  it('shows published price evidence with its own currency and never as an AED figure', async () => {
    await renderLoaded()
    const row = screen.getByRole('button', { name: 'Fixture Global Equity Fund' }).closest('tr')
    const priceCell = row.querySelector('.v6-col-price')
    expect(priceCell).toHaveTextContent('USD')
    expect(priceCell).toHaveTextContent('118.40')
    // A holding with no published price says so rather than showing a blank.
    const manual = screen.getByRole('button', { name: 'Fixture India Portfolio' }).closest('tr')
    expect(manual.querySelector('.v6-col-price')).toHaveTextContent('No published price')
  })

  it('reports only published valuation evidence and withholds every freshness verdict', async () => {
    const { container } = await renderLoaded()
    expect(screen.getAllByText('Quantity × last published price').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Manual account value').length).toBeGreaterThan(0)
    expect(screen.getByText(/A live, delayed or stale price judgement is not available yet/)).toBeInTheDocument()
    expect(screen.getByText(/Full price provenance is not available yet/)).toBeInTheDocument()
    expect(screen.getAllByText(/SHR-172/).length).toBeGreaterThan(0)
    const claimed = claimedText(container)
    expect(claimed).not.toMatch(/\blive\b|\bstale\b|\bfresh\b|up to date|out of date|delayed|real.?time|market open|needs attention/i)
    expect(claimed).not.toMatch(/\b\d+ (?:days?|hours?|minutes?) ago\b/i)
    expect(claimed).not.toMatch(/just now/i)
  })

  it('reports the staleness counter as an absent policy rather than a clean bill of health', async () => {
    await renderLoaded()
    expect(screen.getByText('None applied')).toBeInTheDocument()
    expect(screen.getByText(/that is the absence of a policy, not a finding that every price is current/)).toBeInTheDocument()
  })

  it('authors no client-side freshness threshold and infers no price provenance', () => {
    for (const path of PRODUCTION_TREE) {
      const code = productionCode(path)
      const executable = code.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/’/g, "'")
      expect(executable, path).not.toMatch(/Date\.now\(\)|new Date\(\)|staleAfter|isStale|freshnessScore|STALE_(?:DAYS|HOURS)|threshold|daysSince|ageInDays|valuation_age_seconds/i)
      expect(executable, path).not.toMatch(/lastTransaction|firstTransaction|inferProvider|guessSource|providerFor/i)
    }
  })

  it('calls no third-party market-data API from the browser', () => {
    for (const path of PRODUCTION_TREE) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).not.toMatch(/\bfetch\(|axios|XMLHttpRequest|EventSource|https?:\/\/(?!linear|www\.w3)/i)
      expect(source, path).not.toMatch(/yahoo|coingecko|finnhub|alphavantage|polygon\.io|iexcloud/i)
    }
  })

  it('states FX evidence as published and applies no rate in the browser', async () => {
    await renderLoaded()
    const quality = screen.getByRole('region', { name: 'Valuation quality and evidence' })
    expect(within(quality).getByText('Current rate')).toBeInTheDocument()
    expect(within(quality).getByText(/No rate is applied in\s+the browser/)).toBeInTheDocument()
  })
})

describe('V6 Investments — ownership, scope and container semantics', () => {
  it('never renders a legacy owner label as economic ownership', async () => {
    const { container } = await renderLoaded()
    const text = container.textContent
    for (const label of INVESTMENTS_FIXTURE_LEGACY_OWNER_LABELS) expect(text).not.toContain(label)
    expect(claimedText(container)).not.toMatch(/\bShared\b|\bJoint\b|\bWife\b|\bHusband\b|half of shared|50\/50|\bPrimary\b|\bPartner\b/)
  })

  it('keeps the Owner column as an honest unavailable position naming SHR-154 and SHR-156', async () => {
    await renderLoaded()
    expect(screen.getByRole('columnheader', { name: 'Owner' })).toBeInTheDocument()
    expect(screen.getAllByText(/Holding ownership is not available yet/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/SHR-154 \/ SHR-156/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/presentation only — not an identity/).length).toBeGreaterThan(0)
  })

  it('counts every shared holding exactly once and offers no per-person scope, naming SHR-156', async () => {
    await renderLoaded()
    for (const row of INVESTMENTS_FIXTURE_POSITIONS) {
      expect(screen.getAllByRole('button', { name: new RegExp(`^${row.name}$`) })).toHaveLength(1)
    }
    expect(screen.getByText(/Personal and shared portfolio scopes are not available yet/)).toBeInTheDocument()
    expect(screen.getByText(/SHR-156 \/ SHR-173/)).toBeInTheDocument()
    expect(screen.getByText(/never duplicated into two people and never divided in half/)).toBeInTheDocument()
  })

  it('splits, duplicates and allocates nothing per person in its production tree', () => {
    for (const path of PRODUCTION_TREE) {
      const code = productionCode(path)
      const executable = code.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/’/g, "'")
      expect(executable, path).not.toMatch(/\browner\b\s*[=:]|row\.owner|legacyOwner|ownerAllocation|sharedAllocation|splitShared|allocateTo|\/\s*2\b|\*\s*0\.5\b/)
      expect(executable, path).not.toMatch(/\bmembers\[[01]\]|firstMember|secondMember|bothPartners/i)
    }
  })

  it('infers no brokerage container from a name or ticker and names SHR-174 for the relationship', async () => {
    await renderLoaded()
    expect(screen.getAllByText(/Brokerage and account grouping is not available yet/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Uninvested cash held at a broker is not identified here/).length).toBeGreaterThan(0)
    for (const path of PRODUCTION_TREE) {
      const code = productionCode(path)
      expect(code, path).not.toMatch(/name\.(?:includes|match|startsWith|endsWith|indexOf|search|toLowerCase)/)
      expect(code, path).not.toMatch(/ticker\.(?:includes|match|startsWith|endsWith|test)/)
      expect(code, path).not.toMatch(/\/(?:IBKR|broker|ETF|Zerodha|custodian)\//i)
    }
  })

  it('lists each canonical position exactly once with no container row beside it', async () => {
    await renderLoaded()
    const table = screen.getByRole('table')
    expect(table.querySelectorAll('tbody tr')).toHaveLength(INVESTMENTS_FIXTURE_POSITIONS.length)
    expect(table.querySelectorAll('tbody th[scope="row"]')).toHaveLength(INVESTMENTS_FIXTURE_POSITIONS.length)
    // No group/subtotal row exists, so a container and its contents can never
    // both appear in one column of figures.
    expect(table.querySelectorAll('[data-role="subtotal"], tfoot')).toHaveLength(0)
  })
})

describe('V6 Investments — read-only detail and deep links', () => {
  it('opens a read-only holding detail with the published facts and no manufactured history', async () => {
    const row = INVESTMENTS_FIXTURE_POSITIONS[0]
    await renderLoaded({ detailId: row.id })
    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByRole('heading', { name: row.name })).toBeInTheDocument()
    expect(within(drawer).getByText('179,147.99')).toBeInTheDocument()
    expect(within(drawer).getByText('USD 48,780.80')).toBeInTheDocument()
    expect(within(drawer).getByText('USD 118.40')).toBeInTheDocument()
    expect(within(drawer).getByText('143,741.65')).toBeInTheDocument()
    expect(within(drawer).getByText('fixture-feed')).toBeInTheDocument()
    expect(within(drawer).getByText('Published price timestamp')).toBeInTheDocument()
    expect(within(drawer).getByText(/Portfolio performance history is not available yet/)).toBeInTheDocument()
    expect(within(drawer).queryByRole('table')).not.toBeInTheDocument()
  })

  it('withholds a holding’s cost basis and profit together when the contract withholds them', async () => {
    const row = INVESTMENTS_FIXTURE_POSITIONS[3]
    await renderLoaded({ detailId: row.id })
    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByText('220,476.10')).toBeInTheDocument()
    expect(within(drawer).getAllByText(/withholds this holding’s cost basis and profit/).length).toBe(2)
  })

  it('keeps every maintenance action visible, inert and named to its owning contract', async () => {
    await renderLoaded({ detailId: INVESTMENTS_FIXTURE_POSITIONS[0].id })
    const drawer = await screen.findByRole('dialog')
    for (const name of ['Edit holding', 'Update quantity', 'Update price', 'Record trade']) {
      expect(within(drawer).getByRole('button', { name })).toBeDisabled()
    }
    expect(within(drawer).getByText(/Portfolio maintenance is not available here/)).toBeInTheDocument()
  })

  it('fails a deep link to an unknown or inaccessible holding closed', async () => {
    await renderLoaded({ detailId: '99999999-0000-4000-8000-000000000000' })
    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByText(/This holding is not available/)).toBeInTheDocument()
    expect(within(drawer).getByText(/not evidence that a position exists or that it may be disclosed/)).toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: 'Edit holding' })).not.toBeInTheDocument()
  })

  it('opens the detail route from a row without mutating anything', async () => {
    const user = userEvent.setup()
    const { onOpenDetail } = await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Fixture Index Tracker' }))
    expect(onOpenDetail).toHaveBeenCalledWith('investment', INVESTMENTS_FIXTURE_POSITIONS[1].id)
  })

  it('exposes no form control or enabled write action on the screen itself', async () => {
    const { container } = await renderLoaded()
    expect(container.querySelectorAll('form, input, textarea, select')).toHaveLength(0)
    const enabled = [...container.querySelectorAll('button')]
      .filter((node) => !node.disabled && node.getAttribute('aria-disabled') !== 'true')
    for (const button of enabled) {
      expect(button.textContent).not.toMatch(/Add|Save|Delete|Create|Buy|Sell|Trade|Update|Refresh|Rebalance/i)
    }
  })

  it('renders the prototype’s Refresh prices and + Holding controls disabled', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    for (const name of ['Refresh prices', '+ Holding']) {
      const button = screen.getByRole('button', { name })
      expect(button).toBeDisabled()
      await user.click(button)
    }
    expect(screen.getAllByText(/Portfolio maintenance is not available here/).length).toBeGreaterThan(0)
  })
})

describe('V6 Investments — no advice engine', () => {
  it('offers no recommendation, rebalancing or judgement vocabulary', async () => {
    const { container } = await renderLoaded()
    const text = container.textContent
    expect(text).not.toMatch(/overweight|underweight|rebalanc|diversif|too concentrated|high risk|poor perform|underperform|outperform|you should|consider (?:buying|selling)/i)
    for (const path of PRODUCTION_TREE) {
      expect(executableCode(path), path).not.toMatch(/recommend|advice|suggestBuy|suggestSell|riskScore|concentrationRisk|rebalance/i)
    }
  })

  it('presents quality evidence as evidence, not as a warning severity or anomaly', async () => {
    await renderLoaded()
    const quality = screen.getByRole('region', { name: 'Valuation quality and evidence' })
    expect(within(quality).getByText(/not an alert, a score, an anomaly claim or a\s+recommendation/)).toBeInTheDocument()
    expect(within(quality).getByText(/Provisional is a quality fact, not an error or a warning/)).toBeInTheDocument()
  })

  it('signals gains and losses in text as well as sign, never by colour alone', async () => {
    await renderLoaded()
    const row = screen.getByRole('button', { name: 'Fixture Global Equity Fund' }).closest('tr')
    const profit = row.querySelector('.v6-col-profit')
    expect(profit).toHaveTextContent('+35,406.34')
    expect(profit).toHaveTextContent('gain')
  })
})

describe('V6 Investments — states, structure and accessibility', () => {
  it('renders honest loading, empty, incomplete and failed states', async () => {
    const pending = new Promise(() => {})
    const loading = renderInvestments({ reads: { getInvestments: () => pending, listInvestmentPositions: () => pending } })
    expect(screen.getByText(/Reading canonical investment contracts/)).toBeInTheDocument()
    expect(screen.getByText(/Nothing is estimated, converted, multiplied out, reconstructed from the ledger or written/)).toBeInTheDocument()
    expect(await axe(loading.container)).toHaveNoViolations()
    loading.unmount()

    for (const fixture of ['empty', 'incomplete', 'failed']) {
      const state = renderInvestments({ reads: investmentsFixtureReadsWith(fixture) })
      await waitFor(() => expect(screen.queryByText(/Reading canonical investment contracts/)).not.toBeInTheDocument())
      if (fixture === 'empty') expect(screen.getByText(/No holdings to show/)).toBeInTheDocument()
      if (fixture === 'incomplete') expect(screen.getAllByText('Incomplete').length).toBeGreaterThan(0)
      if (fixture === 'failed') expect(screen.getByText(/Investment positions are not available/)).toBeInTheDocument()
      expect(await axe(state.container)).toHaveNoViolations()
      state.unmount()
    }
  })

  it('keeps each canonical read failing independently', async () => {
    const metricsFailed = renderInvestments({ reads: investmentsFixtureReadsWith('metrics-failed') })
    await waitFor(() => expect(screen.getByText('Fixture Index Tracker')).toBeInTheDocument())
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0)
    metricsFailed.unmount()

    renderInvestments({ reads: investmentsFixtureReadsWith('positions-failed') })
    await waitFor(() => expect(screen.getByText(/Investment positions are not available/)).toBeInTheDocument())
    expect(screen.getByRole('region', { name: 'Portfolio value' })).toBeInTheDocument()
  })

  it('uses one semantic table with a caption, scoped headers and a contained scroll region', async () => {
    const { container } = await renderLoaded()
    const table = screen.getByRole('table')
    expect(table.querySelector('caption')).toBeTruthy()
    expect(table.querySelectorAll('thead th[scope="col"]').length).toBe(9)
    expect(table.querySelectorAll('tbody th[scope="row"]').length).toBe(INVESTMENTS_FIXTURE_POSITIONS.length)
    const scroll = container.querySelectorAll('.v6-investments-scroll')
    expect(scroll).toHaveLength(1)
    expect(scroll[0]).toHaveAttribute('role', 'region')
    expect(scroll[0]).toHaveAttribute('tabindex', '0')
  })

  it('mounts in the V6 shell with one h1 and Investments current in section navigation', async () => {
    const route = resolveAppHref('/wealth/investments')
    render(
      <AppShell identity="member@example.com" navigate={vi.fn(() => true)} onSignOut={vi.fn().mockResolvedValue(true)} presentation={presentationForRoute(route)} route={route} screenOwnsHeader takePendingFocusTarget={() => null}>
        <InvestmentsScreen reads={investmentsFixtureReads} />
      </AppShell>,
    )
    await waitFor(() => expect(screen.getByText('Fixture Index Tracker')).toBeInTheDocument())
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const nav = screen.getByRole('navigation', { name: 'Section navigation' })
    expect(within(nav).getByRole('link', { name: 'Investments' })).toHaveAttribute('aria-current', 'page')
  })

  it('announces its read state to assistive technology without claiming freshness', async () => {
    await renderLoaded()
    const status = screen.getByRole('status')
    expect(status.textContent).toMatch(/Showing 4 whole-household holdings/)
    expect(status.textContent).not.toMatch(/updated|current|live|fresh/i)
  })

  it('keeps every holding reachable by keyboard', async () => {
    const user = userEvent.setup()
    const { onOpenDetail } = await renderLoaded()
    const first = screen.getByRole('button', { name: 'Fixture Global Equity Fund' })
    first.focus()
    expect(first).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onOpenDetail).toHaveBeenCalledWith('investment', INVESTMENTS_FIXTURE_POSITIONS[0].id)
  })

  it('has no automated accessibility violations in the loaded and detail states', async () => {
    const loaded = await renderLoaded()
    expect(await axe(loaded.container)).toHaveNoViolations()
    loaded.unmount()
    const detail = await renderLoaded({ detailId: INVESTMENTS_FIXTURE_POSITIONS[0].id })
    await screen.findByRole('dialog')
    expect(await axe(detail.container)).toHaveNoViolations()
  })
})
