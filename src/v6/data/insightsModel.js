import { insightsGapSlot } from './insightsGaps.js'
import { availableSlot, errorSlot, incompleteSlot } from './slots.js'

const UNCATEGORISED = 'Uncategorised'

function metricSlot(metrics, field, error, incompleteReason) {
  if (error) return errorSlot(error)
  if (!metrics) return errorSlot('Canonical period metrics were not read. No legacy or estimated value is substituted.')
  const value = metrics[field]
  if (value === null || value === undefined) return incompleteSlot(incompleteReason)
  return availableSlot(value, { source: `canonical_period_metrics.${field}` })
}

function categorySlot(row) {
  if (row.actual_aed === null || row.actual_aed === undefined) {
    return incompleteSlot('The category actual is withheld because its canonical inputs are incomplete.')
  }
  return availableSlot(row.actual_aed, { source: 'canonical_budget_actuals.actual_aed' })
}

function cents(value) {
  return Math.round(value * 100)
}

function buildCategories(rows, error, selectedSpend) {
  if (error) return Object.freeze({ status: 'unavailable', reason: error, rows: [], geometry: null })
  if (!Array.isArray(rows)) {
    return Object.freeze({
      status: 'unavailable',
      reason: 'Canonical category actuals were not read. No legacy or estimated value is substituted.',
      rows: [],
      geometry: null,
    })
  }
  if (rows.length === 0) {
    return Object.freeze({
      status: 'empty',
      reason: 'The canonical actuals contract reports no category consumption spend in this period.',
      rows: [],
      geometry: null,
    })
  }

  const output = rows.map((row, index) => Object.freeze({
    key: `${index}:${row.category}`,
    label: row.category,
    isUncategorised: row.category === UNCATEGORISED,
    actual: categorySlot(row),
    comparison: insightsGapSlot('categoryComparison'),
    quality: row.quality_status,
    transactionCount: row.transaction_count,
    needsReviewCount: row.needs_review_count,
    zeroPlaceholderCount: row.zero_placeholder_count,
    missingFxCount: row.missing_fx_count,
    magnitude: null,
  }))

  const allAvailable = output.every((row) => row.actual.status === 'available')
  const publishedTotal = selectedSpend?.status === 'available' ? selectedSpend.value : null
  const total = allAvailable ? output.reduce((sum, row) => sum + row.actual.value, 0) : null
  const reconciled = total !== null && publishedTotal !== null && cents(total) === cents(publishedTotal)
  const peak = reconciled
    ? output.reduce((largest, row) => Math.max(largest, Math.abs(row.actual.value)), 0)
    : 0

  const withGeometry = output.map((row) => Object.freeze({
    ...row,
    // Drawing-only magnitude relative to the largest published category
    // value. It is aria-hidden and is never exposed as a percentage or share.
    magnitude: reconciled && peak > 0 ? Math.abs(row.actual.value) / peak : null,
  }))

  return Object.freeze({
    status: 'available',
    reason: null,
    rows: Object.freeze(withGeometry),
    geometry: Object.freeze({
      drawable: reconciled,
      reason: reconciled
        ? null
        : 'Relative category bars are withheld because the complete category set cannot be reconciled to canonical period consumption spend.',
    }),
  })
}

function buildHistory(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return Object.freeze({ status: 'unavailable', reason: 'No completed-period reads were requested.', rows: [], geometry: null })
  }

  const rows = entries.map((entry) => Object.freeze({
    key: entry.range.key,
    range: entry.range,
    spend: metricSlot(
      entry.metrics,
      'consumption_spend_aed',
      entry.error,
      'Consumption spend is withheld for this month because canonical inputs are incomplete.',
    ),
    income: metricSlot(
      entry.metrics,
      'posted_income_aed',
      entry.error,
      'Posted income is withheld for this month because canonical inputs are incomplete.',
    ),
    quality: entry.metrics?.quality_status ?? null,
  }))

  const drawable = rows.every((row) => row.spend.status === 'available' && row.income.status === 'available')
  const peak = drawable
    ? rows.reduce((largest, row) => Math.max(largest, Math.abs(row.spend.value), Math.abs(row.income.value)), 0)
    : 0
  const bars = rows.map((row) => Object.freeze({
    key: row.key,
    spend: drawable && peak > 0 ? Math.abs(row.spend.value) / peak : null,
    income: drawable && peak > 0 ? Math.abs(row.income.value) / peak : null,
  }))

  return Object.freeze({
    status: rows.some((row) => row.spend.status === 'available' || row.income.status === 'available') ? 'available' : 'unavailable',
    reason: drawable ? null : 'At least one completed month is incomplete or unavailable, so the drawing is withheld rather than implying a continuous series.',
    rows: Object.freeze(rows),
    geometry: Object.freeze({ drawable, bars: Object.freeze(bars) }),
  })
}

export function buildInsightsModel({ period, view, metrics, categoryActuals, history, errors = {} }) {
  const spend = metricSlot(
    metrics,
    'consumption_spend_aed',
    errors.metrics,
    'Consumption spend is withheld for this period because canonical inputs are incomplete.',
  )
  const income = metricSlot(
    metrics,
    'posted_income_aed',
    errors.metrics,
    'Posted income is withheld for this period because canonical inputs are incomplete.',
  )

  return Object.freeze({
    period,
    view,
    summary: Object.freeze({
      spend,
      income,
      quality: metrics?.quality_status ?? null,
      needsReviewCount: metrics?.needs_review_count ?? null,
      zeroPlaceholderCount: metrics?.zero_placeholder_count ?? null,
      missingFxCount: metrics?.missing_fx_count ?? null,
      missingFxCurrencies: metrics?.quality_metadata?.missing_fx_currencies ?? [],
    }),
    categories: buildCategories(categoryActuals, errors.categoryActuals, spend),
    history: buildHistory(history),
    gaps: Object.freeze({
      categoryComparison: insightsGapSlot('categoryComparison'),
      categoryTrend: insightsGapSlot('categoryTrend'),
      descriptions: insightsGapSlot('descriptions'),
      merchantIdentity: insightsGapSlot('merchantIdentity'),
      explanation: insightsGapSlot('explanation'),
      incomeAnalysis: insightsGapSlot('incomeAnalysis'),
      categoryIdentity: insightsGapSlot('categoryIdentity'),
      attribution: insightsGapSlot('attribution'),
    }),
    readOnly: true,
  })
}
