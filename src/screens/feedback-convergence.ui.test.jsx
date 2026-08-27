import { render, screen, waitFor, within } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Budget from './Budget'
import Debts from './Debts'
import Goals from './Goals'
import Recurring from './Recurring'
import Settings from './Settings'
import Transactions from './Transactions'

const loaders = vi.hoisted(() => ({
  countNeedsReview: vi.fn(),
  countUnreviewed: vi.fn(),
  getSetting: vi.fn(),
  listAccounts: vi.fn(),
  listAllContributions: vi.fn(),
  listBudgets: vi.fn(),
  listCategories: vi.fn(),
  listGoals: vi.fn(),
  listIncome: vi.fn(),
  listRecurring: vi.fn(),
  listRules: vi.fn(),
  listTransactions: vi.fn(),
  loadFx: vi.fn(),
}))

vi.mock('../lib/accounts', async (importOriginal) => ({
  ...(await importOriginal()),
  listAccounts: loaders.listAccounts,
}))
vi.mock('../lib/budgets', async (importOriginal) => ({
  ...(await importOriginal()),
  listBudgets: loaders.listBudgets,
}))
vi.mock('../lib/categories', async (importOriginal) => ({
  ...(await importOriginal()),
  listCategories: loaders.listCategories,
}))
vi.mock('../lib/categoryRules', async (importOriginal) => ({
  ...(await importOriginal()),
  listRules: loaders.listRules,
}))
vi.mock('../lib/goals', async (importOriginal) => ({
  ...(await importOriginal()),
  listAllContributions: loaders.listAllContributions,
  listGoals: loaders.listGoals,
}))
vi.mock('../lib/income', async (importOriginal) => ({
  ...(await importOriginal()),
  listIncome: loaders.listIncome,
}))
vi.mock('../lib/recurring', async (importOriginal) => ({
  ...(await importOriginal()),
  listRecurring: loaders.listRecurring,
}))
vi.mock('../lib/settings', async (importOriginal) => ({
  ...(await importOriginal()),
  getSetting: loaders.getSetting,
}))
vi.mock('../lib/transactions', async (importOriginal) => ({
  ...(await importOriginal()),
  countNeedsReview: loaders.countNeedsReview,
  countUnreviewed: loaders.countUnreviewed,
  listTransactions: loaders.listTransactions,
}))
vi.mock('../lib/PrefsContext', () => ({
  usePrefs: () => ({
    fmt: (value) => String(value ?? '—'),
    fxRates: { AED: 1 },
    refreshFx: vi.fn(),
  }),
}))
vi.mock('../lib/useRealtime', () => ({ useRealtimeRefresh: vi.fn() }))
vi.mock('../lib/useRouteQueryState', () => ({
  useRouteQueryState: (defaults) => [defaults, vi.fn()],
}))
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: loaders.loadFx })),
      })),
    })),
    functions: { invoke: vi.fn() },
  },
}))

const allLoaders = Object.values(loaders)

function expectRequestCounts(expected) {
  for (const [loader, count] of expected) expect(loader).toHaveBeenCalledTimes(count)
}

const cases = [
  {
    name: 'Budget',
    Component: Budget,
    props: {},
    pendingLoader: loaders.listBudgets,
    message: 'Could not load budget. Check your connection and try again.',
    bodyText: 'Left to budget',
    loadingCounts: [
      [loaders.listCategories, 1], [loaders.listBudgets, 1], [loaders.listTransactions, 1],
      [loaders.listIncome, 1], [loaders.listGoals, 1], [loaders.listAllContributions, 1],
    ],
  },
  {
    name: 'Debts',
    Component: Debts,
    props: {},
    pendingLoader: loaders.listGoals,
    message: 'Could not load debts. Check your connection and try again.',
    bodyText: 'Debts',
    loadingCounts: [[loaders.listGoals, 1], [loaders.listAccounts, 1]],
  },
  {
    name: 'Goals',
    Component: Goals,
    props: {},
    pendingLoader: loaders.listAllContributions,
    message: 'Could not load goals. Check your connection and try again.',
    bodyText: 'Goals',
    loadingCounts: [[loaders.listGoals, 1], [loaders.listAllContributions, 1], [loaders.listAccounts, 1]],
  },
  {
    name: 'Recurring',
    Component: Recurring,
    props: { routeQuery: {}, onRouteQueryChange: vi.fn() },
    pendingLoader: loaders.listRecurring,
    message: 'Could not load. Check your connection and try again.',
    bodyText: 'Bills & EMIs',
    loadingCounts: [[loaders.listRecurring, 1], [loaders.listIncome, 1], [loaders.listAccounts, 1]],
  },
  {
    name: 'Settings',
    Component: Settings,
    props: {},
    pendingLoader: loaders.listCategories,
    message: 'Could not load settings. Check your connection and try again.',
    bodyText: 'Household split',
    loadingCounts: [
      [loaders.listCategories, 1], [loaders.listAccounts, 1], [loaders.listRecurring, 1],
      [loaders.listBudgets, 1], [loaders.listTransactions, 1], [loaders.getSetting, 4], [loaders.loadFx, 1],
    ],
    errorCounts: [[loaders.getSetting, 8]],
  },
  {
    name: 'Transactions',
    Component: Transactions,
    props: { routeQuery: {}, onRouteQueryChange: vi.fn() },
    pendingLoader: loaders.listRules,
    message: 'Could not load transactions. Check your connection and try again.',
    bodyText: 'Transactions',
    loadingCounts: [
      [loaders.listTransactions, 1], [loaders.listAccounts, 1], [loaders.listCategories, 1],
      [loaders.countNeedsReview, 1], [loaders.countUnreviewed, 1], [loaders.listRules, 1], [loaders.listGoals, 1],
    ],
  },
]

beforeEach(() => {
  for (const loader of allLoaders) loader.mockReset()
  for (const loader of [
    loaders.listAccounts,
    loaders.listAllContributions,
    loaders.listBudgets,
    loaders.listCategories,
    loaders.listGoals,
    loaders.listIncome,
    loaders.listRecurring,
    loaders.listRules,
    loaders.listTransactions,
  ]) loader.mockResolvedValue([])
  loaders.countNeedsReview.mockResolvedValue(0)
  loaders.countUnreviewed.mockResolvedValue(0)
  loaders.getSetting.mockResolvedValue(null)
  loaders.loadFx.mockResolvedValue({ data: null })
})

describe.each(cases)('$name passive page feedback', ({ Component, props, pendingLoader, message, bodyText, loadingCounts, errorCounts }) => {
  it('keeps the existing initial request count while exposing the shared loading status', async () => {
    pendingLoader.mockImplementationOnce(() => new Promise(() => {}))
    render(<Component {...props} />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    await waitFor(() => expectRequestCounts(loadingCounts))
  })

  it('keeps the failure inline and passive without retrying', async () => {
    pendingLoader.mockRejectedValueOnce(new Error('fixture load failure'))
    render(<Component {...props} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(message)
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getAllByText(bodyText, { exact: true }).length).toBeGreaterThan(0)
    await waitFor(() => expectRequestCounts(errorCounts ?? loadingCounts))
    expect(await axe(alert)).toHaveNoViolations()
  })

  it('keeps the normal loaded composition free of passive feedback', async () => {
    render(<Component {...props} />)

    await waitFor(() => expect(screen.getAllByText(bodyText, { exact: true }).length).toBeGreaterThan(0))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expectRequestCounts(errorCounts ?? loadingCounts))
  })
})
