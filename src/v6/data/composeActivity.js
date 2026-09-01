/**
 * Canonical read composition for the V6 Activity screen.
 *
 * Pure by construction: the reads are injected, so this module never imports
 * the Supabase client and stays loadable under `node --test`.
 *
 * Each read settles independently. The ledger failing must not blank the
 * period totals, and canonical accounts failing must not invent an account
 * name — it degrades that column to an honest state instead.
 */

import { buildActivityModel } from './activityModel.js'
import { monthPeriod } from './activityPeriods.js'

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

export async function composeActivity({ year, month, today, reads, filters, view = 'list' }) {
  if (!reads) throw new Error('composeActivity requires canonical reads')
  const period = monthPeriod({ year, month, today })

  const [ledger, accounts, metrics] = await Promise.all([
    settle(() => reads.listLedgerRows({ from: period.from, to: period.to }), 'The canonical ledger'),
    settle(() => reads.listAccounts(), 'Canonical accounts'),
    settle(() => reads.getPeriodMetrics({ from: period.from, to: period.to }), 'Canonical period metrics'),
  ])

  return buildActivityModel({
    period,
    ledgerRows: ledger.value,
    accounts: accounts.value,
    periodMetrics: metrics.value,
    filters,
    view,
    errors: {
      ledgerRows: ledger.error,
      accounts: accounts.error,
      periodMetrics: metrics.error,
    },
  })
}
