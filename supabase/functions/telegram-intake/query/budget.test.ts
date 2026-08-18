// Taskiv #54: budget-vs-actual formatting. Every case here is one the task
// names explicitly — full grid, single category, no-budget category, zero
// spend, over budget — plus the two invariants that must never regress: an
// unbudgeted category never reads as over budget, and a zero/null limit
// never divides by zero.

import assert from 'node:assert/strict'
import test from 'node:test'

import { classify, formatBudgetStatusReply, partitionAndClassify } from './budget.ts'
import type { CategoryBudgetRow, ResolvedPeriod } from './types.ts'

const THIS_MONTH: ResolvedPeriod = { from: '2026-08-01', to: '2026-08-10', label: '1–10 Aug' }
const LAST_MONTH: ResolvedPeriod = { from: '2026-07-01', to: '2026-07-31', label: 'Jul' }

test('classify: over, close and on-track thresholds', () => {
  assert.equal(classify({ category: 'Dining Out', limitAed: 1000, spentAed: 1240 }).bucket, 'over')
  assert.equal(classify({ category: 'Groceries', limitAed: 1800, spentAed: 1510 }).bucket, 'close') // 84%
  assert.equal(classify({ category: 'Transport', limitAed: 600, spentAed: 310 }).bucket, 'on_track') // 52%
  assert.equal(classify({ category: 'Utilities', limitAed: 900, spentAed: 720 }).bucket, 'close') // exactly 80%
})

test('partitionAndClassify: a null limit and a zero limit are both unbudgeted, never over budget', () => {
  const rows: CategoryBudgetRow[] = [
    { category: 'Clothing', limitAed: null, spentAed: 340 },
    { category: 'Gifts', limitAed: 0, spentAed: 50 },
    { category: 'Groceries', limitAed: 1800, spentAed: 1510 },
  ]
  const { classified, unbudgeted } = partitionAndClassify(rows)
  assert.equal(classified.length, 1)
  assert.equal(classified[0].category, 'Groceries')
  assert.deepEqual(unbudgeted.map((r) => r.category).sort(), ['Clothing', 'Gifts'])
})

test('full grid: groups by status, sorted by percentage descending within each group', () => {
  const rows: CategoryBudgetRow[] = [
    { category: 'Dining Out', limitAed: 1000, spentAed: 1240 }, // over, 124%
    { category: 'Groceries', limitAed: 1800, spentAed: 1510 }, // close, 84%
    { category: 'Transport', limitAed: 600, spentAed: 310 }, // on track, 52%
    { category: 'Utilities', limitAed: 900, spentAed: 480 }, // on track, 53%
    { category: 'Clothing', limitAed: null, spentAed: 340 }, // unbudgeted
  ]
  const reply = formatBudgetStatusReply(undefined, rows, THIS_MONTH, true)

  assert.match(reply, /Over\n {2}Dining Out.*124%/)
  assert.match(reply, /Close\n {2}Groceries.*84%/)
  // Utilities (53%) sorts above Transport (52%) within "On track".
  const onTrackIndex = reply.indexOf('On track')
  const utilitiesIndex = reply.indexOf('Utilities', onTrackIndex)
  const transportIndex = reply.indexOf('Transport', onTrackIndex)
  assert.ok(utilitiesIndex < transportIndex, 'higher percentage sorts first within the bucket')
  assert.match(reply, /No budget set: Clothing/)
  assert.match(reply, /Unbudgeted spend this month: 340 AED/)
})

test('full grid: an unbudgeted category never appears in Over/Close/On track', () => {
  const rows: CategoryBudgetRow[] = [{ category: 'Medical', limitAed: null, spentAed: 5000 }]
  const reply = formatBudgetStatusReply(undefined, rows, THIS_MONTH, true)
  assert.doesNotMatch(reply, /Over/)
  assert.doesNotMatch(reply, /Close/)
  assert.match(reply, /No budget set: Medical/)
})

test('full grid: caps at 15 rows and names how many more', () => {
  const rows: CategoryBudgetRow[] = Array.from({ length: 18 }, (_, i) => ({
    category: `Category ${i}`,
    limitAed: 100,
    spentAed: 90 - i, // strictly descending so ordering is deterministic
  }))
  const reply = formatBudgetStatusReply(undefined, rows, THIS_MONTH, true)
  assert.match(reply, /\+3 more — see the Budget tab/)
})

test('full grid: shows the current-month day count only when isCurrentMonth is true', () => {
  const rows: CategoryBudgetRow[] = [{ category: 'Groceries', limitAed: 1800, spentAed: 1510 }]
  const withDays = formatBudgetStatusReply(undefined, rows, THIS_MONTH, true)
  assert.match(withDays, /10 days in, 21 left/)
  const withoutDays = formatBudgetStatusReply(undefined, rows, LAST_MONTH, false)
  assert.doesNotMatch(withoutDays, /days in/)
})

test('single category: over budget', () => {
  const rows: CategoryBudgetRow[] = [{ category: 'Dining Out', limitAed: 1000, spentAed: 1240 }]
  const reply = formatBudgetStatusReply('Dining Out', rows, THIS_MONTH, true)
  assert.match(reply, /Dining Out — 1–10 Aug/)
  assert.match(reply, /1,240 of 1,000 AED · 0 left · 124%/)
  assert.doesNotMatch(reply, /days left/, 'no daily pace once already over budget')
})

test('single category: on track, with the daily-pace line', () => {
  const rows: CategoryBudgetRow[] = [{ category: 'Groceries', limitAed: 1800, spentAed: 1510 }]
  const reply = formatBudgetStatusReply('Groceries', rows, THIS_MONTH, true)
  assert.match(reply, /1,510 of 1,800 AED · 290 left · 84%/)
  assert.match(reply, /21 days left, ~13.81\/day to stay inside\./)
})

test('single category: no daily-pace line when the period is not the current month', () => {
  const rows: CategoryBudgetRow[] = [{ category: 'Groceries', limitAed: 1800, spentAed: 1510 }]
  const reply = formatBudgetStatusReply('Groceries', rows, LAST_MONTH, false)
  assert.doesNotMatch(reply, /days left/)
})

test('single category: no budget set for that category, but spend exists', () => {
  const rows: CategoryBudgetRow[] = [{ category: 'Clothing', limitAed: null, spentAed: 340 }]
  const reply = formatBudgetStatusReply('Clothing', rows, THIS_MONTH, true)
  assert.equal(reply, 'No budget set for Clothing. Spent 340 AED in 1–10 Aug.')
})

test('single category: no budget row at all for that category (not even in the rows list)', () => {
  const reply = formatBudgetStatusReply('Clothing', [], THIS_MONTH, true)
  assert.equal(reply, 'No budget set for Clothing, and nothing spent in 1–10 Aug.')
})

test('single category: budgeted, zero spend', () => {
  const rows: CategoryBudgetRow[] = [{ category: 'Groceries', limitAed: 1800, spentAed: 0 }]
  const reply = formatBudgetStatusReply('Groceries', rows, THIS_MONTH, true)
  assert.equal(reply, 'Groceries: nothing spent yet of 1,800 AED in 1–10 Aug.')
})

test('single category: a monthly_limit of 0 is treated as unbudgeted, never a division by zero', () => {
  const rows: CategoryBudgetRow[] = [{ category: 'Gifts', limitAed: 0, spentAed: 50 }]
  const reply = formatBudgetStatusReply('Gifts', rows, THIS_MONTH, true)
  assert.equal(reply, 'No budget set for Gifts. Spent 50 AED in 1–10 Aug.')
  assert.doesNotMatch(reply, /NaN|Infinity/)
})

test('full grid: zero-spend month renders sensibly, nothing divides by zero', () => {
  const rows: CategoryBudgetRow[] = [
    { category: 'Groceries', limitAed: 1800, spentAed: 0 },
    { category: 'Clothing', limitAed: null, spentAed: 0 },
  ]
  const reply = formatBudgetStatusReply(undefined, rows, THIS_MONTH, true)
  assert.doesNotMatch(reply, /NaN|Infinity/)
  assert.match(reply, /On track\n {2}Groceries.*0%/)
})
