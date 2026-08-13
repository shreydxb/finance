// MONEY-01: a missing FX rate must never produce a money figure.
//
// The old behaviour substituted 1 for an unknown rate, so 100 USD displayed as
// "AED 100" — a wrong number indistinguishable from a right one. These tests
// pin the fail-visible replacement.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  convert,
  formatMoney,
  fromAED,
  isRateAvailable,
  missingCurrencies,
  toAED,
  UNAVAILABLE,
} from './money.js'

const FX = { AED: 1, USD: 3.6725, INR: 0.044 }
const PARTIAL = { AED: 1, INR: 0.044 } // USD rate never loaded

// ── rate availability ────────────────────────────────────────────────────────

test('AED is always available, as the pivot', () => {
  assert.equal(isRateAvailable('AED', {}), true)
  assert.equal(isRateAvailable('AED', null), true)
})

test('a rate that is missing, zero, negative or non-finite is not available', () => {
  assert.equal(isRateAvailable('USD', {}), false)
  assert.equal(isRateAvailable('USD', { USD: 0 }), false)
  assert.equal(isRateAvailable('USD', { USD: -3 }), false)
  assert.equal(isRateAvailable('USD', { USD: NaN }), false)
  assert.equal(isRateAvailable('USD', { USD: Infinity }), false)
  assert.equal(isRateAvailable('USD', { USD: '3.67' }), false, 'a string is not a rate')
  assert.equal(isRateAvailable('USD', null), false)
})

test('a real rate is available', () => {
  assert.equal(isRateAvailable('USD', FX), true)
})

// ── conversion refuses to guess ──────────────────────────────────────────────

test('toAED converts with a known rate', () => {
  assert.equal(toAED(100, 'USD', FX), 367.25)
  assert.equal(toAED(100, 'AED', FX), 100)
})

test('toAED returns NaN rather than treating a missing rate as 1:1', () => {
  // The regression: this used to return 100, rendering 100 USD as "AED 100".
  assert.ok(Number.isNaN(toAED(100, 'USD', PARTIAL)))
  assert.ok(Number.isNaN(toAED(100, 'USD', {})))
  assert.ok(Number.isNaN(toAED(100, 'GBP', FX)), 'an unknown currency is not AED')
})

test('a zero rate is not treated as a missing key and silently passed through', () => {
  assert.ok(Number.isNaN(toAED(100, 'USD', { AED: 1, USD: 0 })))
})

test('convert and fromAED refuse an unknown rate in either direction', () => {
  assert.ok(Number.isNaN(convert(100, 'USD', 'INR', PARTIAL)))
  assert.ok(Number.isNaN(convert(100, 'INR', 'USD', PARTIAL)))
  assert.ok(Number.isNaN(fromAED(100, 'USD', PARTIAL)))

  assert.equal(convert(100, 'USD', 'USD', {}), 100, 'same currency needs no rate')
})

test('an unconvertible amount poisons any total it enters', () => {
  // NaN is contagious on purpose: one unknown rate must invalidate the sum
  // rather than quietly under-counting it.
  const total = [toAED(100, 'AED', PARTIAL), toAED(50, 'USD', PARTIAL)].reduce((a, b) => a + b, 0)
  assert.ok(Number.isNaN(total))
})

// ── formatting is the last line of defence ───────────────────────────────────

test('formatMoney renders an unconvertible figure as unavailable, not as zero', () => {
  // `Number(x) || 0` used to turn NaN into a confident "AED 0".
  assert.equal(formatMoney(NaN, 'AED'), UNAVAILABLE)
  assert.equal(formatMoney(Infinity, 'AED'), UNAVAILABLE)
  assert.equal(formatMoney(undefined, 'AED'), UNAVAILABLE)
})

test('formatMoney still formats real figures, including zero and negatives', () => {
  assert.equal(formatMoney(0, 'AED'), 'AED 0')
  assert.equal(formatMoney(1200, 'USD'), '$1,200')
  assert.equal(formatMoney(-1200, 'USD'), '-$1,200', 'sign leads the symbol')
})

// ── reporting which rates are missing ────────────────────────────────────────

test('missingCurrencies names exactly what cannot be shown', () => {
  assert.deepEqual(missingCurrencies(['AED', 'USD', 'INR'], PARTIAL), ['USD'])
  assert.deepEqual(missingCurrencies(['AED', 'USD', 'INR'], FX), [])
  assert.deepEqual(missingCurrencies(['USD', 'USD'], PARTIAL), ['USD'], 'deduplicated')
  assert.deepEqual(missingCurrencies([null, undefined, 'AED'], FX), [], 'ignores empty currencies')
})
