// Executor skeleton (Taskiv #51). A plain switch over `plan.q` dispatching to
// hand-written, parameterised `QueryStore` methods (types.ts) — no
// string-built SQL anywhere, ever. The individual queries are Taskiv #52
// ("first five queries"); this file only owns the dispatch shape and the
// clock/period wiring so #52 has a fixed, tested seam to implement against.
//
// Every money aggregate reads `v_transactions_aed.amount_aed` — the Sprint 1
// FX-normalised view (036_money_view.sql) — never `transactions.amount`
// directly. Whatever implements QueryStore against PostgrestStore must
// enforce that in its SQL, not just in a comment here.

import { resolvePeriod } from './period.ts'
import type { QueryPlan, QueryResult, QueryStore } from './types.ts'

export async function runQuery(plan: QueryPlan, store: QueryStore, now: () => Date = () => new Date()): Promise<QueryResult> {
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
      const period = resolvePeriod(plan.period, now())
      const result = await store.accountSpend(plan.account, period)
      return { q: 'account_spend', account: plan.account, ...result }
    }
    case 'recent_transactions': {
      const rows = await store.recentTransactions(plan.limit, plan.owner)
      return { q: 'recent_transactions', rows }
    }
  }
}
