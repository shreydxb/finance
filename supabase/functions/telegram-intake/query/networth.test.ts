// Taskiv #55: net-worth formatting. Named cases from the task: a single-row
// store (insufficient history for a compare), a multi-row store (delta
// computed correctly), and a missing owner key (omitted, never reported as
// zero). The one invariant that must never regress: a `compare` whose
// baseline predates the earliest recorded row is 'unavailable', never an
// interpolated or otherwise fabricated delta.

import assert from 'node:assert/strict'
import test from 'node:test'

import { formatNetWorthReply } from './networth.ts'
import type { NetWorthResult } from './types.ts'

const BASE: NetWorthResult = {
  asOf: '2026-08-17',
  totalAed: 335533,
  assetsAed: 462058,
  liabilitiesAed: 126525,
  byOwner: { Shrey: 290333, Tarika: 45200 },
}

test('full household reply: total, assets/liabilities, per-owner breakdown, as-of date', () => {
  const text = formatNetWorthReply(undefined, BASE)
  assert.match(text, /^Net worth: 335,533 AED/)
  assert.match(text, /Assets 462,058 · Liabilities 126,525/)
  assert.match(text, /Shrey 290,333 · Tarika 45,200/)
  assert.match(text, /As of Mon 17 Aug\.$/)
})

test('a household with no by_owner entries omits the per-owner line entirely', () => {
  const text = formatNetWorthReply(undefined, { ...BASE, byOwner: {} })
  assert.doesNotMatch(text, /Shrey|Tarika/)
})

test('owner-scoped reply reads the owner total from by_owner, not a recomputation', () => {
  const text = formatNetWorthReply('Tarika', BASE)
  assert.match(text, /^Tarika's net worth: 45,200 AED/)
  assert.doesNotMatch(text, /Shrey/)
})

test('a missing owner key is a plain "no accounts yet" answer, never a reported 0', () => {
  const text = formatNetWorthReply('Tarika', { ...BASE, byOwner: { Shrey: 290333 } })
  assert.equal(text, "I don't have any accounts recorded for Tarika yet.")
})

test('no snapshot ever recorded (empty asOf) is an honest answer, not a crash on formatDate', () => {
  const text = formatNetWorthReply(undefined, { asOf: '', totalAed: 0, assetsAed: 0, liabilitiesAed: 0, byOwner: {} })
  assert.equal(text, "I don't have a net worth snapshot recorded yet.")
})

test('a computed delta (multi-row store, baseline before the period) folds into the headline', () => {
  const result: NetWorthResult = {
    ...BASE,
    change: { kind: 'delta', fromDay: '2026-07-25', fromAed: 300000, deltaAed: 35533, deltaPct: 11.84, periodLabel: '1–17 Aug' },
  }
  const text = formatNetWorthReply(undefined, result)
  assert.match(text, /^Net worth: 335,533 AED {2}\(\+35,533 1–17 Aug, \+11\.8%\)/)
})

test('a negative delta shows a minus sign on both figures, not a stray double-negative', () => {
  const result: NetWorthResult = {
    ...BASE,
    change: { kind: 'delta', fromDay: '2026-07-25', fromAed: 350000, deltaAed: -14467, deltaPct: -4.13, periodLabel: '1–17 Aug' },
  }
  const text = formatNetWorthReply(undefined, result)
  assert.match(text, /^Net worth: 335,533 AED {2}\(-14,467 1–17 Aug, -4\.1%\)/)
})

test('single-row store: insufficient history reports the honest refusal, never a guessed delta', () => {
  const result: NetWorthResult = {
    ...BASE,
    change: { kind: 'unavailable', earliestDay: '2026-08-09' },
  }
  const text = formatNetWorthReply(undefined, result)
  assert.match(text, /I only have history back to Sun 9 Aug, so I can't show a change for that period yet\./)
  assert.doesNotMatch(text, /\+|-\d/) // no fabricated delta anywhere in the reply
})

test('owner-scoped reply with an unavailable compare still names the owner, not the household', () => {
  const result: NetWorthResult = {
    ...BASE,
    change: { kind: 'unavailable', earliestDay: '2026-08-09' },
  }
  const text = formatNetWorthReply('Shrey', result)
  assert.match(text, /^Shrey's net worth: 290,333 AED/)
  assert.match(text, /I only have history back to Sun 9 Aug/)
})
