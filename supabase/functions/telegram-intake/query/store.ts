// The real QueryStore (Taskiv #52), backed by `v_transactions_aed`
// (036_money_view.sql) over PostgREST. Every filter is a parameterised
// PostgREST query param built with URLSearchParams — never a concatenated
// SQL string — so nothing a household member (or a forged planner response)
// types can reach the database as anything but a filter value.
//
// Plain fetch, same as `_shared/store.ts`, so this runs under Deno and under
// `node --test` without a URL-import shim.

import type { CategoryBudgetRow, GoalContribution, GoalRecord, InvestmentHolding, NetWorthRow, QueryStore, RecentTransaction, RecurringEntry, ResolvedPeriod, SpendResult, TotalSpendResult } from './types.ts'

type FetchLike = typeof fetch

const SAVINGS_CATEGORY = 'Savings & Investments'
// Transfer is a bookkeeping category, not something to budget against — the
// same exclusion src/screens/Budget.jsx applies before building its rows.
const NON_BUDGETABLE_GROUP = 'Transfer'

interface ViewRow {
  amount: string
  amount_aed: string | null
  currency: string
  category: string | null
  note: string | null
  owner: string | null
  date: string
  needs_review: boolean
}

interface CategoryRow {
  name: string
  group: string
}

interface BudgetRow {
  monthly_limit: string
  categories: { name: string } | null
}

interface NwDailyRow {
  day: string
  total_aed: string
  assets_aed: string
  liabilities_aed: string
  by_owner: Record<string, number> | null
}

function fromNwDailyRow(row: NwDailyRow): NetWorthRow {
  return {
    day: row.day,
    totalAed: Number(row.total_aed),
    assetsAed: Number(row.assets_aed),
    liabilitiesAed: Number(row.liabilities_aed),
    byOwner: row.by_owner ?? {},
  }
}

interface GoalAccountEmbed {
  value: string
  currency: string
  type: string
  interest_rate: string | null
}

interface GoalRow {
  id: string
  name: string
  icon: string | null
  kind: 'save_up' | 'pay_down'
  target_amount: string | null
  monthly_plan: string | null
  priority: number | null
  target_date: string | null
  starting_balance: string | null
  accounts: GoalAccountEmbed | null
}

interface GoalContributionRow {
  goal_id: string
  amount: string
  date: string
}

interface SettingRow {
  value: unknown
}

interface InvestmentRow {
  id: string
  name: string
  ticker: string | null
  quantity: string | null
  avg_cost: string | null
  last_price: string | null
  value: string
  currency: string
  owner: string
  price_updated_at: string | null
}

interface RecurringRow {
  id: string
  name: string
  kind: 'income' | 'expense' | 'emi'
  amount: string
  currency: string
  owner: string | null
  day_of_month: number | null
  months: number[] | null
  autopay: boolean
  end_date: string | null
}

export class PostgrestQueryStore implements QueryStore {
  baseUrl: string
  serviceKey: string
  fetchImpl: FetchLike

  constructor(opts: { supabaseUrl: string; serviceKey: string; fetchImpl?: FetchLike }) {
    this.baseUrl = `${opts.supabaseUrl.replace(/\/$/, '')}/rest/v1`
    this.serviceKey = opts.serviceKey
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  private async select(params: URLSearchParams): Promise<ViewRow[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/v_transactions_aed?${params.toString()}`, {
      headers: { apikey: this.serviceKey, authorization: `Bearer ${this.serviceKey}` },
    })
    if (!res.ok) {
      throw new Error(`Supabase GET v_transactions_aed failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
    }
    return (await res.json()) as ViewRow[]
  }

  private periodParams(period: ResolvedPeriod, owner?: string): URLSearchParams {
    const params = new URLSearchParams({
      select: 'amount,amount_aed,category',
      date: `gte.${period.from}`,
    })
    params.append('date', `lte.${period.to}`)
    if (owner) params.set('owner', `eq.${owner}`)
    return params
  }

  async categorySpend(category: string, period: ResolvedPeriod, owner?: string): Promise<SpendResult> {
    const params = this.periodParams(period, owner)
    params.set('category', `eq.${category}`)
    const rows = await this.select(params)
    return { ...summarise(rows), period }
  }

  async totalSpend(period: ResolvedPeriod, owner?: string): Promise<TotalSpendResult> {
    const rows = await this.select(this.periodParams(period, owner))
    // Moving money into an investment isn't spend — see the Taskiv #52
    // description. Split client-side rather than a second round trip.
    const spendRows = rows.filter((r) => r.category !== SAVINGS_CATEGORY)
    const savingsRows = rows.filter((r) => r.category === SAVINGS_CATEGORY)
    return {
      ...summarise(spendRows),
      excludedSavingsAed: sumAed(savingsRows),
      period,
    }
  }

  async merchantSpend(merchant: string, period: ResolvedPeriod): Promise<SpendResult> {
    const params = this.periodParams(period)
    // note is where the extraction prompt puts "merchant first, then what was
    // bought" (prompt.ts) — there is no dedicated merchant column.
    params.set('note', `ilike.*${escapeLikeSpecials(merchant)}*`)
    const rows = await this.select(params)
    return { ...summarise(rows), period }
  }

  async accountSpend(accountId: string, period: ResolvedPeriod): Promise<SpendResult> {
    const params = this.periodParams(period)
    params.set('account_id', `eq.${accountId}`)
    const rows = await this.select(params)
    return { ...summarise(rows), period }
  }

  async recentTransactions(limit: number, owner?: string): Promise<RecentTransaction[]> {
    const params = new URLSearchParams({
      select: 'date,amount,amount_aed,currency,category,note,owner,needs_review',
      order: 'date.desc,created_at.desc',
      limit: String(limit),
    })
    if (owner) params.set('owner', `eq.${owner}`)
    const res = await this.fetchImpl(`${this.baseUrl}/v_transactions_aed?${params.toString()}`, {
      headers: { apikey: this.serviceKey, authorization: `Bearer ${this.serviceKey}` },
    })
    if (!res.ok) {
      throw new Error(`Supabase GET v_transactions_aed failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
    }
    const rows = (await res.json()) as ViewRow[]
    return rows.map((r) => ({
      date: r.date,
      amount: Number(r.amount),
      amountAed: r.amount_aed === null ? null : Number(r.amount_aed),
      currency: r.currency,
      category: r.category,
      note: r.note,
      owner: r.owner,
      needsReview: r.needs_review,
    }))
  }

  async budgetStatus(period: ResolvedPeriod): Promise<CategoryBudgetRow[]> {
    const [categories, budgets, txRows] = await Promise.all([
      this.fetchJson<CategoryRow[]>('categories', { select: 'name,group' }),
      this.fetchJson<BudgetRow[]>('budgets', { select: 'monthly_limit,categories(name)' }),
      this.select(this.periodParams(period)),
    ])

    const limitByCategory = new Map<string, number>()
    for (const b of budgets) {
      if (b.categories) limitByCategory.set(b.categories.name, Number(b.monthly_limit))
    }

    const spentByCategory = new Map<string, number>()
    for (const row of txRows) {
      if (row.amount_aed === null || !row.category) continue
      spentByCategory.set(row.category, (spentByCategory.get(row.category) ?? 0) + Number(row.amount_aed))
    }

    return categories
      .filter((c) => c.group !== NON_BUDGETABLE_GROUP)
      .map((c) => ({
        category: c.name,
        limitAed: limitByCategory.get(c.name) ?? null,
        spentAed: spentByCategory.get(c.name) ?? 0,
      }))
  }

  async netWorthLatest(): Promise<NetWorthRow | null> {
    const rows = await this.fetchJson<NwDailyRow[]>('nw_daily', {
      select: 'day,total_aed,assets_aed,liabilities_aed,by_owner',
      order: 'day.desc',
      limit: '1',
    })
    return rows[0] ? fromNwDailyRow(rows[0]) : null
  }

  async netWorthOnOrBefore(day: string): Promise<NetWorthRow | null> {
    const rows = await this.fetchJson<NwDailyRow[]>('nw_daily', {
      select: 'day,total_aed,assets_aed,liabilities_aed,by_owner',
      day: `lte.${day}`,
      order: 'day.desc',
      limit: '1',
    })
    return rows[0] ? fromNwDailyRow(rows[0]) : null
  }

  async netWorthEarliestDay(): Promise<string | null> {
    const rows = await this.fetchJson<{ day: string }[]>('nw_daily', {
      select: 'day',
      order: 'day.asc',
      limit: '1',
    })
    return rows[0]?.day ?? null
  }

  async goalsWithContributions(): Promise<GoalRecord[]> {
    const [goals, contributions] = await Promise.all([
      this.fetchJson<GoalRow[]>('goals', {
        select: 'id,name,icon,kind,target_amount,monthly_plan,priority,target_date,starting_balance,accounts(value,currency,type,interest_rate)',
        order: 'priority.asc.nullslast',
      }),
      this.fetchJson<GoalContributionRow[]>('goal_contributions', { select: 'goal_id,amount,date' }),
    ])
    const contributionsByGoal = new Map<string, GoalContribution[]>()
    for (const c of contributions) {
      const list = contributionsByGoal.get(c.goal_id) ?? []
      list.push({ amount: Number(c.amount), date: c.date })
      contributionsByGoal.set(c.goal_id, list)
    }
    return goals.map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      kind: g.kind,
      targetAmount: g.target_amount === null ? null : Number(g.target_amount),
      monthlyPlan: g.monthly_plan === null ? null : Number(g.monthly_plan),
      priority: g.priority,
      targetDate: g.target_date,
      startingBalance: g.starting_balance === null ? null : Number(g.starting_balance),
      linkedAccount: g.accounts
        ? {
            value: Number(g.accounts.value),
            currency: g.accounts.currency,
            type: g.accounts.type,
            interestRate: g.accounts.interest_rate === null ? null : Number(g.accounts.interest_rate),
          }
        : null,
      contributions: contributionsByGoal.get(g.id) ?? [],
    }))
  }

  async fxRates(): Promise<Record<string, number>> {
    const rows = await this.fetchJson<SettingRow[]>('settings', { select: 'value', key: 'eq.fx_rates' })
    const value = rows[0]?.value
    return value && typeof value === 'object' ? (value as Record<string, number>) : { AED: 1 }
  }

  async recurringEntries(): Promise<RecurringEntry[]> {
    const rows = await this.fetchJson<RecurringRow[]>('recurring', {
      select: 'id,name,kind,amount,currency,owner,day_of_month,months,autopay,end_date',
    })
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      amount: Number(r.amount),
      currency: r.currency,
      owner: r.owner,
      dayOfMonth: r.day_of_month,
      months: r.months ?? [],
      autopay: r.autopay,
      endDate: r.end_date,
    }))
  }

  async investmentHoldings(): Promise<InvestmentHolding[]> {
    const rows = await this.fetchJson<InvestmentRow[]>('accounts', {
      select: 'id,name,ticker,quantity,avg_cost,last_price,value,currency,owner,price_updated_at',
      type: 'eq.investment',
    })
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      ticker: r.ticker,
      quantity: r.quantity === null ? null : Number(r.quantity),
      avgCost: r.avg_cost === null ? null : Number(r.avg_cost),
      lastPrice: r.last_price === null ? null : Number(r.last_price),
      value: Number(r.value),
      currency: r.currency,
      owner: r.owner,
      priceUpdatedAt: r.price_updated_at,
    }))
  }

  async needsReviewCount(): Promise<number> {
    const rows = await this.fetchJson<{ id: string }[]>('transactions', {
      select: 'id',
      needs_review: 'eq.true',
      deleted_at: 'is.null',
    })
    return rows.length
  }

  private async fetchJson<T>(table: string, params: Record<string, string>): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}/${table}?${new URLSearchParams(params).toString()}`, {
      headers: { apikey: this.serviceKey, authorization: `Bearer ${this.serviceKey}` },
    })
    if (!res.ok) {
      throw new Error(`Supabase GET ${table} failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
    }
    return (await res.json()) as T
  }
}

function summarise(rows: ViewRow[]): { amountAed: number; count: number; unconvertedCount: number } {
  return {
    amountAed: sumAed(rows),
    count: rows.length,
    unconvertedCount: rows.filter((r) => r.amount_aed === null).length,
  }
}

/** Postgres's own sum() skips NULL rather than propagating it — see 036_money_view.sql. */
function sumAed(rows: ViewRow[]): number {
  return rows.reduce((total, r) => (r.amount_aed === null ? total : total + Number(r.amount_aed)), 0)
}

/** PostgREST pattern operators treat `%`, `_` and `\` specially; escape them so a merchant name containing one is matched literally, not as a wildcard. */
function escapeLikeSpecials(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`)
}
