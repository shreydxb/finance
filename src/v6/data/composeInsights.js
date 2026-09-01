/**
 * Approved read composition for Money → Insights.
 *
 * The production tree reaches only two canonical contracts already consumed
 * by V6: `canonical_period_metrics` and `canonical_budget_actuals`. It never
 * reads ledger rows, income rows, legacy Reports helpers or transaction rows,
 * so client-side grouping and merchant/payee inference have no source data to
 * operate on.
 */

import { buildInsightsModel } from './insightsModel.js'
import { completedMonthsBefore, insightsPeriod } from './insightsPeriods.js'

function failureText(error, subject) {
  const detail = error?.message ? ` (${error.message})` : ''
  return `${subject} could not be read${detail}. No legacy or estimated value is substituted.`
}

async function settle(promiseFactory, subject) {
  try {
    return { value: await promiseFactory(), error: null }
  } catch (error) {
    return { value: null, error: failureText(error, subject) }
  }
}

export async function composeInsights({ kind = 'month', view = 'breakdown', year, month, quarter, today, reads }) {
  if (!reads) throw new Error('composeInsights requires canonical reads')
  const period = insightsPeriod({ kind, year, month, quarter, today })
  const windows = completedMonthsBefore(period)

  const [metrics, categoryActuals, history] = await Promise.all([
    settle(
      () => reads.getPeriodMetrics({ from: period.from, to: period.to }),
      `Canonical period metrics for ${period.label}`,
    ),
    settle(
      () => reads.listBudgetActuals({ from: period.from, to: period.to }),
      `Canonical category actuals for ${period.label}`,
    ),
    Promise.all(windows.map(async (range) => {
      const result = await settle(
        () => reads.getPeriodMetrics({ from: range.from, to: range.to }),
        `Canonical period metrics for ${range.label}`,
      )
      return { range, metrics: result.value, error: result.error }
    })),
  ])

  return buildInsightsModel({
    period,
    view,
    metrics: metrics.value,
    categoryActuals: categoryActuals.value,
    history,
    errors: { metrics: metrics.error, categoryActuals: categoryActuals.error },
  })
}
