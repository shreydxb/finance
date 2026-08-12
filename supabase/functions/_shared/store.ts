// Postgres access over PostgREST with the service-role key (RLS is bypassed —
// the household allowlist in intake.ts is the gate that matters here).
//
// Plain fetch rather than supabase-js so this module also runs under Node for
// tests without a URL-import shim.
//
// Lives in _shared/ so telegram-push can reuse it. Nothing here imports from
// a specific function's directory (e.g. telegram-intake/config.ts) — that
// one-way dependency is what keeps _shared/ safe to import from either
// function without pulling in the other's secrets/config shape.

import type {
  AccountRef,
  CategoryRef,
  HouseholdContext,
  IncomeInsert,
  IntakeLogEntry,
  IntakeStore,
  MediaGroupState,
  PendingIncome,
  PossibleDuplicate,
  TransactionRow,
} from './types.ts'

type FetchLike = typeof fetch

// Mirrors telegram-intake/config.ts DEFAULTS.confidenceThreshold. Duplicated
// rather than imported, on purpose — see the note above.
const FALLBACK_CONFIDENCE_THRESHOLD = 0.85

export const SETTINGS_KEYS = {
  person1: 'tg_id_1',
  person2: 'tg_id_2',
  threshold: 'ai_confidence_threshold',
  defaultAccount: 'tg_default_account_id',
  chatId: 'tg_chat_id',
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
  /**
   * Injectable clock. `Date.now()` has millisecond resolution, so two media-group
   * joins in the same millisecond produce an identical `updated_at` — which made
   * the "a later join is detectable" test fail on roughly one run in six. The
   * behaviour is worth asserting, so the clock is injectable rather than the
   * assertion weakened.
   */
  now: () => string

  constructor(opts: {
    supabaseUrl: string
    serviceKey: string
    fetchImpl?: FetchLike
    fallbackThreshold?: number
    fallbackTelegramIds?: number[]
    now?: () => string
  }) {
    this.baseUrl = `${opts.supabaseUrl.replace(/\/$/, '')}/rest/v1`
    this.serviceKey = opts.serviceKey
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.fallbackThreshold = opts.fallbackThreshold ?? FALLBACK_CONFIDENCE_THRESHOLD
    this.fallbackTelegramIds = opts.fallbackTelegramIds ?? []
    this.now = opts.now ?? (() => new Date().toISOString())
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
      // Only types someone actually pays a purchase *with*. loan/mortgage/
      // other_liability/investment/real_estate/vehicle/valuable are debt or
      // asset trackers — matching a receipt to "Car Down-Payment EMI" would
      // silently attribute an unrelated new purchase to that debt line rather
      // than to the card that was actually charged.
      this.request<AccountRef[]>('/accounts?select=id,name,type,owner&type=in.(cash,credit_card)&order=created_at.asc'),
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

  async findTransactionsBySplitGroup(splitGroupId: string): Promise<TransactionRow[]> {
    return this.request<TransactionRow[]>(`/transactions?split_group_id=eq.${encodeURIComponent(splitGroupId)}`)
  }

  async getSetting(key: string): Promise<unknown | null> {
    const rows = await this.request<SettingRow[]>(`/settings?select=key,value&key=eq.${encodeURIComponent(key)}`)
    return rows[0]?.value ?? null
  }

  async putSetting(key: string, value: unknown): Promise<void> {
    // resolution=merge-duplicates: an upsert keyed on the `key` primary key,
    // so a second write to the same setting updates in place rather than 409ing.
    await this.request<SettingRow[]>('/settings', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ key, value }),
    })
  }

  async logEvent(entry: IntakeLogEntry): Promise<void> {
    await this.request<void>('/intake_logs', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        direction: entry.direction,
        chat_id: entry.chatId ?? null,
        telegram_user_id: entry.telegramUserId ?? null,
        person: entry.person ?? null,
        telegram_msg_id: entry.telegramMsgId ?? null,
        stage: entry.stage,
        message_type: entry.messageType ?? null,
        input_summary: entry.inputSummary ?? null,
        model: entry.model ?? null,
        prompt_tokens: entry.usage?.promptTokens ?? null,
        completion_tokens: entry.usage?.completionTokens ?? null,
        total_tokens: entry.usage?.totalTokens ?? null,
        success: entry.success,
        error: entry.error ?? null,
        duration_ms: entry.durationMs ?? null,
        transaction_id: entry.transactionId ?? null,
      }),
    })
  }

  async joinMediaGroup(mediaGroupId: string, chatId: number, fileId: string, caption: string | null): Promise<MediaGroupState> {
    const nowIso = this.now()
    const existing = await this.request<MediaGroupRow[]>(
      `/media_groups?media_group_id=eq.${encodeURIComponent(mediaGroupId)}&limit=1`
    )
    if (existing.length === 0) {
      try {
        const rows = await this.request<MediaGroupRow[]>('/media_groups', {
          method: 'POST',
          headers: { prefer: 'return=representation' },
          body: JSON.stringify({ media_group_id: mediaGroupId, chat_id: chatId, file_ids: [fileId], caption, updated_at: nowIso }),
        })
        return fromMediaGroupRow(rows[0])
      } catch {
        // Lost a race: a sibling photo's insert landed between our read and
        // write. Fall through to append instead of losing this photo — the
        // group already exists now, so the PATCH path below picks it up.
      }
    }
    const current =
      existing[0] ??
      (await this.request<MediaGroupRow[]>(`/media_groups?media_group_id=eq.${encodeURIComponent(mediaGroupId)}&limit=1`))[0]
    const fileIds = current.file_ids.includes(fileId) ? current.file_ids : [...current.file_ids, fileId]
    const rows = await this.request<MediaGroupRow[]>(`/media_groups?media_group_id=eq.${encodeURIComponent(mediaGroupId)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({ file_ids: fileIds, caption: current.caption ?? caption, updated_at: nowIso }),
    })
    return fromMediaGroupRow(rows[0])
  }

  async getMediaGroup(mediaGroupId: string): Promise<MediaGroupState | null> {
    const rows = await this.request<MediaGroupRow[]>(`/media_groups?media_group_id=eq.${encodeURIComponent(mediaGroupId)}&limit=1`)
    return rows[0] ? fromMediaGroupRow(rows[0]) : null
  }

  async claimMediaGroup(mediaGroupId: string): Promise<void> {
    await this.request<MediaGroupRow[]>(`/media_groups?media_group_id=eq.${encodeURIComponent(mediaGroupId)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({ processed_at: this.now() }),
    })
  }

  async findPossibleDuplicate(params: {
    amount: number
    currency: string
    date: string
    accountId: string | null
    excludeId: string
  }): Promise<PossibleDuplicate | null> {
    const accountFilter = params.accountId === null ? 'account_id=is.null' : `account_id=eq.${params.accountId}`
    const query = [
      'select=id,note,amount,date',
      'deleted_at=is.null',
      `amount=eq.${params.amount}`,
      `currency=eq.${params.currency}`,
      `date=gte.${shiftIsoDate(params.date, -1)}`,
      `date=lte.${shiftIsoDate(params.date, 1)}`,
      accountFilter,
      `id=neq.${params.excludeId}`,
      'order=created_at.desc',
      'limit=1',
    ].join('&')
    const rows = await this.request<TransactionRow[]>(`/transactions?${query}`)
    const row = rows[0]
    return row ? { id: row.id, note: row.note, amount: Number(row.amount), date: row.date } : null
  }

  async createPendingIncome(row: Omit<PendingIncome, 'id'>): Promise<PendingIncome> {
    const rows = await this.request<PendingIncomeRow[]>('/pending_income', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        person: row.person,
        source: row.source,
        kind: row.kind,
        amount: row.amount,
        currency: row.currency,
        date: row.date,
      }),
    })
    return fromPendingIncomeRow(rows[0])
  }

  async getPendingIncome(id: string): Promise<PendingIncome | null> {
    const rows = await this.request<PendingIncomeRow[]>(`/pending_income?id=eq.${encodeURIComponent(id)}&limit=1`)
    return rows[0] ? fromPendingIncomeRow(rows[0]) : null
  }

  async deletePendingIncome(id: string): Promise<void> {
    await this.request<void>(`/pending_income?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { prefer: 'return=minimal' },
    })
  }

  async insertIncome(row: IncomeInsert): Promise<void> {
    await this.request<void>('/income', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify(row),
    })
  }
}

interface PendingIncomeRow {
  id: string
  person: string
  source: string | null
  kind: string
  amount: number | string | null
  currency: string
  date: string
}

function fromPendingIncomeRow(row: PendingIncomeRow): PendingIncome {
  return {
    id: row.id,
    person: row.person,
    source: row.source,
    kind: row.kind,
    amount: row.amount === null ? null : Number(row.amount),
    currency: row.currency,
    date: row.date,
  }
}

/** Calendar-day shift on an already-resolved YYYY-MM-DD date, no timezone involved. */
function shiftIsoDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

interface MediaGroupRow {
  media_group_id: string
  chat_id: number
  file_ids: string[]
  caption: string | null
  updated_at: string
  processed_at: string | null
}

function fromMediaGroupRow(row: MediaGroupRow): MediaGroupState {
  return {
    fileIds: row.file_ids,
    caption: row.caption,
    updatedAt: row.updated_at,
    processedAt: row.processed_at,
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
