// The query toolbox's closed vocabulary (Taskiv #51, extended by #52).
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
 *
 * `account` on `account_spend` is deliberately a free-text guess ("ENBD
 * card"), not a name pre-matched against the household's account list —
 * unlike `category` (a closed enum) an account name is exactly the kind of
 * thing people paraphrase, and `intake.ts` already has a scorer built for
 * that (`matchAccount`). Run.ts resolves it the same way a receipt's
 * `paid_with` is resolved, including the tie case, rather than duplicating a
 * second, stricter matcher in the planner.
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
  /** The amount as stored, in its own currency — always present, even when amountAed is null. */
  amount: number
  amountAed: number | null
  currency: string
  category: string | null
  note: string | null
  owner: string | null
  /** Surfaced with a ⚠️ in the reply — the answer doubles as a review nudge. */
  needsReview: boolean
}

/**
 * Every money aggregate reads `amount_aed` from the Sprint 1 FX view
 * (`v_transactions_aed`, 036_money_view.sql), never `transactions.amount`
 * directly — the whole point of that view is one source of truth for every
 * bot money query.
 *
 * `amountAed` is the sum over only the rows that had a known FX rate — 0 for
 * a genuine "nothing logged", same as Postgres's own `sum()` behaviour (see
 * the sharp-edge comment on 036_money_view.sql: it silently skips NULL
 * inputs). `unconvertedCount` is what surfaces the rows `sum()` hid, so a
 * caller can never mistake "some rows couldn't be converted" for "there was
 * no spend".
 */
export interface SpendResult {
  amountAed: number
  count: number
  unconvertedCount: number
  period: ResolvedPeriod
}

/** total_spend additionally reports what it excluded, so the reply can say so. */
export interface TotalSpendResult extends SpendResult {
  /** Sum of `Savings & Investments` rows over the same window — moving money into an investment isn't spend. */
  excludedSavingsAed: number
}

/**
 * account_spend's three possible outcomes from resolving a free-text guess
 * against the household's real accounts via `matchAccount`/`matchAccountTies`:
 * a clean match, a tie (matchAccount abstained because two accounts scored
 * equally), or no match at all. Both non-`ok` cases become a clarifying
 * question in the reply rather than a guess or a silent zero.
 */
export type AccountSpendOutcome =
  | ({ status: 'ok'; account: string } & SpendResult)
  | { status: 'needs_clarification'; candidates: string[] }

export type QueryResult =
  | ({ q: 'category_spend'; category: string; owner?: string } & SpendResult)
  | ({ q: 'total_spend'; owner?: string } & TotalSpendResult)
  | ({ q: 'merchant_spend'; merchant: string } & SpendResult)
  | ({ q: 'account_spend' } & AccountSpendOutcome)
  | { q: 'recent_transactions'; rows: RecentTransaction[]; owner?: string }

/**
 * Parameterised, hand-written query methods — no string-built SQL anywhere.
 * `accountId` (not a name or guess) because resolution already happened in
 * run.ts by the time this is called.
 */
export interface QueryStore {
  categorySpend(category: string, period: ResolvedPeriod, owner?: string): Promise<SpendResult>
  totalSpend(period: ResolvedPeriod, owner?: string): Promise<TotalSpendResult>
  merchantSpend(merchant: string, period: ResolvedPeriod): Promise<SpendResult>
  accountSpend(accountId: string, period: ResolvedPeriod): Promise<SpendResult>
  recentTransactions(limit: number, owner?: string): Promise<RecentTransaction[]>
}
