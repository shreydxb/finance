// Templates a QueryResult into the chat reply (Taskiv #52). Every digit here
// came from the query result — nothing is regenerated or re-summed by a
// model. Every reply states its window, and a zero-result answer is worded
// as plainly as a real one, not as an error.

import { formatAmount, formatDate } from '../format.ts'
import { formatBudgetStatusReply } from './budget.ts'
import { formatGoalProgressReply } from './goals.ts'
import { formatNetWorthReply } from './networth.ts'
import type { QueryResult } from './types.ts'

export function formatQueryReply(result: QueryResult): string {
  switch (result.q) {
    case 'category_spend':
      return spendLines(`${result.category}${ownerSuffix(result.owner)}, ${result.period.label}`, result, {
        zero: `Nothing logged for ${result.category}${ownerSuffix(result.owner)} in ${result.period.label} yet.`,
      })
    case 'total_spend': {
      const lines = spendLines(`Total spend${ownerSuffix(result.owner)}, ${result.period.label}`, result, {
        zero: `Nothing logged${ownerSuffix(result.owner)} in ${result.period.label} yet.`,
      })
      if (result.excludedSavingsAed > 0) {
        return `${lines}\n(excludes ${formatAmount(result.excludedSavingsAed)} AED into Savings & Investments)`
      }
      return lines
    }
    case 'merchant_spend': {
      const header =
        result.count === 0
          ? `Nothing matching "${result.merchant}" in ${result.period.label} yet.`
          : `Matching "${result.merchant}" in ${result.period.label}: ${formatAmount(result.amountAed)} AED across ${result.count} transaction${result.count === 1 ? '' : 's'}${unconvertedSuffix(result.unconvertedCount)}`
      return `${header}\n(matched on the note text)`
    }
    case 'account_spend':
      return formatAccountSpendReply(result)
    case 'recent_transactions':
      return formatRecentTransactions(result)
    case 'budget_status':
      return formatBudgetStatusReply(result.category, result.rows, result.period, result.isCurrentMonth)
    case 'net_worth':
      return formatNetWorthReply(result.owner, result)
    case 'goal_progress':
      return formatGoalProgressReply(result)
  }
}

function ownerSuffix(owner: string | undefined): string {
  return owner ? ` (${owner})` : ''
}

function unconvertedSuffix(unconvertedCount: number): string {
  if (unconvertedCount === 0) return ''
  return ` (${unconvertedCount} transaction${unconvertedCount === 1 ? '' : 's'} could not be converted — check the FX rate)`
}

function spendLines(
  header: string,
  result: { amountAed: number; count: number; unconvertedCount: number },
  opts: { zero: string }
): string {
  if (result.count === 0) return opts.zero
  const avg = result.amountAed / result.count
  return `${header}: ${formatAmount(result.amountAed)} AED${unconvertedSuffix(result.unconvertedCount)}\n${result.count} transaction${result.count === 1 ? '' : 's'} · avg ${formatAmount(avg)} AED`
}

function formatAccountSpendReply(
  result: Extract<QueryResult, { q: 'account_spend' }>
): string {
  if (result.status === 'needs_clarification') {
    return `Which account did you mean — ${result.candidates.join(', ')}?`
  }
  return spendLines(`${result.account}, ${result.period.label}`, result, {
    zero: `Nothing logged on ${result.account} in ${result.period.label} yet.`,
  })
}

function formatRecentTransactions(result: Extract<QueryResult, { q: 'recent_transactions' }>): string {
  const header = `Recent transactions${ownerSuffix(result.owner)}:`
  if (result.rows.length === 0) return `Nothing logged${ownerSuffix(result.owner)} yet.`
  const lines = result.rows.map((row) => {
    const flag = row.needsReview ? '⚠️ ' : ''
    const amount = row.amountAed === null ? `${formatAmount(row.amount)} ${row.currency} (unconverted)` : `${formatAmount(row.amountAed)} AED`
    const parts = [formatDate(row.date), row.category ?? 'Uncategorised', amount, row.note].filter(Boolean)
    return `${flag}${parts.join(' · ')}`
  })
  return [header, ...lines].join('\n')
}
