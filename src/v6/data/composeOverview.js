/**
 * Canonical read composition for the V6 Overview.
 *
 * Pure by construction: the reads are injected, so this module never imports
 * the Supabase client and stays loadable under `node --test`. That separation
 * is the repository's own rule — logic that lives beside a Supabase import
 * silently becomes untestable.
 *
 * Every read is settled independently. One contract failing must degrade only
 * its own region into an honest unavailable state; it must never blank the
 * screen, and it must never fall back to a legacy non-canonical estimate.
 */

import { buildOverviewModel } from './overviewModel.js'
import { periodToDateRange, trailingCompletedMonths } from './periods.js'

export const CASH_FLOW_MONTHS = 6

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

export async function composeOverview({ periodKey = 'mtd', today, reads, months = CASH_FLOW_MONTHS }) {
  if (!reads) throw new Error('composeOverview requires canonical reads')
  const period = periodToDateRange(periodKey, today)
  const windows = trailingCompletedMonths(months, today)

  const [balance, investments, metrics, budget, ledger, accounts, series] = await Promise.all([
    settle(() => reads.getBalanceSheet(), 'The canonical balance sheet'),
    settle(() => reads.getInvestments(), 'Canonical investment metrics'),
    settle(() => reads.getPeriodMetrics({ from: period.from, to: period.to }), 'Canonical period metrics'),
    settle(() => reads.listBudgetActuals({ from: period.from, to: period.to }), 'Canonical category actuals'),
    settle(() => reads.listLedgerRows({ from: period.from, to: period.to }), 'The canonical ledger'),
    settle(() => reads.listAccounts(), 'Canonical accounts'),
    Promise.all(windows.map(async (range) => {
      const result = await settle(
        () => reads.getPeriodMetrics({ from: range.from, to: range.to }),
        `Canonical metrics for ${range.key}`,
      )
      return { range, metrics: result.value, error: result.error }
    })),
  ])

  return buildOverviewModel({
    today: period.to,
    period,
    balanceSheet: balance.value,
    investments: investments.value,
    periodMetrics: metrics.value,
    monthlySeries: series,
    budgetActuals: budget.value,
    ledgerRows: ledger.value,
    accounts: accounts.value,
    errors: {
      balanceSheet: balance.error,
      investments: investments.error,
      periodMetrics: metrics.error,
      budgetActuals: budget.error,
      ledgerRows: ledger.error,
      accounts: accounts.error,
    },
  })
}
