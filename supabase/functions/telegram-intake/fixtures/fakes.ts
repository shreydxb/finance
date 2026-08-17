// In-memory stand-ins for Telegram, OpenRouter, Groq and Postgres.

import { buildHouseholdContext } from '../../_shared/store.ts'
import type {
  AccountRef,
  BulkRow,
  TransferArgs,
  CategoryRef,
  ChatMessage,
  DownloadedFile,
  HouseholdContext,
  IncomeInsert,
  IntakeLogEntry,
  IntakeStore,
  MediaGroupState,
  Messenger,
  ModelClient,
  PendingIncome,
  PossibleDuplicate,
  SendOptions,
  TelegramMessage,
  Transcriber,
  TransactionRow,
} from '../../_shared/types.ts'
import type { QueryStore, RecentTransaction, ResolvedPeriod, SpendResult, TotalSpendResult } from '../query/types.ts'
import { SHREY_ID, TARIKA_ID } from './updates.ts'

export const CATEGORIES: CategoryRef[] = [
  { name: 'Groceries', group: 'Needs' },
  { name: 'Dining Out', group: 'Wants' },
  { name: 'Transport & Fuel', group: 'Needs' },
  { name: 'Shopping', group: 'Wants' },
  { name: 'Utilities', group: 'Needs' },
  { name: 'Savings & Investments', group: 'Savings' },
  { name: 'Medical', group: 'Needs' },
  { name: 'Other', group: 'Wants' },
]

export const ACCOUNTS: AccountRef[] = [
  { id: 'acc-joint', name: 'Joint Current', type: 'cash', owner: 'Joint' },
  { id: 'acc-enbd', name: 'ENBD Credit Card 4412', type: 'credit_card', owner: 'Shrey' },
  { id: 'acc-wio', name: 'Wio Personal', type: 'cash', owner: 'Tarika' },
]

export function household(overrides: Partial<{ threshold: number; defaultAccountId: string | null }> = {}): HouseholdContext {
  return buildHouseholdContext({
    categories: CATEGORIES,
    accounts: ACCOUNTS,
    settings: [
      { key: 'tg_id_1', value: { person: 'Shrey', telegram_user_id: SHREY_ID } },
      { key: 'tg_id_2', value: { person: 'Tarika', telegram_user_id: TARIKA_ID } },
      { key: 'ai_confidence_threshold', value: overrides.threshold ?? 0.85 },
      { key: 'tg_default_account_id', value: overrides.defaultAccountId ?? null },
    ],
    fallbackThreshold: 0.85,
    fallbackTelegramIds: [],
  })
}

export class FakeStore implements IntakeStore {
  rows = new Map<string, TransactionRow>()
  context: HouseholdContext
  settings = new Map<string, unknown>()
  putSettingCalls: Array<{ key: string; value: unknown }> = []
  failPutSetting = false
  private sequence = 0
  // Separate from `sequence` so group ids don't shift transaction ids.
  private groupSequence = 0

  constructor(context: HouseholdContext = household()) {
    this.context = context
  }

  loadHouseholdContext(): Promise<HouseholdContext> {
    // `context` is otherwise a fixed snapshot from construction, but chatId
    // has to track `settings` live: captureChatId (via getSetting/putSetting,
    // both backed by `settings`) is what tests use to simulate a captured
    // household chat, same as the real PostgrestStore reading it back out of
    // the settings table on the next request.
    const raw = this.settings.get('tg_chat_id') as { chat_id?: unknown } | undefined
    const chatId = raw && Number.isInteger(Number(raw.chat_id)) ? Number(raw.chat_id) : this.context.chatId
    return Promise.resolve({ ...this.context, chatId })
  }

  insertTransaction(row: Partial<TransactionRow>): Promise<TransactionRow> {
    const id = `tx-${++this.sequence}`
    const stored: TransactionRow = {
      id,
      date: row.date ?? '1970-01-01',
      amount: row.amount ?? 0,
      currency: row.currency ?? 'AED',
      account_id: row.account_id ?? null,
      category: row.category ?? null,
      owner: row.owner ?? null,
      note: row.note ?? null,
      source: row.source ?? 'telegram',
      needs_review: row.needs_review ?? false,
      telegram_chat_id: row.telegram_chat_id ?? null,
      telegram_msg_id: row.telegram_msg_id ?? null,
      telegram_prompt_msg_id: row.telegram_prompt_msg_id ?? null,
      items: row.items ?? null,
      deleted_at: row.deleted_at ?? null,
      split_group_id: row.split_group_id ?? null,
      idempotency_key: row.idempotency_key ?? null,
      transaction_group_id: row.transaction_group_id ?? null,
      group_kind: row.group_kind ?? null,
      transfer_direction: row.transfer_direction ?? null,
    }
    this.rows.set(id, stored)
    return Promise.resolve(stored)
  }

  /** Mirrors the unique index: a replayed key updates the row, never adds one. */
  insertTransactionOnce(row: Partial<TransactionRow>, idempotencyKey: string): Promise<TransactionRow> {
    for (const [id, existing] of this.rows) {
      if (existing.idempotency_key === idempotencyKey) {
        const updated = { ...existing, ...row, idempotency_key: idempotencyKey }
        this.rows.set(id, updated)
        return Promise.resolve(updated)
      }
    }
    return this.insertTransaction({ ...row, idempotency_key: idempotencyKey })
  }

  findTransactionsByGroup(groupId: string): Promise<TransactionRow[]> {
    return Promise.resolve(Array.from(this.rows.values()).filter((row) => row.transaction_group_id === groupId))
  }

  updateTransaction(id: string, patch: Partial<TransactionRow>): Promise<TransactionRow> {
    const current = this.rows.get(id)
    if (!current) throw new Error(`no such transaction: ${id}`)
    const updated = { ...current, ...patch }
    this.rows.set(id, updated)
    return Promise.resolve(updated)
  }

  getTransaction(id: string): Promise<TransactionRow | null> {
    return Promise.resolve(this.rows.get(id) ?? null)
  }

  findTransactionByMessage(chatId: number, messageId: number): Promise<TransactionRow | null> {
    for (const row of this.rows.values()) {
      if (row.telegram_chat_id !== chatId) continue
      if (row.telegram_msg_id === messageId || row.telegram_prompt_msg_id === messageId) {
        return Promise.resolve(row)
      }
    }
    return Promise.resolve(null)
  }

  getSetting(key: string): Promise<unknown | null> {
    return Promise.resolve(this.settings.has(key) ? this.settings.get(key) : null)
  }

  putSetting(key: string, value: unknown): Promise<void> {
    this.putSettingCalls.push({ key, value })
    if (this.failPutSetting) return Promise.reject(new Error('settings write failed'))
    this.settings.set(key, value)
    return Promise.resolve()
  }

  logs: IntakeLogEntry[] = []
  failLogEvent = false

  logEvent(entry: IntakeLogEntry): Promise<void> {
    if (this.failLogEvent) return Promise.reject(new Error('log write failed'))
    this.logs.push(entry)
    return Promise.resolve()
  }

  mediaGroups = new Map<string, MediaGroupState>()
  /** Mirrors the unique index on transactions.idempotency_key (027). */
  idempotencyKeys = new Set<string>()
  private mediaGroupClock = 0

  joinMediaGroup(mediaGroupId: string, _chatId: number, fileId: string, caption: string | null): Promise<MediaGroupState> {
    const current = this.mediaGroups.get(mediaGroupId)
    // A monotonic counter, not a real timestamp: two joins in the same test
    // tick would otherwise share a millisecond and break the "am I still the
    // latest" comparison the real store relies on real Postgres time for.
    const updatedAt = String(++this.mediaGroupClock)
    const next: MediaGroupState = {
      fileIds: current && !current.fileIds.includes(fileId) ? [...current.fileIds, fileId] : current?.fileIds ?? [fileId],
      caption: current?.caption ?? caption,
      updatedAt,
      processedAt: current?.processedAt ?? null,
    }
    this.mediaGroups.set(mediaGroupId, next)
    return Promise.resolve(next)
  }

  getMediaGroup(mediaGroupId: string): Promise<MediaGroupState | null> {
    return Promise.resolve(this.mediaGroups.get(mediaGroupId) ?? null)
  }

  /**
   * Compare-and-set, mirroring the real `claim_media_group` (027): exactly one
   * caller wins. Modelling this faithfully is the point — a fake that always
   * returned success would hide the double-extraction the real race caused.
   */
  claimMediaGroup(mediaGroupId: string): Promise<boolean> {
    const current = this.mediaGroups.get(mediaGroupId)
    if (!current || current.processedAt) return Promise.resolve(false)
    this.mediaGroups.set(mediaGroupId, { ...current, processedAt: String(++this.mediaGroupClock) })
    return Promise.resolve(true)
  }

  /** Both transfer rows at once, refusing a replay of the same message. */
  createTransfer(args: TransferArgs): Promise<TransactionRow[]> {
    const keys = [`${args.idempotencyBase}:out`, `${args.idempotencyBase}:in`]
    if (keys.some((k) => this.idempotencyKeys.has(k))) return Promise.resolve([])
    keys.forEach((k) => this.idempotencyKeys.add(k))

    const groupId = `grp-${++this.groupSequence}`
    const base = {
      date: args.date,
      amount: args.amount,
      currency: args.currency,
      category: 'Transfer',
      owner: args.owner,
      source: 'telegram' as const,
      needs_review: args.needsReview,
      telegram_chat_id: args.chatId,
      telegram_msg_id: args.messageId,
      transaction_group_id: groupId,
      group_kind: 'transfer' as const,
    }
    return Promise.all([
      this.insertTransaction({
        ...base,
        account_id: args.fromAccountId,
        note: `Transfer out → ${args.toLabel ?? 'unknown account'}`,
        transfer_direction: 'out',
        idempotency_key: keys[0],
      }),
      this.insertTransaction({
        ...base,
        account_id: args.toAccountId,
        note: `Transfer in ← ${args.fromLabel ?? 'unknown account'}`,
        transfer_direction: 'in',
        idempotency_key: keys[1],
      }),
    ])
  }

  /** All bulk rows at once, refusing a replay of the same message. */
  createBulkTransactions(rows: BulkRow[], chatId: number, idempotencyBase: string): Promise<TransactionRow[]> {
    const keys = rows.map((_, i) => `${idempotencyBase}:${i}`)
    if (keys.some((k) => this.idempotencyKeys.has(k))) return Promise.resolve([])
    keys.forEach((k) => this.idempotencyKeys.add(k))

    const groupId = `grp-${++this.groupSequence}`
    return Promise.all(
      rows.map((row, i) =>
        this.insertTransaction({
          ...row,
          source: 'telegram',
          telegram_chat_id: chatId,
          transaction_group_id: groupId,
          group_kind: 'bulk_batch',
          idempotency_key: keys[i],
        } as Partial<TransactionRow>)
      )
    )
  }

  /**
   * Deletes the proposal and logs the income together. The delete is the
   * guard, exactly as in `apply_pending_income`: a second call finds nothing
   * and returns null rather than logging the same cashback twice.
   */
  applyPendingIncome(pendingId: string): Promise<unknown | null> {
    const pending = this.pendingIncome.get(pendingId)
    if (!pending) return Promise.resolve(null)
    this.pendingIncome.delete(pendingId)
    const row = {
      person: pending.person,
      source: pending.source,
      kind: pending.kind,
      amount: pending.amount as number,
      currency: pending.currency,
      date: pending.date,
    }
    this.income.push(row)
    return Promise.resolve(row)
  }

  findPossibleDuplicate(params: {
    amount: number
    currency: string
    date: string
    accountId: string | null
    excludeId: string
  }): Promise<PossibleDuplicate | null> {
    const matches = Array.from(this.rows.values()).filter(
      (row) =>
        row.id !== params.excludeId &&
        !row.deleted_at &&
        row.amount === params.amount &&
        row.currency === params.currency &&
        row.account_id === params.accountId &&
        withinOneDay(row.date, params.date)
    )
    if (matches.length === 0) return Promise.resolve(null)
    // Most recently inserted wins, mirroring `order by created_at desc` on the real store.
    const latest = matches.reduce((best, row) => (rowSequence(row.id) > rowSequence(best.id) ? row : best))
    return Promise.resolve({ id: latest.id, note: latest.note, amount: latest.amount, date: latest.date })
  }

  pendingIncome = new Map<string, PendingIncome>()
  income: IncomeInsert[] = []
  private pendingSequence = 0

  createPendingIncome(row: Omit<PendingIncome, 'id'>): Promise<PendingIncome> {
    const id = `pending-${++this.pendingSequence}`
    const stored: PendingIncome = { id, ...row }
    this.pendingIncome.set(id, stored)
    return Promise.resolve(stored)
  }

  getPendingIncome(id: string): Promise<PendingIncome | null> {
    return Promise.resolve(this.pendingIncome.get(id) ?? null)
  }

  deletePendingIncome(id: string): Promise<void> {
    this.pendingIncome.delete(id)
    return Promise.resolve()
  }

  insertIncome(row: IncomeInsert): Promise<void> {
    this.income.push(row)
    return Promise.resolve()
  }

  only(): TransactionRow {
    const rows = Array.from(this.rows.values())
    if (rows.length !== 1) throw new Error(`expected exactly one row, found ${rows.length}`)
    return rows[0]
  }
}

function withinOneDay(a: string, b: string): boolean {
  const days = Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000
  return days <= 1
}

function rowSequence(id: string): number {
  return Number(id.split('-')[1] ?? 0)
}

export interface SentMessage {
  method: string
  chatId?: number
  messageId?: number
  text?: string
  opts?: SendOptions
}

/**
 * A minimal QueryStore for tests that only need routing (does this message
 * write a transaction or not?) rather than real numbers — every query
 * answers a first-class, correct zero unless seeded. The actual query
 * arithmetic (FX conversion, category exclusion, etc.) is covered against
 * its own fake in query/run.test.ts; this one exists so intake.test.ts and
 * demo.ts can exercise the intent router without a live v_transactions_aed.
 */
export class FakeQueryStore implements QueryStore {
  categorySpend(_category: string, period: ResolvedPeriod): Promise<SpendResult> {
    return Promise.resolve({ amountAed: 0, count: 0, unconvertedCount: 0, period })
  }

  totalSpend(period: ResolvedPeriod): Promise<TotalSpendResult> {
    return Promise.resolve({ amountAed: 0, count: 0, unconvertedCount: 0, excludedSavingsAed: 0, period })
  }

  merchantSpend(_merchant: string, period: ResolvedPeriod): Promise<SpendResult> {
    return Promise.resolve({ amountAed: 0, count: 0, unconvertedCount: 0, period })
  }

  accountSpend(_accountId: string, period: ResolvedPeriod): Promise<SpendResult> {
    return Promise.resolve({ amountAed: 0, count: 0, unconvertedCount: 0, period })
  }

  recentTransactions(): Promise<RecentTransaction[]> {
    return Promise.resolve([])
  }
}

export class FakeMessenger implements Messenger {
  sent: SentMessage[] = []
  files = new Map<string, DownloadedFile>()
  private sequence = 5000

  sendMessage(chatId: number, text: string, opts: SendOptions = {}): Promise<TelegramMessage> {
    this.sent.push({ method: 'sendMessage', chatId, text, opts })
    return Promise.resolve({ message_id: ++this.sequence, chat: { id: chatId, type: 'group' }, text })
  }

  editMessageText(chatId: number, messageId: number, text: string, opts: SendOptions = {}): Promise<unknown> {
    this.sent.push({ method: 'editMessageText', chatId, messageId, text, opts })
    return Promise.resolve(null)
  }

  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<unknown> {
    this.sent.push({ method: 'answerCallbackQuery', text })
    void callbackQueryId
    return Promise.resolve(null)
  }

  downloadFile(fileId: string): Promise<DownloadedFile> {
    const file = this.files.get(fileId)
    if (file) return Promise.resolve(file)
    return Promise.resolve({
      bytes: new Uint8Array([1, 2, 3, 4]),
      mimeType: 'image/jpeg',
      filePath: `photos/${fileId}.jpg`,
    })
  }

  last(): SentMessage {
    return this.sent[this.sent.length - 1]
  }

  texts(): string[] {
    return this.sent.filter((s) => s.method === 'sendMessage').map((s) => s.text ?? '')
  }
}

/** Replays canned model responses in order, recording what it was asked. */
export class FakeModel implements ModelClient {
  responses: string[]
  calls: ChatMessage[][] = []
  model = 'fake-model'
  usage: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null } | null = null

  constructor(responses: string | string[]) {
    this.responses = Array.isArray(responses) ? [...responses] : [responses]
  }

  chat(messages: ChatMessage[]): Promise<string> {
    this.calls.push(messages)
    const next = this.responses.length > 1 ? this.responses.shift() : this.responses[0]
    if (next === undefined) throw new Error('FakeModel ran out of responses')
    if (next.startsWith('THROW:')) return Promise.reject(new Error(next.slice(6)))
    return Promise.resolve(next)
  }

  getLastUsage() {
    return this.usage
  }

  /** Flattens the last prompt to plain text for assertions. */
  lastPromptText(): string {
    const messages = this.calls[this.calls.length - 1] ?? []
    return messages
      .map((m) =>
        typeof m.content === 'string'
          ? m.content
          : m.content.map((part) => (part.type === 'text' ? part.text : `[image ${part.image_url.url.slice(0, 30)}]`)).join('\n')
      )
      .join('\n')
  }

  lastHadImage(): boolean {
    const messages = this.calls[this.calls.length - 1] ?? []
    return messages.some((m) => Array.isArray(m.content) && m.content.some((part) => part.type === 'image_url'))
  }
}

export class FakeTranscriber implements Transcriber {
  transcript: string
  calls: DownloadedFile[] = []

  constructor(transcript: string) {
    this.transcript = transcript
  }

  transcribe(file: DownloadedFile): Promise<string> {
    this.calls.push(file)
    return Promise.resolve(this.transcript)
  }
}
