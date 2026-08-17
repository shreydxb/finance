// The real QueryStore (Taskiv #52), backed by `v_transactions_aed`
// (036_money_view.sql) over PostgREST. Every filter is a parameterised
// PostgREST query param built with URLSearchParams — never a concatenated
// SQL string — so nothing a household member (or a forged planner response)
// types can reach the database as anything but a filter value.
//
// Plain fetch, same as `_shared/store.ts`, so this runs under Deno and under
// `node --test` without a URL-import shim.

import type { QueryStore, RecentTransaction, ResolvedPeriod, SpendResult, TotalSpendResult } from './types.ts'

type FetchLike = typeof fetch

const SAVINGS_CATEGORY = 'Savings & Investments'

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
