/**
 * Canonical read composition for the V6 Budget screen.
 *
 * Pure by construction: the reads are injected, so this module never imports
 * the Supabase client and stays loadable under `node --test`.
 *
 * Each read settles independently. The category actuals failing must not blank
 * the period headline, and one month of the year grid failing must not blank
 * the other eleven — that month's column says so instead.
 *
 * Only approved canonical contracts are read: `canonical_budget_actuals` and
 * `canonical_period_metrics`, both already consumed by the V6 Overview. The
 * legacy `src/lib/budgets.js` reader is deliberately absent — its values are
 * not a canonical contract, and the V6 boundary test enforces that.
 */

import { buildBudgetModel } from './budgetModel.js'
import { budgetPeriod } from './budgetPeriods.js'

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

export async function composeBudget({ view = 'month', year, month, today, reads }) {
  if (!reads) throw new Error('composeBudget requires canonical reads')
  const period = budgetPeriod({ view, year, month, today })

  if (period.view === 'year') {
    const [monthlyActuals, monthlyMetrics] = await Promise.all([
      Promise.all(period.months.map(async (window) => {
        const result = await settle(
          () => reads.listBudgetActuals({ from: window.from, to: window.to }),
          `Canonical category actuals for ${window.label}`,
        )
        return { key: window.key, rows: result.value, error: result.error }
      })),
      Promise.all(period.months.map(async (window) => {
        const result = await settle(
          () => reads.getPeriodMetrics({ from: window.from, to: window.to }),
          `Canonical period metrics for ${window.label}`,
        )
        return { key: window.key, metrics: result.value, error: result.error }
      })),
    ])

    return buildBudgetModel({ period, view: 'year', monthlyActuals, monthlyMetrics })
  }

  const [actuals, metrics] = await Promise.all([
    settle(() => reads.listBudgetActuals({ from: period.from, to: period.to }), 'Canonical category actuals'),
    settle(() => reads.getPeriodMetrics({ from: period.from, to: period.to }), 'Canonical period metrics'),
  ])

  return buildBudgetModel({
    period,
    view: 'month',
    budgetActuals: actuals.value,
    periodMetrics: metrics.value,
    errors: { budgetActuals: actuals.error, periodMetrics: metrics.error },
  })
}
