import { availableSlot, errorSlot, incompleteSlot } from './slots.js'
import { netWorthGapSlot } from './netWorthGaps.js'

const ACCOUNT_TYPE_LABELS = Object.freeze({
  cash: 'Cash', bank: 'Bank', savings: 'Savings', fixed_deposit: 'Fixed deposit',
  investment: 'Investment', property: 'Property', gold: 'Gold', other_asset: 'Other asset',
  credit_card: 'Credit card', loan: 'Loan', mortgage: 'Mortgage', other_liability: 'Other liability',
})

const VALUATION_LABELS = Object.freeze({
  account_balance: 'Account balance',
  quantity_times_last_price: 'Quantity × last published price',
  manual_account_value: 'Manual account value',
})

function currentFigure(value, error, field) {
  if (error) return errorSlot(error)
  if (value === null || value === undefined) {
    return incompleteSlot(`canonical_balance_sheet withholds ${field} while required account inputs are incomplete.`)
  }
  return availableSlot(value, { source: `canonical_balance_sheet.${field}` })
}

function buildCurrent(balanceSheet, error) {
  return Object.freeze({
    netWorth: currentFigure(balanceSheet?.net_worth_aed, error, 'net_worth_aed'),
    assets: currentFigure(balanceSheet?.assets_aed, error, 'assets_aed'),
    liabilities: currentFigure(balanceSheet?.liabilities_aed, error, 'liabilities_aed'),
    quality: balanceSheet?.quality_status ?? null,
    incompleteAccountCount: balanceSheet?.incomplete_account_count ?? null,
    provisionalAccountCount: balanceSheet?.provisional_account_count ?? null,
    missingFxCount: balanceSheet?.missing_fx_count ?? null,
    fxUpdatedAt: balanceSheet?.quality_metadata?.fx_updated_at ?? null,
    change: netWorthGapSlot('change'),
    composition: netWorthGapSlot('composition'),
    scope: netWorthGapSlot('scope'),
  })
}

function accountName(row) {
  return typeof row.name === 'string' && row.name.trim() ? row.name.trim() : ACCOUNT_TYPE_LABELS[row.type] ?? row.type
}

function accountRow(row) {
  return Object.freeze({
    id: row.id,
    name: accountName(row),
    type: ACCOUNT_TYPE_LABELS[row.type] ?? row.type,
    isLiability: row.is_liability,
    currency: row.currency,
    quality: row.quality_status,
    value: row.canonical_value_aed === null
      ? incompleteSlot('The canonical account contract withholds this AED value while its valuation inputs are incomplete.')
      : availableSlot(row.canonical_value_aed, { source: 'v_canonical_accounts_aed.canonical_value_aed' }),
    valuationMethod: VALUATION_LABELS[row.valuation_method] ?? row.valuation_method,
    valuationAsOf: row.valuation_as_of,
    fxUpdatedAt: row.fx_updated_at,
  })
}

function buildAccounts(accounts, error) {
  if (error) return Object.freeze({ status: 'unavailable', reason: error, assets: [], liabilities: [] })
  if (!Array.isArray(accounts)) {
    return Object.freeze({ status: 'unavailable', reason: 'Canonical account rows have not been read.', assets: [], liabilities: [] })
  }
  if (accounts.length === 0) return Object.freeze({ status: 'empty', reason: 'No canonical accounts are recorded.', assets: [], liabilities: [] })
  const rows = accounts.map(accountRow)
  return Object.freeze({
    status: 'available',
    reason: null,
    assets: Object.freeze(rows.filter((row) => !row.isLiability)),
    liabilities: Object.freeze(rows.filter((row) => row.isLiability)),
  })
}

/** Drawing-only geometry. It never returns a financial number to the UI. */
export function buildNetWorthGeometry(points) {
  const published = points.filter((point) => point.total_aed !== null)
  if (published.length === 0) return Object.freeze([])
  const dates = points.map((point) => Date.parse(`${point.day}T00:00:00Z`))
  const first = Math.min(...dates)
  const last = Math.max(...dates)
  const span = last - first
  const peak = Math.max(...published.flatMap((point) => [Math.abs(point.assets_aed), Math.abs(point.liabilities_aed), Math.abs(point.total_aed)]), 1)
  // Net-worth points use their signed published values. Including zero in the
  // drawing domain prevents equal-magnitude positive and negative observations
  // from collapsing to the same vertical position without exposing a new
  // financial metric or comparison.
  const netMin = Math.min(0, ...published.map((point) => point.total_aed))
  const netMax = Math.max(0, ...published.map((point) => point.total_aed))
  const netSpan = netMax - netMin
  return Object.freeze(points.map((point) => Object.freeze({
    day: point.day,
    status: point.history_status,
    missing: point.total_aed === null,
    x: span === 0 ? 50 : ((Date.parse(`${point.day}T00:00:00Z`) - first) / span) * 100,
    assetHeight: point.assets_aed === null ? 0 : (Math.abs(point.assets_aed) / peak) * 100,
    liabilityHeight: point.liabilities_aed === null ? 0 : (Math.abs(point.liabilities_aed) / peak) * 100,
    netY: point.total_aed === null ? null : (netSpan === 0 ? 50 : ((netMax - point.total_aed) / netSpan) * 100),
  })))
}

function historyRow(point) {
  return Object.freeze({
    ...point,
    change: netWorthGapSlot('change'),
    saved: netWorthGapSlot('saved'),
  })
}

function buildHistory(history, error) {
  const gaps = { change: netWorthGapSlot('change'), saved: netWorthGapSlot('saved') }
  if (error) return Object.freeze({ status: 'unavailable', reason: error, rows: [], geometry: [], ...gaps })
  if (!Array.isArray(history)) {
    return Object.freeze({ status: 'unavailable', reason: 'Authoritative snapshot history has not been read.', rows: [], geometry: [], ...gaps })
  }
  if (history.length === 0) {
    return Object.freeze({ status: 'empty', reason: 'No authoritative or preserved legacy snapshot facts exist in this range.', rows: [], geometry: [], ...gaps })
  }
  return Object.freeze({
    status: 'available',
    reason: null,
    rows: Object.freeze([...history].reverse().map(historyRow)),
    geometry: buildNetWorthGeometry(history),
    ...gaps,
  })
}

export function buildNetWorthModel({ range, balanceSheet = null, accounts = null, history = null, errors = {} }) {
  return Object.freeze({
    range,
    current: buildCurrent(balanceSheet, errors.balanceSheet ?? null),
    accounts: buildAccounts(accounts, errors.accounts ?? null),
    history: buildHistory(history, errors.history ?? null),
    provenance: netWorthGapSlot('provenance'),
    freshness: netWorthGapSlot('freshness'),
  })
}
