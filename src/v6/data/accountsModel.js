import { availableSlot, errorSlot, incompleteSlot } from './slots.js'
import { accountsGapSlot } from './accountsGaps.js'
import { resolveAccountsGrouping } from './accountsGrouping.js'

/**
 * Wealth → Accounts model (SHR-180).
 *
 * Two canonical reads and nothing else: `canonical_balance_sheet` for the
 * household totals, and `v_canonical_accounts_aed` for the rows. There is no
 * ledger input here at all, which is what makes "no transaction-derived
 * valuation" a structural property of this module rather than a convention —
 * there are no posted rows in scope to reconstruct a balance from.
 *
 * Three rules shape everything below:
 *
 *  1. Native value and AED value are separate published facts. The model
 *     carries both exactly as the contract returned them and never derives one
 *     from the other. A row with a native figure and no AED figure keeps the
 *     AED position empty rather than borrowing the native number.
 *  2. Ownership is not in this model. The canonical row's legacy `owner` text
 *     is discarded here, at the boundary, so no component downstream can
 *     render it as an ownership claim by accident.
 *  3. Timestamps are reported, never judged. `valuation_as_of`, `fx_updated_at`
 *     and the contract's own `freshness_status` are passed through; no
 *     threshold turns any of them into fresh, stale or overdue.
 */

// Presentation labels for the canonical `accounts.type` vocabulary. This maps a
// contract value to English; it does not decide what an account is, and no
// entry is chosen by inspecting a name, note or amount. An unrecognised type
// falls through to the canonical value itself rather than to a guess.
const ACCOUNT_TYPE_LABELS = Object.freeze({
  cash: 'Cash', bank: 'Bank', savings: 'Savings', fixed_deposit: 'Fixed deposit',
  investment: 'Investment', property: 'Property', gold: 'Gold', other_asset: 'Other asset',
  credit_card: 'Credit card', loan: 'Loan', mortgage: 'Mortgage', other_liability: 'Other liability',
})

// Section order within assets and within liabilities. Ordering only: an
// account's side of the balance sheet comes from the contract's own
// `is_liability`, never from this list and never from its type label.
const TYPE_ORDER = Object.freeze([
  'cash', 'bank', 'savings', 'fixed_deposit', 'investment', 'property', 'gold', 'other_asset',
  'credit_card', 'loan', 'mortgage', 'other_liability',
])

const VALUATION_METHOD_LABELS = Object.freeze({
  account_balance: 'Account balance',
  quantity_times_last_price: 'Quantity × last published price',
  manual_account_value: 'Manual account value',
})

// The canonical view's own categorisation of where a valuation timestamp comes
// from. These are descriptions of the published category, not verdicts about
// how current a value is — "Manual entry" says who supplies the number, not
// whether it is old.
const FRESHNESS_EVIDENCE_LABELS = Object.freeze({
  account_balance: 'Recorded account balance',
  timestamped: 'Published price timestamp',
  manual: 'Manual entry, no published price',
  missing_timestamp: 'No price timestamp recorded',
})

export function accountTypeLabel(type) {
  return ACCOUNT_TYPE_LABELS[type] ?? type
}

function accountName(row) {
  return typeof row.name === 'string' && row.name.trim() ? row.name.trim() : accountTypeLabel(row.type)
}

function nativeSlot(row) {
  if (row.canonical_value_native === null) {
    return incompleteSlot('The canonical account contract publishes no native valuation for this account.')
  }
  return availableSlot(row.canonical_value_native, { source: 'v_canonical_accounts_aed.canonical_value_native' })
}

function aedSlot(row) {
  if (row.canonical_value_aed === null) {
    // Deliberately not filled from the native value. A missing AED figure means
    // the canonical contract could not state one — most often because
    // settings.fx_rates publishes no rate for this currency — and converting
    // it here would answer a question the contract declined to answer.
    return incompleteSlot(
      row.fx_rate_to_aed === null
        ? `No published FX rate for ${row.currency}, so the canonical contract states no AED value. It is not converted here.`
        : 'The canonical account contract withholds this AED value while its valuation inputs are incomplete.',
    )
  }
  return availableSlot(row.canonical_value_aed, { source: 'v_canonical_accounts_aed.canonical_value_aed' })
}

function accountRow(row) {
  return Object.freeze({
    id: row.id,
    name: accountName(row),
    typeKey: row.type,
    type: accountTypeLabel(row.type),
    // The contract's own asset/liability fact. Nothing here moves an account
    // between the two sides, and no value is negated to make a total read well:
    // the canonical view states liabilities as positive magnitudes and this
    // model keeps them that way, with the side carried as text.
    isLiability: row.is_liability,
    sideLabel: row.is_liability ? 'Liability' : 'Asset',
    currency: row.currency,
    native: nativeSlot(row),
    aed: aedSlot(row),
    quality: row.quality_status,
    valuationMethod: VALUATION_METHOD_LABELS[row.valuation_method] ?? row.valuation_method,
    valuationMethodKey: row.valuation_method,
    valuationAsOf: row.valuation_as_of,
    freshnessEvidence: row.freshness_status === null
      ? null
      : FRESHNESS_EVIDENCE_LABELS[row.freshness_status] ?? row.freshness_status,
    fxRate: row.fx_rate_to_aed,
    fxUpdatedAt: row.fx_updated_at,
    // Ownership is a slot, not a value, and it is the same gap for every row:
    // the screen shows the prototype's column and says what is missing rather
    // than printing `row.owner`, which is never read here.
    ownership: accountsGapSlot('ownership'),
  })
}

function compareRows(left, right) {
  const order = TYPE_ORDER.indexOf(left.typeKey) - TYPE_ORDER.indexOf(right.typeKey)
  if (order !== 0) return order
  return left.name.localeCompare(right.name, 'en')
}

function buildSections(rows) {
  const sections = new Map()
  for (const row of rows) {
    const key = row.typeKey
    if (!sections.has(key)) {
      sections.set(key, {
        key,
        label: row.type,
        isLiability: row.isLiability,
        sideLabel: row.sideLabel,
        rows: [],
      })
    }
    sections.get(key).rows.push(row)
  }
  return Object.freeze([...sections.values()]
    .sort((left, right) => {
      // Assets before liabilities, then the fixed type order. Both facts come
      // from the contract; neither is decided by an amount's sign.
      if (left.isLiability !== right.isLiability) return left.isLiability ? 1 : -1
      return TYPE_ORDER.indexOf(left.key) - TYPE_ORDER.indexOf(right.key)
    })
    .map((section) => Object.freeze({
      ...section,
      rows: Object.freeze([...section.rows].sort((left, right) => left.name.localeCompare(right.name, 'en'))),
      count: section.rows.length,
      // Counting rows is structural. Summing their AED values would be a wealth
      // aggregate no contract publishes, so the position is named, not filled.
      total: accountsGapSlot('groupTotals'),
    })))
}

function buildPositions(accounts, error) {
  const empty = { sections: Object.freeze([]), rows: Object.freeze([]) }
  if (error) return Object.freeze({ status: 'unavailable', reason: error, ...empty })
  if (!Array.isArray(accounts)) {
    return Object.freeze({
      status: 'unavailable',
      reason: 'Canonical account rows have not been read.',
      ...empty,
    })
  }
  if (accounts.length === 0) {
    return Object.freeze({
      status: 'empty',
      reason: 'No accounts are recorded in the household’s canonical account set.',
      ...empty,
    })
  }
  const rows = Object.freeze([...accounts.map(accountRow)].sort(compareRows))
  return Object.freeze({ status: 'available', reason: null, rows, sections: buildSections(rows) })
}

function buildSummary(positions) {
  if (positions.status !== 'available') {
    return Object.freeze({ accountCount: null, currencyCount: null, currencies: Object.freeze([]) })
  }
  const currencies = Object.freeze([...new Set(positions.rows.map((row) => row.currency))].sort())
  return Object.freeze({
    // Both are counts of canonical rows and distinct canonical currency codes.
    // Neither is a financial metric, and neither says anything about how
    // current a valuation is — the prototype's "all valued today" claim is
    // withheld under `freshness` instead.
    accountCount: positions.rows.length,
    currencyCount: currencies.length,
    currencies,
  })
}

function totalSlot(value, error, field) {
  if (error) return errorSlot(error)
  if (value === null || value === undefined) {
    return incompleteSlot(`canonical_balance_sheet withholds ${field} while required account inputs are incomplete.`)
  }
  return availableSlot(value, { source: `canonical_balance_sheet.${field}` })
}

function buildTotals(balanceSheet, error) {
  return Object.freeze({
    // Household totals come from the balance-sheet contract, where a shared
    // account is counted exactly once. They are never a sum of the rows in the
    // table above, which is why an incomplete row can leave a total withheld
    // while the rows themselves still render.
    net: totalSlot(balanceSheet?.net_worth_aed, error, 'net_worth_aed'),
    assets: totalSlot(balanceSheet?.assets_aed, error, 'assets_aed'),
    liabilities: totalSlot(balanceSheet?.liabilities_aed, error, 'liabilities_aed'),
    scope: balanceSheet?.scope ?? null,
    quality: balanceSheet?.quality_status ?? null,
    incompleteAccountCount: balanceSheet?.incomplete_account_count ?? null,
    provisionalAccountCount: balanceSheet?.provisional_account_count ?? null,
    missingFxCount: balanceSheet?.missing_fx_count ?? null,
    fxUpdatedAt: balanceSheet?.quality_metadata?.fx_updated_at ?? null,
    fxBasis: balanceSheet?.quality_metadata?.fx_basis ?? null,
  })
}

const CAPABILITIES = Object.freeze({
  add: accountsGapSlot('maintenance'),
  edit: accountsGapSlot('maintenance'),
  revalue: accountsGapSlot('maintenance'),
  archive: accountsGapSlot('maintenance'),
  changeOwner: accountsGapSlot('ownershipMaintenance'),
  countTowardNetWorth: accountsGapSlot('netWorthContribution'),
})

const GAPS = Object.freeze({
  ownership: accountsGapSlot('ownership'),
  ownerGrouping: accountsGapSlot('ownerGrouping'),
  scope: accountsGapSlot('scope'),
  provenance: accountsGapSlot('provenance'),
  freshness: accountsGapSlot('freshness'),
  history: accountsGapSlot('history'),
  performance: accountsGapSlot('performance'),
  groupTotals: accountsGapSlot('groupTotals'),
})

export function buildAccountsModel({ group, balanceSheet = null, accounts = null, errors = {} }) {
  const positions = buildPositions(accounts, errors.accounts ?? null)
  return Object.freeze({
    grouping: resolveAccountsGrouping(group),
    positions,
    summary: buildSummary(positions),
    totals: buildTotals(balanceSheet, errors.balanceSheet ?? null),
    capabilities: CAPABILITIES,
    gaps: GAPS,
  })
}

/**
 * Resolves a `/wealth/accounts/:id` deep link against the loaded canonical set.
 *
 * Fails closed: an identifier that is not in the set the household could read
 * returns `unavailable` with the access gap, never a partially populated
 * record and never a claim that the account exists elsewhere.
 */
export function resolveAccountDetail(model, id) {
  if (!id) return Object.freeze({ status: 'none', row: null, slot: null })
  const row = model?.positions?.rows?.find((candidate) => candidate.id === id) ?? null
  if (row) return Object.freeze({ status: 'found', row, slot: null })
  return Object.freeze({ status: 'unavailable', row: null, slot: accountsGapSlot('access') })
}

export { ACCOUNT_TYPE_LABELS }
