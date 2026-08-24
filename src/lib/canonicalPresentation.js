import { colorizeGroups } from './chartPalette.js'
import { mergeCanonicalQuality } from './canonicalContracts.js'

const CENTS = 100

export function toCents(value) {
  return value === null ? null : Math.round(value * CENTS)
}

export function reconcilesAtCents(actual, expected) {
  if (actual === null || expected === null) return false
  return toCents(actual) === toCents(expected)
}

export function canonicalHeadline(metrics) {
  return Object.freeze({
    income: metrics.posted_income_aed,
    consumption: metrics.consumption_spend_aed,
    savingsMovement: metrics.savings_movement_aed,
    cashRetained: metrics.cash_retained_aed,
    cashFlow: metrics.cash_flow_aed,
    savings: metrics.savings_aed,
    savingsRate: metrics.savings_rate_percent,
    savingsRateReason: metrics.savings_rate_reason,
    quality: metrics.quality_status,
  })
}

function countCopy(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function fxDetail(metrics) {
  const timestamp = metrics.quality_metadata?.fx_updated_at
  if (!timestamp) return 'Current-rate AED basis; no FX timestamp was provided.'
  const formatted = new Date(timestamp).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
  return `Current-rate AED basis; FX updated ${formatted}.`
}

export function qualityCopy(metrics) {
  if (metrics.quality_status === 'complete') {
    return {
      label: 'Complete',
      detail: `All required canonical inputs are complete. ${fxDetail(metrics)}`,
    }
  }
  if (metrics.quality_status === 'provisional') {
    const reviewCount = metrics.needs_review_count
    const provisionalCount = metrics.quality_metadata.provisional_transaction_count
    return {
      label: 'Provisional',
      detail: `${countCopy(reviewCount, 'needs_review transaction')}; ${countCopy(provisionalCount, 'provisional canonical transaction')}. Totals may change. ${fxDetail(metrics)}`,
    }
  }
  const reasons = []
  const metadata = metrics.quality_metadata
  if (metrics.zero_placeholder_count) reasons.push(countCopy(metrics.zero_placeholder_count, 'unresolved zero placeholder'))
  if (metrics.missing_fx_count) {
    const currencies = metadata.missing_fx_currencies.length
      ? ` (${metadata.missing_fx_currencies.join(', ')})`
      : ''
    reasons.push(`${countCopy(metrics.missing_fx_count, 'entry', 'entries')} missing required FX${currencies}`)
  }
  if (metadata.income_incomplete_count) reasons.push(countCopy(metadata.income_incomplete_count, 'incomplete posted-income input'))
  if (metadata.consumption_incomplete_count) reasons.push(countCopy(metadata.consumption_incomplete_count, 'incomplete consumption input'))
  if (metadata.savings_movement_incomplete_count) reasons.push(countCopy(metadata.savings_movement_incomplete_count, 'incomplete savings-movement input'))
  return {
    label: 'Incomplete',
    detail: `${reasons.length ? `${reasons.join('; ')}. ` : 'Required canonical inputs are incomplete. '}Affected canonical monetary totals are unavailable. ${fxDetail(metrics)}`,
  }
}

export function savingsRateCopy(headline) {
  if (headline.savingsRate !== null) return null
  if (headline.savingsRateReason === 'nonpositive_income') return 'Unavailable because posted income is zero or negative.'
  if (headline.savingsRateReason === 'incomplete_inputs') return 'Unavailable because required canonical inputs are incomplete.'
  return 'Unavailable.'
}

function groupFacts(rows, keyFor, valueFor, expectedTotal) {
  if (expectedTotal === null || rows.some((row) => row.quality_status === 'incomplete')) {
    return { groups: [], quality: 'incomplete', reconciles: false }
  }
  const values = new Map()
  let quality = 'complete'
  for (const row of rows) {
    const value = valueFor(row)
    if (value === null) return { groups: [], quality: 'incomplete', reconciles: false }
    const key = keyFor(row)
    values.set(key, (values.get(key) ?? 0) + value)
    quality = mergeCanonicalQuality(quality, row.quality_status)
  }
  const total = [...values.values()].reduce((sum, value) => sum + value, 0)
  if (!reconcilesAtCents(total, expectedTotal)) return { groups: [], quality: 'incomplete', reconciles: false }
  return {
    groups: colorizeGroups([...values].map(([key, value]) => ({ key, label: key, value }))),
    quality,
    reconciles: true,
  }
}

export function categoryConsumptionGroups(rows, expectedTotal) {
  return groupFacts(rows, (row) => row.category, (row) => row.actual_aed, expectedTotal)
}

export function groupedCategoryConsumption(rows, categoryGroupByName, expectedTotal) {
  return groupFacts(
    rows,
    (row) => categoryGroupByName.get(row.category) || 'Uncategorised',
    (row) => row.actual_aed,
    expectedTotal
  )
}

export function ledgerConsumptionGroups(rows, dimension, expectedTotal) {
  const consumption = rows.filter((row) => row.economic_classification === 'consumption_spend')
  const keyFor = dimension === 'owner'
    ? (row) => row.owner || 'Unassigned'
    : (row) => row.note?.trim() || 'No note'
  return groupFacts(consumption, keyFor, (row) => row.consumption_spend_aed, expectedTotal)
}

export function incomeGroups(rows, dimension, expectedTotal) {
  const keyFor = dimension === 'person'
    ? (row) => row.person || 'Unassigned'
    : (row) => row.source?.trim() || row.kind || 'Other'
  return groupFacts(rows, keyFor, (row) => row.amount_aed, expectedTotal)
}

export function consumptionStats(rows, expectedTotal) {
  const consumption = rows.filter((row) => row.economic_classification === 'consumption_spend')
  if (expectedTotal === null || consumption.some((row) => row.quality_status === 'incomplete' || row.consumption_spend_aed === null)) {
    return { count: consumption.length, largest: null, average: null, first: null, last: null }
  }
  const dates = consumption.map((row) => row.date).sort()
  const largest = consumption.length ? Math.max(...consumption.map((row) => row.consumption_spend_aed)) : 0
  return {
    count: consumption.length,
    largest,
    average: consumption.length ? expectedTotal / consumption.length : 0,
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
  }
}

export function buildSankeyModel({ metrics, sources, consumption }) {
  const headline = canonicalHeadline(metrics)
  const required = [headline.income, headline.consumption, headline.savingsMovement, headline.cashRetained]
  if (metrics.quality_status === 'incomplete' || required.some((value) => value === null)) {
    return { canRender: false, reason: 'Canonical flows are incomplete.', sources: [], destinations: [] }
  }
  if (required.some((value) => value < 0) || sources.some((g) => g.value < 0) || consumption.some((g) => g.value < 0)) {
    return { canRender: false, reason: 'Sankey cannot represent signed canonical flows.', sources: [], destinations: [] }
  }
  const sourceTotal = sources.reduce((sum, group) => sum + group.value, 0)
  const consumptionTotal = consumption.reduce((sum, group) => sum + group.value, 0)
  const destinations = [...consumption]
  if (headline.savingsMovement > 0) destinations.push({ key: '__savings_movement', label: 'Savings movement', value: headline.savingsMovement })
  if (headline.cashRetained > 0) destinations.push({ key: '__cash_retained', label: 'Cash retained', value: headline.cashRetained })
  const destinationTotal = destinations.reduce((sum, group) => sum + group.value, 0)
  if (!reconcilesAtCents(sourceTotal, headline.income)
    || !reconcilesAtCents(consumptionTotal, headline.consumption)
    || !reconcilesAtCents(destinationTotal, headline.income)) {
    return { canRender: false, reason: 'Canonical flows do not reconcile at two-decimal precision.', sources: [], destinations: [] }
  }
  return {
    canRender: true,
    reason: null,
    sources: colorizeGroups(sources),
    destinations: colorizeGroups(destinations),
  }
}

export function canonicalTrendPoints(periods, labels) {
  return periods.map((metrics, index) => ({
    key: `${metrics.period_start}:${metrics.period_end}`,
    label: labels[index],
    value: metrics.consumption_spend_aed,
    quality: metrics.quality_status,
  }))
}
