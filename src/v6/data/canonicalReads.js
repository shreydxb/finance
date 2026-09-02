/**
 * The production canonical reads.
 *
 * This is the only V6 data module that touches the Supabase-backed adapters,
 * which is why the composition itself lives in `composeOverview.js`.
 */

import {
  getCanonicalBalanceSheet,
  getCanonicalInvestmentMetrics,
  getCanonicalPeriodMetrics,
  listCanonicalAccounts,
  listCanonicalBudgetActuals,
  listCanonicalLedgerRows,
} from '../../lib/canonicalMetrics.js'
import { listAuthoritativeNetWorthHistory } from '../../lib/snapshots.js'

export const canonicalReads = Object.freeze({
  getBalanceSheet: getCanonicalBalanceSheet,
  getInvestments: getCanonicalInvestmentMetrics,
  getPeriodMetrics: getCanonicalPeriodMetrics,
  listBudgetActuals: listCanonicalBudgetActuals,
  listLedgerRows: listCanonicalLedgerRows,
  listAccounts: listCanonicalAccounts,
  listNetWorthHistory: listAuthoritativeNetWorthHistory,
})
