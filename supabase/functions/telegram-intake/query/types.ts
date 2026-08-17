// The query toolbox's closed vocabulary (Taskiv #51).
//
// The model never writes SQL and never does arithmetic — see plan.ts. It
// picks exactly one of these shapes, with parameters, from a prompt that
// lists the household's real category/account names; planQuery then
// validates the result against this enum in code before anything reaches a
// query. Postgres computes every digit from there.

/**
 * A resolved or resolvable date window. `resolvePeriod` (period.ts) turns
 * any of these into concrete from/to dates plus a human label — every reply
 * must state its window, since ambiguity about "this month" is where trust
 * dies (see the task).
 */
export type Period =
  | { kind: 'this_month' }
  | { kind: 'last_month' }
  | { kind: 'this_week' }
  | { kind: 'last_week' }
  | { kind: 'ytd' }
  | { kind: 'last_n_days'; n: number }
  | { kind: 'explicit'; from: string; to: string } // YYYY-MM-DD inclusive

/**
 * The closed set of questions the bot can answer. Sprint 3 adds:
 * budget_status, net_worth, goal_progress, upcoming_bills, portfolio_summary,
 * needs_review_count — not built here.
 */
export type QueryPlan =
  | { q: 'category_spend'; category: string; period: Period; owner?: string }
  | { q: 'total_spend'; period: Period; owner?: string }
  | { q: 'merchant_spend'; merchant: string; period: Period }
  | { q: 'account_spend'; account: string; period: Period }
  | { q: 'recent_transactions'; limit: number; owner?: string }

/** A resolved period, ready to hand to a parameterised query. */
export interface ResolvedPeriod {
  from: string
  to: string
  label: string
}

/**
 * One row of what `recent_transactions` returns. Deliberately narrow — a
 * chat reply summarises, it doesn't dump every column.
 */
export interface RecentTransaction {
  date: string
  amountAed: number | null
  currency: string
  category: string | null
  note: string | null
  owner: string | null
}

/**
 * Every money aggregate reads `amount_aed` from the Sprint 1 FX view
 * (`v_transactions_aed`, 036_money_view.sql), never `transactions.amount`
 * directly — the whole point of that view is one source of truth for every
 * bot money query.
 *
 * `amountAed: null` means "some of the underlying rows had no known FX rate"
 * — see the sharp-edge comment on 036_money_view.sql: Postgres's `sum()`
 * silently skips a NULL `amount_aed` rather than propagating it, so a
 * QueryStore implementation must check for an unconverted row itself
 * (`unconvertedCount`) and this type surfaces that instead of hiding it.
 */
export interface SpendResult {
  amountAed: number | null
  unconvertedCount: number
  period: ResolvedPeriod
}

export type QueryResult =
  | ({ q: 'category_spend'; category: string; owner?: string } & SpendResult)
  | ({ q: 'total_spend'; owner?: string } & SpendResult)
  | ({ q: 'merchant_spend'; merchant: string } & SpendResult)
  | ({ q: 'account_spend'; account: string } & SpendResult)
  | { q: 'recent_transactions'; rows: RecentTransaction[] }

/**
 * Parameterised, hand-written query methods — no string-built SQL anywhere.
 * One method per QueryPlan variant. Implementations land in Taskiv #52
 * ("first five queries"); this task builds only the dispatch shape run.ts
 * switches over.
 */
export interface QueryStore {
  categorySpend(category: string, period: ResolvedPeriod, owner?: string): Promise<SpendResult>
  totalSpend(period: ResolvedPeriod, owner?: string): Promise<SpendResult>
  merchantSpend(merchant: string, period: ResolvedPeriod): Promise<SpendResult>
  accountSpend(account: string, period: ResolvedPeriod): Promise<SpendResult>
  recentTransactions(limit: number, owner?: string): Promise<RecentTransaction[]>
}
