/**
 * Canonical read composition for the V6 Recurring screen.
 *
 * Pure by construction: the reads are injected, so this module never imports
 * the Supabase client and stays loadable under `node --test`.
 *
 * Exactly one canonical contract is read — `canonical_period_metrics`, already
 * consumed by the V6 Overview and Budget — and it supplies exactly one figure
 * this screen states: the period's consumption spend, shown as the total the
 * prototype's fixed-versus-variable split would be taken of.
 *
 * The reads this module deliberately does **not** make are the point:
 *
 *  - `listLedgerRows` / raw transactions. A posted transaction is not evidence
 *    that a recurring plan exists, and the moment a ledger read reaches this
 *    screen the temptation to cluster it into commitments becomes a one-line
 *    change. It is not read at all, so the inference cannot be written.
 *  - `src/lib/recurring.js`. Not a canonical contract, and its writer would
 *    create commitments SHR-171's plan contract could not later version.
 *  - Posted income. The screen's only income position is the prototype's
 *    *expected* income; that gap names SHR-167 rather than borrowing a total.
 */

import { buildRecurringModel } from './recurringModel.js'
import { recurringPeriod } from './recurringPeriods.js'

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

export async function composeRecurring({ view = 'list', type = 'bills', year, month, today, reads }) {
  if (!reads) throw new Error('composeRecurring requires canonical reads')
  const period = recurringPeriod({ year, month, today })

  const metrics = await settle(
    () => reads.getPeriodMetrics({ from: period.from, to: period.to }),
    'Canonical period metrics',
  )

  return buildRecurringModel({
    period,
    view,
    type,
    periodMetrics: metrics.value,
    errors: { periodMetrics: metrics.error },
  })
}
