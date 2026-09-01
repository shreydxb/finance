/**
 * The V6 Overview view model.
 *
 * This module is pure: it imports no Supabase client and performs no I/O, so
 * it is testable under `node --test`. It also performs **no financial
 * arithmetic**. Every monetary figure it returns is a value a canonical
 * contract already computed and validated; the module only decides which slot
 * a value belongs in, and what to say when a contract cannot supply one.
 *
 * Three statuses are deliberately distinct:
 *
 *  - `available`   — a canonical contract returned the value.
 *  - `incomplete`  — a canonical contract returned `null` **on purpose**,
 *                    because its required inputs are incomplete. The contract
 *                    exists and answered; the answer is "not computable".
 *  - `unavailable` — no approved contract can supply the slot at all, or the
 *                    read failed. Carries the named gap from `gaps.js`.
 *
 * Collapsing those into one "—" would hide the difference between a household
 * data problem the household can fix and a product gap only a backend contract
 * can close.
 */

import { reconcilesAtCents } from '../../lib/canonicalPresentation.js'
import { gapSlot, OVERVIEW_GAPS } from './gaps.js'

const RECENT_ACTIVITY_LIMIT = 7
const ACCOUNT_LIMIT = 8
const TOP_SPEND_LIMIT = 5

const INCOMPLETE_REASONS = Object.freeze({
  posted_income_aed: 'Posted income is incomplete for this period, so the canonical contract withholds the figure.',
  consumption_spend_aed: 'Consumption spend is incomplete for this period, so the canonical contract withholds the figure.',
  savings_aed: 'Savings needs both posted income and consumption spend; at least one is incomplete.',
  balance: 'The canonical balance sheet reports incomplete account inputs, so it withholds monetary totals.',
  investment: 'The canonical investment contract reports incomplete holdings, so it withholds the value.',
  amount_aed: 'No FX rate is recorded for this entry’s currency, so it has no canonical AED amount.',
})

export function availableSlot(value, extra = {}) {
  return Object.freeze({ status: 'available', value, ...extra })
}

export function incompleteSlot(reason) {
  return Object.freeze({ status: 'incomplete', reason })
}

export function errorSlot(reason) {
  return Object.freeze({ status: 'unavailable', gap: null, reason })
}

function canonicalFigure(value, incompleteReasonKey, extra = {}) {
  if (value === null || value === undefined) return incompleteSlot(INCOMPLETE_REASONS[incompleteReasonKey])
  return availableSlot(value, extra)
}

function sourced(contract, field) {
  return `${contract}.${field}`
}

/* ── Hero and household summary ─────────────────────────────────────────── */

function buildSummary({ balanceSheet, investments, balanceError, investmentError }) {
  const balanceSlot = (field, key) => {
    if (balanceError) return errorSlot(balanceError)
    if (!balanceSheet) return errorSlot('The canonical balance sheet has not been read.')
    return canonicalFigure(balanceSheet[field], key, { source: sourced('canonical_balance_sheet', field) })
  }

  const investmentSlot = () => {
    if (investmentError) return errorSlot(investmentError)
    if (!investments) return errorSlot('The canonical investment contract has not been read.')
    return canonicalFigure(investments.investment_value_aed, 'investment', {
      source: sourced('canonical_investment_metrics', 'investment_value_aed'),
    })
  }

  return {
    netWorth: balanceSlot('net_worth_aed', 'balance'),
    assets: balanceSlot('assets_aed', 'balance'),
    liabilities: balanceSlot('liabilities_aed', 'balance'),
    investments: investmentSlot(),
    balanceQuality: balanceSheet?.quality_status ?? null,
    investmentQuality: investments?.quality_status ?? null,
    // Slots the prototype fills that no approved contract can fill yet.
    changeThisPeriod: gapSlot('netWorthChange'),
    twelveMonthChange: gapSlot('twelveMonthChange'),
    runway: gapSlot('runway'),
    equityShare: gapSlot('equityShare'),
    investmentDayChange: gapSlot('investmentDayChange'),
    scopeNote: 'Whole household, counted once',
  }
}

/* ── Period KPIs ────────────────────────────────────────────────────────── */

function savingsRateSlot(metrics) {
  if (metrics.savings_rate_percent !== null) {
    return availableSlot(metrics.savings_rate_percent, {
      unit: 'percent',
      source: sourced('canonical_period_metrics', 'savings_rate_percent'),
    })
  }
  if (metrics.savings_rate_reason === 'nonpositive_income') {
    return incompleteSlot('Unavailable because posted income for this period is zero or negative.')
  }
  return incompleteSlot('Unavailable because required canonical inputs are incomplete.')
}

function buildKpis({ periodMetrics, periodError }) {
  const failed = (reason) => ([
    { key: 'income', label: 'Income', slot: errorSlot(reason) },
    { key: 'spend', label: 'Spend', slot: errorSlot(reason) },
    { key: 'saved', label: 'Saved', slot: errorSlot(reason) },
    { key: 'rate', label: 'Savings rate', slot: errorSlot(reason) },
    { key: 'budget', label: 'Budget left', slot: gapSlot('budgetRemaining') },
  ])

  if (periodError) return failed(periodError)
  if (!periodMetrics) return failed('The canonical period contract has not been read.')

  return [
    {
      key: 'income',
      label: 'Income',
      hint: 'Posted income only',
      slot: canonicalFigure(periodMetrics.posted_income_aed, 'posted_income_aed', {
        source: sourced('canonical_period_metrics', 'posted_income_aed'),
      }),
    },
    {
      key: 'spend',
      label: 'Spend',
      hint: 'Consumption spend; transfers excluded',
      slot: canonicalFigure(periodMetrics.consumption_spend_aed, 'consumption_spend_aed', {
        source: sourced('canonical_period_metrics', 'consumption_spend_aed'),
      }),
    },
    {
      key: 'saved',
      label: 'Saved',
      hint: 'Posted income less consumption spend',
      slot: canonicalFigure(periodMetrics.savings_aed, 'savings_aed', {
        source: sourced('canonical_period_metrics', 'savings_aed'),
      }),
    },
    {
      key: 'rate',
      label: 'Savings rate',
      hint: 'Share of posted income',
      slot: savingsRateSlot(periodMetrics),
    },
    {
      key: 'budget',
      label: 'Budget left',
      hint: OVERVIEW_GAPS.budgetRemaining.contract,
      slot: gapSlot('budgetRemaining'),
    },
  ]
}

/* ── Cash-flow series ───────────────────────────────────────────────────── */

function seriesColumn(entry) {
  const { range, metrics, error } = entry
  if (error || !metrics) {
    return {
      key: range.key,
      from: range.from,
      to: range.to,
      income: null,
      spend: null,
      rate: null,
      quality: null,
      note: error ?? 'This month was not read.',
    }
  }
  return {
    key: range.key,
    from: range.from,
    to: range.to,
    income: metrics.posted_income_aed,
    spend: metrics.consumption_spend_aed,
    rate: metrics.savings_rate_percent,
    quality: metrics.quality_status,
    note: null,
  }
}

/**
 * Geometry only. Bar heights and the savings-rate polyline are drawing
 * instructions derived from canonical values — they are never rounded back
 * into a figure the screen presents as money.
 */
export function buildCashFlowGeometry(columns) {
  const magnitudes = columns
    .flatMap((column) => [column.income, column.spend])
    .filter((value) => value !== null && Number.isFinite(value))
    .map((value) => Math.abs(value))
  const peak = magnitudes.length ? Math.max(...magnitudes) : 0

  const bars = columns.map((column) => ({
    key: column.key,
    income: peak > 0 && column.income !== null ? Math.abs(column.income) / peak : null,
    spend: peak > 0 && column.spend !== null ? Math.abs(column.spend) / peak : null,
  }))

  const rates = columns.map((column) => column.rate)
  const known = rates.filter((rate) => rate !== null && Number.isFinite(rate))
  let polyline = null
  if (known.length >= 2) {
    const low = Math.min(0, ...known)
    const high = Math.max(0, ...known)
    const span = high - low
    const step = 100 / columns.length
    polyline = columns
      .map((column, index) => {
        if (column.rate === null || !Number.isFinite(column.rate)) return null
        const x = step * index + step / 2
        const y = span === 0 ? 50 : 100 - ((column.rate - low) / span) * 100
        return `${x.toFixed(2)},${y.toFixed(2)}`
      })
      .filter(Boolean)
      .join(' ')
  }

  return { peak, bars, polyline }
}

function buildCashFlow({ monthlySeries }) {
  if (!Array.isArray(monthlySeries) || monthlySeries.length === 0) {
    return { status: 'unavailable', reason: 'The canonical monthly series has not been read.', columns: [] }
  }
  const columns = monthlySeries.map(seriesColumn)
  const usable = columns.filter((column) => column.income !== null || column.spend !== null)
  if (usable.length === 0) {
    return {
      status: 'incomplete',
      reason: 'Every month in the window reports incomplete canonical inputs, so no cash-flow series can be drawn.',
      columns,
    }
  }
  return { status: 'available', reason: null, columns, geometry: buildCashFlowGeometry(columns) }
}

/* ── Attention ──────────────────────────────────────────────────────────── */

function signal(id, kind, title, meta, source, action = null) {
  return { id, kind, title, meta, source, action }
}

/**
 * Canonical quality counts, listed verbatim.
 *
 * These are not an attention feed and are not ranked, scored or interpreted:
 * each row is one integer a canonical read contract already returned, next to
 * the field it came from. The ranked feed is SHR-192 and is reported as a gap.
 */
export function buildQualitySignals({ periodMetrics, balanceSheet, investments }) {
  const signals = []

  if (periodMetrics) {
    const metadata = periodMetrics.quality_metadata
    if (periodMetrics.needs_review_count > 0) {
      signals.push(signal(
        'needs-review',
        'Review',
        `${periodMetrics.needs_review_count} transaction${periodMetrics.needs_review_count === 1 ? '' : 's'} flagged for review`,
        'Flagged in this period’s canonical ledger.',
        sourced('canonical_period_metrics', 'needs_review_count'),
        { label: 'Open in Activity', href: '/money/activity?needsReview=1' },
      ))
    }
    if (periodMetrics.zero_placeholder_count > 0) {
      signals.push(signal(
        'zero-placeholder',
        'Amount',
        `${periodMetrics.zero_placeholder_count} unresolved zero placeholder${periodMetrics.zero_placeholder_count === 1 ? '' : 's'}`,
        'Entries captured without a resolved amount.',
        sourced('canonical_period_metrics', 'zero_placeholder_count'),
        { label: 'Open in Activity', href: '/money/activity?needsReview=1' },
      ))
    }
    if (periodMetrics.missing_fx_count > 0) {
      const currencies = metadata.missing_fx_currencies
      signals.push(signal(
        'missing-fx',
        'FX',
        `${periodMetrics.missing_fx_count} entr${periodMetrics.missing_fx_count === 1 ? 'y' : 'ies'} missing a required FX rate`,
        currencies.length ? `No AED rate recorded for ${currencies.join(', ')}.` : 'No AED rate recorded for the entry’s currency.',
        sourced('canonical_period_metrics', 'missing_fx_count'),
      ))
    }
    const inputGaps = [
      ['income_incomplete_count', 'posted income'],
      ['consumption_incomplete_count', 'consumption spend'],
      ['savings_movement_incomplete_count', 'savings movement'],
    ]
    for (const [field, label] of inputGaps) {
      if (metadata[field] > 0) {
        signals.push(signal(
          `input-${field}`,
          'Inputs',
          `${metadata[field]} incomplete ${label} input${metadata[field] === 1 ? '' : 's'}`,
          'The canonical period total for this input is withheld while it is incomplete.',
          sourced('canonical_period_metrics.quality_metadata', field),
        ))
      }
    }
  }

  if (balanceSheet) {
    if (balanceSheet.incomplete_account_count > 0) {
      signals.push(signal(
        'accounts-incomplete',
        'Accounts',
        `${balanceSheet.incomplete_account_count} account${balanceSheet.incomplete_account_count === 1 ? '' : 's'} with incomplete valuation inputs`,
        'Balance-sheet totals are withheld while an account input is incomplete.',
        sourced('canonical_balance_sheet', 'incomplete_account_count'),
        { label: 'Open in Wealth', href: '/wealth/accounts' },
      ))
    }
    if (balanceSheet.provisional_account_count > 0) {
      signals.push(signal(
        'accounts-provisional',
        'Accounts',
        `${balanceSheet.provisional_account_count} account${balanceSheet.provisional_account_count === 1 ? '' : 's'} valued provisionally`,
        'A manual value stands in for a quoted price.',
        sourced('canonical_balance_sheet', 'provisional_account_count'),
        { label: 'Open in Wealth', href: '/wealth/accounts' },
      ))
    }
  }

  if (investments) {
    if (investments.stale_value_count > 0) {
      signals.push(signal(
        'holdings-stale',
        'Holdings',
        `${investments.stale_value_count} holding${investments.stale_value_count === 1 ? '' : 's'} with a stale price`,
        'Reported by the canonical investment contract, not inferred from a refresh schedule.',
        sourced('canonical_investment_metrics', 'stale_value_count'),
        { label: 'Open in Wealth', href: '/wealth/investments' },
      ))
    }
    if (investments.incomplete_value_count > 0) {
      signals.push(signal(
        'holdings-incomplete',
        'Holdings',
        `${investments.incomplete_value_count} holding${investments.incomplete_value_count === 1 ? '' : 's'} with incomplete valuation inputs`,
        'The canonical investment value is withheld while a holding input is incomplete.',
        sourced('canonical_investment_metrics', 'incomplete_value_count'),
        { label: 'Open in Wealth', href: '/wealth/investments' },
      ))
    }
  }

  return signals
}

/* ── Top spend ──────────────────────────────────────────────────────────── */

function buildTopSpend({ budgetActuals, periodMetrics, budgetError }) {
  if (budgetError) return { status: 'unavailable', reason: budgetError, rows: [] }
  if (!Array.isArray(budgetActuals)) {
    return { status: 'unavailable', reason: 'Canonical category actuals have not been read.', rows: [] }
  }
  const total = periodMetrics?.consumption_spend_aed ?? null
  if (total === null) {
    return {
      status: 'incomplete',
      reason: 'Canonical consumption spend is incomplete for this period, so category actuals cannot be shown against a reconciled total.',
      rows: [],
    }
  }
  if (budgetActuals.some((row) => row.quality_status === 'incomplete' || row.actual_aed === null)) {
    return {
      status: 'incomplete',
      reason: 'At least one category actual is incomplete, so the category breakdown does not reconcile to the canonical period total.',
      rows: [],
    }
  }
  const sum = budgetActuals.reduce((running, row) => running + row.actual_aed, 0)
  if (!reconcilesAtCents(sum, total)) {
    return {
      status: 'incomplete',
      reason: 'Category actuals do not reconcile to the canonical period consumption total at two-decimal precision, so no breakdown is shown.',
      rows: [],
    }
  }
  const ordered = [...budgetActuals].sort((left, right) => right.actual_aed - left.actual_aed)
  const peak = ordered.length ? Math.abs(ordered[0].actual_aed) : 0
  const rows = ordered.slice(0, TOP_SPEND_LIMIT).map((row, index) => ({
    key: row.category,
    label: row.category,
    value: row.actual_aed,
    // Drawing width only. No share percentage is stated: a share of spend is a
    // derived metric and no contract publishes one.
    fill: peak > 0 ? Math.abs(row.actual_aed) / peak : 0,
    rank: index,
    transactionCount: row.transaction_count,
    needsReviewCount: row.needs_review_count,
    quality: row.quality_status,
  }))
  return { status: 'available', reason: null, rows, reconciledTotal: total }
}

/* ── Recent activity ────────────────────────────────────────────────────── */

const CLASSIFICATION_LABELS = Object.freeze({
  consumption_spend: 'Spend',
  savings_movement: 'Savings movement',
  internal_transfer: 'Transfer',
})

function buildRecentActivity({ ledgerRows, ledgerError }) {
  if (ledgerError) return { status: 'unavailable', reason: ledgerError, rows: [] }
  if (!Array.isArray(ledgerRows)) {
    return { status: 'unavailable', reason: 'The canonical ledger has not been read.', rows: [] }
  }
  if (ledgerRows.length === 0) {
    return { status: 'empty', reason: 'No canonical ledger entries fall inside this period.', rows: [] }
  }
  const rows = [...ledgerRows]
    .sort((left, right) => (left.date < right.date ? 1 : left.date > right.date ? -1 : 0))
    .slice(0, RECENT_ACTIVITY_LIMIT)
    .map((row) => ({
      key: row.id,
      date: row.date,
      title: row.note?.trim() || 'No description',
      category: row.category ?? null,
      classification: row.economic_classification,
      classificationLabel: CLASSIFICATION_LABELS[row.economic_classification] ?? row.economic_classification,
      needsReview: row.needs_review === true,
      quality: row.quality_status,
      amount: row.amount_aed === null
        ? incompleteSlot(INCOMPLETE_REASONS.amount_aed)
        : availableSlot(row.amount_aed, { source: sourced('v_canonical_ledger_aed', 'amount_aed') }),
    }))
  return { status: 'available', reason: null, rows }
}

/* ── Accounts ───────────────────────────────────────────────────────────── */

const ACCOUNT_TYPE_LABELS = Object.freeze({
  cash: 'Cash',
  bank: 'Bank',
  savings: 'Savings',
  investment: 'Investment',
  credit_card: 'Credit card',
  loan: 'Loan',
  mortgage: 'Mortgage',
  property: 'Property',
  other_asset: 'Other asset',
  other_liability: 'Other liability',
})

function accountLabel(row) {
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  if (name) return name
  return ACCOUNT_TYPE_LABELS[row.type] ?? row.type
}

function buildAccounts({ accounts, accountsError }) {
  if (accountsError) return { status: 'unavailable', reason: accountsError, rows: [], total: 0 }
  if (!Array.isArray(accounts)) {
    return { status: 'unavailable', reason: 'Canonical accounts have not been read.', rows: [], total: 0 }
  }
  if (accounts.length === 0) {
    return { status: 'empty', reason: 'No accounts are recorded for this household.', rows: [], total: 0 }
  }
  const ranked = [...accounts].sort((left, right) => {
    if (left.is_liability !== right.is_liability) return left.is_liability ? 1 : -1
    const leftValue = left.canonical_value_aed ?? -Infinity
    const rightValue = right.canonical_value_aed ?? -Infinity
    return rightValue - leftValue
  })
  const rows = ranked.slice(0, ACCOUNT_LIMIT).map((row) => ({
    key: row.id,
    label: accountLabel(row),
    typeLabel: ACCOUNT_TYPE_LABELS[row.type] ?? row.type,
    owner: row.owner,
    isLiability: row.is_liability,
    currency: row.currency,
    quality: row.quality_status,
    valuationMethod: row.valuation_method,
    valuationAsOf: row.valuation_as_of,
    amount: row.canonical_value_aed === null
      ? incompleteSlot('This account’s canonical AED value is withheld while its inputs are incomplete.')
      : availableSlot(row.canonical_value_aed, { source: sourced('v_canonical_accounts_aed', 'canonical_value_aed') }),
  }))
  return { status: 'available', reason: null, rows, total: accounts.length }
}

/* ── Quality and freshness ──────────────────────────────────────────────── */

function buildQuality({ periodMetrics, balanceSheet, investments, accounts }) {
  const fxUpdatedAt = periodMetrics?.quality_metadata?.fx_updated_at ?? null
  const valuationTimes = Array.isArray(accounts)
    ? accounts.map((row) => row.valuation_as_of).filter(Boolean).sort()
    : []
  return {
    period: periodMetrics?.quality_status ?? null,
    balance: balanceSheet?.quality_status ?? null,
    investments: investments?.quality_status ?? null,
    fxUpdatedAt,
    fxBasis: periodMetrics?.quality_metadata?.fx_basis ?? balanceSheet?.quality_metadata?.fx_basis ?? null,
    oldestAccountValuation: valuationTimes[0] ?? null,
    newestAccountValuation: valuationTimes[valuationTimes.length - 1] ?? null,
    integrationStatus: gapSlot('integrationStatus'),
  }
}

/* ── Entry point ────────────────────────────────────────────────────────── */

export function buildOverviewModel(input) {
  const {
    today,
    period,
    balanceSheet = null,
    investments = null,
    periodMetrics = null,
    monthlySeries = [],
    budgetActuals = null,
    ledgerRows = null,
    accounts = null,
    errors = {},
  } = input

  const attentionSignals = buildQualitySignals({ periodMetrics, balanceSheet, investments })

  return Object.freeze({
    today,
    period,
    summary: buildSummary({
      balanceSheet,
      investments,
      balanceError: errors.balanceSheet ?? null,
      investmentError: errors.investments ?? null,
    }),
    kpis: buildKpis({ periodMetrics, periodError: errors.periodMetrics ?? null }),
    cashFlow: buildCashFlow({ monthlySeries }),
    attention: Object.freeze({
      registry: gapSlot('attentionRegistry'),
      signals: attentionSignals,
      signalsRead: Boolean(periodMetrics || balanceSheet || investments),
    }),
    upcoming: gapSlot('upcoming'),
    topSpend: buildTopSpend({ budgetActuals, periodMetrics, budgetError: errors.budgetActuals ?? null }),
    recentActivity: buildRecentActivity({ ledgerRows, ledgerError: errors.ledgerRows ?? null }),
    accounts: buildAccounts({ accounts, accountsError: errors.accounts ?? null }),
    quality: buildQuality({ periodMetrics, balanceSheet, investments, accounts }),
  })
}
