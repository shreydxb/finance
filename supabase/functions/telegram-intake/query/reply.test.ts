import assert from 'node:assert/strict'
import test from 'node:test'

import { formatQueryReply } from './reply.ts'
import type { QueryResult, ResolvedPeriod } from './types.ts'

const PERIOD_1_10_AUG: ResolvedPeriod = { from: '2026-08-01', to: '2026-08-10', label: '1–10 Aug' }
const PERIOD_JULY: ResolvedPeriod = { from: '2026-07-01', to: '2026-07-31', label: 'Jul' }
const PERIOD_1_17_AUG: ResolvedPeriod = { from: '2026-08-01', to: '2026-08-17', label: '1–17 Aug' }

test('category_spend: the given example template', () => {
  const result: QueryResult = { q: 'category_spend', category: 'Groceries', amountAed: 1240, count: 14, unconvertedCount: 0, period: PERIOD_1_10_AUG }
  // 1240 / 14 = 88.57 — the task description's "89 AED" was an illustrative rounding, not exact.
  assert.equal(formatQueryReply(result), 'Groceries, 1–10 Aug: 1,240 AED\n14 transactions · avg 88.57 AED')
})

test('category_spend: zero result reads as a plain sentence, not an error', () => {
  const result: QueryResult = { q: 'category_spend', category: 'Groceries', amountAed: 0, count: 0, unconvertedCount: 0, period: PERIOD_1_17_AUG }
  assert.equal(formatQueryReply(result), 'Nothing logged for Groceries in 1–17 Aug yet.')
})

test('category_spend: an owner-scoped query names the owner', () => {
  const result: QueryResult = { q: 'category_spend', category: 'Dining Out', owner: 'Shrey', amountAed: 84, count: 1, unconvertedCount: 0, period: PERIOD_1_17_AUG }
  assert.equal(formatQueryReply(result), 'Dining Out (Shrey), 1–17 Aug: 84 AED\n1 transaction · avg 84 AED')
})

test('total_spend: the given example template, including the excluded-savings footer', () => {
  const result: QueryResult = { q: 'total_spend', amountAed: 6410, count: 40, unconvertedCount: 0, excludedSavingsAed: 2000, period: { from: '2026-08-01', to: '2026-08-31', label: 'August' } }
  assert.equal(formatQueryReply(result), 'Total spend, August: 6,410 AED\n40 transactions · avg 160.25 AED\n(excludes 2,000 AED into Savings & Investments)')
})

test('total_spend: no footer when nothing was excluded', () => {
  const result: QueryResult = { q: 'total_spend', amountAed: 500, count: 5, unconvertedCount: 0, excludedSavingsAed: 0, period: PERIOD_JULY }
  assert.equal(formatQueryReply(result), 'Total spend, Jul: 500 AED\n5 transactions · avg 100 AED')
})

test('total_spend: zero result', () => {
  const result: QueryResult = { q: 'total_spend', amountAed: 0, count: 0, unconvertedCount: 0, excludedSavingsAed: 0, period: PERIOD_1_17_AUG }
  assert.equal(formatQueryReply(result), 'Nothing logged in 1–17 Aug yet.')
})

test('merchant_spend: the given example template', () => {
  const result: QueryResult = { q: 'merchant_spend', merchant: 'Carrefour', amountAed: 840, count: 6, unconvertedCount: 0, period: PERIOD_JULY }
  assert.equal(formatQueryReply(result), 'Matching "Carrefour" in Jul: 840 AED across 6 transactions\n(matched on the note text)')
})

test('merchant_spend: zero result still carries the note-text caveat', () => {
  const result: QueryResult = { q: 'merchant_spend', merchant: 'Lulu', amountAed: 0, count: 0, unconvertedCount: 0, period: PERIOD_JULY }
  assert.equal(formatQueryReply(result), 'Nothing matching "Lulu" in Jul yet.\n(matched on the note text)')
})

test('account_spend: ok status reads like category_spend', () => {
  const result: QueryResult = { q: 'account_spend', status: 'ok', account: 'ENBD Credit Card 4412', amountAed: 320, count: 4, unconvertedCount: 0, period: PERIOD_1_17_AUG }
  assert.equal(formatQueryReply(result), 'ENBD Credit Card 4412, 1–17 Aug: 320 AED\n4 transactions · avg 80 AED')
})

test('account_spend: zero result', () => {
  const result: QueryResult = { q: 'account_spend', status: 'ok', account: 'Joint Current', amountAed: 0, count: 0, unconvertedCount: 0, period: PERIOD_1_17_AUG }
  assert.equal(formatQueryReply(result), 'Nothing logged on Joint Current in 1–17 Aug yet.')
})

test('account_spend: a tie asks a clarifying question naming both candidates', () => {
  const result: QueryResult = { q: 'account_spend', status: 'needs_clarification', candidates: ['Car Down-Payment EMI (ENBD Noon CC ...1657)', 'Mobile EMI (ENBD Noon CC ...1657)'] }
  assert.equal(
    formatQueryReply(result),
    'Which account did you mean — Car Down-Payment EMI (ENBD Noon CC ...1657), Mobile EMI (ENBD Noon CC ...1657)?'
  )
})

test('recent_transactions: newest-first rows, flagged needs_review', () => {
  const result: QueryResult = {
    q: 'recent_transactions',
    rows: [
      { date: '2026-08-17', amount: 84, amountAed: 84, currency: 'AED', category: 'Dining Out', note: 'Karak House', owner: 'Shrey', needsReview: true },
      { date: '2026-08-16', amount: 45, amountAed: 45, currency: 'AED', category: 'Groceries', note: 'Carrefour', owner: 'Tarika', needsReview: false },
    ],
  }
  const reply = formatQueryReply(result)
  assert.equal(
    reply,
    ['Recent transactions:', '⚠️ Mon 17 Aug · Dining Out · 84 AED · Karak House', 'Sun 16 Aug · Groceries · 45 AED · Carrefour'].join('\n')
  )
})

test('recent_transactions: zero result', () => {
  const result: QueryResult = { q: 'recent_transactions', rows: [] }
  assert.equal(formatQueryReply(result), 'Nothing logged yet.')
})

test('recent_transactions: an unconverted row still shows its real amount, in its own currency', () => {
  const result: QueryResult = {
    q: 'recent_transactions',
    rows: [{ date: '2026-08-17', amount: 20, amountAed: null, currency: 'GBP', category: 'Groceries', note: 'Waitrose', owner: 'Shrey', needsReview: false }],
  }
  assert.equal(formatQueryReply(result), 'Recent transactions:\nMon 17 Aug · Groceries · 20 GBP (unconverted) · Waitrose')
})

test('recent_transactions: an owner-scoped query names the owner in the header', () => {
  const result: QueryResult = { q: 'recent_transactions', owner: 'Tarika', rows: [] }
  assert.equal(formatQueryReply(result), 'Nothing logged (Tarika) yet.')
})

test('budget_status: dispatches to query/budget.ts (full grid and single category alike — see budget.test.ts for the formatting itself)', () => {
  const rows = [{ category: 'Groceries', limitAed: 1800, spentAed: 1510 }]
  const grid: QueryResult = { q: 'budget_status', rows, period: PERIOD_1_10_AUG, isCurrentMonth: true }
  assert.match(formatQueryReply(grid), /Budget — 1–10 Aug/)

  const single: QueryResult = { q: 'budget_status', category: 'Groceries', rows, period: PERIOD_1_10_AUG, isCurrentMonth: true }
  assert.match(formatQueryReply(single), /Groceries — 1–10 Aug/)
})

test('net_worth: dispatches to query/networth.ts (see networth.test.ts for the formatting itself)', () => {
  const result: QueryResult = {
    q: 'net_worth',
    asOf: '2026-08-17',
    totalAed: 335533,
    assetsAed: 462058,
    liabilitiesAed: 126525,
    byOwner: { Shrey: 290333, Tarika: 45200 },
  }
  assert.match(formatQueryReply(result), /Net worth: 335,533 AED/)
})

test('goal_progress: dispatches to query/goals.ts (see goals.test.ts for the formatting itself)', () => {
  const result: QueryResult = {
    q: 'goal_progress',
    status: 'needs_clarification',
    candidates: ['Emergency Fund', 'Car Loan'],
  }
  assert.match(formatQueryReply(result), /Which goal did you mean/)
})
