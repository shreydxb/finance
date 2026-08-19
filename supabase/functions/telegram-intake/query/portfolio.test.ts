// Taskiv #58: portfolio summary + needs-review count. Fixtures named by the
// task: null last_price, a metals row with no ticker, an INR Zerodha row,
// and mixed owners — plus the two invariants that must never regress: no
// NaN from a missing avg_cost/last_price, and cost basis is derived as
// valueAed - gainAed, not summed from each holding independently.

import assert from 'node:assert/strict'
import test from 'node:test'

import { computePortfolioSummary, formatNeedsReviewCountReply, formatPortfolioSummaryReply } from './portfolio.ts'
import type { InvestmentHolding } from './types.ts'

const FX = { AED: 1, USD: 3.6725, INR: 0.044 }

function holding(overrides: Partial<InvestmentHolding>): InvestmentHolding {
  return {
    id: 'h1',
    name: 'Test Holding',
    ticker: null,
    quantity: null,
    avgCost: null,
    lastPrice: null,
    value: 1000,
    currency: 'AED',
    owner: 'Shrey',
    priceUpdatedAt: null,
    ...overrides,
  }
}

// -- named fixture: an INR Zerodha row --

test('an INR Zerodha row (ticker, quantity, avg_cost, last_price all present) computes gain like the screen', () => {
  const h = holding({
    name: 'NETWEB', ticker: 'NETWEB', quantity: 15, avgCost: 4007.88, lastPrice: 5212.4, value: 78186, currency: 'INR',
    priceUpdatedAt: '2026-08-17T18:27:56Z',
  })
  const result = computePortfolioSummary([h], undefined, FX)
  const costNative = 15 * 4007.88 // 60118.2
  const gainNative = 78186 - costNative
  assert.equal(Math.round(result.gainAed), Math.round(gainNative * 0.044))
  assert.equal(result.tickerPricedCount, 1)
  assert.equal(result.manualCount, 0)
})

// -- named fixture: a metals row with no ticker --

test('a metals row (no ticker, null last_price, but a real quantity/avg_cost) still computes a real cost basis', () => {
  const gold = holding({ name: 'Gold (XAU/USD)', ticker: null, quantity: 1.23244, avgCost: 4177.08, lastPrice: null, value: 5350.9, currency: 'USD' })
  const result = computePortfolioSummary([gold], undefined, FX)
  // Cost basis and gain never depend on last_price — only quantity * avg_cost vs value.
  const costNative = 1.23244 * 4177.08
  const gainNative = 5350.9 - costNative
  assert.equal(Math.round(result.gainAed), Math.round(gainNative * 3.6725))
  assert.equal(result.manualCount, 1) // no ticker -> manual, regardless of null last_price
  assert.equal(result.tickerPricedCount, 0)
})

// -- named fixture: null last_price (does not crash into NaN) --

test('null last_price never produces NaN anywhere in value/cost/gain', () => {
  const h = holding({ ticker: null, quantity: 1, avgCost: 100, lastPrice: null, value: 120, currency: 'AED' })
  const result = computePortfolioSummary([h], undefined, FX)
  for (const n of [result.valueAed, result.costAed, result.gainAed]) {
    assert.ok(Number.isFinite(n), `expected a finite number, got ${n}`)
  }
})

// -- named fixture: mixed owners --

test('mixed owners: byOwner splits value correctly, only for the combined (no filter) view', () => {
  const shrey = holding({ owner: 'Shrey', value: 100000, currency: 'AED' })
  const tarika = holding({ owner: 'Tarika', value: 50000, currency: 'AED' })
  const combined = computePortfolioSummary([shrey, tarika], undefined, FX)
  assert.deepEqual(combined.byOwner, { Shrey: 100000, Tarika: 50000 })

  const filtered = computePortfolioSummary([shrey, tarika], 'Shrey', FX)
  assert.equal(filtered.holdingsCount, 1)
  assert.deepEqual(filtered.byOwner, {}) // no per-owner breakdown once already filtered to one owner
  assert.equal(filtered.owner, 'Shrey')
})

// -- edge cases --

test('a holding with no avg_cost/quantity contributes 0 gain, but its full value still counts toward cost basis', () => {
  const noCost = holding({ quantity: null, avgCost: null, value: 1000, currency: 'AED' })
  const result = computePortfolioSummary([noCost], undefined, FX)
  assert.equal(result.gainAed, 0)
  assert.equal(result.valueAed, 1000)
  assert.equal(result.costAed, 1000) // valueAed - gainAed, mirroring Investments.jsx's totalCost formula exactly
})

test('an unconvertible currency is excluded from every total, not silently 1:1 or NaN', () => {
  const gbp = holding({ currency: 'GBP', value: 500, quantity: 1, avgCost: 400 })
  const aed = holding({ id: 'h2', currency: 'AED', value: 1000, quantity: 1, avgCost: 800 })
  const result = computePortfolioSummary([gbp, aed], undefined, FX)
  assert.equal(result.unconvertedCount, 1)
  assert.equal(result.valueAed, 1000) // only the AED holding
})

test('gainPct is null (not a divide-by-zero) when the derived cost basis is zero or negative', () => {
  const noCost = holding({ quantity: null, avgCost: null, value: 0, currency: 'AED' })
  const result = computePortfolioSummary([noCost], undefined, FX)
  assert.equal(result.gainPct, null)
})

test('zero holdings reads as a plain sentence, not a crash', () => {
  const result = computePortfolioSummary([], undefined, FX)
  assert.equal(result.holdingsCount, 0)
  assert.equal(formatPortfolioSummaryReply(result), "You don't have any investment holdings yet.")
})

test('zero holdings for a filtered owner names them specifically', () => {
  const result = computePortfolioSummary([], 'Tarika', FX)
  assert.equal(formatPortfolioSummaryReply(result), 'Tarika has no investment holdings.')
})

// -- freshness line --

test('freshness reads the latest price_updated_at among ticker-priced holdings only, ignoring manual ones', () => {
  const older = holding({ id: 'a', ticker: 'AAA', quantity: 1, currency: 'USD', priceUpdatedAt: '2026-08-10T00:00:00Z' })
  const newer = holding({ id: 'b', ticker: 'BBB', quantity: 1, currency: 'INR', priceUpdatedAt: '2026-08-17T18:27:56Z' })
  const manual = holding({ id: 'c', ticker: null, quantity: 1, avgCost: 1, priceUpdatedAt: '2026-08-19T00:00:00Z' }) // later, but manual — must not win
  const result = computePortfolioSummary([older, newer, manual], undefined, FX)
  assert.equal(result.latestPriceUpdate, '2026-08-17T18:27:56Z')
  const text = formatPortfolioSummaryReply(result)
  assert.match(text, /Prices last refreshed: .*2 ticker-priced; 1 valued manually/)
})

test('all-manual portfolio (no ticker-priced holdings at all) states that plainly, never a fake refresh date', () => {
  const manual = holding({ ticker: null, quantity: 1, avgCost: 1 })
  const result = computePortfolioSummary([manual], undefined, FX)
  const text = formatPortfolioSummaryReply(result)
  assert.match(text, /All holdings are valued manually/)
})

// -- the given full reply shape --

test('the full reply shape: value, cost basis, unrealised with sign and percentage, owner split', () => {
  const shrey = holding({ id: 's', owner: 'Shrey', quantity: 10, avgCost: 100, value: 1500, currency: 'AED' })
  const tarika = holding({ id: 't', owner: 'Tarika', quantity: 10, avgCost: 100, value: 800, currency: 'AED' })
  const result = computePortfolioSummary([shrey, tarika], undefined, FX)
  const text = formatPortfolioSummaryReply(result)
  assert.match(text, /^Portfolio — combined/)
  assert.match(text, /Value {8}2,300 AED/)
  assert.match(text, /Cost basis {3}2,000 AED/)
  assert.match(text, /Unrealised {3}\+300 {2}\(\+15\.0%\)/)
  assert.match(text, /Shrey 1,500 · Tarika 800/)
})

test('a net loss shows a minus sign, not a stray double-negative', () => {
  const h = holding({ quantity: 10, avgCost: 200, value: 1500, currency: 'AED' })
  const result = computePortfolioSummary([h], undefined, FX)
  const text = formatPortfolioSummaryReply(result)
  assert.match(text, /Unrealised {3}-500 {2}\(-25\.0%\)/)
})

// -- needs_review_count --

test('needs_review_count: zero reads as "all clean"', () => {
  assert.equal(formatNeedsReviewCountReply(0), 'Nothing flagged. All clean.')
})

test('needs_review_count: one is grammatically singular', () => {
  assert.equal(formatNeedsReviewCountReply(1), '1 transaction needs a look.\nSend /review to go through them.')
})

test('needs_review_count: plural count', () => {
  assert.equal(formatNeedsReviewCountReply(3), '3 transactions need a look.\nSend /review to go through them.')
})
