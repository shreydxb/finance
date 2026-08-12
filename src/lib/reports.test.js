// First tests for the frontend money calculations. The Edge Function suite has
// had good coverage for a while; everything under src/ had none, which is how a
// transfer came to be counted as spending in three separate reports.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isSpend,
  monthlyTrend,
  sumByCategoryAED,
  sumByGroupAED,
  sumByMerchantAED,
  sortByAmountAED,
  sumByOwnerAED,
  totalAED,
  transactionStats,
} from './reports.js'

// "AED per 1 unit of X" — the convention fx_rates uses in settings.
const FX = { AED: 1, USD: 3.6725, INR: 0.044 }

/**
 * A transfer between the household's own accounts, as the Telegram bot writes
 * it: two positive rows in the Transfer category. This is the shape that was
 * inflating merchant/trend/owner totals by twice the transfer amount.
 */
const TRANSFER = [
  { date: '2026-08-10', amount: 500, currency: 'AED', category: 'Transfer', owner: 'Shrey', note: 'To Emergency Fund' },
  { date: '2026-08-10', amount: 500, currency: 'AED', category: 'Transfer', owner: 'Shrey', note: 'From Joint' },
]

const SPEND = [
  { date: '2026-08-09', amount: 120, currency: 'AED', category: 'Groceries', owner: 'Shrey', note: 'Carrefour' },
  { date: '2026-08-09', amount: 80, currency: 'AED', category: 'Dining Out', owner: 'Tarika', note: 'Cafe' },
]

test('isSpend rejects transfers and accepts everything else', () => {
  assert.equal(isSpend({ category: 'Transfer' }), false)
  assert.equal(isSpend({ category: 'Groceries' }), true)
  assert.equal(isSpend({ category: null }), true)
})

test('a transfer is excluded from every spend total', () => {
  const all = [...SPEND, ...TRANSFER]
  const groups = new Map([['Groceries', 'Needs'], ['Dining Out', 'Wants']])

  // Each of these is computed twice: once over spend alone, once with the
  // transfer's two rows added. A transfer must not move any of them.
  assert.equal(totalAED(all, FX), totalAED(SPEND, FX), 'totalAED')

  assert.deepEqual(sumByCategoryAED(all, FX), sumByCategoryAED(SPEND, FX), 'sumByCategoryAED')
  assert.deepEqual(sumByGroupAED(all, FX, groups), sumByGroupAED(SPEND, FX, groups), 'sumByGroupAED')

  // The three that were missing the guard.
  assert.deepEqual(sumByMerchantAED(all, FX), sumByMerchantAED(SPEND, FX), 'sumByMerchantAED')
  assert.deepEqual(sumByOwnerAED(all, FX), sumByOwnerAED(SPEND, FX), 'sumByOwnerAED')
  assert.deepEqual(
    monthlyTrend(all, FX, 1, new Date(2026, 7, 15)),
    monthlyTrend(SPEND, FX, 1, new Date(2026, 7, 15)),
    'monthlyTrend'
  )
})

test('a transfer contributes no merchant row of its own', () => {
  const merchants = sumByMerchantAED([...SPEND, ...TRANSFER], FX)
  assert.equal(merchants.has('To Emergency Fund'), false)
  assert.equal(merchants.has('From Joint'), false)
  assert.equal(merchants.get('Carrefour'), 120)
})

test('a transfer does not appear against an owner', () => {
  const byOwner = sumByOwnerAED([...SPEND, ...TRANSFER], FX)
  // Shrey spent 120, not 1120.
  assert.equal(byOwner.get('Shrey'), 120)
  assert.equal(byOwner.get('Tarika'), 80)
})

test('the monthly trend for a transfer-only month is zero, not the transfer amount', () => {
  const trend = monthlyTrend(TRANSFER, FX, 1, new Date(2026, 7, 15))
  assert.equal(trend[0].value, 0)
})

// ── mixed currency ───────────────────────────────────────────────────────────

test('totals normalise mixed currencies through the AED pivot', () => {
  const mixed = [
    { date: '2026-08-01', amount: 100, currency: 'AED', category: 'Groceries', owner: 'Shrey', note: 'a' },
    { date: '2026-08-01', amount: 100, currency: 'USD', category: 'Groceries', owner: 'Shrey', note: 'b' },
    { date: '2026-08-01', amount: 100, currency: 'INR', category: 'Groceries', owner: 'Shrey', note: 'c' },
  ]

  assert.equal(totalAED(mixed, FX), 100 + 100 * 3.6725 + 100 * 0.044)
})

// ── MONEY-04: stats must not compare raw amounts across currencies ───────────

test('largest is the biggest in AED, not the biggest raw number', () => {
  // INR 1,000 is worth ~44 AED; USD 100 is worth ~367. Comparing the stored
  // numbers ranked the rupee row highest.
  const rows = [
    { date: '2026-08-01', amount: 1000, currency: 'INR', category: 'Shopping', owner: 'S', note: 'a' },
    { date: '2026-08-02', amount: 100, currency: 'USD', category: 'Shopping', owner: 'S', note: 'b' },
  ]

  const stats = transactionStats(rows, FX)
  assert.equal(stats.largest, 100 * 3.6725)
  assert.notEqual(stats.largest, 1000, 'the raw rupee amount must not win')
})

test('average is computed in AED', () => {
  const rows = [
    { date: '2026-08-01', amount: 100, currency: 'AED', category: 'Shopping', owner: 'S', note: 'a' },
    { date: '2026-08-02', amount: 100, currency: 'USD', category: 'Shopping', owner: 'S', note: 'b' },
  ]

  assert.equal(transactionStats(rows, FX).average, (100 + 367.25) / 2)
})

test('stats over an empty set stay at zero', () => {
  assert.deepEqual(transactionStats([], FX), { count: 0, largest: 0, average: 0, first: null, last: null })
})

test('a missing rate makes the stats unavailable rather than wrong', () => {
  const rows = [{ date: '2026-08-01', amount: 100, currency: 'USD', category: 'Shopping', owner: 'S', note: 'a' }]
  const stats = transactionStats(rows, { AED: 1 })
  assert.ok(Number.isNaN(stats.largest))
  assert.ok(Number.isNaN(stats.average))
})

test('sorting by amount orders by AED value, not by the stored number', () => {
  const rows = [
    { date: '2026-08-01', amount: 1000, currency: 'INR', category: 'Shopping', owner: 'S', note: 'rupees' },
    { date: '2026-08-02', amount: 100, currency: 'USD', category: 'Shopping', owner: 'S', note: 'dollars' },
    { date: '2026-08-03', amount: 200, currency: 'AED', category: 'Shopping', owner: 'S', note: 'dirhams' },
  ]

  // 100 USD = 367.25, 200 AED = 200, 1000 INR = 44.
  assert.deepEqual(
    sortByAmountAED(rows, FX).map((t) => t.note),
    ['dollars', 'dirhams', 'rupees']
  )
})

test('sorting does not mutate the input and puts unconvertible rows last', () => {
  const rows = [
    { date: '2026-08-01', amount: 5, currency: 'USD', category: 'Shopping', owner: 'S', note: 'no rate' },
    { date: '2026-08-02', amount: 10, currency: 'AED', category: 'Shopping', owner: 'S', note: 'convertible' },
  ]
  const before = rows.map((t) => t.note)

  const sorted = sortByAmountAED(rows, { AED: 1 })
  assert.deepEqual(sorted.map((t) => t.note), ['convertible', 'no rate'])
  assert.deepEqual(rows.map((t) => t.note), before, 'input is untouched')
})

test('a USD transfer is excluded before conversion, not after', () => {
  const rows = [
    { date: '2026-08-01', amount: 100, currency: 'AED', category: 'Groceries', owner: 'Shrey', note: 'a' },
    { date: '2026-08-01', amount: 100, currency: 'USD', category: 'Transfer', owner: 'Shrey', note: 'move' },
  ]

  assert.equal(totalAED(rows, FX), 100)
})
