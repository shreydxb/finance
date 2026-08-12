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
  sumByOwnerAED,
  totalAED,
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

test('a USD transfer is excluded before conversion, not after', () => {
  const rows = [
    { date: '2026-08-01', amount: 100, currency: 'AED', category: 'Groceries', owner: 'Shrey', note: 'a' },
    { date: '2026-08-01', amount: 100, currency: 'USD', category: 'Transfer', owner: 'Shrey', note: 'move' },
  ]

  assert.equal(totalAED(rows, FX), 100)
})
