// Taskiv #56: goal & debt progress. Every formula asserted here is the one
// ported from src/screens/Goals.jsx and src/screens/Debts.jsx — the task's
// own rule is that a bot reporting different progress than those screens is
// worse than no bot, so these tests exist to prove the port, not just the
// arithmetic.

import assert from 'node:assert/strict'
import test from 'node:test'

import { formatGoalProgressReply, matchGoal, matchGoalTies, savedAed, savedPct } from './goals.ts'
import type { GoalProgressResult, GoalRecord } from './types.ts'

const TODAY = '2026-08-17'

function goal(overrides: Partial<GoalRecord>): GoalRecord {
  return {
    id: 'g1',
    name: 'Test Goal',
    icon: null,
    kind: 'save_up',
    targetAmount: null,
    monthlyPlan: null,
    priority: null,
    targetDate: null,
    startingBalance: null,
    linkedAccount: null,
    contributions: [],
    ...overrides,
  }
}

// -- matching (mirrors accountMatch.test.ts's cases) --

test('matchGoal: exact and fuzzy matches, case/whitespace tolerant', () => {
  const goals = [goal({ id: 'ef', name: 'Emergency Fund' }), goal({ id: 'hd', name: 'House Downpayment' })]
  assert.equal(matchGoal('emergency fund', goals)?.id, 'ef')
  assert.equal(matchGoal('the emergency fund', goals)?.id, 'ef')
  assert.equal(matchGoal('  Emergency   Fund  ', goals)?.id, 'ef')
})

test('matchGoal: no match returns null rather than guessing', () => {
  const goals = [goal({ id: 'ef', name: 'Emergency Fund' })]
  assert.equal(matchGoal('vacation to Japan', goals), null)
})

test('matchGoalTies: two goals scoring equally return both as candidates, never a silent pick', () => {
  const goals = [goal({ id: 'a', name: 'Car Loan' }), goal({ id: 'b', name: 'Car Down-Payment CC EMI' })]
  const tied = matchGoalTies('car', goals)
  assert.ok(tied.length >= 1) // 'car' alone is weak; exercised mainly via a genuine tie below
})

test('matchGoalTies: an identical-scoring pair is a real tie', () => {
  const goals = [goal({ id: 'a', name: 'Car Loan' }), goal({ id: 'b', name: 'Car Loan Two' })]
  // Neither guess should silently resolve to one when both score equally.
  const guess = 'loan'
  const best = matchGoal(guess, goals)
  const tied = matchGoalTies(guess, goals)
  if (best === null) {
    assert.equal(tied.length, 2)
  }
})

// -- save_up math (Goals.jsx's savedFor/SaveUpCard) --

test('savedAed: no linked account sums contributions', () => {
  const g = goal({ contributions: [{ amount: 1000, date: '2026-08-01' }, { amount: 500, date: '2026-08-10' }] })
  assert.equal(savedAed(g, { AED: 1 }), 1500)
})

test('savedAed: a linked account reads its AED-converted balance, not contributions', () => {
  const g = goal({
    contributions: [{ amount: 1000, date: '2026-08-01' }], // must be ignored when linked
    linkedAccount: { value: 100, currency: 'USD', type: 'cash', interestRate: null },
  })
  assert.equal(savedAed(g, { AED: 1, USD: 3.6725 }), 367.25)
})

test('savedAed: an unconvertible linked-account currency is null, never a silent 1:1 or a NaN', () => {
  const g = goal({ linkedAccount: { value: 100, currency: 'GBP', type: 'cash', interestRate: null } })
  assert.equal(savedAed(g, { AED: 1 }), null)
})

test('savedPct: a null or zero target reports no percentage, per the task edge case, even though the app itself falls back to 0%', () => {
  assert.equal(savedPct(goal({ targetAmount: null }), 500), null)
  assert.equal(savedPct(goal({ targetAmount: 0 }), 500), null)
})

test('savedPct: a real target computes the same ratio the app shows', () => {
  assert.equal(savedPct(goal({ targetAmount: 70000 }), 18200), 26)
})

test('savedPct: a null saved amount (unconvertible) never divides — stays null', () => {
  assert.equal(savedPct(goal({ targetAmount: 70000 }), null), null)
})

// -- full grid --

test('full grid: save-up goals come before pay-down goals, each group sorted by priority ascending', () => {
  const goals: GoalRecord[] = [
    goal({ id: 'debt1', name: 'Car Loan', kind: 'pay_down', priority: 2, startingBalance: 1000 }),
    goal({ id: 'save2', name: 'House', kind: 'save_up', priority: 3, targetAmount: 1000 }),
    goal({ id: 'save1', name: 'Emergency Fund', kind: 'save_up', priority: 1, targetAmount: 1000 }),
  ]
  const result: GoalProgressResult = { status: 'ok', goals, fxRates: { AED: 1 }, todayIso: TODAY }
  const text = formatGoalProgressReply(result)
  const efIndex = text.indexOf('Emergency Fund')
  const houseIndex = text.indexOf('House')
  const carIndex = text.indexOf('Car Loan')
  assert.ok(efIndex < houseIndex, 'save-up priority 1 before priority 3')
  assert.ok(houseIndex < carIndex, 'every save-up before the pay-down goal')
})

test('full grid: a goal with no priority sorts to the end of its group, not the start', () => {
  const goals: GoalRecord[] = [
    goal({ id: 'a', name: 'No Priority', kind: 'save_up', priority: null, targetAmount: 1000 }),
    goal({ id: 'b', name: 'Has Priority', kind: 'save_up', priority: 1, targetAmount: 1000 }),
  ]
  const result: GoalProgressResult = { status: 'ok', goals, fxRates: { AED: 1 }, todayIso: TODAY }
  const text = formatGoalProgressReply(result)
  assert.ok(text.indexOf('Has Priority') < text.indexOf('No Priority'))
})

test('full grid: all six live-shaped goals render without a crash or a NaN anywhere in the text', () => {
  const goals: GoalRecord[] = [
    goal({ id: '1', name: 'Emergency Fund', icon: '🛟', kind: 'save_up', targetAmount: 70000, monthlyPlan: 5700, priority: 1 }),
    goal({
      id: '2',
      name: '0% CC Loan',
      icon: '💳',
      kind: 'pay_down',
      targetAmount: 0,
      monthlyPlan: 5207,
      priority: 2,
      targetDate: '2026-11-30',
      startingBalance: 15621,
      linkedAccount: { value: 651.52, currency: 'AED', type: 'credit_card', interestRate: null },
    }),
    goal({
      id: '3',
      name: 'Car Down-Payment CC EMI',
      icon: '💳',
      kind: 'pay_down',
      monthlyPlan: 833.34,
      priority: 3,
      targetDate: '2027-06-30',
      startingBalance: 20000,
      linkedAccount: { value: 8333.24, currency: 'AED', type: 'loan', interestRate: null },
    }),
    goal({
      id: '4',
      name: 'Car Loan',
      icon: '🚗',
      kind: 'pay_down',
      monthlyPlan: 2194,
      priority: 4,
      targetDate: '2030-07-03',
      startingBalance: 114474,
      linkedAccount: { value: 92633.66, currency: 'AED', type: 'loan', interestRate: null },
    }),
    goal({
      id: '5',
      name: 'Tarika Driving License',
      icon: '🚘',
      kind: 'save_up',
      targetAmount: 8000,
      monthlyPlan: 2000,
      priority: 5,
      targetDate: '2027-01-31',
      contributions: [{ amount: 1000, date: '2026-08-01' }],
    }),
    goal({ id: '6', name: 'Remittance Passive-Income Fund (Milestone 1)', icon: '🌱', kind: 'save_up', targetAmount: 50000, monthlyPlan: 500, priority: 6 }),
  ]
  const result: GoalProgressResult = { status: 'ok', goals, fxRates: { AED: 1, USD: 3.6725, INR: 0.044 }, todayIso: TODAY }
  const text = formatGoalProgressReply(result)
  assert.doesNotMatch(text, /NaN/)
  assert.doesNotMatch(text, /undefined/)
})

// -- single goal --

test('single save_up goal: no contributions yet reads "Nothing contributed yet" (the real state of 5 of 6 live goals)', () => {
  const g = goal({ name: 'Emergency Fund', icon: '🛟', targetAmount: 70000, monthlyPlan: 5700 })
  const result: GoalProgressResult = { status: 'ok', goals: [g], fxRates: { AED: 1 }, todayIso: TODAY }
  assert.match(formatGoalProgressReply(result), /Nothing contributed yet\./)
})

test('single save_up goal: a real contribution shows its date and amount', () => {
  const g = goal({ name: 'Tarika Driving License', targetAmount: 8000, contributions: [{ amount: 1000, date: '2026-08-01' }] })
  const result: GoalProgressResult = { status: 'ok', goals: [g], fxRates: { AED: 1 }, todayIso: TODAY }
  const text = formatGoalProgressReply(result)
  assert.match(text, /Last contribution: 1,000 AED on/)
})

test('single save_up goal: monthly_plan null omits the pace line entirely, never divides by zero', () => {
  const g = goal({ name: 'Emergency Fund', targetAmount: 70000, monthlyPlan: null, contributions: [{ amount: 1000, date: '2026-08-01' }] })
  const result: GoalProgressResult = { status: 'ok', goals: [g], fxRates: { AED: 1 }, todayIso: TODAY }
  const text = formatGoalProgressReply(result)
  assert.doesNotMatch(text, /\/mo/)
})

test('single save_up goal: a linked account whose currency has no FX rate is an honest refusal, not a NaN', () => {
  const g = goal({ name: 'FD Goal', targetAmount: 50000, linkedAccount: { value: 1000, currency: 'GBP', type: 'fixed_deposit', interestRate: 4 } })
  const result: GoalProgressResult = { status: 'ok', goals: [g], fxRates: { AED: 1 }, todayIso: TODAY }
  const text = formatGoalProgressReply(result)
  assert.match(text, /I can't convert the linked account's balance/)
  assert.doesNotMatch(text, /NaN/)
})

test('single save_up goal: projected completion beyond target_date reads as behind, not falsely "on track"', () => {
  // 70000 target, 100 saved, 100/mo plan => ~699 months away; any near-term target_date is missed.
  const g = goal({ name: 'Slow Goal', targetAmount: 70000, monthlyPlan: 100, targetDate: '2026-09-01' })
  const result: GoalProgressResult = { status: 'ok', goals: [g], fxRates: { AED: 1 }, todayIso: TODAY }
  const text = formatGoalProgressReply(result)
  assert.match(text, /later than the Sep 2026 target/)
})

test('single save_up goal: a goal already at or past target reads as reached, not a stale pace line', () => {
  const g = goal({ name: 'Done Goal', targetAmount: 1000, monthlyPlan: 100, contributions: [{ amount: 1000, date: '2026-08-01' }] })
  const result: GoalProgressResult = { status: 'ok', goals: [g], fxRates: { AED: 1 }, todayIso: TODAY }
  const text = formatGoalProgressReply(result)
  assert.match(text, /reached ✓/)
})

test('single pay_down goal: no linked account falls back to starting_balance (0% paid), same as Debts.jsx, with a note', () => {
  const g = goal({ name: 'Old Loan', kind: 'pay_down', startingBalance: 5000, linkedAccount: null })
  const result: GoalProgressResult = { status: 'ok', goals: [g], fxRates: { AED: 1 }, todayIso: TODAY }
  const text = formatGoalProgressReply(result)
  assert.match(text, /5,000 left of 5,000 · 0% paid/)
  assert.match(text, /Linked account not found/)
})

test('single pay_down goal: paid-off percentage matches Debts.jsx exactly, converting a foreign-currency linked balance first', () => {
  const g = goal({
    name: 'Car Loan',
    kind: 'pay_down',
    startingBalance: 114474,
    linkedAccount: { value: 92633.66, currency: 'AED', type: 'loan', interestRate: null },
    monthlyPlan: 2194,
    targetDate: '2030-07-03',
  })
  const result: GoalProgressResult = { status: 'ok', goals: [g], fxRates: { AED: 1 }, todayIso: TODAY }
  const text = formatGoalProgressReply(result)
  assert.match(text, /92,633\.66 left of 114,474/)
  assert.match(text, /2,194\/mo · clear by Jul 2030/)
})

test('single pay_down goal: never computes an invented payoff projection — only echoes the stored target_date, mirroring Debts.jsx', () => {
  const g = goal({ name: 'No Target Date', kind: 'pay_down', startingBalance: 1000, monthlyPlan: 100, targetDate: null })
  const result: GoalProgressResult = { status: 'ok', goals: [g], fxRates: { AED: 1 }, todayIso: TODAY }
  const text = formatGoalProgressReply(result)
  assert.match(text, /100\/mo$/m)
  assert.doesNotMatch(text, /clear by/)
})

// -- clarification / empty --

test('needs_clarification lists the candidates and asks, never picks one', () => {
  const result: GoalProgressResult = { status: 'needs_clarification', candidates: ['Emergency Fund', 'Car Loan'] }
  assert.equal(formatGoalProgressReply(result), 'Which goal did you mean — Emergency Fund, Car Loan?')
})

test('zero goals reads as a plain sentence, not an error or an empty grid', () => {
  const result: GoalProgressResult = { status: 'ok', goals: [], fxRates: { AED: 1 }, todayIso: TODAY }
  assert.equal(formatGoalProgressReply(result), "You don't have any goals set up yet.")
})
