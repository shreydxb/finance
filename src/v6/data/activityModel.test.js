import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { normalizeCanonicalLedgerRows } from '../../lib/canonicalContracts.js'
import { detailHref, resolveAppHref } from '../../lib/routes.js'
import { activityFixtureReads, ACTIVITY_FIXTURE_TODAY } from '../fixtures/activityFixture.js'
import { ACTIVITY_GAPS } from './activityGaps.js'
import {
  applyFilters,
  buildActivityModel,
  resolveDetail,
  buildCalendar,
  buildCapabilities,
  filterOptions,
  findActivityRow,
  isWriteEnabled,
  normalizeFilters,
} from './activityModel.js'
import { monthPeriod, stepMonth } from './activityPeriods.js'
import { composeActivity } from './composeActivity.js'

const PERIOD = monthPeriod({ year: 2026, month: 8, today: ACTIVITY_FIXTURE_TODAY })

async function loadedModel(overrides = {}) {
  return composeActivity({
    year: 2026, month: 8, today: ACTIVITY_FIXTURE_TODAY, reads: activityFixtureReads, ...overrides,
  })
}

/* ── Route contract ─────────────────────────────────────────────────────── */

test('/money/activity and its detail route resolve to the V6 Activity screen', () => {
  const list = resolveAppHref('/money/activity')
  assert.equal(list.kind, 'screen')
  assert.equal(list.screen, 'Activity')

  const id = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001'
  const detail = resolveAppHref(`/money/activity/${id}`)
  assert.equal(detail.screen, 'Activity')
  assert.deepEqual(detail.detail, { kind: 'transaction', id, parentPath: '/money/activity' })
})

test('the application mounts the V6 Activity screen and no longer mounts the legacy one', () => {
  const app = readFileSync(new URL('../../App.jsx', import.meta.url), 'utf8')
  assert.match(app, /import ActivityScreen from '\.\/v6\/ActivityScreen'/)
  assert.match(app, /Activity: ActivityScreen/)
  // The legacy composition stays in the repository but is not imported or
  // mounted anywhere in the application entry.
  assert.doesNotMatch(app, /^import .* from '\.\/screens\/Transactions'/m)
  assert.doesNotMatch(app, /^\s+Transactions,$/m)
})

test('meaningful Activity state is deep-linkable and unknown values are rejected', () => {
  // The route contract canonicalises query order, so a link written in another
  // order redirects to the canonical form rather than resolving twice.
  const messy = resolveAppHref('/money/activity?view=calendar&search=fixture&sort=amount')
  assert.equal(messy.kind, 'redirect')

  const route = resolveAppHref(messy.to)
  assert.equal(route.kind, 'screen')
  assert.equal(route.screen, 'Activity')
  assert.equal(route.searchParams.get('view'), 'calendar')
  assert.equal(route.searchParams.get('sort'), 'amount')
  assert.equal(route.searchParams.get('search'), 'fixture')

  const monthly = resolveAppHref(resolveAppHref('/money/activity?year=2026&month=7').to ?? '/money/activity?year=2026&month=7')
  assert.equal(monthly.searchParams.get('year'), '2026')
  assert.equal(monthly.searchParams.get('month'), '7')

  // An unsupported view or sort is dropped by the route contract before the
  // screen ever sees it, rather than passed through.
  const dirty = resolveAppHref('/money/activity?view=gantt&sort=colour&month=13')
  assert.equal(dirty.kind, 'redirect')
  assert.equal(dirty.to, '/money/activity')
})

/* ── Period ─────────────────────────────────────────────────────────────── */

test('Activity reviews a whole calendar month and steps across a year boundary', () => {
  assert.deepEqual(
    { from: PERIOD.from, to: PERIOD.to, label: PERIOD.label },
    { from: '2026-08-01', to: '2026-08-31', label: 'August 2026' },
  )
  assert.equal(monthPeriod({ today: '2026-08-28' }).isCurrentMonth, true)
  assert.equal(monthPeriod({ year: 2026, month: 7, today: '2026-08-28' }).isCurrentMonth, false)
  assert.deepEqual(stepMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 })
  assert.deepEqual(stepMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 })
  // February is not assumed to be 28 days.
  assert.equal(monthPeriod({ year: 2028, month: 2, today: '2026-08-28' }).to, '2028-02-29')
})

/* ── Fail-closed rows ───────────────────────────────────────────────────── */

test('canonical rows render faithfully from the ledger contract', async () => {
  const model = await loadedModel()
  assert.equal(model.list.status, 'available')
  assert.equal(model.loadedCount, 12)

  const grocery = findActivityRow(model, 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001')
  assert.equal(grocery.description, 'Fixture grocery run')
  assert.equal(grocery.categoryLabel, 'Groceries')
  assert.equal(grocery.amount.status, 'available')
  assert.equal(grocery.amount.value, 437)
  assert.equal(grocery.amount.source, 'v_canonical_ledger_aed.amount_aed')
  assert.equal(grocery.needsReview, true)
  assert.equal(grocery.quality, 'provisional')
  assert.equal(grocery.account.value, 'Fixture Current Account')
})

test('an entry with no canonical AED amount is withheld, never shown as its native figure', async () => {
  const model = await loadedModel()
  const overseas = findActivityRow(model, 'aaaaaaaa-bbbb-4ccc-8ddd-000000000004')
  assert.equal(overseas.currency, 'JPY')
  assert.equal(overseas.amount.status, 'incomplete')
  assert.match(overseas.amount.reason, /No FX rate/)
  assert.equal(overseas.amount.value, undefined)
})

test('an account missing from the canonical account view is stated, never guessed from its id', async () => {
  const model = await loadedModel()
  const stationery = findActivityRow(model, 'aaaaaaaa-bbbb-4ccc-8ddd-000000000006')
  assert.equal(stationery.account.status, 'incomplete')
  assert.match(stationery.account.reason, /not present in the canonical account view/)
  // The raw identifier must not leak out as a stand-in name.
  assert.notEqual(stationery.account.value, stationery.accountId)
})

test('category and owner are the recorded labels, never inferred from description text', async () => {
  const model = await loadedModel()
  const unlabelled = findActivityRow(model, 'aaaaaaaa-bbbb-4ccc-8ddd-000000000009')
  assert.equal(unlabelled.category, null)
  assert.equal(unlabelled.categoryLabel, 'Uncategorised')
  assert.equal(unlabelled.classificationReason, 'uncategorised_consumption')
  assert.equal(unlabelled.owner, null)
  // Not "Unassigned": that would state an attribution decision the ledger
  // never made. The datum is a recorded text label, absent here.
  assert.equal(unlabelled.ownerLabel, 'Not recorded')

  // Both carry their gap so the label is never read as stable truth.
  assert.equal(model.gaps.categoryIdentity.gap, ACTIVITY_GAPS.categoryIdentity)
  assert.equal(model.gaps.attribution.gap, ACTIVITY_GAPS.stableAttribution)
})

test('a transfer reports its own direction and refuses to pair itself', async () => {
  const model = await loadedModel()
  const transfer = findActivityRow(model, 'aaaaaaaa-bbbb-4ccc-8ddd-000000000007')
  assert.equal(transfer.isTransfer, true)
  assert.equal(transfer.transferDirection, 'out')
  assert.equal(model.gaps.transferPairing.gap, ACTIVITY_GAPS.transferPairing)
  assert.equal(model.gaps.refundLinkage.gap, ACTIVITY_GAPS.refundLinkage)
})

test('a failed canonical read degrades only its own region', async () => {
  const ledgerDown = await loadedModel({
    reads: { ...activityFixtureReads, listLedgerRows: async () => { throw new Error('ledger offline') } },
  })
  assert.equal(ledgerDown.list.status, 'unavailable')
  assert.match(ledgerDown.list.reason, /ledger offline/)
  assert.equal(ledgerDown.summary.spend.status, 'available')

  const accountsDown = await loadedModel({
    reads: { ...activityFixtureReads, listAccounts: async () => { throw new Error('accounts offline') } },
  })
  assert.equal(accountsDown.list.status, 'available')
  assert.equal(accountsDown.accountsRead, false)
  assert.equal(accountsDown.rows[0].account.status, 'unavailable')
})

test('period totals come from the canonical period contract, never from adding the rows up', async () => {
  const model = await loadedModel()
  assert.equal(model.summary.spend.source, 'canonical_period_metrics.consumption_spend_aed')
  assert.equal(model.summary.income.source, 'canonical_period_metrics.posted_income_aed')
  const rowSum = model.rows
    .filter((row) => row.amount.status === 'available')
    .reduce((total, row) => total + row.amount.value, 0)
  assert.notEqual(model.summary.spend.value, rowSum)
})

/* ── Mutations stay inert ───────────────────────────────────────────────── */

test('every write capability is reported unsupported and names its contract', () => {
  const capabilities = buildCapabilities()
  assert.deepEqual(Object.keys(capabilities).sort(), ['create', 'delete', 'edit', 'review', 'split'])
  for (const [name, slot] of Object.entries(capabilities)) {
    assert.equal(slot.status, 'unavailable', name)
    assert.match(slot.gap.contract, /SHR-\d+/, name)
  }
  assert.equal(isWriteEnabled(capabilities), false)
})

test('no V6 Activity module reaches a legacy writer or a non-canonical reader', () => {
  const files = [
    'activityModel.js', 'composeActivity.js', 'activityPeriods.js', 'activityGaps.js', 'useActivityData.js',
  ].map((name) => readFileSync(new URL(name, import.meta.url), 'utf8'))
  const screen = readFileSync(new URL('../ActivityScreen.jsx', import.meta.url), 'utf8')
  for (const text of [...files, screen]) {
    // No import of a legacy financial reader or writer…
    assert.doesNotMatch(text, /from '[^']*lib\/(transactions|budgets|goals|recurring|accounts|income|snapshots)'/)
    assert.doesNotMatch(text, /supabaseClient/)
    // …and no call site for one either. Gap identifiers are allowed to be
    // named; invoking a writer is not.
    assert.doesNotMatch(text, /\b(await |= )?(createTransaction|updateTransaction|softDeleteTransaction|restoreTransaction|assignForReview|linkToGoal)\s*\(/)
  }
})

/* ── Filters, sorting and the calendar ──────────────────────────────────── */

test('filters narrow the loaded rows without touching a value', async () => {
  const model = await loadedModel()
  const rows = model.allRows

  assert.equal(applyFilters(rows, normalizeFilters({ needsReview: true })).length, 1)
  assert.equal(applyFilters(rows, normalizeFilters({ owner: 'Fixture person A' })).length, 1)
  assert.equal(applyFilters(rows, normalizeFilters({ category: 'Dining Out' })).length, 2)
  assert.equal(applyFilters(rows, normalizeFilters({ search: 'pharmacy' })).length, 1)
  assert.equal(applyFilters(rows, normalizeFilters({ search: 'FIXTURE UTILITY' })).length, 1)
  assert.equal(applyFilters(rows, normalizeFilters({ search: 'nothing matches this' })).length, 0)

  // A category filter is an exact label match: matching by substring would be
  // inferring category identity from text.
  assert.equal(applyFilters(rows, normalizeFilters({ category: 'Dining' })).length, 0)

  const filtered = applyFilters(rows, normalizeFilters({ search: 'pharmacy' }))
  assert.equal(filtered[0].amount.value, 94)
})

test('sorting by amount puts a withheld amount last rather than treating it as zero', async () => {
  const model = await loadedModel()
  const sorted = applyFilters(model.allRows, normalizeFilters({ sort: 'amount' }))
  assert.equal(sorted[0].amount.value, 5000)
  assert.equal(sorted.at(-1).amount.status, 'incomplete')
})

test('filter options are the labels present in the loaded rows, not a guessed taxonomy', async () => {
  const model = await loadedModel()
  const options = filterOptions(model.allRows)
  assert.ok(options.categories.includes('Uncategorised'))
  assert.ok(options.owners.includes('Not recorded'))
  assert.ok(!options.categories.includes('Housing'))
})

test('the calendar is a Monday-first month grid of canonical row counts, never money', () => {
  const weeks = buildCalendar([
    { date: '2026-08-01', needsReview: false },
    { date: '2026-08-27', needsReview: true },
    { date: '2026-08-27', needsReview: false },
  ], { year: 2026, month: 8 })

  assert.ok(weeks.every((week) => week.length === 7))
  const cells = weeks.flat()
  // 1 August 2026 is a Saturday, so a Monday-first grid leads with five blanks.
  assert.equal(cells.slice(0, 5).every((cell) => !cell.inMonth), true)
  assert.equal(cells[5].day, 1)
  assert.equal(cells.filter((cell) => cell.inMonth).length, 31)

  const twentySeventh = cells.find((cell) => cell.date === '2026-08-27')
  assert.equal(twentySeventh.count, 2)
  assert.equal(twentySeventh.needsReview, 1)
  for (const cell of cells) {
    assert.deepEqual(Object.keys(cell).sort(), ['count', 'date', 'day', 'inMonth', 'key', 'needsReview'])
  }
})

test('the calendar states its missing daily-total and bill contracts', async () => {
  const model = await loadedModel({ view: 'calendar' })
  assert.equal(model.view, 'calendar')
  assert.equal(model.calendar.dailyTotals.gap, ACTIVITY_GAPS.calendarTotals)
  assert.equal(model.calendar.bills.gap, ACTIVITY_GAPS.calendarBills)
})

test('filtering everything out is distinguished from an empty period', async () => {
  const filteredOut = await loadedModel({ filters: { search: 'no such entry' } })
  assert.equal(filteredOut.list.status, 'filtered-empty')

  const emptyPeriod = await loadedModel({
    reads: { ...activityFixtureReads, listLedgerRows: async () => [] },
  })
  assert.equal(emptyPeriod.list.status, 'empty')
})

/* ── Fixtures match the real contract ───────────────────────────────────── */

test('the Activity fixtures satisfy the real canonical ledger normaliser', async () => {
  const rows = normalizeCanonicalLedgerRows(await activityFixtureReads.listLedgerRows())
  assert.equal(rows.length, 12)
})

/* ── Recorded owner label is not economic attribution ───────────────────── */

test('the owner datum is a recorded label and its absence is stated, not decided', async () => {
  const model = await loadedModel()
  const labels = model.allRows.map((row) => row.ownerLabel)

  // Nothing normalises a label into a party, a share, or an assignment.
  for (const forbidden of ['Unassigned', 'Shared', 'Both', 'Joint', 'Household 50%']) {
    assert.equal(labels.includes(forbidden), false, forbidden)
  }
  assert.ok(labels.includes('Not recorded'))
  assert.ok(labels.includes('Fixture person A'))

  // The row keeps the raw datum alongside its label, and never invents one.
  const unlabelled = findActivityRow(model, 'aaaaaaaa-bbbb-4ccc-8ddd-000000000009')
  assert.equal(unlabelled.owner, null)
  assert.equal(model.gaps.attribution.gap, ACTIVITY_GAPS.stableAttribution)
  assert.match(model.gaps.attribution.gap.reason, /recorded text label, not household ownership/)
})

test('filtering by a recorded label is exact text and creates no party identity', async () => {
  const model = await loadedModel()
  const exact = applyFilters(model.allRows, normalizeFilters({ owner: 'Fixture person A' }))
  assert.equal(exact.length, 1)
  // No fuzzy or identity-based matching: "Fixture person" resolves nothing.
  assert.equal(applyFilters(model.allRows, normalizeFilters({ owner: 'Fixture person' })).length, 0)
  assert.equal(applyFilters(model.allRows, normalizeFilters({ owner: 'fixture person a' })).length, 0)
})

/* ── Period-scoped detail deep links ────────────────────────────────────── */

test('a detail link generated from a loaded row carries the row’s month', () => {
  const id = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001'
  const query = new URLSearchParams({ year: '2026', month: '8' })
  const href = detailHref('transaction', id, query)

  assert.match(href, /year=2026/)
  assert.match(href, /month=8/)

  // Reopening that generated link loads the period containing the entry.
  const reopened = resolveAppHref(href)
  assert.equal(reopened.kind, 'screen')
  assert.equal(reopened.screen, 'Activity')
  assert.equal(reopened.detail.id, id)
  assert.equal(reopened.searchParams.get('year'), '2026')
  assert.equal(reopened.searchParams.get('month'), '8')
})

test('a real entry outside the loaded month resolves as outside-period, never as nonexistent', async () => {
  const july = await composeActivity({
    year: 2026, month: 7, today: ACTIVITY_FIXTURE_TODAY, reads: activityFixtureReads,
  })
  // The entry is real — it is simply in a month July never requested.
  assert.equal(july.allRows.length, 0)

  const detail = resolveDetail(july, 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001')
  assert.equal(detail.status, 'outside-period')
  assert.equal(detail.row, null)
  assert.equal(detail.slot.gap, ACTIVITY_GAPS.directLookup)
  assert.match(detail.slot.gap.contract, /SHR-163/)
  // The wording must not assert absence.
  assert.doesNotMatch(detail.slot.gap.detail, /does not exist|deleted|missing transaction/i)
  assert.match(detail.slot.gap.detail, /not missing/)

  // The same id resolves normally once its own month is loaded.
  const august = await loadedModel()
  assert.equal(resolveDetail(august, 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001').status, 'found')
  assert.equal(resolveDetail(august, null).status, 'none')
})

test('detail resolution never reaches past the loaded period for a row', async () => {
  const model = await loadedModel()
  // `resolveDetail` reads only what the period contract returned; there is no
  // direct-by-id reader anywhere in the V6 Activity surface.
  const screen = readFileSync(new URL('../ActivityScreen.jsx', import.meta.url), 'utf8')
  const compose = readFileSync(new URL('composeActivity.js', import.meta.url), 'utf8')
  for (const text of [screen, compose]) {
    assert.doesNotMatch(text, /getTransactionById|listTransactions|\.eq\('id'/)
  }
  assert.equal(resolveDetail(model, 'aaaaaaaa-bbbb-4ccc-8ddd-999999999999').status, 'outside-period')
})
