import { readFileSync } from 'node:fs'

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { describe, expect, it, vi } from 'vitest'

import AppShell from '../../shell/AppShell'
import { presentationForRoute, resolveAppHref } from '../../lib/routes'
import NetWorthScreen from '../NetWorthScreen'
import { NET_WORTH_FIXTURE_TODAY, netWorthFixtureReads, netWorthFixtureReadsWith } from '../fixtures/netWorthFixture'

vi.mock('../../lib/PrefsContext', () => ({
  usePrefs: () => ({ currency: 'AED', setCurrency: vi.fn(), theme: 'system', setTheme: vi.fn() }),
}))
vi.mock('../../lib/useRealtime', () => ({ useRealtimeRefresh: () => {} }))

function renderNetWorth({ query = {}, reads = netWorthFixtureReads } = {}) {
  const onRouteQueryChange = vi.fn()
  const result = render(
    <NetWorthScreen routeQuery={query} onRouteQueryChange={onRouteQueryChange} today={NET_WORTH_FIXTURE_TODAY} reads={reads} />,
  )
  return { ...result, onRouteQueryChange }
}

async function renderLoaded(options) {
  const result = renderNetWorth(options)
  await waitFor(() => expect(screen.getByText('2,050,000')).toBeInTheDocument())
  return result
}

function claimedText(container) {
  const clone = container.cloneNode(true)
  for (const region of clone.querySelectorAll('.v6-unavailable')) region.remove()
  return clone.textContent
}

describe('V6 Net Worth — route and fresh boundary', () => {
  it('mounts the fresh V6 screen at /wealth/net-worth and leaves other V6 routes intact', async () => {
    expect(resolveAppHref('/wealth/net-worth').screen).toBe('NetWorth')
    expect(resolveAppHref('/overview').screen).toBe('Overview')
    expect(resolveAppHref('/money/activity').screen).toBe('Activity')
    expect(resolveAppHref('/money/budget').screen).toBe('Budget')
    expect(resolveAppHref('/money/recurring').screen).toBe('Recurring')
    expect(resolveAppHref('/money/insights').screen).toBe('Insights')
    const { container } = await renderLoaded()
    expect(container.querySelector('[data-testid="v6-net-worth"]')).toBeInTheDocument()
    expect(container.querySelector('[data-read-only="true"]')).toBeInTheDocument()
  })

  it('does not mount the legacy Accounts presentation for Net Worth', async () => {
    const app = readFileSync('src/App.jsx', 'utf8')
    expect(app).toMatch(/NetWorth: NetWorthScreen/)
    expect(resolveAppHref('/wealth/accounts').screen).toBe('Accounts')
    expect(resolveAppHref('/wealth/net-worth').screen).not.toBe('Accounts')
    const { container } = await renderLoaded()
    expect(container.innerHTML).not.toMatch(/Add account|Edit card|Forecast setup|rounded-2xl/)
  })

  it('keeps the production tree read-only and free of legacy writers and presentation imports', () => {
    const paths = [
      'src/v6/NetWorthScreen.jsx', 'src/v6/data/composeNetWorth.js', 'src/v6/data/netWorthModel.js',
      'src/v6/data/useNetWorthData.js', 'src/v6/net-worth/BalanceSheetPositions.jsx',
      'src/v6/net-worth/NetWorthHistory.jsx',
    ]
    for (const path of paths) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).not.toMatch(/from '[^']*\/(?:screens|components)\//)
      expect(source, path).not.toMatch(/\b(?:createAccount|updateAccount|deleteAccount|recordDailyNetWorth|capture_nw_snapshot|claim_nw_snapshot|upsert|insert)\b/)
    }
  })
})

describe('V6 Net Worth — approved financial and snapshot truth', () => {
  it('reads only current balance sheet, canonical accounts and authoritative snapshots', async () => {
    const calls = []
    const forbidden = vi.fn(async () => { throw new Error('forbidden') })
    await renderLoaded({ reads: {
      ...netWorthFixtureReads,
      getBalanceSheet: async () => { calls.push('current'); return netWorthFixtureReads.getBalanceSheet() },
      listAccounts: async () => { calls.push('accounts'); return netWorthFixtureReads.listAccounts() },
      listNetWorthHistory: async (range) => { calls.push(['history', range]); return netWorthFixtureReads.listNetWorthHistory(range) },
      listLedgerRows: forbidden, listTransactions: forbidden, listIncomeRows: forbidden,
    } })
    expect(calls.map((call) => Array.isArray(call) ? call[0] : call).sort()).toEqual(['accounts', 'current', 'history'])
    expect(forbidden).not.toHaveBeenCalled()
  })

  it('shows current canonical truth separately from historical snapshot truth', async () => {
    await renderLoaded()
    expect(screen.getByText('2,050,000')).toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveTextContent('2,038,000')
    expect(screen.getByText(/Current balance sheet and published snapshot history/)).toBeInTheDocument()
    expect(screen.getByText(/Published observations only/)).toBeInTheDocument()
  })

  it('preserves exact historical observations, skipped publication and Provisional status', async () => {
    const { container } = await renderLoaded()
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(7)
    expect(within(table).getAllByText('Provisional').length).toBeGreaterThan(0)
    expect(within(table).getByText('Skipped — incomplete')).toBeInTheDocument()
    const skipped = within(table).getByText('Skipped — incomplete').closest('tr')
    expect(skipped).toHaveTextContent('Not published')
    expect(container.querySelector('.v6-wealth-history-drawing')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('region', { name: 'Authoritative net worth history table' })).toBeInTheDocument()
  })

  it('never presents Provisional as an error, anomaly or attention claim', async () => {
    const { container } = await renderLoaded()
    expect(screen.getByText(/Provisional is a quality fact, not an error/)).toBeInTheDocument()
    expect(container.querySelector('[role="alert"]')).not.toBeInTheDocument()
    expect(claimedText(container)).not.toMatch(/needs attention|incorrect|broken|invalid/i)
  })

  it('withholds every unsupported change, saved, composition, personal scope and interpreted freshness position', async () => {
    await renderLoaded()
    expect(screen.getAllByText(/Net-worth change is not available yet/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Wealth composition is not available yet/)).toBeInTheDocument()
    expect(screen.getByText(/Personal and shared wealth positions are not available yet/)).toBeInTheDocument()
    expect(screen.getByText(/Full valuation provenance is not available yet/)).toBeInTheDocument()
    expect(screen.getByText(/combined freshness interpretation is not available yet/)).toBeInTheDocument()
    expect(screen.getAllByText(/SHR-173/).length).toBeGreaterThan(0)
    expect(screen.getByText(/SHR-156 \/ SHR-173/)).toBeInTheDocument()
    expect(screen.getByText(/SHR-172 \/ SHR-173/)).toBeInTheDocument()
  })

  it('never exposes legacy owner text, allocation, unsupported change percentages or trend claims', async () => {
    const { container } = await renderLoaded()
    const text = claimedText(container)
    expect(text).not.toMatch(/fixture-label|Shared/)
    expect(text).not.toMatch(/50\/50|69\/31|half of shared|equity share/i)
    expect(text).not.toMatch(/[+−-]\d+(?:\.\d+)?%/)
    expect(text).not.toMatch(/CAGR|growth rate|average growth|forecast|projection|trending|grew|declined/i)
  })

  it('renders drawing-only geometry with no semantic financial value', async () => {
    const { container } = await renderLoaded()
    const drawing = container.querySelector('.v6-wealth-history-drawing')
    expect(drawing).toHaveAttribute('aria-hidden', 'true')
    expect(drawing.querySelectorAll('.v6-wealth-drawing-point')).toHaveLength(6)
    expect(drawing.textContent).toBe('')
  })
})

describe('V6 Net Worth — states, routing and accessibility', () => {
  it('renders honest loading, empty, incomplete and failed states', async () => {
    const pending = new Promise(() => {})
    const loading = renderNetWorth({ reads: { getBalanceSheet: () => pending, listAccounts: () => pending, listNetWorthHistory: () => pending } })
    expect(screen.getByText(/Reading canonical wealth contracts/)).toBeInTheDocument()
    expect(screen.getByText(/Nothing is estimated, reconstructed or written/)).toBeInTheDocument()
    loading.unmount()

    for (const fixture of ['empty', 'incomplete', 'failed']) {
      const state = renderNetWorth({ reads: netWorthFixtureReadsWith(fixture) })
      await waitFor(() => expect(screen.queryByText(/Reading canonical wealth contracts/)).not.toBeInTheDocument())
      if (fixture === 'empty') expect(screen.getByText(/No snapshot facts in this range/)).toBeInTheDocument()
      if (fixture === 'incomplete') expect(screen.getAllByText('Incomplete').length).toBeGreaterThan(0)
      if (fixture === 'failed') expect(screen.getByText(/Snapshot history is not available/)).toBeInTheDocument()
      expect(await axe(state.container)).toHaveNoViolations()
      state.unmount()
    }
  })

  it('keeps range state URL-backed and keyboard operable', async () => {
    const user = userEvent.setup()
    const { onRouteQueryChange } = await renderLoaded({ query: { range: '5y' } })
    expect(screen.getByRole('button', { name: '5Y' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(onRouteQueryChange).toHaveBeenCalledWith({ range: 'all' })
  })

  it('mounts in the V6 shell with one h1 and Net worth current in section navigation', async () => {
    const route = resolveAppHref('/wealth/net-worth?range=1y')
    render(
      <AppShell identity="member@example.com" navigate={vi.fn(() => true)} onSignOut={vi.fn().mockResolvedValue(true)} presentation={presentationForRoute(route)} route={route} screenOwnsHeader takePendingFocusTarget={() => null}>
        <NetWorthScreen routeQuery={{ range: '1y' }} onRouteQueryChange={vi.fn()} today={NET_WORTH_FIXTURE_TODAY} reads={netWorthFixtureReads} />
      </AppShell>,
    )
    await waitFor(() => expect(screen.getByText('2,050,000')).toBeInTheDocument())
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const nav = screen.getByRole('navigation', { name: 'Section navigation' })
    expect(within(nav).getByRole('link', { name: 'Net worth' })).toHaveAttribute('aria-current', 'page')
  })

  it('has no automated accessibility violations in loaded and loading states', async () => {
    const loaded = await renderLoaded()
    expect(await axe(loaded.container)).toHaveNoViolations()
    loaded.unmount()
    const pending = new Promise(() => {})
    const loading = renderNetWorth({ reads: { getBalanceSheet: () => pending, listAccounts: () => pending, listNetWorthHistory: () => pending } })
    expect(await axe(loading.container)).toHaveNoViolations()
  })
})

describe('V6 Net Worth — no prototype demo truth', () => {
  it('renders none of the frozen prototype financial values', async () => {
    const { container } = await renderLoaded()
    const text = container.textContent
    for (const demo of ['2,847,300', '3,412,900', '565,600', '42,180', '18.4%', '71.8%', '17.9%', '8.9%']) {
      expect(text).not.toContain(demo)
    }
  })
})
