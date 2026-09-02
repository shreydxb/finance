import { buildNetWorthModel } from './netWorthModel.js'
import { netWorthRange } from './netWorthRanges.js'

function failureText(error, subject) {
  const detail = error?.message ? ` (${error.message})` : ''
  return `${subject} could not be read${detail}. No legacy estimate, transaction reconstruction or current-value fallback is substituted.`
}

async function settle(factory, subject) {
  try {
    return { value: await factory(), error: null }
  } catch (error) {
    return { value: null, error: failureText(error, subject) }
  }
}

export async function composeNetWorth({ rangeKey = '1y', today, reads }) {
  if (!reads) throw new Error('composeNetWorth requires approved reads')
  const range = netWorthRange(rangeKey, today)
  const [balanceSheet, accounts, history] = await Promise.all([
    settle(() => reads.getBalanceSheet(), 'Current canonical balance sheet'),
    settle(() => reads.listAccounts(), 'Canonical account positions'),
    settle(() => reads.listNetWorthHistory({ from: range.from, to: range.to }), 'Authoritative net-worth snapshot history'),
  ])
  return buildNetWorthModel({
    range,
    balanceSheet: balanceSheet.value,
    accounts: accounts.value,
    history: history.value,
    errors: { balanceSheet: balanceSheet.error, accounts: accounts.error, history: history.error },
  })
}
