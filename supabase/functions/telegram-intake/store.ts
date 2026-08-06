// Postgres access over PostgREST with the service-role key (RLS is bypassed —
// the household allowlist in intake.ts is the gate that matters here).
//
// Plain fetch rather than supabase-js so this module also runs under Node for
// tests without a URL-import shim.

import { DEFAULTS } from './config.ts'
import type { AccountRef, CategoryRef, HouseholdContext, IntakeStore, TransactionRow } from './types.ts'

type FetchLike = typeof fetch

export const SETTINGS_KEYS = {
  person1: 'tg_id_1',
  person2: 'tg_id_2',
  threshold: 'ai_confidence_threshold',
  defaultAccount: 'tg_default_account_id',
}

interface SettingRow {
  key: string
  value: unknown
}

export class PostgrestStore implements IntakeStore {
  baseUrl: string
  serviceKey: string
  fetchImpl: FetchLike
  fallbackThreshold: number
  fallbackTelegramIds: number[]

  constructor(opts: {
    supabaseUrl: string
    serviceKey: string
    fetchImpl?: FetchLike
    fallbackThreshold?: number
    fallbackTelegramIds?: number[]
  }) {
    this.baseUrl = `${opts.supabaseUrl.replace(/\/$/, '')}/rest/v1`
    this.serviceKey = opts.serviceKey
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.fallbackThreshold = opts.fallbackThreshold ?? DEFAULTS.confidenceThreshold
    this.fallbackTelegramIds = opts.fallbackTelegramIds ?? []
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        apikey: this.serviceKey,
        authorization: `Bearer ${this.serviceKey}`,
        'content-type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    })
    if (!res.ok) {
      throw new Error(`Supabase ${init.method ?? 'GET'} ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  async loadHouseholdContext(): Promise<HouseholdContext> {
    const keys = Object.values(SETTINGS_KEYS).join(',')
    const [categories, accounts, settings] = await Promise.all([
      this.request<CategoryRef[]>('/categories?select=name,group&order=name.asc'),
      this.request<AccountRef[]>('/accounts?select=id,name,type,owner&order=created_at.asc'),
      this.request<SettingRow[]>(`/settings?select=key,value&key=in.(${keys})`),
    ])
    return buildHouseholdContext({
      categories,
      accounts,
      settings,
      fallbackThreshold: this.fallbackThreshold,
      fallbackTelegramIds: this.fallbackTelegramIds,
    })
  }

  async insertTransaction(row: Partial<TransactionRow>): Promise<TransactionRow> {
    const rows = await this.request<TransactionRow[]>('/transactions', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify(row),
    })
    return rows[0]
  }

  async updateTransaction(id: string, patch: Partial<TransactionRow>): Promise<TransactionRow> {
    const rows = await this.request<TransactionRow[]>(`/transactions?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify(patch),
    })
    return rows[0]
  }

  async getTransaction(id: string): Promise<TransactionRow | null> {
    const rows = await this.request<TransactionRow[]>(`/transactions?id=eq.${encodeURIComponent(id)}&limit=1`)
    return rows[0] ?? null
  }

  async findTransactionByMessage(chatId: number, messageId: number): Promise<TransactionRow | null> {
    // A correction may reply to the household's own original message or to the
    // bot's follow-up prompt; both point at the same row.
    const filter = `or=(telegram_msg_id.eq.${messageId},telegram_prompt_msg_id.eq.${messageId})`
    const rows = await this.request<TransactionRow[]>(
      `/transactions?telegram_chat_id=eq.${chatId}&${filter}&order=created_at.desc&limit=1`
    )
    return rows[0] ?? null
  }
}

export function buildHouseholdContext(input: {
  categories: CategoryRef[]
  accounts: AccountRef[]
  settings: SettingRow[]
  fallbackThreshold: number
  fallbackTelegramIds: number[]
}): HouseholdContext {
  const byKey = new Map(input.settings.map((s) => [s.key, s.value]))
  const people = new Map<number, string>()

  for (const key of [SETTINGS_KEYS.person1, SETTINGS_KEYS.person2]) {
    const entry = byKey.get(key)
    if (!entry || typeof entry !== 'object') continue
    const { person, telegram_user_id: telegramUserId } = entry as { person?: string; telegram_user_id?: unknown }
    const id = Number(telegramUserId)
    if (person && Number.isInteger(id) && id !== 0) people.set(id, person)
  }

  // Env-configured ids are a bootstrap path for before Settings has been filled
  // in — they grant access but carry no person name.
  for (const id of input.fallbackTelegramIds) {
    if (!people.has(id)) people.set(id, '')
  }

  const rawThreshold = Number(byKey.get(SETTINGS_KEYS.threshold))
  const threshold =
    Number.isFinite(rawThreshold) && rawThreshold >= 0 && rawThreshold <= 1 ? rawThreshold : input.fallbackThreshold

  const rawDefaultAccount = byKey.get(SETTINGS_KEYS.defaultAccount)
  const defaultAccountId =
    typeof rawDefaultAccount === 'string' && input.accounts.some((a) => a.id === rawDefaultAccount)
      ? rawDefaultAccount
      : null

  return {
    categories: input.categories,
    accounts: input.accounts,
    people,
    confidenceThreshold: threshold,
    defaultAccountId,
  }
}
