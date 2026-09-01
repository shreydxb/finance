/**
 * NON-CONTRACTUAL canonical-shaped Activity fixtures.
 *
 * Same rule as `canonicalFixture.js`: these exist only so the deterministic
 * preview, the component tests and the responsive/accessibility runs have a
 * stable target without a Supabase session. They are not household data and
 * are never a fallback — `composeActivity` only ever uses reads passed to it.
 *
 * The set deliberately includes the awkward cases, because those are the ones
 * that must fail closed rather than look tidy: an entry with no FX rate, one
 * whose account is absent from the canonical account view, an uncategorised
 * one, an unassigned owner, a transfer, a savings movement and a split.
 *
 * Values are obviously synthetic and are not taken from the prototype's demo
 * numbers, so a screenshot can never be mistaken for a real balance.
 */

import { fixtureReads } from './canonicalFixture.js'

export const ACTIVITY_FIXTURE_TODAY = '2026-08-28'
export const ACTIVITY_FIXTURE_MONTH = Object.freeze({ year: 2026, month: 8 })

// Ids are real v4-shaped UUIDs because the route contract only accepts an
// immutable UUID in a detail path — a fixture with a friendly id would make
// the drawer unreachable in the preview while working fine in production.
function row(id, date, note, category, amount, extra = {}) {
  return Object.freeze({
    id,
    date,
    amount,
    currency: 'AED',
    category,
    owner: 'Household',
    note,
    tags: [],
    account_id: 'fixture-account-1',
    needs_review: false,
    transaction_group_id: null,
    group_kind: null,
    transfer_direction: null,
    economic_classification: 'consumption_spend',
    classification_reason: 'categorised_consumption',
    quality_status: 'complete',
    amount_aed: amount,
    consumption_spend_aed: amount,
    savings_movement_aed: null,
    ...extra,
  })
}

const LEDGER = Object.freeze([
  row('aaaaaaaa-bbbb-4ccc-8ddd-000000000001', '2026-08-27', 'Fixture grocery run', 'Groceries', 437, {
    needs_review: true, quality_status: 'provisional',
  }),
  row('aaaaaaaa-bbbb-4ccc-8ddd-000000000002', '2026-08-27', 'Fixture pharmacy', 'Health', 94, { owner: 'Fixture person A' }),
  row('aaaaaaaa-bbbb-4ccc-8ddd-000000000003', '2026-08-26', 'Fixture utility bill', 'Utilities', 1265, {
    account_id: 'fixture-account-2',
  }),
  // No FX rate for the entry's currency: the canonical AED amount is withheld,
  // and the row must say so rather than showing the native figure as AED.
  Object.freeze({
    ...row('aaaaaaaa-bbbb-4ccc-8ddd-000000000004', '2026-08-25', 'Fixture overseas order', 'Shopping', 129),
    currency: 'JPY',
    quality_status: 'incomplete',
    amount_aed: null,
    consumption_spend_aed: null,
  }),
  row('aaaaaaaa-bbbb-4ccc-8ddd-000000000005', '2026-08-25', 'Fixture fuel top-up', 'Transport & Fuel', 240, { owner: 'Fixture person B' }),
  // Account not present in the canonical account view.
  row('aaaaaaaa-bbbb-4ccc-8ddd-000000000006', '2026-08-24', 'Fixture stationery', 'Shopping', 76, {
    account_id: 'fixture-account-missing',
  }),
  Object.freeze({
    ...row('aaaaaaaa-bbbb-4ccc-8ddd-000000000007', '2026-08-24', 'Fixture card payment', 'Transfer', 3850),
    economic_classification: 'internal_transfer',
    classification_reason: 'typed_transfer',
    consumption_spend_aed: null,
    transaction_group_id: 'fixture-group-transfer',
    group_kind: 'transfer',
    transfer_direction: 'out',
  }),
  Object.freeze({
    ...row('aaaaaaaa-bbbb-4ccc-8ddd-000000000008', '2026-08-22', 'Fixture savings sweep', 'Savings & Investments', 5000),
    economic_classification: 'savings_movement',
    classification_reason: 'legacy_exact_savings_category',
    consumption_spend_aed: null,
    savings_movement_aed: 5000,
  }),
  // Uncategorised: the canonical reason says so; the label is never guessed
  // back from the description text.
  Object.freeze({
    ...row('aaaaaaaa-bbbb-4ccc-8ddd-000000000009', '2026-08-21', 'Fixture unlabelled charge', null, 218),
    category: null,
    classification_reason: 'uncategorised_consumption',
    owner: null,
  }),
  Object.freeze({
    ...row('aaaaaaaa-bbbb-4ccc-8ddd-000000000010', '2026-08-20', 'Fixture split purchase', 'Groceries', 310),
    transaction_group_id: 'fixture-group-split',
    group_kind: 'category_split',
  }),
  row('aaaaaaaa-bbbb-4ccc-8ddd-000000000011', '2026-08-18', 'Fixture restaurant', 'Dining Out', 186),
  // No note recorded at all.
  Object.freeze({ ...row('aaaaaaaa-bbbb-4ccc-8ddd-000000000012', '2026-08-14', '', 'Dining Out', 62), note: null }),
])

export const activityFixtureReads = Object.freeze({
  async listLedgerRows({ from, to } = {}) {
    // Honour the requested window like the real contract does, so navigating
    // to another month genuinely returns different rows — and a deep link to
    // an entry outside the loaded month genuinely fails to resolve.
    if (!from || !to) return LEDGER
    return Object.freeze(LEDGER.filter((row) => row.date >= from && row.date <= to))
  },
  async listAccounts() {
    return fixtureReads.listAccounts()
  },
  async getPeriodMetrics(range) {
    return fixtureReads.getPeriodMetrics(range)
  },
})

export { LEDGER as ACTIVITY_FIXTURE_LEDGER }
