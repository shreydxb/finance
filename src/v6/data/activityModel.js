/**
 * The V6 Activity view model.
 *
 * Pure: no Supabase import, no I/O, and no financial arithmetic. Every money
 * figure is one a canonical contract already computed — the period totals come
 * from `canonical_period_metrics`, and each row's amount is the ledger's own
 * `amount_aed`. Nothing here sums, averages, pairs, links or re-derives.
 *
 * Filtering and sorting are presentation over the canonical rows already read
 * for the period. They narrow what is shown; they never change a value, and
 * they never stand in for the stable search/filter contract (SHR-163), which
 * is reported as a gap so the household is not told this is a whole-ledger
 * search.
 */

import { ACTIVITY_GAPS, activityGapSlot } from './activityGaps.js'
import { availableSlot, errorSlot, incompleteSlot } from './slots.js'

export const CLASSIFICATION_LABELS = Object.freeze({
  consumption_spend: 'Spend',
  savings_movement: 'Savings movement',
  internal_transfer: 'Transfer',
})

export const SORT_OPTIONS = Object.freeze([
  { value: 'date', label: 'Newest first' },
  { value: 'amount', label: 'Largest amount' },
])

export const VIEW_OPTIONS = Object.freeze([
  { value: 'list', label: 'List' },
  { value: 'calendar', label: 'Calendar' },
])

export const UNASSIGNED_OWNER = 'Unassigned'
export const UNCATEGORISED = 'Uncategorised'

function sourced(contract, field) {
  return `${contract}.${field}`
}

/* ── Rows ───────────────────────────────────────────────────────────────── */

function accountSlot(row, accountsById, accountsRead) {
  if (!accountsRead) {
    return errorSlot('Canonical accounts were not read, so this entry’s account cannot be named.')
  }
  if (!row.account_id) {
    return incompleteSlot('The canonical ledger records no account for this entry.')
  }
  const account = accountsById.get(row.account_id)
  if (!account) {
    // Never fall back to the raw identifier dressed up as a name.
    return incompleteSlot('This entry’s account is not present in the canonical account view.')
  }
  const name = typeof account.name === 'string' ? account.name.trim() : ''
  if (!name) return incompleteSlot('The canonical account view records no name for this account.')
  return availableSlot(name, { source: sourced('v_canonical_accounts_aed', 'name') })
}

function buildRow(row, accountsById, accountsRead) {
  const note = typeof row.note === 'string' ? row.note.trim() : ''
  const category = typeof row.category === 'string' ? row.category.trim() : ''
  const owner = typeof row.owner === 'string' ? row.owner.trim() : ''
  const isTransfer = row.economic_classification === 'internal_transfer'

  return Object.freeze({
    key: row.id,
    id: row.id,
    date: row.date,
    // Shown exactly as recorded. There is no resolved merchant identity
    // behind it (SHR-169), so it is never normalised into one.
    description: note || null,
    category: category || null,
    categoryLabel: category || UNCATEGORISED,
    classificationReason: row.classification_reason,
    owner: owner || null,
    ownerLabel: owner || UNASSIGNED_OWNER,
    account: accountSlot(row, accountsById, accountsRead),
    accountId: row.account_id ?? null,
    currency: row.currency,
    amount: row.amount_aed === null || row.amount_aed === undefined
      ? incompleteSlot('No FX rate is recorded for this entry’s currency, so it has no canonical AED amount.')
      : availableSlot(row.amount_aed, { source: sourced('v_canonical_ledger_aed', 'amount_aed') }),
    classification: row.economic_classification,
    classificationLabel: CLASSIFICATION_LABELS[row.economic_classification] ?? row.economic_classification,
    isTransfer,
    transferDirection: isTransfer ? row.transfer_direction ?? null : null,
    groupKind: row.group_kind ?? null,
    isSplit: row.group_kind === 'category_split',
    needsReview: row.needs_review === true,
    quality: row.quality_status,
  })
}

/* ── Filtering ──────────────────────────────────────────────────────────── */

export const EMPTY_FILTERS = Object.freeze({
  search: '', category: '', owner: '', needsReview: false, sort: 'date',
})

export function normalizeFilters(input = {}) {
  const sort = SORT_OPTIONS.some((option) => option.value === input.sort) ? input.sort : 'date'
  return Object.freeze({
    search: typeof input.search === 'string' ? input.search.trim() : '',
    category: typeof input.category === 'string' ? input.category.trim() : '',
    owner: typeof input.owner === 'string' ? input.owner.trim() : '',
    needsReview: input.needsReview === true || input.needsReview === '1',
    sort,
  })
}

function matchesSearch(row, term) {
  if (!term) return true
  const haystack = [
    row.description,
    row.categoryLabel,
    row.ownerLabel,
    row.account.status === 'available' ? row.account.value : null,
    row.classificationLabel,
  ].filter(Boolean).join(' ').toLowerCase()
  return haystack.includes(term.toLowerCase())
}

export function applyFilters(rows, filters) {
  const matched = rows.filter((row) => {
    if (filters.needsReview && !row.needsReview) return false
    // Exact label match only. Matching a category by substring would be
    // inferring category identity from text, which no contract supports.
    if (filters.category && row.categoryLabel !== filters.category) return false
    if (filters.owner && row.ownerLabel !== filters.owner) return false
    return matchesSearch(row, filters.search)
  })

  if (filters.sort === 'amount') {
    // Rows whose canonical amount is withheld sort last rather than as zero:
    // an incomplete amount is not a small one.
    return [...matched].sort((left, right) => {
      const leftValue = left.amount.status === 'available' ? Math.abs(left.amount.value) : -Infinity
      const rightValue = right.amount.status === 'available' ? Math.abs(right.amount.value) : -Infinity
      if (leftValue === rightValue) return left.date < right.date ? 1 : -1
      return rightValue - leftValue
    })
  }
  return [...matched].sort((left, right) => {
    if (left.date === right.date) return left.id < right.id ? 1 : -1
    return left.date < right.date ? 1 : -1
  })
}

/** Distinct labels present in the loaded rows — never a guessed taxonomy. */
export function filterOptions(rows) {
  const categories = new Set()
  const owners = new Set()
  for (const row of rows) {
    categories.add(row.categoryLabel)
    owners.add(row.ownerLabel)
  }
  return {
    categories: [...categories].sort((left, right) => left.localeCompare(right)),
    owners: [...owners].sort((left, right) => left.localeCompare(right)),
  }
}

/* ── Calendar ───────────────────────────────────────────────────────────── */

export const WEEKDAY_LABELS = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * A Monday-first month grid.
 *
 * Each cell reports how many canonical entries fall on that day and how many
 * of them the contract flags for review. Both are cardinalities of rows the
 * contract returned — not money, and not a judgement about the day.
 */
export function buildCalendar(rows, { year, month }) {
  const byDay = new Map()
  for (const row of rows) {
    const bucket = byDay.get(row.date) ?? { count: 0, needsReview: 0 }
    bucket.count += 1
    if (row.needsReview) bucket.needsReview += 1
    byDay.set(row.date, bucket)
  }

  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1))
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  // getUTCDay(): 0 = Sunday. Monday-first offset.
  const leading = (firstOfMonth.getUTCDay() + 6) % 7

  const cells = []
  for (let index = 0; index < leading; index += 1) {
    cells.push({ key: `lead-${index}`, date: null, day: null, inMonth: false, count: 0, needsReview: 0 })
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = isoDate(year, month, day)
    const bucket = byDay.get(date) ?? { count: 0, needsReview: 0 }
    cells.push({ key: date, date, day, inMonth: true, count: bucket.count, needsReview: bucket.needsReview })
  }
  while (cells.length % 7 !== 0) {
    cells.push({ key: `trail-${cells.length}`, date: null, day: null, inMonth: false, count: 0, needsReview: 0 })
  }

  const weeks = []
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7))
  return weeks
}

/* ── Summary ────────────────────────────────────────────────────────────── */

function summaryFigure(metrics, field, incompleteReason, error) {
  if (error) return errorSlot(error)
  if (!metrics) return errorSlot('The canonical period contract has not been read.')
  const value = metrics[field]
  if (value === null || value === undefined) return incompleteSlot(incompleteReason)
  return availableSlot(value, { source: sourced('canonical_period_metrics', field) })
}

/* ── Capabilities ───────────────────────────────────────────────────────── */

/**
 * Every write this screen could offer, reported as unsupported.
 *
 * These are rendered as visible, disabled affordances that name their missing
 * contract. Nothing here is wired to a legacy writer: a parallel client-side
 * mutation path would bypass exactly the safety the named contracts own.
 */
export function buildCapabilities() {
  return Object.freeze({
    create: activityGapSlot('createTransaction'),
    edit: activityGapSlot('editTransaction'),
    delete: activityGapSlot('deleteTransaction'),
    split: activityGapSlot('categorySplit'),
    review: activityGapSlot('reviewAction'),
  })
}

export function isWriteEnabled(capabilities) {
  return Object.values(capabilities).some((slot) => slot.status === 'available')
}

/* ── Entry point ────────────────────────────────────────────────────────── */

export function buildActivityModel(input) {
  const {
    period,
    ledgerRows = null,
    accounts = null,
    periodMetrics = null,
    filters: rawFilters = EMPTY_FILTERS,
    view = 'list',
    errors = {},
  } = input

  const filters = normalizeFilters(rawFilters)
  const accountsRead = Array.isArray(accounts)
  const accountsById = new Map(accountsRead ? accounts.map((account) => [account.id, account]) : [])

  const ledgerError = errors.ledgerRows ?? null
  const allRows = Array.isArray(ledgerRows)
    ? ledgerRows.map((row) => buildRow(row, accountsById, accountsRead))
    : []
  const rows = applyFilters(allRows, filters)

  let list
  if (ledgerError) {
    list = { status: 'unavailable', reason: ledgerError }
  } else if (!Array.isArray(ledgerRows)) {
    list = { status: 'unavailable', reason: 'The canonical ledger has not been read.' }
  } else if (allRows.length === 0) {
    list = { status: 'empty', reason: 'No canonical ledger entries fall inside this period.' }
  } else if (rows.length === 0) {
    list = { status: 'filtered-empty', reason: 'No entry in this period matches the current search and filters.' }
  } else {
    list = { status: 'available', reason: null }
  }

  return Object.freeze({
    period,
    view: VIEW_OPTIONS.some((option) => option.value === view) ? view : 'list',
    filters,
    filterOptions: filterOptions(allRows),
    rows,
    // Every row read for the period, unfiltered. A deep link to one entry must
    // still resolve when the active filters happen to exclude it.
    allRows,
    list,
    loadedCount: allRows.length,
    visibleCount: rows.length,
    reviewCount: allRows.filter((row) => row.needsReview).length,
    summary: Object.freeze({
      spend: summaryFigure(
        periodMetrics,
        'consumption_spend_aed',
        'Consumption spend is incomplete for this period, so the canonical contract withholds the figure.',
        errors.periodMetrics ?? null,
      ),
      income: summaryFigure(
        periodMetrics,
        'posted_income_aed',
        'Posted income is incomplete for this period, so the canonical contract withholds the figure.',
        errors.periodMetrics ?? null,
      ),
      quality: periodMetrics?.quality_status ?? null,
      needsReviewCount: periodMetrics?.needs_review_count ?? null,
    }),
    calendar: Object.freeze({
      weeks: buildCalendar(rows, period),
      dailyTotals: activityGapSlot('calendarTotals'),
      bills: activityGapSlot('calendarBills'),
    }),
    accountsRead,
    capabilities: buildCapabilities(),
    gaps: Object.freeze({
      search: activityGapSlot('search'),
      attribution: activityGapSlot('stableAttribution'),
      categoryIdentity: activityGapSlot('categoryIdentity'),
      description: activityGapSlot('descriptionIdentity'),
      transferPairing: activityGapSlot('transferPairing'),
      refundLinkage: activityGapSlot('refundLinkage'),
      provenance: activityGapSlot('provenance'),
    }),
  })
}

export function findActivityRow(model, id) {
  if (!id || !model) return null
  return model.allRows.find((row) => row.id === id) ?? null
}

export { ACTIVITY_GAPS }
