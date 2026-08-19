import assert from 'node:assert/strict'
import test from 'node:test'

import { resolvePeriod } from './period.ts'
import { runQuery } from './run.ts'
import type { AccountRef } from '../../_shared/types.ts'
import type { CategoryBudgetRow, GoalRecord, InvestmentHolding, NetWorthRow, QueryPlan, QueryStore, RecentTransaction, RecurringEntry, ResolvedPeriod, SpendResult, TotalSpendResult } from './types.ts'

const FX_RATES: Record<string, number> = { AED: 1, USD: 3.6725, INR: 0.044 }
const SAVINGS_CATEGORY = 'Savings & Investments'

interface FakeRow {
  date: string
  amount: number
  currency: string
  category: string | null
  accountId: string | null
  owner: string | null
  note: string | null
  needsReview?: boolean
  deletedAt?: string | null
}

function amountAed(row: FakeRow): number | null {
  const rate = FX_RATES[row.currency]
  return rate === undefined ? null : row.amount * rate
}

/**
 * Mirrors v_transactions_aed's own arithmetic (FX conversion, NULL for an
 * unrated currency, deleted_at exclusion) in memory, so these tests exercise
 * run.ts's orchestration without a database — the view's SQL itself is
 * covered by supabase/db-test/money_view.test.mjs.
 */
class FakeQueryStore implements QueryStore {
  rows: FakeRow[]

  constructor(rows: FakeRow[]) {
    this.rows = rows
  }

  private inPeriod(row: FakeRow, period: ResolvedPeriod): boolean {
    return !row.deletedAt && row.date >= period.from && row.date <= period.to
  }

  private summarise(rows: FakeRow[], period: ResolvedPeriod): SpendResult {
    const converted = rows.map(amountAed)
    return {
      amountAed: converted.reduce<number>((sum, a) => (a === null ? sum : sum + a), 0),
      count: rows.length,
      unconvertedCount: converted.filter((a) => a === null).length,
      period,
    }
  }

  categorySpend(category: string, period: ResolvedPeriod, owner?: string): Promise<SpendResult> {
    const rows = this.rows.filter((r) => this.inPeriod(r, period) && r.category === category && (!owner || r.owner === owner))
    return Promise.resolve(this.summarise(rows, period))
  }

  totalSpend(period: ResolvedPeriod, owner?: string): Promise<TotalSpendResult> {
    const inWindow = this.rows.filter((r) => this.inPeriod(r, period) && (!owner || r.owner === owner))
    const spend = inWindow.filter((r) => r.category !== SAVINGS_CATEGORY)
    const savings = inWindow.filter((r) => r.category === SAVINGS_CATEGORY)
    return Promise.resolve({
      ...this.summarise(spend, period),
      excludedSavingsAed: savings.reduce<number>((sum, r) => sum + (amountAed(r) ?? 0), 0),
    })
  }

  merchantSpend(merchant: string, period: ResolvedPeriod): Promise<SpendResult> {
    const wanted = merchant.toLowerCase()
    const rows = this.rows.filter((r) => this.inPeriod(r, period) && (r.note ?? '').toLowerCase().includes(wanted))
    return Promise.resolve(this.summarise(rows, period))
  }

  accountSpend(accountId: string, period: ResolvedPeriod): Promise<SpendResult> {
    const rows = this.rows.filter((r) => this.inPeriod(r, period) && r.accountId === accountId)
    return Promise.resolve(this.summarise(rows, period))
  }

  recentTransactions(limit: number, owner?: string): Promise<RecentTransaction[]> {
    const rows = this.rows
      .filter((r) => !r.deletedAt && (!owner || r.owner === owner))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, limit)
    return Promise.resolve(
      rows.map((r) => ({
        date: r.date,
        amount: r.amount,
        amountAed: amountAed(r),
        currency: r.currency,
        category: r.category,
        note: r.note,
        owner: r.owner,
        needsReview: r.needsReview ?? false,
      }))
    )
  }

  budgetRows: CategoryBudgetRow[] = []

  budgetStatus(): Promise<CategoryBudgetRow[]> {
    return Promise.resolve(this.budgetRows)
  }

  nwDaily: NetWorthRow[] = []

  netWorthLatest(): Promise<NetWorthRow | null> {
    const sorted = [...this.nwDaily].sort((a, b) => (a.day < b.day ? 1 : -1))
    return Promise.resolve(sorted[0] ?? null)
  }

  netWorthOnOrBefore(day: string): Promise<NetWorthRow | null> {
    const eligible = this.nwDaily.filter((r) => r.day <= day).sort((a, b) => (a.day < b.day ? 1 : -1))
    return Promise.resolve(eligible[0] ?? null)
  }

  netWorthEarliestDay(): Promise<string | null> {
    const sorted = [...this.nwDaily].sort((a, b) => (a.day < b.day ? -1 : 1))
    return Promise.resolve(sorted[0]?.day ?? null)
  }

  goals: GoalRecord[] = []

  goalsWithContributions(): Promise<GoalRecord[]> {
    return Promise.resolve(this.goals)
  }

  fxRatesValue: Record<string, number> = { AED: 1 }

  fxRates(): Promise<Record<string, number>> {
    return Promise.resolve(this.fxRatesValue)
  }

  recurring: RecurringEntry[] = []

  recurringEntries(): Promise<RecurringEntry[]> {
    return Promise.resolve(this.recurring)
  }

  holdings: InvestmentHolding[] = []

  investmentHoldings(): Promise<InvestmentHolding[]> {
    return Promise.resolve(this.holdings)
  }

  reviewCount = 0

  needsReviewCount(): Promise<number> {
    return Promise.resolve(this.reviewCount)
  }
}

const NOW = () => new Date('2026-08-17T09:00:00Z') // matches period.test.ts's MID_MONTH
const THIS_MONTH = resolvePeriod({ kind: 'this_month' }, NOW())

const ACCOUNTS: AccountRef[] = [
  { id: 'acc-joint', name: 'Joint Current', type: 'cash', owner: 'Joint' },
  { id: 'acc-enbd', name: 'ENBD Credit Card 4412', type: 'credit_card', owner: 'Shrey' },
]

test('category_spend sums correctly and reports count/avg', async () => {
  const store = new FakeQueryStore([
    { date: '2026-08-05', amount: 84, currency: 'AED', category: 'Dining Out', accountId: 'acc-enbd', owner: 'Shrey', note: 'Zomato' },
    { date: '2026-08-10', amount: 40, currency: 'AED', category: 'Dining Out', accountId: 'acc-enbd', owner: 'Tarika', note: 'Karak House' },
    { date: '2026-08-10', amount: 20, currency: 'AED', category: 'Groceries', accountId: 'acc-joint', owner: 'Shrey', note: 'Carrefour' },
  ])
  const plan: QueryPlan = { q: 'category_spend', category: 'Dining Out', period: { kind: 'this_month' } }

  const result = await runQuery(plan, store, ACCOUNTS, NOW)

  assert.deepEqual(result, { q: 'category_spend', category: 'Dining Out', amountAed: 124, count: 2, unconvertedCount: 0, period: THIS_MONTH })
})

test('category_spend with zero matches is a first-class zero, not an error', async () => {
  const store = new FakeQueryStore([])
  const plan: QueryPlan = { q: 'category_spend', category: 'Groceries', period: { kind: 'this_month' } }

  const result = await runQuery(plan, store, ACCOUNTS, NOW)

  assert.equal(result.q === 'category_spend' ? result.count : -1, 0)
  assert.equal(result.q === 'category_spend' ? result.amountAed : -1, 0)
})

test('total_spend excludes Savings & Investments from the sum and reports it separately', async () => {
  const store = new FakeQueryStore([
    { date: '2026-08-05', amount: 100, currency: 'AED', category: 'Groceries', accountId: 'acc-joint', owner: 'Shrey', note: 'Carrefour' },
    { date: '2026-08-06', amount: 2000, currency: 'AED', category: SAVINGS_CATEGORY, accountId: 'acc-joint', owner: 'Shrey', note: 'Zerodha SIP' },
  ])
  const plan: QueryPlan = { q: 'total_spend', period: { kind: 'this_month' } }

  const result = await runQuery(plan, store, ACCOUNTS, NOW)

  assert.equal(result.q === 'total_spend' ? result.amountAed : -1, 100)
  assert.equal(result.q === 'total_spend' ? result.excludedSavingsAed : -1, 2000)
})

test('a mixed-currency fixture (1000 INR + 100 AED) sums correctly via the FX view', async () => {
  const store = new FakeQueryStore([
    { date: '2026-08-05', amount: 1000, currency: 'INR', category: 'Savings & Investments', accountId: 'acc-joint', owner: 'Shrey', note: 'Zerodha' },
    { date: '2026-08-06', amount: 100, currency: 'AED', category: 'Groceries', accountId: 'acc-joint', owner: 'Shrey', note: 'Carrefour' },
  ])
  const plan: QueryPlan = { q: 'total_spend', period: { kind: 'this_month' } }

  const result = await runQuery(plan, store, ACCOUNTS, NOW)

  // 1000 INR is Savings, excluded from spend; 100 AED is the only spend row.
  assert.equal(result.q === 'total_spend' ? result.amountAed : -1, 100)
  assert.equal(result.q === 'total_spend' ? result.excludedSavingsAed : -1, 1000 * FX_RATES.INR)
})

test('a row in a currency with no known FX rate is excluded from the sum and counted as unconverted', async () => {
  const store = new FakeQueryStore([
    { date: '2026-08-05', amount: 50, currency: 'AED', category: 'Groceries', accountId: 'acc-joint', owner: 'Shrey', note: 'Carrefour' },
    { date: '2026-08-06', amount: 20, currency: 'GBP', category: 'Groceries', accountId: 'acc-joint', owner: 'Shrey', note: 'Waitrose' },
  ])
  const plan: QueryPlan = { q: 'category_spend', category: 'Groceries', period: { kind: 'this_month' } }

  const result = await runQuery(plan, store, ACCOUNTS, NOW)

  assert.equal(result.q === 'category_spend' ? result.amountAed : -1, 50, 'sum() silently skips the unconverted row, matching Postgres')
  assert.equal(result.q === 'category_spend' ? result.count : -1, 2)
  assert.equal(result.q === 'category_spend' ? result.unconvertedCount : -1, 1)
})

test('a soft-deleted row is excluded from every query', async () => {
  const store = new FakeQueryStore([
    { date: '2026-08-05', amount: 500, currency: 'AED', category: 'Groceries', accountId: 'acc-joint', owner: 'Shrey', note: 'Carrefour', deletedAt: '2026-08-06T00:00:00Z' },
  ])
  const plan: QueryPlan = { q: 'category_spend', category: 'Groceries', period: { kind: 'this_month' } }

  const result = await runQuery(plan, store, ACCOUNTS, NOW)

  assert.equal(result.q === 'category_spend' ? result.count : -1, 0)
})

test('merchant_spend matches case-insensitively on note text and is a zero when nothing matches', async () => {
  const store = new FakeQueryStore([
    { date: '2026-08-05', amount: 60, currency: 'AED', category: 'Groceries', accountId: 'acc-joint', owner: 'Shrey', note: 'CARREFOUR Mall of Emirates' },
    { date: '2026-08-06', amount: 30, currency: 'AED', category: 'Dining Out', accountId: 'acc-joint', owner: 'Shrey', note: 'Zomato' },
  ])

  const hit = await runQuery({ q: 'merchant_spend', merchant: 'carrefour', period: { kind: 'this_month' } }, store, ACCOUNTS, NOW)
  assert.equal(hit.q === 'merchant_spend' ? hit.amountAed : -1, 60)
  assert.equal(hit.q === 'merchant_spend' ? hit.count : -1, 1)

  const miss = await runQuery({ q: 'merchant_spend', merchant: 'Lulu', period: { kind: 'this_month' } }, store, ACCOUNTS, NOW)
  assert.equal(miss.q === 'merchant_spend' ? miss.count : -1, 0)
})

test('account_spend resolves a free-text guess to the matching account', async () => {
  const store = new FakeQueryStore([
    { date: '2026-08-05', amount: 40, currency: 'AED', category: 'Dining Out', accountId: 'acc-enbd', owner: 'Shrey', note: 'Zomato' },
    { date: '2026-08-06', amount: 90, currency: 'AED', category: 'Groceries', accountId: 'acc-joint', owner: 'Shrey', note: 'Carrefour' },
  ])
  const plan: QueryPlan = { q: 'account_spend', account: 'the ENBD card', period: { kind: 'this_month' } }

  const result = await runQuery(plan, store, ACCOUNTS, NOW)

  assert.deepEqual(result, {
    q: 'account_spend',
    status: 'ok',
    account: 'ENBD Credit Card 4412',
    amountAed: 40,
    count: 1,
    unconvertedCount: 0,
    period: THIS_MONTH,
  })
})

test('account_spend zero-result is still status ok with a real, empty summary', async () => {
  const store = new FakeQueryStore([])
  const plan: QueryPlan = { q: 'account_spend', account: 'Joint Current', period: { kind: 'this_month' } }

  const result = await runQuery(plan, store, ACCOUNTS, NOW)

  assert.equal(result.q === 'account_spend' && result.status === 'ok' ? result.count : -1, 0)
})

test('account_spend never guesses on a tie — it asks, naming both candidates', async () => {
  const tiedAccounts: AccountRef[] = [
    { id: 'acc-a', name: 'Car Down-Payment EMI (ENBD Noon CC ...1657)', type: 'credit_card', owner: 'Shrey' },
    { id: 'acc-b', name: 'Mobile EMI (ENBD Noon CC ...1657)', type: 'credit_card', owner: 'Shrey' },
  ]
  const store = new FakeQueryStore([])
  const plan: QueryPlan = { q: 'account_spend', account: 'card ending 1657', period: { kind: 'this_month' } }

  const result = await runQuery(plan, store, tiedAccounts, NOW)

  assert.deepEqual(result, {
    q: 'account_spend',
    status: 'needs_clarification',
    candidates: ['Car Down-Payment EMI (ENBD Noon CC ...1657)', 'Mobile EMI (ENBD Noon CC ...1657)'],
  })
})

test('account_spend with no match at all lists every real account as candidates', async () => {
  const store = new FakeQueryStore([])
  const plan: QueryPlan = { q: 'account_spend', account: 'some crypto wallet', period: { kind: 'this_month' } }

  const result = await runQuery(plan, store, ACCOUNTS, NOW)

  assert.deepEqual(result, {
    q: 'account_spend',
    status: 'needs_clarification',
    candidates: ['Joint Current', 'ENBD Credit Card 4412'],
  })
})

test('recent_transactions returns newest first, flags needs_review, and is a clean zero when empty', async () => {
  const store = new FakeQueryStore([
    { date: '2026-08-05', amount: 40, currency: 'AED', category: 'Dining Out', accountId: 'acc-enbd', owner: 'Shrey', note: 'Zomato', needsReview: true },
    { date: '2026-08-06', amount: 90, currency: 'AED', category: 'Groceries', accountId: 'acc-joint', owner: 'Shrey', note: 'Carrefour' },
  ])

  const result = await runQuery({ q: 'recent_transactions', limit: 10 }, store, ACCOUNTS, NOW)
  assert.equal(result.q, 'recent_transactions')
  const rows = result.q === 'recent_transactions' ? result.rows : []
  assert.equal(rows[0].date, '2026-08-06', 'newest first')
  assert.equal(rows[1].needsReview, true)

  const empty = await runQuery({ q: 'recent_transactions', limit: 10 }, new FakeQueryStore([]), ACCOUNTS, NOW)
  assert.deepEqual(empty.q === 'recent_transactions' ? empty.rows : null, [])
})

test('budget_status: full grid dispatches to store.budgetStatus and stamps isCurrentMonth', async () => {
  const store = new FakeQueryStore([])
  store.budgetRows = [
    { category: 'Groceries', limitAed: 1800, spentAed: 1510 },
    { category: 'Clothing', limitAed: null, spentAed: 340 },
  ]
  const plan: QueryPlan = { q: 'budget_status', period: { kind: 'this_month' } }

  const result = await runQuery(plan, store, ACCOUNTS, NOW)

  assert.equal(result.q, 'budget_status')
  assert.deepEqual(result.q === 'budget_status' ? result.rows : null, store.budgetRows)
  assert.equal(result.q === 'budget_status' ? result.isCurrentMonth : null, true)
  assert.equal(result.q === 'budget_status' ? result.category : 'unset', undefined)
})

test('budget_status: a category-scoped plan carries the category through and is not "this month" for last_month', async () => {
  const store = new FakeQueryStore([])
  const plan: QueryPlan = { q: 'budget_status', category: 'Groceries', period: { kind: 'last_month' } }

  const result = await runQuery(plan, store, ACCOUNTS, NOW)

  assert.equal(result.q === 'budget_status' ? result.category : null, 'Groceries')
  assert.equal(result.q === 'budget_status' ? result.isCurrentMonth : null, false)
})

test('recent_transactions respects an owner filter', async () => {
  const store = new FakeQueryStore([
    { date: '2026-08-05', amount: 40, currency: 'AED', category: 'Dining Out', accountId: 'acc-enbd', owner: 'Shrey', note: 'Zomato' },
    { date: '2026-08-06', amount: 90, currency: 'AED', category: 'Groceries', accountId: 'acc-joint', owner: 'Tarika', note: 'Carrefour' },
  ])

  const result = await runQuery({ q: 'recent_transactions', limit: 10, owner: 'Tarika' }, store, ACCOUNTS, NOW)
  const rows = result.q === 'recent_transactions' ? result.rows : []
  assert.equal(rows.length, 1)
  assert.equal(rows[0].owner, 'Tarika')
})

test('net_worth: no compare dispatches to store.netWorthLatest only', async () => {
  const store = new FakeQueryStore([])
  store.nwDaily = [
    { day: '2026-08-17', totalAed: 335533, assetsAed: 462058, liabilitiesAed: 126525, byOwner: { Shrey: 290333, Tarika: 45200 } },
  ]

  const result = await runQuery({ q: 'net_worth' }, store, ACCOUNTS, NOW)

  assert.equal(result.q, 'net_worth')
  assert.equal(result.q === 'net_worth' ? result.asOf : null, '2026-08-17')
  assert.equal(result.q === 'net_worth' ? result.totalAed : null, 335533)
  assert.equal(result.q === 'net_worth' ? result.change : 'unset', undefined)
})

test('net_worth: compare with a baseline before the period start computes a delta', async () => {
  const store = new FakeQueryStore([])
  store.nwDaily = [
    { day: '2026-07-25', totalAed: 300000, assetsAed: 400000, liabilitiesAed: 100000, byOwner: {} },
    { day: '2026-08-17', totalAed: 335533, assetsAed: 462058, liabilitiesAed: 126525, byOwner: {} },
  ]

  const result = await runQuery({ q: 'net_worth', compare: { kind: 'this_month' } }, store, ACCOUNTS, NOW)

  assert.equal(result.q === 'net_worth' && result.change?.kind, 'delta')
  if (result.q === 'net_worth' && result.change?.kind === 'delta') {
    assert.equal(result.change.fromDay, '2026-07-25')
    assert.equal(result.change.deltaAed, 35533)
  }
})

test('net_worth: compare with no baseline before the period start reports unavailable, not a guessed delta', async () => {
  const store = new FakeQueryStore([])
  store.nwDaily = [
    { day: '2026-08-09', totalAed: 300000, assetsAed: 400000, liabilitiesAed: 100000, byOwner: {} },
    { day: '2026-08-17', totalAed: 335533, assetsAed: 462058, liabilitiesAed: 126525, byOwner: {} },
  ]

  // this_month for NOW (2026-08-17) starts 2026-08-01 — earlier than the earliest row (08-09).
  const result = await runQuery({ q: 'net_worth', compare: { kind: 'this_month' } }, store, ACCOUNTS, NOW)

  assert.equal(result.q === 'net_worth' && result.change?.kind, 'unavailable')
  if (result.q === 'net_worth' && result.change?.kind === 'unavailable') {
    assert.equal(result.change.earliestDay, '2026-08-09')
  }
})

test('net_worth: owner and byOwner pass through untouched', async () => {
  const store = new FakeQueryStore([])
  store.nwDaily = [{ day: '2026-08-17', totalAed: 335533, assetsAed: 462058, liabilitiesAed: 126525, byOwner: { Shrey: 290333, Tarika: 45200 } }]

  const result = await runQuery({ q: 'net_worth', owner: 'Tarika' }, store, ACCOUNTS, NOW)

  assert.equal(result.q === 'net_worth' ? result.owner : null, 'Tarika')
  assert.deepEqual(result.q === 'net_worth' ? result.byOwner : null, { Shrey: 290333, Tarika: 45200 })
})

test('net_worth: no snapshot ever recorded is an honest empty answer, not a throw', async () => {
  const store = new FakeQueryStore([])

  const result = await runQuery({ q: 'net_worth' }, store, ACCOUNTS, NOW)

  assert.equal(result.q === 'net_worth' ? result.asOf : null, '')
  assert.equal(result.q === 'net_worth' ? result.totalAed : null, 0)
})

const EMERGENCY_FUND: GoalRecord = {
  id: 'goal-ef',
  name: 'Emergency Fund',
  icon: '🛟',
  kind: 'save_up',
  targetAmount: 70000,
  monthlyPlan: 5700,
  priority: 1,
  targetDate: null,
  startingBalance: null,
  linkedAccount: null,
  contributions: [],
}

const CAR_LOAN: GoalRecord = {
  id: 'goal-car',
  name: 'Car Loan',
  icon: '🚗',
  kind: 'pay_down',
  targetAmount: 0,
  monthlyPlan: 2194,
  priority: 4,
  targetDate: '2030-07-03',
  startingBalance: 114474,
  linkedAccount: { value: 92633.66, currency: 'AED', type: 'loan', interestRate: null },
  contributions: [],
}

test('goal_progress: no goal name dispatches to store.goalsWithContributions for all goals', async () => {
  const store = new FakeQueryStore([])
  store.goals = [EMERGENCY_FUND, CAR_LOAN]

  const result = await runQuery({ q: 'goal_progress' }, store, ACCOUNTS, NOW)

  assert.equal(result.q === 'goal_progress' && result.status, 'ok')
  if (result.q === 'goal_progress' && result.status === 'ok') {
    assert.equal(result.goals.length, 2)
    assert.deepEqual(result.fxRates, { AED: 1 })
  }
})

test('goal_progress: a matched goal name resolves to that single goal', async () => {
  const store = new FakeQueryStore([])
  store.goals = [EMERGENCY_FUND, CAR_LOAN]

  const result = await runQuery({ q: 'goal_progress', goal: 'emergency fund' }, store, ACCOUNTS, NOW)

  assert.equal(result.q === 'goal_progress' && result.status, 'ok')
  if (result.q === 'goal_progress' && result.status === 'ok') {
    assert.equal(result.goals.length, 1)
    assert.equal(result.goals[0].id, 'goal-ef')
  }
})

test('goal_progress: an unmatched goal name asks a clarifying question naming the real goals, never a guess', async () => {
  const store = new FakeQueryStore([])
  store.goals = [EMERGENCY_FUND, CAR_LOAN]

  const result = await runQuery({ q: 'goal_progress', goal: 'vacation fund' }, store, ACCOUNTS, NOW)

  assert.equal(result.q === 'goal_progress' ? result.status : null, 'needs_clarification')
  assert.deepEqual(result.q === 'goal_progress' && result.status === 'needs_clarification' ? result.candidates.sort() : null, [
    'Car Loan',
    'Emergency Fund',
  ])
})

test('upcoming_bills: dispatches to store.recurringEntries/fxRates and defaults days to 14', async () => {
  const store = new FakeQueryStore([])
  store.recurring = [
    // NOW is 2026-08-17; day 25 falls 8 days out, inside the default 14-day window.
    { id: 'r1', name: 'Car Loan EMI', kind: 'emi', amount: 2194, currency: 'AED', owner: 'Shrey', dayOfMonth: 25, months: [], autopay: false, endDate: '2030-07-03' },
  ]

  const result = await runQuery({ q: 'upcoming_bills' }, store, ACCOUNTS, NOW)

  assert.equal(result.q === 'upcoming_bills' ? result.days : null, 14)
  if (result.q === 'upcoming_bills') {
    assert.equal(result.bills.length, 1)
    assert.equal(result.bills[0].date, '2026-08-25')
  }
})

test('upcoming_bills: an out-of-range days value is clamped, never trusted as-is', async () => {
  const store = new FakeQueryStore([])
  store.recurring = []

  const result = await runQuery({ q: 'upcoming_bills', days: 500 }, store, ACCOUNTS, NOW)

  assert.equal(result.q === 'upcoming_bills' ? result.days : null, 90)
})

test('portfolio_summary: dispatches to store.investmentHoldings/fxRates and passes owner through', async () => {
  const store = new FakeQueryStore([])
  store.holdings = [
    { id: 'h1', name: 'NETWEB', ticker: 'NETWEB', quantity: 15, avgCost: 4000, lastPrice: 5200, value: 78186, currency: 'INR', owner: 'Shrey', priceUpdatedAt: '2026-08-17T18:27:56Z' },
  ]

  const result = await runQuery({ q: 'portfolio_summary', owner: 'Shrey' }, store, ACCOUNTS, NOW)

  assert.equal(result.q === 'portfolio_summary' ? result.owner : null, 'Shrey')
  assert.equal(result.q === 'portfolio_summary' ? result.holdingsCount : null, 1)
})

test('needs_review_count: dispatches to store.needsReviewCount', async () => {
  const store = new FakeQueryStore([])
  store.reviewCount = 3

  const result = await runQuery({ q: 'needs_review_count' }, store, ACCOUNTS, NOW)

  assert.equal(result.q === 'needs_review_count' ? result.count : null, 3)
})
