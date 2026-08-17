import assert from 'node:assert/strict'
import test from 'node:test'

import { resolvePeriod } from './period.ts'
import { runQuery } from './run.ts'
import type { AccountRef } from '../../_shared/types.ts'
import type { QueryPlan, QueryStore, RecentTransaction, ResolvedPeriod, SpendResult, TotalSpendResult } from './types.ts'

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
