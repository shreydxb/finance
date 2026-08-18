// Executor (Taskiv #51 skeleton, filled in by #52). A plain switch over
// `plan.q` dispatching to hand-written, parameterised `QueryStore` methods
// (types.ts) — no string-built SQL anywhere, ever.
//
// Every money aggregate reads `v_transactions_aed.amount_aed` — the Sprint 1
// FX-normalised view (036_money_view.sql) — never `transactions.amount`
// directly. `PostgrestQueryStore` (store.ts) is what enforces that in SQL;
// this file only orchestrates.

import { matchAccount, matchAccountTies } from '../accountMatch.ts'
import { resolvePeriod } from './period.ts'
import type { AccountRef } from '../../_shared/types.ts'
import type { QueryPlan, QueryResult, QueryStore } from './types.ts'

export async function runQuery(
  plan: QueryPlan,
  store: QueryStore,
  accounts: AccountRef[],
  now: () => Date = () => new Date()
): Promise<QueryResult> {
  switch (plan.q) {
    case 'category_spend': {
      const period = resolvePeriod(plan.period, now())
      const result = await store.categorySpend(plan.category, period, plan.owner)
      return { q: 'category_spend', category: plan.category, ...(plan.owner ? { owner: plan.owner } : {}), ...result }
    }
    case 'total_spend': {
      const period = resolvePeriod(plan.period, now())
      const result = await store.totalSpend(period, plan.owner)
      return { q: 'total_spend', ...(plan.owner ? { owner: plan.owner } : {}), ...result }
    }
    case 'merchant_spend': {
      const period = resolvePeriod(plan.period, now())
      const result = await store.merchantSpend(plan.merchant, period)
      return { q: 'merchant_spend', merchant: plan.merchant, ...result }
    }
    case 'account_spend': {
      // Same scorer a receipt's paid_with resolves through — a question and a
      // receipt name "the ENBD card" identically. A tie or no match becomes a
      // clarifying question, never a guess or a silent zero.
      const matched = matchAccount(plan.account, accounts)
      if (!matched) {
        const tied = matchAccountTies(plan.account, accounts)
        const candidates = tied.length > 0 ? tied.map((a) => a.name) : accounts.map((a) => a.name)
        return { q: 'account_spend', status: 'needs_clarification', candidates }
      }
      const period = resolvePeriod(plan.period, now())
      const result = await store.accountSpend(matched.id, period)
      return { q: 'account_spend', status: 'ok', account: matched.name, ...result }
    }
    case 'recent_transactions': {
      const rows = await store.recentTransactions(plan.limit, plan.owner)
      return { q: 'recent_transactions', rows, ...(plan.owner ? { owner: plan.owner } : {}) }
    }
    case 'budget_status': {
      const period = resolvePeriod(plan.period, now())
      const rows = await store.budgetStatus(period)
      return {
        q: 'budget_status',
        ...(plan.category ? { category: plan.category } : {}),
        period,
        rows,
        isCurrentMonth: plan.period.kind === 'this_month',
      }
    }
  }
}
