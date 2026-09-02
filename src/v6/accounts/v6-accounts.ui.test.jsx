import { readFileSync } from 'node:fs'

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { describe, expect, it, vi } from 'vitest'

import AppShell from '../../shell/AppShell'
import { presentationForRoute, resolveAppHref } from '../../lib/routes'
import AccountsScreen from '../AccountsScreen'
import {
  ACCOUNTS_FIXTURE_ROWS,
  accountsFixtureReads,
  accountsFixtureReadsWith,
} from '../fixtures/accountsFixture'

vi.mock('../../lib/PrefsContext', () => ({
  usePrefs: () => ({ currency: 'AED', setCurrency: vi.fn(), theme: 'system', setTheme: vi.fn() }),
}))
vi.mock('../../lib/useRealtime', () => ({ useRealtimeRefresh: () => {} }))

const PRODUCTION_TREE = [
  'src/v6/AccountsScreen.jsx',
  'src/v6/accounts/AccountsHeader.jsx',
  'src/v6/accounts/AccountsControls.jsx',
  'src/v6/accounts/AccountsTable.jsx',
  'src/v6/accounts/AccountsTotals.jsx',
  'src/v6/accounts/AccountsQuality.jsx',
  'src/v6/accounts/AccountDrawer.jsx',
  'src/v6/data/accountsModel.js',
  'src/v6/data/accountsGaps.js',
  'src/v6/data/accountsGrouping.js',
  'src/v6/data/composeAccounts.js',
  'src/v6/data/useAccountsData.js',
]

function renderAccounts({ query = {}, detailId = null, reads = accountsFixtureReads } = {}) {
  const onRouteQueryChange = vi.fn()
  const onOpenDetail = vi.fn()
  const onCloseDetail = vi.fn()
  const result = render(
    <AccountsScreen
      routeQuery={query}
      onRouteQueryChange={onRouteQueryChange}
      detailId={detailId}
      onOpenDetail={onOpenDetail}
      onCloseDetail={onCloseDetail}
      reads={reads}
    />,
  )
  return { ...result, onRouteQueryChange, onOpenDetail, onCloseDetail }
}

async function renderLoaded(options) {
  const result = renderAccounts(options)
  await waitFor(() => expect(screen.getByText('Fixture Savings')).toBeInTheDocument())
  return result
}

/** Text the screen actually claims — every honest unavailable region removed. */
function claimedText(container) {
  const clone = container.cloneNode(true)
  for (const region of clone.querySelectorAll('.v6-unavailable')) region.remove()
  return clone.textContent
}

describe('V6 Accounts — route, fresh boundary and no legacy presentation', () => {
  it('mounts the fresh V6 screen at /wealth/accounts and leaves every other V6 route intact', async () => {
    expect(resolveAppHref('/wealth/accounts').screen).toBe('Accounts')
    expect(resolveAppHref('/overview').screen).toBe('Overview')
    expect(resolveAppHref('/money/activity').screen).toBe('Activity')
    expect(resolveAppHref('/money/budget').screen).toBe('Budget')
    expect(resolveAppHref('/money/recurring').screen).toBe('Recurring')
    expect(resolveAppHref('/money/insights').screen).toBe('Insights')
    expect(resolveAppHref('/wealth/net-worth').screen).toBe('NetWorth')
    const { container } = await renderLoaded()
    expect(container.querySelector('[data-testid="v6-accounts"]')).toBeInTheDocument()
    expect(container.querySelector('[data-read-only="true"]')).toBeInTheDocument()
  })

  it('binds the Accounts route to the V6 screen and never to the legacy Accounts presentation', async () => {
    const app = readFileSync('src/App.jsx', 'utf8')
    expect(app).toMatch(/import AccountsScreen from '\.\/v6\/AccountsScreen'/)
    expect(app).toMatch(/Accounts: AccountsScreen,/)
    expect(app).not.toMatch(/\bAccounts,\s*$/m)
    // The legacy module stays bound only to Planning's Forecasts placeholder,
    // which has always rendered it. It reaches no Wealth route.
    expect(app).toMatch(/Forecasts: LegacyForecastsPlaceholder,/)
    expect(resolveAppHref('/planning/forecasts').screen).toBe('Forecasts')
    expect(resolveAppHref('/wealth/accounts').screen).not.toBe('Forecasts')
    const { container } = await renderLoaded()
    // Built rather than written literally: `v6-boundary.test.js` fails any V6
    // file that contains a legacy ramp class, this assertion's own subject
    // included.
    const legacyMarkers = new RegExp(['rounded-2xl', `shadow-${'card'}`, `text-${'ink'}-500`, 'Forecast setup', 'Add account'].join('|'))
    expect(container.innerHTML).not.toMatch(legacyMarkers)
  })

  it('imports no legacy presentation, legacy reader or account writer anywhere in its tree', () => {
    for (const path of PRODUCTION_TREE) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).not.toMatch(/from '[^']*\/(?:screens|components)\//)
      expect(source, path).not.toMatch(/from '[^']*\/lib\/(?:accounts|transactions|snapshots|forecast|fire|cards|money)(?:\.js)?'/)
      expect(source, path).not.toMatch(/\b(?:createAccount|updateAccount|deleteAccount|archiveAccount|saveAccount|upsert|insert\(|recordDailyNetWorth|refreshPrices|refreshFx)\b/)
    }
  })
})

describe('V6 Accounts — canonical valuation truth', () => {
  it('reads only the canonical balance sheet and canonical account rows', async () => {
    const called = []
    const forbidden = vi.fn(async () => { throw new Error('forbidden') })
    await renderLoaded({ reads: {
      getBalanceSheet: async () => { called.push('balanceSheet'); return accountsFixtureReads.getBalanceSheet() },
      listAccounts: async () => { called.push('accounts'); return accountsFixtureReads.listAccounts() },
      listLedgerRows: forbidden, listTransactions: forbidden, listIncomeRows: forbidden,
      listNetWorthHistory: forbidden, getInvestments: forbidden, listBudgetActuals: forbidden,
    } })
    expect([...called].sort()).toEqual(['accounts', 'balanceSheet'])
    expect(forbidden).not.toHaveBeenCalled()
  })

  it('performs no financial mutation when the screen opens', async () => {
    const write = vi.fn()
    await renderLoaded({ reads: {
      getBalanceSheet: accountsFixtureReads.getBalanceSheet,
      listAccounts: accountsFixtureReads.listAccounts,
      createAccount: write, updateAccount: write, deleteAccount: write, recordDailyNetWorth: write,
    } })
    expect(write).not.toHaveBeenCalled()
  })

  it('shows the published AED value per account and the published household totals', async () => {
    await renderLoaded()
    // An AED account publishes the same figure twice — native and AED — which
    // is itself the point: they are two facts that happen to coincide when the
    // account currency is already AED.
    expect(screen.getAllByText('187,325.00').length).toBe(2)
    expect(screen.getByText('434,273.13')).toBeInTheDocument()
    const totals = screen.getByRole('region', { name: 'Household totals' })
    expect(within(totals).getByText('2,138,582')).toBeInTheDocument()
    expect(within(totals).getByText(/each account counted once · not a sum of the rows above/)).toBeInTheDocument()
  })

  it('renders native and AED as two separate published columns and never conflates them', async () => {
    await renderLoaded()
    const usdRow = screen.getByRole('button', { name: 'Fixture Brokerage · Global' }).closest('tr')
    expect(usdRow).toHaveTextContent('USD')
    expect(usdRow).toHaveTextContent('118,250.00')
    expect(usdRow).toHaveTextContent('434,273.13')
    const inrRow = screen.getByRole('button', { name: 'Fixture Portfolio · India' }).closest('tr')
    expect(inrRow).toHaveTextContent('2,871,400.00')
    expect(inrRow).toHaveTextContent('126,341.60')
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toContain('Native')
    expect(headers).toContain('AED')
  })

  it('fails a missing AED valuation closed rather than converting the native figure', async () => {
    const { container } = renderAccounts({ reads: accountsFixtureReadsWith('incomplete') })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fixture Overseas Holding' })).toBeInTheDocument())
    const row = screen.getByRole('button', { name: 'Fixture Overseas Holding' }).closest('tr')
    expect(row).toHaveTextContent('CHF')
    expect(row).toHaveTextContent('39,415.00')
    expect(row).toHaveTextContent('Incomplete')
    expect(screen.getByText(/No published FX rate for CHF/)).toBeInTheDocument()
    expect(screen.getByText(/It is not converted here/)).toBeInTheDocument()
    // No AED figure exists anywhere for a row whose contract published none.
    expect(container.textContent).not.toMatch(/144,79|39,415\.00\s*39,415/)
  })

  it('introduces no browser-side FX engine or transaction-derived valuation', () => {
    for (const path of PRODUCTION_TREE) {
      const code = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
      expect(code, path).not.toMatch(/toAED|convertCurrency|fxRate\s*[*/]|[*/]\s*fxRate|fx_rate_to_aed\s*[*/]|exchangeRate|rates\[/)
      expect(code, path).not.toMatch(/\b(?:listLedgerRows|listCanonicalLedgerRows|listTransactions|listIncomeRows|listCanonicalIncomeRows)\b/)
      expect(code, path).not.toMatch(/contributions?\s*[-+]\s*withdrawals?|sumTransactions|deriveBalance|runningBalance/i)
    }
  })
})

describe('V6 Accounts — ownership and household scope', () => {
  it('never renders legacy owner text as economic ownership', async () => {
    const { container } = await renderLoaded()
    const text = container.textContent
    for (const row of ACCOUNTS_FIXTURE_ROWS) expect(text).not.toContain(row.owner)
    expect(claimedText(container)).not.toMatch(/\bShared\b|\bJoint\b|\bMe\b\s*·|\bWife\b|half of shared|50\/50/)
  })

  it('keeps the Owner column as an honest unavailable position naming SHR-154 and SHR-156', async () => {
    await renderLoaded()
    expect(screen.getAllByRole('columnheader', { name: 'Owner' }).length).toBeGreaterThan(0)
    expect(screen.getByText(/Account ownership is not available yet/)).toBeInTheDocument()
    expect(screen.getAllByText(/SHR-154 \/ SHR-156/).length).toBeGreaterThan(0)
    expect(screen.getByText(/legacy accounts.owner text is presentation evidence/)).toBeInTheDocument()
  })

  it('counts every account once and offers no per-person scope, naming SHR-156', async () => {
    await renderLoaded()
    for (const row of ACCOUNTS_FIXTURE_ROWS) {
      expect(screen.getAllByRole('button', { name: row.name })).toHaveLength(1)
    }
    expect(screen.getByText(/Personal and shared account scopes are not available yet/)).toBeInTheDocument()
    expect(screen.getByText(/SHR-156 \/ SHR-173/)).toBeInTheDocument()
  })

  it('renders the By owner grouping segment disabled instead of grouping by a legacy label', async () => {
    const user = userEvent.setup()
    const { onRouteQueryChange } = await renderLoaded()
    const group = screen.getByRole('group', { name: 'Account grouping' })
    const owner = within(group).getByRole('button', { name: /By owner/ })
    expect(owner).toHaveAttribute('aria-disabled', 'true')
    await user.click(owner)
    expect(onRouteQueryChange).not.toHaveBeenCalled()
    expect(screen.getByText(/Grouping by owner is not available yet/)).toBeInTheDocument()
  })

  it('falls back honestly when a deep link asks to group by owner', async () => {
    await renderLoaded({ query: { group: 'owner' } })
    expect(screen.getByText(/This link asked to group by owner/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Accounts by type' })).toBeInTheDocument()
  })
})

describe('V6 Accounts — classification, provenance and freshness', () => {
  it('groups by canonical type with the contract’s own asset and liability sides', async () => {
    const { container } = await renderLoaded()
    const groups = [...container.querySelectorAll('.v6-accounts-group-row > th')]
    const headings = groups.map((node) => node.textContent)
    expect(headings.some((text) => text.startsWith('Savings') && text.includes('Asset'))).toBe(true)
    expect(headings.some((text) => text.startsWith('Credit card') && text.includes('Liability'))).toBe(true)
    // Every group heading is a rowgroup header, so the group a row belongs to
    // is a structural fact rather than a visual break.
    for (const node of groups) expect(node).toHaveAttribute('scope', 'rowgroup')
    const assetIndex = headings.findIndex((text) => text.includes('Asset'))
    const liabilityIndex = headings.findIndex((text) => text.includes('Liability'))
    expect(assetIndex).toBeLessThan(liabilityIndex)
  })

  it('states liabilities as positive magnitudes with a text marker, never colour or a sign alone', async () => {
    await renderLoaded()
    const cardRow = screen.getByRole('button', { name: 'Fixture Credit Card' }).closest('tr')
    expect(cardRow).toHaveTextContent('12,483.00')
    expect(cardRow).not.toHaveTextContent('−12,483')
    expect(cardRow).toHaveTextContent('Liability')
  })

  it('reports only published valuation evidence and withholds every freshness verdict', async () => {
    const { container } = await renderLoaded()
    expect(screen.getAllByText('Quantity × last published price').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Account balance').length).toBeGreaterThan(0)
    expect(screen.getByText(/A fresh, stale or delayed judgement is not available yet/)).toBeInTheDocument()
    expect(screen.getByText(/Full valuation provenance is not available yet/)).toBeInTheDocument()
    expect(screen.getAllByText(/SHR-172/).length).toBeGreaterThan(0)
    const claimed = claimedText(container)
    expect(claimed).not.toMatch(/all valued today|up to date|\bstale\b|\bfresh\b|out of date|needs attention|live price|market price/i)
    expect(claimed).not.toMatch(/\b\d+ (?:days?|hours?|minutes?) ago\b/i)
  })

  it('never derives valuation provenance from transaction history or a display label', () => {
    for (const path of PRODUCTION_TREE) {
      const code = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
      expect(code, path).not.toMatch(/lastTransaction|firstTransaction|created_at|createdAt|inferProvider|priceSource|provider\s*=/)
      // Executable code only: the gap registry's prose explains why a
      // browser-side threshold is forbidden, and saying so is not doing it.
      const executable = code.replace(/'(?:[^'\\]|\\.)*'/g, "''")
      expect(executable, path).not.toMatch(/Date\.now\(\)|staleAfter|isStale|freshnessScore|STALE_(?:DAYS|HOURS)|threshold/i)
    }
  })

  it('introduces no Investments analytics, portfolio performance or allocation engine', async () => {
    const { container } = await renderLoaded()
    const claimed = claimedText(container)
    expect(claimed).not.toMatch(/cost basis|unrealised|unrealized|P&L|allocation|day change|return|CAGR|performance chart/i)
    expect(screen.getAllByText(/Performance and return figures are not available here/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/SHR-174 \/ SHR-176/).length).toBeGreaterThan(0)
    for (const path of PRODUCTION_TREE) {
      const code = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
      expect(code, path).not.toMatch(/\b(?:cost_basis_aed|unrealized_pnl_aed|costBasis|unrealizedPnl|dayChange|percentChange|returnPct|allocationShare)\b/)
    }
  })
})

describe('V6 Accounts — read-only detail and deep links', () => {
  it('opens a read-only account detail with the published facts and no manufactured history', async () => {
    const row = ACCOUNTS_FIXTURE_ROWS[1]
    await renderLoaded({ detailId: row.id })
    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByRole('heading', { name: row.name })).toBeInTheDocument()
    expect(within(drawer).getByText('434,273.13')).toBeInTheDocument()
    expect(within(drawer).getByText('USD 118,250.00')).toBeInTheDocument()
    expect(within(drawer).getByText('Published price timestamp')).toBeInTheDocument()
    expect(within(drawer).getByText(/Balance and valuation history for a single account is not available yet/)).toBeInTheDocument()
    expect(within(drawer).getByText(/contributions minus withdrawals is not a current value/)).toBeInTheDocument()
    expect(within(drawer).queryByRole('table')).not.toBeInTheDocument()
  })

  it('keeps every maintenance action visible, inert and named to its owning contract', async () => {
    await renderLoaded({ detailId: ACCOUNTS_FIXTURE_ROWS[0].id })
    const drawer = await screen.findByRole('dialog')
    for (const name of ['Edit account', 'Update valuation', 'Change owner', 'Counts toward net worth', 'Archive']) {
      expect(within(drawer).getByRole('button', { name })).toBeDisabled()
    }
    expect(within(drawer).getByText(/Account maintenance is not available yet/)).toBeInTheDocument()
    expect(within(drawer).getByText(/Changing account ownership is not available here/)).toBeInTheDocument()
    expect(within(drawer).getByText(/Per-account contribution to net worth is not available yet/)).toBeInTheDocument()
  })

  it('fails a deep link to an unknown or inaccessible account closed', async () => {
    await renderLoaded({ detailId: '99999999-0000-4000-8000-000000000000' })
    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByText(/This account is not available/)).toBeInTheDocument()
    expect(within(drawer).getByText(/not evidence that a record exists or that it may be disclosed/)).toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: 'Edit account' })).not.toBeInTheDocument()
  })

  it('opens the detail route from a row without mutating anything', async () => {
    const user = userEvent.setup()
    const { onOpenDetail } = await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Fixture Savings' }))
    expect(onOpenDetail).toHaveBeenCalledWith('account', ACCOUNTS_FIXTURE_ROWS[3].id)
  })

  it('exposes no form control or enabled write action on the screen itself', async () => {
    const { container } = await renderLoaded()
    expect(container.querySelectorAll('form, input, textarea, select')).toHaveLength(0)
    const enabled = [...container.querySelectorAll('button')].filter((node) => !node.disabled && node.getAttribute('aria-disabled') !== 'true')
    for (const button of enabled) {
      expect(button.textContent).not.toMatch(/Add|Save|Delete|Create|Archive|Update|Refresh/i)
    }
  })
})

describe('V6 Accounts — states, URL state and accessibility', () => {
  it('renders honest loading, empty, incomplete and failed states', async () => {
    const pending = new Promise(() => {})
    const loading = renderAccounts({ reads: { getBalanceSheet: () => pending, listAccounts: () => pending } })
    expect(screen.getByText(/Reading canonical account contracts/)).toBeInTheDocument()
    expect(screen.getByText(/Nothing is estimated, converted, reconstructed from the ledger or written/)).toBeInTheDocument()
    expect(await axe(loading.container)).toHaveNoViolations()
    loading.unmount()

    for (const fixture of ['empty', 'incomplete', 'failed']) {
      const state = renderAccounts({ reads: accountsFixtureReadsWith(fixture) })
      await waitFor(() => expect(screen.queryByText(/Reading canonical account contracts/)).not.toBeInTheDocument())
      if (fixture === 'empty') expect(screen.getByText(/No accounts to show/)).toBeInTheDocument()
      if (fixture === 'incomplete') expect(screen.getAllByText('Incomplete').length).toBeGreaterThan(0)
      if (fixture === 'failed') expect(screen.getByText(/Account positions are not available/)).toBeInTheDocument()
      expect(await axe(state.container)).toHaveNoViolations()
      state.unmount()
    }
  })

  it('keeps grouping URL-backed and keyboard operable', async () => {
    const user = userEvent.setup()
    const { onRouteQueryChange } = await renderLoaded()
    const group = screen.getByRole('group', { name: 'Account grouping' })
    const byType = within(group).getByRole('button', { name: /By type/ })
    expect(byType).toHaveAttribute('aria-pressed', 'true')
    byType.focus()
    await user.keyboard('{Enter}')
    expect(onRouteQueryChange).toHaveBeenCalledWith({ group: '' })
  })

  it('uses one semantic table with a caption, scoped headers and a contained scroll region', async () => {
    const { container } = await renderLoaded()
    // One table with one header, as the prototype has it — not one table per
    // group, which would repeat the column header six times.
    const table = screen.getByRole('table')
    expect(table.querySelector('caption')).toBeTruthy()
    expect(table.querySelectorAll('thead th[scope="col"]').length).toBe(6)
    expect(table.querySelectorAll('tbody th[scope="row"]').length).toBe(ACCOUNTS_FIXTURE_ROWS.length)
    expect(table.querySelectorAll('tbody').length).toBeGreaterThan(1)
    const scroll = container.querySelectorAll('.v6-accounts-scroll')
    expect(scroll).toHaveLength(1)
    expect(scroll[0]).toHaveAttribute('role', 'region')
  })

  it('mounts in the V6 shell with one h1 and Accounts current in section navigation', async () => {
    const route = resolveAppHref('/wealth/accounts')
    render(
      <AppShell identity="member@example.com" navigate={vi.fn(() => true)} onSignOut={vi.fn().mockResolvedValue(true)} presentation={presentationForRoute(route)} route={route} screenOwnsHeader takePendingFocusTarget={() => null}>
        <AccountsScreen routeQuery={{}} onRouteQueryChange={vi.fn()} reads={accountsFixtureReads} />
      </AppShell>,
    )
    await waitFor(() => expect(screen.getByText('Fixture Savings')).toBeInTheDocument())
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const nav = screen.getByRole('navigation', { name: 'Section navigation' })
    expect(within(nav).getByRole('link', { name: 'Accounts' })).toHaveAttribute('aria-current', 'page')
  })

  it('has no automated accessibility violations in the loaded and detail states', async () => {
    const loaded = await renderLoaded()
    expect(await axe(loaded.container)).toHaveNoViolations()
    loaded.unmount()
    const detail = await renderLoaded({ detailId: ACCOUNTS_FIXTURE_ROWS[0].id })
    await screen.findByRole('dialog')
    expect(await axe(detail.container)).toHaveNoViolations()
  })
})

describe('V6 Accounts — no prototype demo truth', () => {
  it('renders none of the frozen prototype financial values', async () => {
    const { container } = await renderLoaded()
    const text = container.textContent
    for (const demo of ['2,847,300', '2,450,000', '266,000', '166,300', '150,000', '28,900', '212,400', '84,300', '48,200', '6,800', '8,940', '96,600', '460,060', '72,400', '3,409,091']) {
      expect(text, demo).not.toContain(demo)
    }
    expect(text).not.toMatch(/10 accounts · 3 currencies · all valued today|13 accounts/)
  })
})
