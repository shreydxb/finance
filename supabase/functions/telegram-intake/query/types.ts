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
 * budget_status (this one), net_worth, goal_progress, upcoming_bills,
 * portfolio_summary, needs_review_count — the rest not built here.
 *
 * `account` on `account_spend` is deliberately a free-text guess ("ENBD
 * card"), not a name pre-matched against the household's account list —
 * unlike `category` (a closed enum) an account name is exactly the kind of
 * thing people paraphrase, and `intake.ts` already has a scorer built for
 * that (`matchAccount`). Run.ts resolves it the same way a receipt's
 * `paid_with` is resolved, including the tie case, rather than duplicating a
 * second, stricter matcher in the planner.
 *
 * `budget_status.category` is omitted for the full grid — the same
 * `matchCategory` validation `category_spend` goes through when it is
 * present, so an unmatched category is `unknown_category`, never a made-up
 * one. `period` defaults to `this_month` like every other query (budgets are
 * monthly by definition — see the task), but is not hard-coded so "how did
 * we do on groceries last month" still plans cleanly.
 */
export type QueryPlan =
  | { q: 'category_spend'; category: string; period: Period; owner?: string }
  | { q: 'total_spend'; period: Period; owner?: string }
  | { q: 'merchant_spend'; merchant: string; period: Period }
  | { q: 'account_spend'; account: string; period: Period }
  | { q: 'recent_transactions'; limit: number; owner?: string }
  | { q: 'budget_status'; category?: string; period: Period }
  | { q: 'net_worth'; owner?: string; compare?: Period }
  | { q: 'goal_progress'; goal?: string }
  | { q: 'upcoming_bills'; days?: number }

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

/**
 * One category's budget standing for a period — `limitAed` is `null` when
 * the household has no `budgets` row for it at all, which is NOT the same as
 * a limit of zero (see the Taskiv #54 task: rendering an unbudgeted category
 * as "0 / 0" or "over budget" is the exact bug this type exists to prevent).
 * A stored `monthly_limit` of 0 is treated identically to `null` by
 * `query/budget.ts` — a limit that can never be met is not a limit either.
 */
export interface CategoryBudgetRow {
  category: string
  limitAed: number | null
  spentAed: number
}

export interface BudgetStatusResult {
  period: ResolvedPeriod
  rows: CategoryBudgetRow[]
  /** Only `this_month` gets the "N days left, pace" line — see query/budget.ts. */
  isCurrentMonth: boolean
}

/**
 * One recorded day of `nw_daily` (src/lib/snapshots.js) — client-recorded,
 * upserted once per day the app is opened, never backfilled or estimated.
 * `byOwner` keys are the literal `accounts.owner` strings the app writer
 * groups by ("Shrey", "Tarika"), not a fixed enum — read from the live row,
 * never assumed (see the Taskiv #55 task).
 */
export interface NetWorthRow {
  day: string
  totalAed: number
  assetsAed: number
  liabilitiesAed: number
  byOwner: Record<string, number>
}

/**
 * The result of comparing `net_worth`'s latest snapshot against an earlier
 * one for `compare`. `unavailable` is not an error — it is the honest
 * response when the earliest recorded day falls *inside* the requested
 * window, so there is no snapshot from before the period started to compare
 * against. Never interpolated or estimated (PLAN.md's rule for this table).
 */
export type NetWorthChange =
  | { kind: 'unavailable'; earliestDay: string }
  | { kind: 'delta'; fromDay: string; fromAed: number; deltaAed: number; deltaPct: number; periodLabel: string }

export interface NetWorthResult {
  asOf: string
  totalAed: number
  assetsAed: number
  liabilitiesAed: number
  byOwner: Record<string, number>
  /** Present only when the plan asked for a `compare` period. */
  change?: NetWorthChange
}

/** save_up: saving toward a target. pay_down: working down a linked liability. */
export type GoalKind = 'save_up' | 'pay_down'

export interface GoalContribution {
  amount: number
  date: string
}

/**
 * The linked account's raw fields, in its own currency — conversion to AED
 * happens at format time (query/goals.ts), the same "convert only at
 * display time" rule `src/lib/money.js` documents for the app itself.
 */
export interface LinkedGoalAccount {
  value: number
  currency: string
  type: string
  interestRate: number | null
}

/**
 * One `goals` row plus everything its progress math needs. Every formula
 * that reads this is ported from `src/screens/Goals.jsx` and
 * `src/screens/Debts.jsx`, not reinvented — see the Taskiv #56 task's own
 * warning that a bot reporting different progress than those screens is
 * worse than no bot.
 */
export interface GoalRecord {
  id: string
  name: string
  icon: string | null
  kind: GoalKind
  targetAmount: number | null
  monthlyPlan: number | null
  priority: number | null
  targetDate: string | null
  /** AED, per the schema — never itself in a foreign currency (unlike a linked account's own `value`). */
  startingBalance: number | null
  linkedAccount: LinkedGoalAccount | null
  contributions: GoalContribution[]
}

/**
 * Both non-`ok` cases mirror `account_spend`'s pattern: a tied or
 * unmatched free-text guess becomes a clarifying question, never a guess.
 */
export type GoalProgressResult =
  | { status: 'ok'; goals: GoalRecord[]; fxRates: Record<string, number>; todayIso: string }
  | { status: 'needs_clarification'; candidates: string[] }

/** income/expense/emi — mirrors src/lib/recurringSchedule.js's RECURRING_KINDS. */
export type RecurringKind = 'income' | 'expense' | 'emi'

export interface RecurringEntry {
  id: string
  name: string
  kind: RecurringKind
  amount: number
  currency: string
  owner: string | null
  dayOfMonth: number | null
  months: number[]
  autopay: boolean
  endDate: string | null
}

/** One projected occurrence of a `RecurringEntry` inside the requested window. */
export interface BillOccurrence {
  date: string
  name: string
  amount: number
  currency: string
  /** AED-converted amount, or null when the currency has no FX rate right now. */
  amountAed: number | null
  autopay: boolean
  kind: RecurringKind
}

export interface UpcomingBillsResult {
  days: number
  /** expense/emi occurrences only, sorted by date — income never mixes into this list or its totals. */
  bills: BillOccurrence[]
  /** income occurrences, sorted by date — listed separately, "Coming in", never summed into what's owed. */
  income: BillOccurrence[]
  totalDueAed: number
  totalDueUnconvertedCount: number
  notOnAutopayAed: number
  notOnAutopayUnconvertedCount: number
}

export type QueryResult =
  | ({ q: 'category_spend'; category: string; owner?: string } & SpendResult)
  | ({ q: 'total_spend'; owner?: string } & TotalSpendResult)
  | ({ q: 'merchant_spend'; merchant: string } & SpendResult)
  | ({ q: 'account_spend' } & AccountSpendOutcome)
  | { q: 'recent_transactions'; rows: RecentTransaction[]; owner?: string }
  | ({ q: 'budget_status'; category?: string } & BudgetStatusResult)
  | ({ q: 'net_worth'; owner?: string } & NetWorthResult)
  | ({ q: 'goal_progress' } & GoalProgressResult)
  | ({ q: 'upcoming_bills' } & UpcomingBillsResult)

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
  /** Every real (non-Transfer) category, its budget limit if any, and its spend for `period`. */
  budgetStatus(period: ResolvedPeriod): Promise<CategoryBudgetRow[]>
  /** The most recently recorded `nw_daily` row, or null if none has ever been recorded. */
  netWorthLatest(): Promise<NetWorthRow | null>
  /** The most recent `nw_daily` row on or before `day`, or null when no row that old exists. */
  netWorthOnOrBefore(day: string): Promise<NetWorthRow | null>
  /** The earliest day `nw_daily` has any row for, or null when the table is empty. */
  netWorthEarliestDay(): Promise<string | null>
  /** Every goal, its linked account (if any) and every contribution — small tables, fetched whole. */
  goalsWithContributions(): Promise<GoalRecord[]>
  /** `settings.fx_rates` — "1 unit of X is worth N AED", AED always 1. */
  fxRates(): Promise<Record<string, number>>
  /** The whole `recurring` table — 24 rows live, small enough to fetch whole and project client-side. */
  recurringEntries(): Promise<RecurringEntry[]>
}
