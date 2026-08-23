import assert from 'node:assert/strict'
import test from 'node:test'

import { averageMonthRanges, buildComparisonSeries, resolveComparisonPeriod } from './spendingComparison.js'

const TODAY = new Date('2026-08-19T00:30:00+04:00')

function row(date, value, classification = 'consumption_spend', quality = 'complete') {
  return {
    date,
    economic_classification: classification,
    consumption_spend_aed: classification === 'consumption_spend' ? value : null,
    quality_status: quality,
  }
}

function metric(range, value, quality = 'complete') {
  return { ...range, consumption_spend_aed: value, quality_status: quality }
}

test('comparison boundaries use the Dubai date across the UTC midnight edge', () => {
  const resolved = resolveComparisonPeriod('week', TODAY)
  assert.deepEqual(resolved.current, { from: '2026-08-17', to: '2026-08-19', label: 'This week' })
  assert.deepEqual(resolved.comparison, { from: '2026-08-10', to: '2026-08-16', label: 'Last week' })
})

test('month and year comparison ranges are complete calendar periods', () => {
  const month = resolveComparisonPeriod('month', TODAY)
  assert.deepEqual(month.comparison, { from: '2026-07-01', to: '2026-07-31', label: 'Last month' })
  const year = resolveComparisonPeriod('year', TODAY)
  assert.deepEqual(year.comparison, { from: '2025-01-01', to: '2025-12-31', label: '2025' })
})

test('canonical comparison cumulatively groups canonical AED consumption facts', () => {
  const resolved = resolveComparisonPeriod('week', TODAY)
  const rows = [
    row('2026-08-17', 40), row('2026-08-18', 20),
    row('2026-08-10', 30), row('2026-08-11', 30), row('2026-08-12', 30),
  ]
  const result = buildComparisonSeries({
    rows,
    currentMetrics: metric(resolved.current, 60),
    comparisonMetrics: metric(resolved.comparison, 90),
  }, resolved)
  assert.equal(result.points[0].current, 40)
  assert.equal(result.points[1].current, 60)
  assert.equal(result.points[2].comparison, 90)
  assert.equal(result.points[3].current, null)
  assert.equal(result.points[3].comparison, 90)
})

test('Transfer/card-settlement canonical facts never enter consumption comparison', () => {
  const resolved = resolveComparisonPeriod('week', TODAY)
  const rows = [row('2026-08-17', 40), row('2026-08-17', null, 'internal_transfer')]
  const result = buildComparisonSeries({
    rows,
    currentMetrics: metric(resolved.current, 40),
    comparisonMetrics: metric(resolved.comparison, 0),
  }, resolved)
  assert.equal(result.points[0].current, 40)
})

test('comparison fails closed when canonical facts do not reconcile', () => {
  const resolved = resolveComparisonPeriod('week', TODAY)
  const result = buildComparisonSeries({
    rows: [row('2026-08-17', 40)],
    currentMetrics: metric(resolved.current, 41),
    comparisonMetrics: metric(resolved.comparison, 0),
  }, resolved)
  assert.equal(result.quality, 'incomplete')
  assert.equal(result.points[0].current, null)
})

test('incomplete missing-FX consumption produces no plausible comparison total', () => {
  const resolved = resolveComparisonPeriod('week', TODAY)
  const result = buildComparisonSeries({
    rows: [row('2026-08-17', null, 'consumption_spend', 'incomplete')],
    currentMetrics: metric(resolved.current, null, 'incomplete'),
    comparisonMetrics: metric(resolved.comparison, 0),
  }, resolved)
  assert.equal(result.quality, 'incomplete')
  assert.ok(result.points.every((point) => point.current === null))
})

test('average comparison uses twelve reconciled canonical months', () => {
  const resolved = resolveComparisonPeriod('month_average', TODAY)
  const ranges = averageMonthRanges(resolved.averageWindow)
  const rows = [row('2025-08-31', 100), row('2025-10-31', 200), row('2026-01-05', 50)]
  const averageMetrics = ranges.map((range) => metric(range, rows.filter((fact) => fact.date >= range.from && fact.date <= range.to).reduce((sum, fact) => sum + fact.consumption_spend_aed, 0)))
  const result = buildComparisonSeries({
    rows,
    currentMetrics: metric(resolved.current, 0),
    averageMetrics,
  }, resolved)
  assert.equal(result.points[4].comparison, 50 / 12)
  assert.equal(Math.round(result.points[30].comparison * 1000) / 1000, Math.round(((300 / 7) + 50 / 12) * 1000) / 1000)
})
