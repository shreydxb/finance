// Shared types for the telegram-intake Edge Function.
//
// Only the slice of the Telegram Bot API we actually read is modelled here —
// keeping it narrow means a fixture is easy to hand-write for tests/demo mode.

export interface TelegramUser {
  id: number
  is_bot?: boolean
  first_name?: string
  last_name?: string
  username?: string
}

export interface TelegramChat {
  id: number
  type: string
  title?: string
}

export interface TelegramPhotoSize {
  file_id: string
  file_unique_id?: string
  width: number
  height: number
  file_size?: number
}

export interface TelegramVoice {
  file_id: string
  duration?: number
  mime_type?: string
  file_size?: number
}

export interface TelegramDocument {
  file_id: string
  file_name?: string
  mime_type?: string
}

export interface TelegramMessage {
  message_id: number
  from?: TelegramUser
  chat: TelegramChat
  date?: number
  text?: string
  caption?: string
  photo?: TelegramPhotoSize[]
  voice?: TelegramVoice
  audio?: TelegramVoice
  document?: TelegramDocument
  /** Shared by every photo in a multi-select album send — see media_groups. */
  media_group_id?: string
  reply_to_message?: TelegramMessage
}

export interface TelegramCallbackQuery {
  id: string
  from: TelegramUser
  message?: TelegramMessage
  data?: string
}

export interface TelegramUpdate {
  update_id?: number
  message?: TelegramMessage
  edited_message?: TelegramMessage
  channel_post?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

export interface InlineKeyboardButton {
  text: string
  callback_data: string
}

export interface SendOptions {
  replyToMessageId?: number
  inlineKeyboard?: InlineKeyboardButton[][]
  forceReply?: boolean
}

export interface DownloadedFile {
  bytes: Uint8Array
  mimeType: string
  filePath: string
}

/** Everything the intake flow needs from the Telegram side, so tests can fake it. */
export interface Messenger {
  sendMessage(chatId: number, text: string, opts?: SendOptions): Promise<TelegramMessage>
  editMessageText(chatId: number, messageId: number, text: string, opts?: SendOptions): Promise<unknown>
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<unknown>
  downloadFile(fileId: string): Promise<DownloadedFile>
}

/** One line item on a receipt/order. Display-only — nothing reads this for budget math. */
export interface ExtractionItem {
  name: string
  qty: number | null
  price: number | null
}

/** The structured result every extraction path must produce. Never free text. */
export interface Extraction {
  /** ISO yyyy-mm-dd. */
  date: string
  /** null when the model could not read a total — the row is still written, flagged. */
  amount: number | null
  currency: string
  /** Exactly one of the household's category names, or null when unmatched. */
  category: string | null
  paid_by: string | null
  paid_with: string | null
  note: string | null
  /** 0–1. Drives the needs_review gate. */
  confidence: number
  /** Line items when the source itemizes a receipt/order; null otherwise. */
  items: ExtractionItem[] | null
}

export interface AccountRef {
  id: string
  name: string
  type: string
  owner: string | null
}

export interface CategoryRef {
  name: string
  group: string
}

export interface TransactionRow {
  id: string
  date: string
  amount: number
  currency: string
  account_id: string | null
  category: string | null
  owner: string | null
  note: string | null
  source: string
  needs_review: boolean
  telegram_chat_id: number | null
  telegram_msg_id: number | null
  telegram_prompt_msg_id: number | null
  /** Display-only line items — see ExtractionItem. */
  items: ExtractionItem[] | null
  /** Soft delete for /undo and the duplicate-warning "Delete this one" button. Never a hard DELETE. */
  deleted_at: string | null
  /** DEPRECATED (025): superseded by transaction_group_id + group_kind. */
  split_group_id: string | null
  /** DATA-01: what the group actually is. Never infer it from the id alone. */
  transaction_group_id: string | null
  group_kind: 'category_split' | 'transfer' | 'bulk_batch' | null
  transfer_direction: 'out' | 'in' | null
  /** BOT-01: stable key making a redelivered Telegram update a no-op. */
  idempotency_key: string | null
}

/** A prior row that looks like the same spend re-sent — see findPossibleDuplicate. */
export interface PossibleDuplicate {
  id: string
  note: string | null
  amount: number
  date: string
}

/**
 * A cashback (or future income-verb) proposal awaiting a household tap.
 * Nothing in `income` exists until Apply — see docs/telegram-bot-round2-design.md §4.
 */
export interface PendingIncome {
  id: string
  person: string
  source: string | null
  kind: string
  amount: number | null
  currency: string
  date: string
}

/**
 * A generic propose-then-tap write (Taskiv #60) — anything that isn't a
 * transaction. Unlike PendingIncome, this is never deleted on resolution:
 * `resolvedAt`/`resolution` are kept so a redelivered Telegram callback (and
 * a human debugging "what happened to that proposal") can tell an applied
 * action from a cancelled or expired one.
 */
export interface PendingAction {
  id: string
  kind: string
  payload: unknown
  chatId: number
  promptMsgId: number | null
  requestedBy: number
  createdAt: string
  expiresAt: string
  resolvedAt: string | null
  resolution: 'applied' | 'cancelled' | 'expired' | null
}

export interface IncomeInsert {
  person: string
  source: string | null
  kind: string
  amount: number
  currency: string
  date: string
}

/** Household config resolved from the `settings` table at request time. */
export interface HouseholdContext {
  categories: CategoryRef[]
  accounts: AccountRef[]
  /** Telegram user id → person name. */
  people: Map<number, string>
  confidenceThreshold: number
  defaultAccountId: string | null
  /** The household's captured group chat (settings.tg_chat_id.chat_id), or null before it's ever spoken. */
  chatId: number | null
}

/** Everything the intake flow needs from Postgres, so tests can fake it. */
export interface IntakeStore {
  loadHouseholdContext(): Promise<HouseholdContext>
  insertTransaction(row: Partial<TransactionRow>): Promise<TransactionRow>
  updateTransaction(id: string, patch: Partial<TransactionRow>): Promise<TransactionRow>
  getTransaction(id: string): Promise<TransactionRow | null>
  /** Matches either the user's original message or the bot's follow-up prompt. */
  findTransactionByMessage(chatId: number, messageId: number): Promise<TransactionRow | null>
  /** Taskiv #61: the most recent non-deleted row this bot logged (source='telegram') in this chat — /undo's scope, never a manually-entered row. */
  findLastBotTransaction(chatId: number): Promise<TransactionRow | null>
  getSetting(key: string): Promise<unknown | null>
  /** Upsert. Used sparingly — e.g. capturing tg_chat_id once, not per-message config. */
  putSetting(key: string, value: unknown): Promise<void>
  /** Best-effort observability row. Callers swallow failures — a broken log write must never cost a reply or a spend. */
  logEvent(entry: IntakeLogEntry): Promise<void>
  /** Upsert this photo into its album's row, returning the row as it stood right after this write. */
  joinMediaGroup(mediaGroupId: string, chatId: number, fileId: string, caption: string | null): Promise<MediaGroupState>
  getMediaGroup(mediaGroupId: string): Promise<MediaGroupState | null>
  /** Marks the group as claimed so it's never processed twice. */
  claimMediaGroup(mediaGroupId: string): Promise<void>
  /**
   * Deterministic lookback for a possible re-send of the same spend — exact
   * amount/currency, ±1 day, same account, excluding the row itself and any
   * already-deleted rows. Never blocks or delays the write; see
   * docs/telegram-bot-round2-design.md §1.
   */
  findPossibleDuplicate(params: {
    amount: number
    currency: string
    date: string
    accountId: string | null
    excludeId: string
  }): Promise<PossibleDuplicate | null>
  /** Propose-then-tap holding spot for a not-yet-written income row — see PendingIncome. */
  createPendingIncome(row: Omit<PendingIncome, 'id'>): Promise<PendingIncome>
  getPendingIncome(id: string): Promise<PendingIncome | null>
  deletePendingIncome(id: string): Promise<void>
  /** Writes straight to `income` — only ever called right after a household tap confirms a proposal. */
  insertIncome(row: IncomeInsert): Promise<void>
  /** The other rows sharing one transaction_group_id, whatever the group's kind. */
  findTransactionsByGroup(groupId: string): Promise<TransactionRow[]>
  /** BOT-01: one row per Telegram message, however many times it is delivered. */
  insertTransactionOnce(row: Partial<TransactionRow>, idempotencyKey: string): Promise<TransactionRow>
  /** BOT-01: both transfer rows in one transaction, idempotent against redelivery. */
  createTransfer(args: TransferArgs): Promise<TransactionRow[]>
  /** BOT-01: all bulk rows in one transaction, idempotent per row. */
  createBulkTransactions(rows: BulkRow[], chatId: number, idempotencyBase: string): Promise<TransactionRow[]>
  /** BOT-01: income + proposal removal in one transaction. Null when already applied. */
  applyPendingIncome(pendingId: string): Promise<unknown | null>
  /** Taskiv #60: propose a generic (non-transaction) write. Nothing outside `pending_actions` is touched until it resolves. */
  createPendingAction(kind: string, payload: unknown, chatId: number, requestedBy: number): Promise<PendingAction>
  getPendingAction(id: string): Promise<PendingAction | null>
  setPendingActionPromptMsgId(id: string, promptMsgId: number): Promise<void>
  /**
   * Atomically marks the action resolved iff it was not already — the
   * idempotency guard against a redelivered Telegram callback double-tapping
   * Apply. Returns null (not the row) when it was already resolved or
   * doesn't exist, so a caller never mistakes a lost race for success.
   */
  resolvePendingAction(id: string, resolution: 'applied' | 'cancelled' | 'expired'): Promise<PendingAction | null>
}

/** A photo album in progress — see media_groups and intake.ts's extractFromAlbumPhoto. */
export interface MediaGroupState {
  fileIds: string[]
  caption: string | null
  updatedAt: string
  processedAt: string | null
}

export interface TokenUsage {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
}

/** One row in `intake_logs`: an inbound extraction attempt or an outbound reply. */
export interface IntakeLogEntry {
  direction: 'inbound' | 'outbound'
  /** e.g. 'extract_text', 'extract_photo', 'extract_voice', 'correction', 'callback', 'send_message', 'edit_message' */
  stage: string
  messageType?: string | null
  chatId?: number | null
  telegramUserId?: number | null
  person?: string | null
  telegramMsgId?: number | null
  inputSummary?: string | null
  model?: string | null
  usage?: TokenUsage | null
  success: boolean
  error?: string | null
  durationMs?: number | null
  transactionId?: string | null
}

export interface ChatMessage {
  role: 'system' | 'user'
  content: string | ContentPart[]
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/** The LLM call, narrowed to "messages in, raw string out". */
export interface ModelClient {
  chat(messages: ChatMessage[]): Promise<string>
  /** Token usage from the most recent chat() call, when the provider reports it. Optional: fakes in tests don't implement it. */
  getLastUsage?(): TokenUsage | null
}

/** Voice → text. Separate from ModelClient because it's a different provider. */
export interface Transcriber {
  transcribe(file: DownloadedFile): Promise<string>
}

export type IntakeOutcome =
  | { status: 'ignored'; reason: string }
  | { status: 'logged'; transactionId: string; needsReview: boolean }
  | { status: 'confirmed'; transactionId: string }
  | { status: 'fix_requested'; transactionId: string }
  | { status: 'corrected'; transactionId: string; needsReview: boolean }
  | { status: 'deleted'; transactionId: string }
  | { status: 'cashback_proposed'; pendingId: string }
  | { status: 'cashback_applied'; pendingId: string }
  | { status: 'cashback_cancelled'; pendingId: string }
  | { status: 'error'; reason: string }

/** Arguments for an atomic transfer write (BOT-01). */
export interface TransferArgs {
  date: string
  amount: number
  currency: string
  fromAccountId: string | null
  toAccountId: string | null
  fromLabel: string | null
  toLabel: string | null
  owner: string | null
  needsReview: boolean
  chatId: number
  messageId: number
  idempotencyBase: string
}

/** One line of a bulk message, as passed to create_bulk_transactions. */
export interface BulkRow {
  date: string
  amount: number
  currency: string
  account_id: string | null
  category: string | null
  owner: string | null
  note: string | null
  needs_review: boolean
  items?: unknown
}
