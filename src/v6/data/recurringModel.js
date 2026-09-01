/**
 * The V6 Recurring model.
 *
 * Pure: no Supabase import, no React, loadable under `node --test`.
 *
 * The shape of this module is the whole point of the screen. Recurring is a
 * *plan* surface — bills, EMIs and expected income the household declared —
 * and no approved contract publishes plans yet. So the model is built the
 * other way round from a normal screen: it starts from the registry of named
 * gaps and adds only the handful of positions a canonical contract can
 * genuinely answer.
 *
 * Two rules hold everywhere below and are tested directly:
 *
 *  1. No posted fact is ever promoted into a plan position. This module never
 *     receives a ledger row, never groups by merchant, never measures the
 *     spacing between dates, and never decides that something recurs.
 *  2. The one canonical figure it does publish — the period's consumption
 *     spend — is placed in the prototype's fixed-versus-variable position and
 *     labelled as the whole period's posted spend, with the committed half of
 *     that split left explicitly unavailable. It is context for the split, not
 *     the split.
 */

import { recurringGapSlot } from './recurringGaps.js'
import { availableSlot, errorSlot, incompleteSlot } from './slots.js'
import { RECURRING_TYPE_OPTIONS, RECURRING_VIEW_OPTIONS } from './recurringPeriods.js'

export const WEEKDAY_LABELS = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])

/* ── The plan surface: every position fails closed ──────────────────────── */

/**
 * Every plan position the frozen prototype shows, each one unavailable.
 *
 * Written as a flat registry rather than assembled per row, because there are
 * no rows: an empty list is the honest rendering of "no commitments are
 * published", and a list built from anything else would be the failure this
 * screen exists to avoid.
 */
function buildPlan() {
  return Object.freeze({
    bills: recurringGapSlot('billPlan'),
    income: recurringGapSlot('incomePlan'),
    committedTotal: recurringGapSlot('committedTotal'),
    expectedIncomeTotal: recurringGapSlot('expectedIncomeTotal'),
    cadence: recurringGapSlot('cadence'),
    nextDue: recurringGapSlot('nextDue'),
    paidStatus: recurringGapSlot('paidStatus'),
    autopay: recurringGapSlot('autopay'),
    effectiveWindow: recurringGapSlot('effectiveWindow'),
    accountLink: recurringGapSlot('accountLink'),
    attribution: recurringGapSlot('attribution'),
    fixedVariable: recurringGapSlot('fixedVariable'),
  })
}

/**
 * The prototype's per-row columns, kept as a composition even though no row
 * can be drawn.
 *
 * Hiding them would misrepresent the product as not having recurring
 * commitments at all; drawing them over invented rows would be worse. They are
 * listed as named positions with the contract that would fill each.
 */
function buildRowPositions(type) {
  const shared = [
    { key: 'amount', label: 'Amount', slot: type === 'income' ? recurringGapSlot('incomePlan') : recurringGapSlot('billPlan') },
    { key: 'cadence', label: 'Repeats', slot: recurringGapSlot('cadence') },
    { key: 'attribution', label: type === 'income' ? 'Earned by' : 'Paid by', slot: recurringGapSlot('attribution') },
  ]
  if (type === 'income') {
    return Object.freeze([
      { key: 'source', label: 'Source', slot: recurringGapSlot('incomePlan') },
      ...shared,
      { key: 'expected-on', label: 'Expected on', slot: recurringGapSlot('nextDue') },
      { key: 'account', label: 'Into', slot: recurringGapSlot('accountLink') },
    ].map(Object.freeze))
  }
  return Object.freeze([
    { key: 'name', label: 'Commitment', slot: recurringGapSlot('billPlan') },
    ...shared,
    { key: 'next-due', label: 'Next due', slot: recurringGapSlot('nextDue') },
    { key: 'autopay', label: 'Payment', slot: recurringGapSlot('autopay') },
    { key: 'status', label: 'Status', slot: recurringGapSlot('paidStatus') },
    { key: 'account', label: 'Account', slot: recurringGapSlot('accountLink') },
  ].map(Object.freeze))
}

/**
 * The matching surface, composition preserved and wholly unavailable.
 *
 * SHR-171 defines matching as a deterministic suggestion plus an explicit
 * confirmation. Neither half is implemented here, and the half a browser could
 * fake — merchant similarity, an amount-and-date heuristic — is precisely the
 * half that must never be presented as authoritative.
 */
function buildMatching() {
  return Object.freeze({
    suggestions: recurringGapSlot('matchSuggestions'),
    variance: recurringGapSlot('variance'),
    markPaid: recurringGapSlot('markPaid'),
    linkPosted: recurringGapSlot('matchTransaction'),
  })
}

function buildCapabilities() {
  return Object.freeze({
    add: recurringGapSlot('addCommitment'),
    edit: recurringGapSlot('editCommitment'),
    archive: recurringGapSlot('archiveCommitment'),
    markPaid: recurringGapSlot('markPaid'),
    match: recurringGapSlot('matchTransaction'),
  })
}

/* ── The one canonical position: posted spend for the period ────────────── */

/**
 * The period's consumption spend, from `canonical_period_metrics`.
 *
 * This sits in the prototype's fixed-versus-variable card as the total the
 * split would be taken of. It is a posted fact about the calendar month and is
 * labelled that way; it is never described as committed, recurring, fixed or
 * expected, and the committed half of the split stays unavailable beside it.
 *
 * Posted income is deliberately *not* published here. The only income position
 * this screen has is the prototype's *expected* income, and putting a posted
 * period total in it would answer a different question in a place a household
 * reads as an expectation. That gap names SHR-167.
 */
function buildPosted(periodMetrics, error) {
  if (error) {
    return Object.freeze({
      consumptionSpend: errorSlot(error),
      quality: null,
      needsReviewCount: null,
      missingFxCount: null,
      missingFxCurrencies: Object.freeze([]),
      incomePeriod: recurringGapSlot('postedIncomePeriod'),
    })
  }
  if (!periodMetrics) {
    return Object.freeze({
      consumptionSpend: errorSlot('Canonical period metrics have not answered yet.'),
      quality: null,
      needsReviewCount: null,
      missingFxCount: null,
      missingFxCurrencies: Object.freeze([]),
      incomePeriod: recurringGapSlot('postedIncomePeriod'),
    })
  }
  const spend = periodMetrics.consumption_spend_aed
  return Object.freeze({
    consumptionSpend: spend === null
      ? incompleteSlot('The canonical contract withheld this period’s consumption spend because its inputs are incomplete.')
      : availableSlot(spend),
    quality: periodMetrics.quality_status,
    needsReviewCount: periodMetrics.needs_review_count,
    missingFxCount: periodMetrics.missing_fx_count,
    missingFxCurrencies: Object.freeze([...(periodMetrics.quality_metadata?.missing_fx_currencies ?? [])]),
    incomePeriod: recurringGapSlot('postedIncomePeriod'),
  })
}

/* ── Calendar ───────────────────────────────────────────────────────────── */

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * A Monday-first month grid carrying calendar facts only.
 *
 * Every cell is a real day of the household's own calendar. Nothing is placed
 * inside one: an expected recurring event needs a commitment to project (that
 * gap names SHR-171), and a posted entry placed in a day cell of a *recurring*
 * calendar would read as the expected event having landed, which is the
 * conversion this screen must not perform.
 */
export function buildRecurringCalendar({ year, month, today }) {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1))
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  // getUTCDay(): 0 = Sunday. Monday-first offset.
  const leading = (firstOfMonth.getUTCDay() + 6) % 7

  const cells = []
  for (let index = 0; index < leading; index += 1) {
    cells.push(Object.freeze({ key: `lead-${index}`, date: null, day: null, inMonth: false, isToday: false }))
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = isoDate(year, month, day)
    cells.push(Object.freeze({ key: date, date, day, inMonth: true, isToday: date === today }))
  }
  while (cells.length % 7 !== 0) {
    cells.push(Object.freeze({ key: `trail-${cells.length}`, date: null, day: null, inMonth: false, isToday: false }))
  }

  const weeks = []
  for (let index = 0; index < cells.length; index += 7) weeks.push(Object.freeze(cells.slice(index, index + 7)))
  return Object.freeze(weeks)
}

/* ── Model ──────────────────────────────────────────────────────────────── */

export function buildRecurringModel({
  period,
  view = 'list',
  type = 'bills',
  periodMetrics = null,
  errors = {},
} = {}) {
  if (!period) throw new Error('buildRecurringModel requires a period')
  const resolvedType = RECURRING_TYPE_OPTIONS.some((option) => option.value === type) ? type : 'bills'
  const resolvedView = RECURRING_VIEW_OPTIONS.some((option) => option.value === view) ? view : 'list'

  return Object.freeze({
    period,
    view: resolvedView,
    type: resolvedType,
    /**
     * Always empty, by construction. The screen renders the plan gap in its
     * place; this exists so a reviewer can assert that nothing ever populates
     * it from a posted read.
     */
    items: Object.freeze([]),
    plan: buildPlan(),
    rowPositions: buildRowPositions(resolvedType),
    matching: buildMatching(),
    capabilities: buildCapabilities(),
    posted: buildPosted(periodMetrics, errors.periodMetrics ?? null),
    calendar: Object.freeze({
      weeks: buildRecurringCalendar(period),
      expected: recurringGapSlot('calendarExpected'),
    }),
  })
}
