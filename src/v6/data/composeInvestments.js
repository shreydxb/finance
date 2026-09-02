import { buildInvestmentsModel } from './investmentsModel.js'

/**
 * The Investments composition (SHR-202).
 *
 * Exactly two canonical reads, settled independently so a failure in one does
 * not erase the other: a failed portfolio read still leaves the positions
 * readable, and a failed position read still leaves the published portfolio
 * totals stated. Neither failure falls back to a legacy investment reader, a
 * cached figure, a price API or a reconstruction from the ledger.
 */

function failureText(error, subject) {
  const detail = error?.message ? ` (${error.message})` : ''
  return `${subject} could not be read${detail}. No legacy investment reader, browser valuation, currency conversion or transaction reconstruction is substituted.`
}

async function settle(factory, subject) {
  try {
    return { value: await factory(), error: null }
  } catch (error) {
    return { value: null, error: failureText(error, subject) }
  }
}

export async function composeInvestments({ reads }) {
  if (!reads) throw new Error('composeInvestments requires approved reads')
  const [metrics, positions] = await Promise.all([
    settle(() => reads.getInvestments(), 'Current canonical portfolio metrics'),
    settle(() => reads.listInvestmentPositions(), 'Canonical investment positions'),
  ])
  return buildInvestmentsModel({
    metrics: metrics.value,
    positions: positions.value,
    errors: { metrics: metrics.error, positions: positions.error },
  })
}
