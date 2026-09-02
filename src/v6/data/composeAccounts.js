import { buildAccountsModel } from './accountsModel.js'

/**
 * The Accounts composition (SHR-180).
 *
 * Exactly two canonical reads, settled independently so a failure in one does
 * not erase the other: a failed balance sheet still leaves the account rows
 * readable, and a failed account read still leaves the household totals
 * stated. Neither failure falls back to a legacy reader, a cached figure or a
 * reconstruction from the ledger.
 */

function failureText(error, subject) {
  const detail = error?.message ? ` (${error.message})` : ''
  return `${subject} could not be read${detail}. No legacy account reader, browser conversion or transaction reconstruction is substituted.`
}

async function settle(factory, subject) {
  try {
    return { value: await factory(), error: null }
  } catch (error) {
    return { value: null, error: failureText(error, subject) }
  }
}

export async function composeAccounts({ group, reads }) {
  if (!reads) throw new Error('composeAccounts requires approved reads')
  const [balanceSheet, accounts] = await Promise.all([
    settle(() => reads.getBalanceSheet(), 'Current canonical balance sheet'),
    settle(() => reads.listAccounts(), 'Canonical account positions'),
  ])
  return buildAccountsModel({
    group,
    balanceSheet: balanceSheet.value,
    accounts: accounts.value,
    errors: { balanceSheet: balanceSheet.error, accounts: accounts.error },
  })
}
