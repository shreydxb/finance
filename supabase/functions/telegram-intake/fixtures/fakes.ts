// In-memory stand-ins for Telegram, OpenRouter, Groq and Postgres.

import { buildHouseholdContext } from '../../_shared/store.ts'
import type {
  AccountRef,
  CategoryRef,
  ChatMessage,
  DownloadedFile,
  HouseholdContext,
  IntakeStore,
  Messenger,
  ModelClient,
  SendOptions,
  TelegramMessage,
  Transcriber,
  TransactionRow,
} from '../../_shared/types.ts'
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

  constructor(context: HouseholdContext = household()) {
    this.context = context
  }

  loadHouseholdContext(): Promise<HouseholdContext> {
    return Promise.resolve(this.context)
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
    }
    this.rows.set(id, stored)
    return Promise.resolve(stored)
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

  only(): TransactionRow {
    const rows = Array.from(this.rows.values())
    if (rows.length !== 1) throw new Error(`expected exactly one row, found ${rows.length}`)
    return rows[0]
  }
}

export interface SentMessage {
  method: string
  chatId?: number
  messageId?: number
  text?: string
  opts?: SendOptions
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
