// The intake flow: Telegram update in, transaction row + Telegram reply out.
//
// Every dependency (Telegram, the model, Whisper, Postgres) is injected, so the
// whole flow — allowlist, confidence gate, confirm/fix loop — is exercised in
// tests and in demo mode without a live bot or an API key.
//
// Two rules drive the design:
//   1. Nothing is ever silently lost. Every recognised message writes a row
//      immediately, even when the amount was unreadable; low confidence sets
//      needs_review rather than discarding.
//   2. Corrections update the row they belong to. They never create a second one.

import { todayInTz } from '../_shared/dates.ts'
import { extractBulk, looksLikeBulk } from './bulk.ts'
import { extractCashback, looksLikeCashback } from './cashback.ts'
import type { CashbackExtraction } from './cashback.ts'
import { extractCorrection, extractFromImage, extractFromImages, extractFromText, ExtractionError } from './extract.ts'
import { promptContextFrom } from './prompt.ts'
import type { PromptContext } from './prompt.ts'
import { extractTransfer, looksLikeTransfer } from './transfer.ts'
import type { TransferExtraction } from './transfer.ts'
import { confirmFixKeyboard, largestPhoto, parseCallbackData, toBase64 } from '../_shared/telegram.ts'
import type {
  AccountRef,
  Extraction,
  HouseholdContext,
  InlineKeyboardButton,
  IntakeOutcome,
  IntakeStore,
  Messenger,
  ModelClient,
  PendingIncome,
  PossibleDuplicate,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUpdate,
  TokenUsage,
  Transcriber,
  TransactionRow,
} from '../_shared/types.ts'

export interface IntakeDeps {
  store: IntakeStore
  messenger: Messenger
  model: ModelClient
  /** null when GROQ_API_KEY isn't set: voice notes are then answered with a nudge. */
  transcriber: Transcriber | null
  defaultCurrency: string
  now?: () => Date
  log?: (message: string, data?: Record<string, unknown>) => void
  /** Overridable for tests — see extractFromAlbumPhoto. Defaults to a real setTimeout. */
  wait?: (ms: number) => Promise<void>
}

/**
 * How long an album photo waits for siblings before claiming the group.
 * A heuristic, not a guarantee — see docs/telegram-bot-round2-design.md §6.
 */
const ALBUM_DEBOUNCE_MS = 1200

const HELP_TEXT = [
  'Send me a spend and I log it to Our Money:',
  '• a photo of the receipt',
  '• a voice note ("spent 84 dirhams at Carrefour")',
  '• or just type it',
  '',
  "If I'm not sure, I'll show you what I got with Confirm / Fix buttons.",
  'Anything unconfirmed shows up as “Needs review” in the app.',
  '',
  'Got cashback instead? Type it ("15 aed cashback from the ENBD card") and I\'ll',
  'propose an income entry — nothing is logged until you tap Apply.',
].join('\n')

export async function handleUpdate(update: TelegramUpdate, deps: IntakeDeps): Promise<IntakeOutcome> {
  if (update.callback_query) return handleCallback(update.callback_query, deps)
  const message = update.message ?? update.edited_message
  if (!message) return { status: 'ignored', reason: 'no message in update' }
  return handleMessage(message, deps)
}

async function handleMessage(message: TelegramMessage, deps: IntakeDeps): Promise<IntakeOutcome> {
  const senderId = message.from?.id
  if (!senderId) return { status: 'ignored', reason: 'message has no sender' }

  const text = (message.text ?? '').trim()

  // Answered before the allowlist on purpose: it only ever reveals the caller's
  // own id, and it's how you find the two ids to put into Settings in the first place.
  if (text === '/id') {
    await deps.messenger.sendMessage(message.chat.id, `Your Telegram user id is ${senderId}.`, {
      replyToMessageId: message.message_id,
    })
    return { status: 'ignored', reason: 'id lookup' }
  }

  const household = await deps.store.loadHouseholdContext()
  if (!household.people.has(senderId)) {
    // Silent to the sender — a stranger shouldn't learn whether the bot is live.
    deps.log?.('rejected sender', { senderId, chatId: message.chat.id })
    return { status: 'ignored', reason: `sender ${senderId} is not in the household allowlist` }
  }

  await captureChatId(message, deps)

  if (text === '/start' || text === '/help') {
    await deps.messenger.sendMessage(message.chat.id, HELP_TEXT, { replyToMessageId: message.message_id })
    return { status: 'ignored', reason: 'help' }
  }

  const ctx = promptContextFrom(household, today(deps), deps.defaultCurrency)

  // A reply threaded onto a message we already logged is a correction, not a new spend.
  const replyTarget = message.reply_to_message
  if (replyTarget && text) {
    const existing = await deps.store.findTransactionByMessage(message.chat.id, replyTarget.message_id)
    if (existing) return applyCorrection(existing, text, message, household, ctx, deps)
  }

  // Cashback is income, not a spend — router rule #2 (default to spend on any
  // doubt) means only an explicit "cashback" mention leaves the spend path.
  if (text && looksLikeCashback(text)) {
    return handleCashback(text, message, household, ctx, deps)
  }

  // Same rule for a transfer between the household's own accounts — a bare
  // "from" or "to" isn't enough on its own, see looksLikeTransfer.
  if (text && looksLikeTransfer(text)) {
    return handleTransfer(text, message, household, ctx, deps)
  }

  // Several spends in one message ("45 groceries, 12 coffee, paid rent
  // 3000") — a cheap deterministic pre-check on amount-like tokens, same
  // text-only scoping as cashback/transfer above. See docs/telegram-bot-round2-design.md §2.
  if (text && looksLikeBulk(text)) {
    return handleBulk(text, message, household, ctx, deps)
  }

  const messageType = messageTypeOf(message)
  const t0 = Date.now()

  let extraction: Extraction
  try {
    extraction = await extractFromMessage(message, ctx, deps)
  } catch (error) {
    if (error instanceof UnsupportedMessage) {
      return { status: 'ignored', reason: error.message }
    }
    deps.log?.('extraction failed', { error: String(error) })
    // The reason goes in the reply, not just the logs. A silent "couldn't read
    // that" leaves the household unable to tell a blurry photo from an expired
    // API key, and Supabase's function logs don't surface console output.
    const hint = errorHint(error)
    await deps.messenger.sendMessage(
      message.chat.id,
      hint
        ? `I couldn't read that one — ${hint}\n\nSend it again, or add it by hand in the app.`
        : "I couldn't read that one. Send it again, or add it by hand in the app.",
      { replyToMessageId: message.message_id }
    )
    await logInbound(deps, message, household, senderId, messageType, {
      success: false,
      error: error instanceof ExtractionError ? error.message : String(error),
      durationMs: Date.now() - t0,
    })
    return { status: 'error', reason: error instanceof ExtractionError ? error.message : String(error) }
  }

  return writeAndAnnounce(extraction, message, household, senderId, deps, t0, messageType)
}

/**
 * The single-spend write-then-flag path: one row, one reply. Shared between
 * the ordinary message flow above and handleBulk's fallback when the bulk
 * pre-check fires but the model decides the message was really just one
 * transaction after all — the household sees the same single-spend reply
 * either way, not a one-item numbered list.
 */
async function writeAndAnnounce(
  extraction: Extraction,
  message: TelegramMessage,
  household: HouseholdContext,
  senderId: number,
  deps: IntakeDeps,
  t0: number,
  messageType: 'photo' | 'voice' | 'text',
  stage?: string
): Promise<IntakeOutcome> {
  const resolved = resolve(extraction, household, senderId)
  const row = await deps.store.insertTransaction({
    date: extraction.date,
    // A row with an unreadable total is still worth more than a lost one: it
    // lands at 0 with needs_review set, so it shows up in the app either way.
    amount: extraction.amount ?? 0,
    currency: extraction.currency,
    account_id: resolved.accountId,
    category: extraction.category,
    owner: resolved.owner,
    note: extraction.note,
    source: 'telegram',
    needs_review: resolved.needsReview,
    telegram_chat_id: message.chat.id,
    telegram_msg_id: message.message_id,
    items: extraction.items,
  })

  const usage = modelUsageOf(deps.model)
  await logInbound(deps, message, household, senderId, messageType, {
    stage,
    success: true,
    durationMs: Date.now() - t0,
    transactionId: row.id,
    model: usage.model,
    usage: usage.usage,
  })

  const duplicate = await findDuplicate(extraction, resolved, row.id, deps)
  await announce(row.id, extraction, resolved, message, deps, { duplicate })
  return { status: 'logged', transactionId: row.id, needsReview: resolved.needsReview }
}

/**
 * Several spends in one typed message (docs/telegram-bot-round2-design.md
 * §2). Still write-then-flag, scaled to N: every row lands immediately (never
 * lose any of them), then one reply summarizes the batch. Buttons only show
 * up when at least one row needs a look — mirroring the single-spend
 * precedent of a bare "Logged: ... ✓" on a fully clean write.
 */
async function handleBulk(
  text: string,
  message: TelegramMessage,
  household: HouseholdContext,
  ctx: PromptContext,
  deps: IntakeDeps
): Promise<IntakeOutcome> {
  const senderId = message.from?.id ?? 0
  const t0 = Date.now()

  let extractions: Extraction[]
  try {
    extractions = await extractBulk(text, ctx, deps.model)
  } catch (error) {
    deps.log?.('bulk extraction failed', { error: String(error) })
    const hint = errorHint(error)
    await deps.messenger.sendMessage(
      message.chat.id,
      hint
        ? `I couldn't read that one — ${hint}\n\nSend it again, or add it by hand in the app.`
        : "I couldn't read that one. Send it again, or add it by hand in the app.",
      { replyToMessageId: message.message_id }
    )
    await logInbound(deps, message, household, senderId, 'text', {
      stage: 'extract_bulk',
      success: false,
      error: error instanceof ExtractionError ? error.message : String(error),
      durationMs: Date.now() - t0,
    })
    return { status: 'error', reason: error instanceof ExtractionError ? error.message : String(error) }
  }

  // The pre-check is a heuristic, not a classifier — if the model decided the
  // message was really one transaction after all, fall back to the ordinary
  // single-spend reply rather than a one-item "Logged 1: ①...".
  if (extractions.length === 1) {
    return writeAndAnnounce(extractions[0], message, household, senderId, deps, t0, 'text', 'extract_bulk')
  }

  const splitGroupId = crypto.randomUUID()
  const resolvedRows = extractions.map((extraction) => ({ extraction, resolved: resolve(extraction, household, senderId) }))

  const rows = await Promise.all(
    resolvedRows.map(({ extraction, resolved }) =>
      deps.store.insertTransaction({
        date: extraction.date,
        amount: extraction.amount ?? 0,
        currency: extraction.currency,
        account_id: resolved.accountId,
        category: extraction.category,
        owner: resolved.owner,
        note: extraction.note,
        source: 'telegram',
        needs_review: resolved.needsReview,
        telegram_chat_id: message.chat.id,
        // telegram_msg_id deliberately left unset: all N rows share one
        // inbound message, so setting it here would make a bare reply to
        // that message match an arbitrary row. Fix #n threads correctly
        // anyway because tapping Fix sends its own distinct prompt message
        // per row (see the 'fix' callback branch — unmodified for bulk).
        split_group_id: splitGroupId,
        items: extraction.items,
      })
    )
  )

  await logInbound(deps, message, household, senderId, 'text', {
    stage: 'extract_bulk',
    success: true,
    durationMs: Date.now() - t0,
    transactionId: rows[0].id,
  })

  await announceBulk(rows, resolvedRows, message, deps)
  return { status: 'logged', transactionId: rows[0].id, needsReview: resolvedRows.some(({ resolved }) => resolved.needsReview) }
}

/**
 * A deterministic, no-model lookback for "log a spend, forget, log it again"
 * (docs/telegram-bot-round2-design.md §1). Never worth doing for an unreadable
 * amount — every flagged-zero row would spuriously "duplicate" every other
 * one. Best-effort: a lookup failure must never cost the household their reply.
 */
async function findDuplicate(
  extraction: Extraction,
  resolved: Resolved,
  transactionId: string,
  deps: IntakeDeps
): Promise<PossibleDuplicate | null> {
  if (extraction.amount === null) return null
  try {
    return await deps.store.findPossibleDuplicate({
      amount: extraction.amount,
      currency: extraction.currency,
      date: extraction.date,
      accountId: resolved.accountId,
      excludeId: transactionId,
    })
  } catch (error) {
    deps.log?.('duplicate lookup failed (non-fatal)', { error: String(error) })
    return null
  }
}

/**
 * Cashback: propose, never write-then-flag (docs/telegram-bot-round2-design.md
 * §4). The proposal lives in `pending_income` — genuinely nothing lands in
 * `income` until the household taps Apply.
 */
async function handleCashback(
  text: string,
  message: TelegramMessage,
  household: HouseholdContext,
  ctx: PromptContext,
  deps: IntakeDeps
): Promise<IntakeOutcome> {
  const senderId = message.from?.id ?? 0
  const t0 = Date.now()

  let extraction: CashbackExtraction
  try {
    extraction = await extractCashback(text, ctx, deps.model)
  } catch (error) {
    deps.log?.('cashback extraction failed', { error: String(error) })
    await deps.messenger.sendMessage(
      message.chat.id,
      "I couldn't read that cashback message. Try rephrasing it, or add it by hand in the app.",
      { replyToMessageId: message.message_id }
    )
    await logInbound(deps, message, household, senderId, 'text', {
      stage: 'extract_cashback',
      success: false,
      error: error instanceof ExtractionError ? error.message : String(error),
      durationMs: Date.now() - t0,
    })
    return { status: 'error', reason: error instanceof ExtractionError ? error.message : String(error) }
  }

  const person = household.people.get(senderId) || null

  // Propose-then-tap only makes sense once there's a number and someone to
  // credit it to — ask rather than guess. A missed cashback message costs
  // nothing but a slightly-off income total (unlike a spend, never lost).
  if (extraction.amount === null || !person) {
    await deps.messenger.sendMessage(message.chat.id, "How much cashback was it? Reply with the amount and I'll log it.", {
      replyToMessageId: message.message_id,
    })
    await logInbound(deps, message, household, senderId, 'text', {
      stage: 'extract_cashback',
      success: false,
      error: 'cashback amount unreadable',
      durationMs: Date.now() - t0,
    })
    return { status: 'error', reason: 'cashback amount unreadable' }
  }

  const pending = await deps.store.createPendingIncome({
    person,
    source: extraction.source,
    kind: 'other',
    amount: extraction.amount,
    currency: extraction.currency,
    date: extraction.date,
  })

  await logInbound(deps, message, household, senderId, 'text', {
    stage: 'extract_cashback',
    success: true,
    durationMs: Date.now() - t0,
  })

  await deps.messenger.sendMessage(message.chat.id, `Log cashback?\n${describeCashback(pending)}`, {
    replyToMessageId: message.message_id,
    inlineKeyboard: cashbackKeyboard(pending.id),
  })
  return { status: 'cashback_proposed', pendingId: pending.id }
}

async function handleCashbackCallback(
  action: 'cashback_apply' | 'cashback_cancel',
  pendingId: string,
  chatId: number,
  query: TelegramCallbackQuery,
  deps: IntakeDeps
): Promise<IntakeOutcome> {
  const pending = await deps.store.getPendingIncome(pendingId)
  if (!pending) {
    await deps.messenger.answerCallbackQuery(query.id, 'That proposal is gone.')
    return { status: 'ignored', reason: `pending income ${pendingId} not found` }
  }

  if (action === 'cashback_cancel') {
    await deps.store.deletePendingIncome(pendingId)
    await deps.messenger.answerCallbackQuery(query.id, 'Cancelled')
    if (query.message) {
      await deps.messenger.editMessageText(chatId, query.message.message_id, `Cancelled: ${describeCashback(pending)}`)
    }
    await logCallback(deps, query, chatId, 'cashback_cancel', { success: true })
    return { status: 'cashback_cancelled', pendingId }
  }

  if (pending.amount === null) {
    // Shouldn't happen — handleCashback never proposes an amountless row — but
    // a stale button after a manual DB edit is cheap to guard against anyway.
    await deps.messenger.answerCallbackQuery(query.id, 'No amount to apply')
    return { status: 'ignored', reason: 'pending income has no amount' }
  }

  await deps.store.insertIncome({
    person: pending.person,
    source: pending.source,
    kind: pending.kind,
    amount: pending.amount,
    currency: pending.currency,
    date: pending.date,
  })
  await deps.store.deletePendingIncome(pendingId)
  await deps.messenger.answerCallbackQuery(query.id, 'Logged')
  if (query.message) {
    await deps.messenger.editMessageText(chatId, query.message.message_id, `Logged: ${describeCashback(pending)} ✓`)
  }
  await logCallback(deps, query, chatId, 'cashback_apply', { success: true })
  return { status: 'cashback_applied', pendingId }
}

function describeCashback(pending: PendingIncome): string {
  const parts = [
    pending.amount === null ? `amount unreadable (${pending.currency})` : `${formatAmount(pending.amount)} ${pending.currency}`,
    pending.source,
    pending.person,
    formatDate(pending.date),
  ]
  return parts.filter(Boolean).join(' · ')
}

function cashbackKeyboard(pendingId: string): InlineKeyboardButton[][] {
  return [
    [
      { text: '✅ Apply', callback_data: `cashback_apply:${pendingId}` },
      { text: '✖️ Cancel', callback_data: `cashback_cancel:${pendingId}` },
    ],
  ]
}

/**
 * A transfer between the household's own accounts — write-then-flag like a
 * spend (rule #3: it's still a `transactions` write), never propose-then-tap.
 * Two rows land immediately, category='Transfer', sharing one split_group_id
 * so `src/lib/reports.js`/Budget exclude both from every spend/budget total.
 * accounts.value is never touched (docs/telegram-bot-round2-design.md §3).
 */
async function handleTransfer(
  text: string,
  message: TelegramMessage,
  household: HouseholdContext,
  ctx: PromptContext,
  deps: IntakeDeps
): Promise<IntakeOutcome> {
  const senderId = message.from?.id ?? 0
  const t0 = Date.now()

  let extraction: TransferExtraction
  try {
    extraction = await extractTransfer(text, ctx, deps.model)
  } catch (error) {
    deps.log?.('transfer extraction failed', { error: String(error) })
    await deps.messenger.sendMessage(
      message.chat.id,
      "I couldn't read that transfer. Try rephrasing it, or add it by hand in the app.",
      { replyToMessageId: message.message_id }
    )
    await logInbound(deps, message, household, senderId, 'text', {
      stage: 'extract_transfer',
      success: false,
      error: error instanceof ExtractionError ? error.message : String(error),
      durationMs: Date.now() - t0,
    })
    return { status: 'error', reason: error instanceof ExtractionError ? error.message : String(error) }
  }

  const fromAccount = matchAccount(extraction.fromAccount, household.accounts)
  const toAccount = matchAccount(extraction.toAccount, household.accounts)
  const sameAccount = Boolean(fromAccount && toAccount && fromAccount.id === toAccount.id)
  const needsReview = extraction.amount === null || !fromAccount || !toAccount || sameAccount
  const owner = household.people.get(senderId) || null
  const splitGroupId = crypto.randomUUID()

  const outRow = await deps.store.insertTransaction({
    date: extraction.date,
    amount: extraction.amount ?? 0,
    currency: extraction.currency,
    account_id: fromAccount?.id ?? null,
    category: 'Transfer',
    owner,
    note: `Transfer out → ${toAccount?.name ?? extraction.toAccount ?? 'unknown account'}`,
    source: 'telegram',
    needs_review: needsReview,
    telegram_chat_id: message.chat.id,
    telegram_msg_id: message.message_id,
    split_group_id: splitGroupId,
  })
  await deps.store.insertTransaction({
    date: extraction.date,
    amount: extraction.amount ?? 0,
    currency: extraction.currency,
    account_id: toAccount?.id ?? null,
    category: 'Transfer',
    owner,
    note: `Transfer in ← ${fromAccount?.name ?? extraction.fromAccount ?? 'unknown account'}`,
    source: 'telegram',
    needs_review: needsReview,
    telegram_chat_id: message.chat.id,
    telegram_msg_id: message.message_id,
    split_group_id: splitGroupId,
  })

  await logInbound(deps, message, household, senderId, 'text', {
    stage: 'extract_transfer',
    success: true,
    durationMs: Date.now() - t0,
    transactionId: outRow.id,
  })

  await announceTransfer(outRow.id, extraction, fromAccount, toAccount, needsReview, message, deps)
  return { status: 'logged', transactionId: outRow.id, needsReview }
}

async function announceTransfer(
  outRowId: string,
  extraction: TransferExtraction,
  fromAccount: AccountRef | null,
  toAccount: AccountRef | null,
  needsReview: boolean,
  message: TelegramMessage,
  deps: IntakeDeps
): Promise<void> {
  const summary = describeTransfer(extraction, fromAccount, toAccount)

  if (!needsReview) {
    await deps.messenger.sendMessage(message.chat.id, `Logged: ${summary} ✓`, {
      replyToMessageId: message.message_id,
    })
    return
  }

  const gaps = missingTransferFields(extraction, fromAccount, toAccount)
  const lines = ['Logged — worth a quick check:', summary, formatDate(extraction.date)]
  if (gaps.length) lines.push(`Not sure about: ${gaps.join(', ')}.`)

  const sent = await deps.messenger.sendMessage(message.chat.id, lines.join('\n'), {
    replyToMessageId: message.message_id,
    inlineKeyboard: transferConfirmKeyboard(outRowId),
  })
  await deps.store.updateTransaction(outRowId, { telegram_prompt_msg_id: sent.message_id })
}

function describeTransfer(extraction: TransferExtraction, fromAccount: AccountRef | null, toAccount: AccountRef | null): string {
  const amount =
    extraction.amount === null ? `amount unreadable (${extraction.currency})` : `${formatAmount(extraction.amount)} ${extraction.currency}`
  const from = fromAccount?.name ?? extraction.fromAccount ?? 'account unknown'
  const to = toAccount?.name ?? extraction.toAccount ?? 'account unknown'
  return `Transfer ${amount} · ${from} → ${to}`
}

function missingTransferFields(extraction: TransferExtraction, fromAccount: AccountRef | null, toAccount: AccountRef | null): string[] {
  const gaps: string[] = []
  if (extraction.amount === null) gaps.push('the amount')
  if (!fromAccount) gaps.push('which account it left')
  if (!toAccount) gaps.push('which account it landed in')
  if (fromAccount && toAccount && fromAccount.id === toAccount.id) gaps.push('the two accounts look the same')
  return gaps
}

// Deliberately just Confirm, not the spend Confirm/Fix pair — a Fix reply
// would need its own from/to correction extraction, which isn't built here.
// Reuses the 'confirm' callback action so handleCallback's existing branch
// (made split_group_id-aware below) applies to both rows of the pair.
function transferConfirmKeyboard(transactionId: string): InlineKeyboardButton[][] {
  return [[{ text: '✅ Confirm', callback_data: `confirm:${transactionId}` }]]
}

/**
 * One reply summarizing every row a bulk message wrote. Buttons appear only
 * when at least one row needs a look — a fully clean batch reads as a plain
 * "Logged N: ①...②... ✓" wall, no taps needed, mirroring the single-spend
 * precedent of hiding Confirm/Fix on a row that didn't need them.
 */
async function announceBulk(
  rows: TransactionRow[],
  resolvedRows: { extraction: Extraction; resolved: Resolved }[],
  message: TelegramMessage,
  deps: IntakeDeps
): Promise<void> {
  const anyNeedsReview = resolvedRows.some(({ resolved }) => resolved.needsReview)
  const lines = [
    `Logged ${rows.length}:`,
    ...resolvedRows.map(({ extraction, resolved }, i) => describeBulkLine(i + 1, extraction, resolved)),
  ]

  if (!anyNeedsReview) {
    lines.push('✓')
    await deps.messenger.sendMessage(message.chat.id, lines.join('\n'), { replyToMessageId: message.message_id })
    return
  }

  await deps.messenger.sendMessage(message.chat.id, lines.join('\n'), {
    replyToMessageId: message.message_id,
    inlineKeyboard: bulkKeyboard(rows),
  })
}

const CIRCLED_DIGITS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

function bulkMarker(n: number): string {
  return CIRCLED_DIGITS[n - 1] ?? `${n}.`
}

function describeBulkLine(n: number, extraction: Extraction, resolved: Resolved): string {
  const amount =
    extraction.amount === null ? `amount unreadable (${extraction.currency})` : `${formatAmount(extraction.amount)} ${extraction.currency}`
  const suffix = resolved.needsReview ? ' — needs review' : ''
  return `${bulkMarker(n)} ${extraction.category ?? 'Uncategorised'} · ${amount}${suffix}`
}

/**
 * Confirm all cascades via split_group_id (confirm_group, below); Fix #n is
 * plain per-row `fix:<transactionId>` — the existing single-row Fix flow
 * (its own forceReply prompt, its own telegram_prompt_msg_id) needs no
 * bulk-specific handling at all, since each button already names its own row.
 */
function bulkKeyboard(rows: TransactionRow[]): InlineKeyboardButton[][] {
  const confirmRow: InlineKeyboardButton[] = [{ text: '✅ Confirm all', callback_data: `confirm_group:${rows[0].id}` }]
  const fixButtons = rows.map((row, i) => ({ text: `✏️ Fix #${i + 1}`, callback_data: `fix:${row.id}` }))
  return [confirmRow, ...chunk(fixButtons, 4)]
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function messageTypeOf(message: TelegramMessage): 'photo' | 'voice' | 'text' {
  if (message.photo?.length) return 'photo'
  if (message.voice ?? message.audio) return 'voice'
  return 'text'
}

function inputSummaryOf(message: TelegramMessage): string {
  if (message.photo?.length) {
    return message.caption ? `[photo] ${truncate(message.caption, 150)}` : '[photo]'
  }
  if (message.voice ?? message.audio) return '[voice note]'
  return truncate((message.text ?? message.caption ?? '').trim(), 200)
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** Reads token usage/model name off a ModelClient without widening the interface everyone implements. */
function modelUsageOf(model: ModelClient): { model: string | null; usage: TokenUsage | null } {
  const named = model as Partial<{ model: string }>
  return {
    model: typeof named.model === 'string' ? named.model : null,
    usage: model.getLastUsage ? model.getLastUsage() ?? null : null,
  }
}

async function logInbound(
  deps: IntakeDeps,
  message: TelegramMessage,
  household: HouseholdContext,
  senderId: number,
  messageType: string,
  opts: {
    stage?: string
    success: boolean
    error?: string
    durationMs?: number
    transactionId?: string
    model?: string | null
    usage?: TokenUsage | null
  }
): Promise<void> {
  try {
    await deps.store.logEvent({
      direction: 'inbound',
      stage: opts.stage ?? `extract_${messageType}`,
      messageType,
      chatId: message.chat.id,
      telegramUserId: senderId,
      person: household.people.get(senderId) || null,
      telegramMsgId: message.message_id,
      inputSummary: inputSummaryOf(message),
      model: opts.model ?? null,
      usage: opts.usage ?? null,
      success: opts.success,
      error: opts.error ?? null,
      durationMs: opts.durationMs ?? null,
      transactionId: opts.transactionId ?? null,
    })
  } catch (error) {
    deps.log?.('intake log write failed (non-fatal)', { error: String(error) })
  }
}

const TG_CHAT_ID_SETTING = 'tg_chat_id'

/**
 * Records which Telegram chat the household uses, so a scheduled push (which
 * has no inbound update to read chat.id from) has somewhere to send to.
 *
 * Capture-once, never overwrite: a second chat showing up is worth noticing
 * rather than silently following, since a push job blindly trusting whichever
 * chat spoke most recently could end up mailing account balances to the wrong
 * place. Failure here is never allowed to cost the household a logged spend,
 * so every step is best-effort.
 */
async function captureChatId(message: TelegramMessage, deps: IntakeDeps): Promise<void> {
  try {
    const existing = (await deps.store.getSetting(TG_CHAT_ID_SETTING)) as { chat_id?: number } | null
    if (existing?.chat_id != null) {
      if (existing.chat_id !== message.chat.id) {
        deps.log?.('chat id capture: a second chat spoke to the bot, leaving the stored one untouched', {
          stored: existing.chat_id,
          seen: message.chat.id,
        })
      }
      return
    }
    await deps.store.putSetting(TG_CHAT_ID_SETTING, {
      chat_id: message.chat.id,
      chat_type: message.chat.type,
      title: message.chat.title ?? null,
      captured_at: new Date().toISOString(),
    })
  } catch (error) {
    deps.log?.('chat id capture failed (non-fatal)', { error: String(error) })
  }
}

class UnsupportedMessage extends Error {}

/**
 * A short, readable version of a failure for the Telegram reply. Upstream
 * errors carry the useful part ("OpenRouter 402: insufficient credits"), so
 * they're worth showing — this is a private household group, and the
 * alternative is the couple silently losing spends to an unexplained failure.
 */
export function errorHint(error: unknown): string | null {
  const raw = error instanceof Error ? error.message : String(error)
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  return cleaned.length > 200 ? `${cleaned.slice(0, 200)}…` : cleaned
}

async function extractFromMessage(
  message: TelegramMessage,
  ctx: PromptContext,
  deps: IntakeDeps
): Promise<Extraction> {
  if (message.photo?.length) {
    if (message.media_group_id) return extractFromAlbumPhoto(message, ctx, deps)
    const file = await deps.messenger.downloadFile(largestPhoto(message.photo).file_id)
    const dataUrl = `data:${file.mimeType};base64,${toBase64(file.bytes)}`
    return extractFromImage({ dataUrl, caption: message.caption ?? null }, ctx, deps.model)
  }

  if (message.document) {
    // Without this check, a PDF/file falls through to the text branch below
    // and the caption alone ("here's my invoice") gets logged as a spend with
    // no amount — a silent garbage row, not a helpful failure.
    await deps.messenger.sendMessage(
      message.chat.id,
      "I can't read PDFs or other files yet — send a photo of it instead, or type the amount.",
      { replyToMessageId: message.message_id }
    )
    throw new UnsupportedMessage('document received but not supported')
  }

  const voice = message.voice ?? message.audio
  if (voice) {
    if (!deps.transcriber) {
      await deps.messenger.sendMessage(
        message.chat.id,
        "Voice notes aren't switched on yet (no transcription key configured). Type it or send a photo for now.",
        { replyToMessageId: message.message_id }
      )
      throw new UnsupportedMessage('voice received but no transcriber configured')
    }
    const file = await deps.messenger.downloadFile(voice.file_id)
    const transcript = await deps.transcriber.transcribe(file)
    // Same text pipeline as a typed message — only the spoken flag differs.
    return extractFromText(transcript, ctx, deps.model, { spoken: true })
  }

  const text = (message.text ?? message.caption ?? '').trim()
  if (!text) throw new UnsupportedMessage('message has no text, photo or voice')
  if (text.startsWith('/')) throw new UnsupportedMessage(`unknown command: ${text.split(/\s/)[0]}`)
  return extractFromText(text, ctx, deps.model)
}

/**
 * A photo sent as part of a Telegram album (multi-select send). Telegram
 * delivers each one as its own webhook call sharing one media_group_id, and
 * this Edge Function is stateless between calls — so each photo joins a
 * shared row in `media_groups`, waits briefly, then checks whether it's
 * still the most recently joined member. Exactly one of the N invocations
 * survives that check (see media_groups' claim logic in store.ts) and runs
 * a single extraction across every photo in the group; the rest stand down
 * silently via UnsupportedMessage, same as an out-of-scope command.
 */
async function extractFromAlbumPhoto(message: TelegramMessage, ctx: PromptContext, deps: IntakeDeps): Promise<Extraction> {
  const mediaGroupId = message.media_group_id!
  const fileId = largestPhoto(message.photo!).file_id
  const joined = await deps.store.joinMediaGroup(mediaGroupId, message.chat.id, fileId, message.caption ?? null)

  await waitFor(deps, ALBUM_DEBOUNCE_MS)

  const current = await deps.store.getMediaGroup(mediaGroupId)
  if (!current || current.processedAt || current.updatedAt !== joined.updatedAt) {
    throw new UnsupportedMessage('superseded by a later album member')
  }
  await deps.store.claimMediaGroup(mediaGroupId)

  const files = await Promise.all(current.fileIds.map((id) => deps.messenger.downloadFile(id)))
  const images = files.map((file) => ({ dataUrl: `data:${file.mimeType};base64,${toBase64(file.bytes)}` }))
  return extractFromImages(images, current.caption, ctx, deps.model)
}

function waitFor(deps: IntakeDeps, ms: number): Promise<void> {
  if (deps.wait) return deps.wait(ms)
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function applyCorrection(
  row: TransactionRow,
  correction: string,
  message: TelegramMessage,
  household: HouseholdContext,
  ctx: PromptContext,
  deps: IntakeDeps
): Promise<IntakeOutcome> {
  const senderId = message.from?.id ?? 0
  const t0 = Date.now()

  let extraction: Extraction
  try {
    extraction = await extractCorrection(extractionFromRow(row, household), correction, ctx, deps.model)
  } catch (error) {
    deps.log?.('correction failed', { error: String(error), transactionId: row.id })
    await deps.messenger.sendMessage(message.chat.id, "I couldn't apply that fix — try rephrasing it.", {
      replyToMessageId: message.message_id,
    })
    await logInbound(deps, message, household, senderId, 'text', {
      stage: 'correction',
      success: false,
      error: String(error),
      durationMs: Date.now() - t0,
      transactionId: row.id,
    })
    return { status: 'error', reason: String(error) }
  }

  const resolved = resolve(extraction, household, senderId)
  const updated = await deps.store.updateTransaction(row.id, {
    date: extraction.date,
    amount: extraction.amount ?? 0,
    currency: extraction.currency,
    account_id: resolved.accountId,
    category: extraction.category,
    owner: resolved.owner,
    note: extraction.note,
    needs_review: resolved.needsReview,
    telegram_prompt_msg_id: null,
    items: extraction.items,
  })

  const usage = modelUsageOf(deps.model)
  await logInbound(deps, message, household, senderId, 'text', {
    stage: 'correction',
    success: true,
    durationMs: Date.now() - t0,
    transactionId: updated.id,
    model: usage.model,
    usage: usage.usage,
  })

  await announce(updated.id, extraction, resolved, message, deps, { corrected: true })
  return { status: 'corrected', transactionId: updated.id, needsReview: resolved.needsReview }
}

async function handleCallback(query: TelegramCallbackQuery, deps: IntakeDeps): Promise<IntakeOutcome> {
  const parsed = parseCallbackData(query.data)
  const chatId = query.message?.chat.id
  if (!parsed || !chatId) {
    await deps.messenger.answerCallbackQuery(query.id)
    return { status: 'ignored', reason: 'callback without usable data' }
  }

  const household = await deps.store.loadHouseholdContext()
  if (!household.people.has(query.from.id)) {
    await deps.messenger.answerCallbackQuery(query.id)
    deps.log?.('rejected callback sender', { senderId: query.from.id })
    return { status: 'ignored', reason: `sender ${query.from.id} is not in the household allowlist` }
  }

  if (parsed.action === 'cashback_apply' || parsed.action === 'cashback_cancel') {
    return handleCashbackCallback(parsed.action, parsed.transactionId, chatId, query, deps)
  }

  const row = await deps.store.getTransaction(parsed.transactionId)
  if (!row) {
    await deps.messenger.answerCallbackQuery(query.id, 'That one is gone from the app.')
    await logCallback(deps, query, chatId, parsed.action, { success: false, error: 'transaction not found' })
    return { status: 'ignored', reason: `transaction ${parsed.transactionId} not found` }
  }

  if (parsed.action === 'confirm_group') {
    // Unlike the single-row 'confirm' below (and its split_group_id cascade
    // for a transfer pair, where both rows always share one amount), a bulk
    // group's rows can have independently zero amounts — so each sibling is
    // guarded individually rather than blessing the whole group at once.
    const groupId = row.split_group_id
    const siblings = groupId ? await deps.store.findTransactionsBySplitGroup(groupId) : [row]
    const clearable = siblings.filter((sibling) => Number(sibling.amount) !== 0)
    const blocked = siblings.filter((sibling) => Number(sibling.amount) === 0)

    const updated = await Promise.all(
      clearable.map((sibling) => deps.store.updateTransaction(sibling.id, { needs_review: false, telegram_prompt_msg_id: null }))
    )
    const updatedById = new Map(updated.map((r) => [r.id, r]))
    const finalRows = siblings.map((sibling) => updatedById.get(sibling.id) ?? sibling)

    await deps.messenger.answerCallbackQuery(query.id, blocked.length ? 'Confirmed — some still need the amount' : 'Confirmed')
    if (query.message) {
      const lines = [
        blocked.length ? `Confirmed ${clearable.length} of ${siblings.length}:` : `Confirmed ${siblings.length}:`,
        ...finalRows.map(
          (r, i) => `${bulkMarker(i + 1)} ${describeRow(r, household)}${r.needs_review ? ' — still needs the amount' : ''}`
        ),
      ]
      // Drop the keyboard so a stale message can't be tapped twice — any row
      // still needing the amount has to be fixed in the app from here.
      await deps.messenger.editMessageText(chatId, query.message.message_id, lines.join('\n'))
    }
    await logCallback(deps, query, chatId, 'confirm_group', { success: true, transactionId: row.id })
    return { status: 'confirmed', transactionId: row.id }
  }

  if (parsed.action === 'confirm') {
    if (!Number(row.amount)) {
      // Confirming a row we never managed to read an amount for would bless a
      // zero into the budget. Ask for the number instead — except a transfer,
      // whose "reply with the amount" would route through the spend-shaped
      // correction pipeline (extractCorrection) and corrupt category='Transfer'.
      // No transfer-aware correction extraction exists yet, so point at the app.
      if (row.category === 'Transfer') {
        await deps.messenger.answerCallbackQuery(query.id, 'I still need the amount')
        if (query.message) {
          await deps.messenger.editMessageText(
            chatId,
            query.message.message_id,
            `${describeRow(row, household)}\n\nStill needs an amount — edit it in the app for now.`
          )
        }
        await logCallback(deps, query, chatId, 'confirm_blocked', { success: true, transactionId: row.id })
        return { status: 'fix_requested', transactionId: row.id }
      }
      await deps.messenger.answerCallbackQuery(query.id, 'I still need the amount')
      const prompt = await deps.messenger.sendMessage(
        chatId,
        `I never got an amount for that one. Reply to this message with it — e.g. “84”.\n\nRight now: ${describeRow(row, household)}`,
        { forceReply: true }
      )
      await deps.store.updateTransaction(row.id, { telegram_prompt_msg_id: prompt.message_id })
      await logCallback(deps, query, chatId, 'confirm_blocked', { success: true, transactionId: row.id })
      return { status: 'fix_requested', transactionId: row.id }
    }

    const updated = await deps.store.updateTransaction(row.id, { needs_review: false, telegram_prompt_msg_id: null })
    if (updated.split_group_id) {
      // A transfer's pair: Confirm applies to the pair as a unit, not just the half that carried the button.
      const siblings = await deps.store.findTransactionsBySplitGroup(updated.split_group_id)
      await Promise.all(
        siblings.filter((sibling) => sibling.id !== updated.id).map((sibling) => deps.store.updateTransaction(sibling.id, { needs_review: false }))
      )
    }
    await deps.messenger.answerCallbackQuery(query.id, 'Confirmed')
    if (query.message) {
      // Drop the keyboard so a stale message can't be tapped twice.
      await deps.messenger.editMessageText(
        chatId,
        query.message.message_id,
        `${describeRow(updated, household)} ✓`
      )
    }
    await logCallback(deps, query, chatId, 'confirm', { success: true, transactionId: row.id })
    return { status: 'confirmed', transactionId: row.id }
  }

  if (parsed.action === 'fix') {
    await deps.messenger.answerCallbackQuery(query.id)
    const prompt = await deps.messenger.sendMessage(
      chatId,
      `What should it be? Reply to this message — e.g. “84 not 48”, “groceries”, “paid with the ENBD card”.\n\nRight now: ${describeRow(row, household)}`,
      { forceReply: true }
    )
    // Remember which message the correction will hang off.
    await deps.store.updateTransaction(row.id, { telegram_prompt_msg_id: prompt.message_id })
    await logCallback(deps, query, chatId, 'fix', { success: true, transactionId: row.id })
    return { status: 'fix_requested', transactionId: row.id }
  }

  if (parsed.action === 'delete') {
    // Tapping twice (or a stale button after a rebuild) is a no-op, not an error.
    if (row.deleted_at) {
      await deps.messenger.answerCallbackQuery(query.id, 'Already deleted')
      await logCallback(deps, query, chatId, 'delete_noop', { success: true, transactionId: row.id })
      return { status: 'deleted', transactionId: row.id }
    }
    await deps.store.updateTransaction(row.id, { deleted_at: new Date().toISOString() })
    await deps.messenger.answerCallbackQuery(query.id, 'Deleted')
    if (query.message) {
      // Drop the keyboard so a stale message can't be tapped twice.
      await deps.messenger.editMessageText(chatId, query.message.message_id, `${describeRow(row, household)} — deleted 🗑`)
    }
    await logCallback(deps, query, chatId, 'delete', { success: true, transactionId: row.id })
    return { status: 'deleted', transactionId: row.id }
  }

  await deps.messenger.answerCallbackQuery(query.id)
  await logCallback(deps, query, chatId, parsed.action, { success: false, error: 'unknown callback action', transactionId: row.id })
  return { status: 'ignored', reason: `unknown callback action: ${parsed.action}` }
}

async function logCallback(
  deps: IntakeDeps,
  query: TelegramCallbackQuery,
  chatId: number,
  action: string,
  opts: { success: boolean; error?: string; transactionId?: string }
): Promise<void> {
  try {
    await deps.store.logEvent({
      direction: 'inbound',
      stage: 'callback',
      messageType: 'callback_query',
      chatId,
      telegramUserId: query.from.id,
      telegramMsgId: query.message?.message_id ?? null,
      inputSummary: action,
      success: opts.success,
      error: opts.error ?? null,
      transactionId: opts.transactionId ?? null,
    })
  } catch (error) {
    deps.log?.('intake log write failed (non-fatal)', { error: String(error) })
  }
}

// ── resolution + gating ────────────────────────────────────────────────────

export interface Resolved {
  accountId: string | null
  accountName: string | null
  owner: string | null
  needsReview: boolean
  /** Names of accounts that tied on the match score, when that's why accountId is null. */
  tiedAccountNames: string[]
}

export function resolve(extraction: Extraction, household: HouseholdContext, senderId: number): Resolved {
  const matched = matchAccount(extraction.paid_with, household.accounts)
  const accountId = matched?.id ?? household.defaultAccountId
  const account = household.accounts.find((a) => a.id === accountId) ?? null
  // A tie ("...1657" matches two sub-ledgers on the same physical card) is worth
  // naming in the review prompt — "which account" alone forces a household member
  // to guess blind at what the bot was even confused about.
  const tiedAccountNames = matched ? [] : matchAccountTies(extraction.paid_with, household.accounts).map((a) => a.name)

  const owner = resolveOwner(extraction.paid_by, household, senderId)

  // Gate: the model's confidence, plus the fields we could not resolve ourselves.
  const needsReview =
    extraction.confidence < household.confidenceThreshold ||
    extraction.amount === null ||
    extraction.category === null ||
    accountId === null

  return { accountId, accountName: account?.name ?? null, owner, needsReview, tiedAccountNames }
}

function resolveOwner(paidBy: string | null, household: HouseholdContext, senderId: number): string | null {
  const names = Array.from(new Set(Array.from(household.people.values()).filter(Boolean)))
  if (paidBy) {
    const wanted = paidBy.trim().toLowerCase()
    const named = names.find((name) => name.toLowerCase() === wanted)
    if (named) return named
  }
  // Default to whoever sent the message.
  return household.people.get(senderId) || null
}

const WEAK_ACCOUNT_TOKENS = new Set([
  'card', 'credit', 'debit', 'bank', 'account', 'the', 'my', 'visa', 'mastercard', 'pay', 'wallet',
])

/** Maps a free-text payment hint ("VISA ****1234", "ENBD credit card") to an account. */
export function matchAccount(guess: string | null, accounts: AccountRef[]): AccountRef | null {
  return bestAccountMatch(guess, accounts).best
}

/** The accounts a guess tied on, when that tie is why matchAccount abstained. Empty otherwise. */
export function matchAccountTies(guess: string | null, accounts: AccountRef[]): AccountRef[] {
  return bestAccountMatch(guess, accounts).tied
}

function bestAccountMatch(guess: string | null, accounts: AccountRef[]): { best: AccountRef | null; tied: AccountRef[] } {
  if (!guess) return { best: null, tied: [] }
  const wanted = simplify(guess)
  if (wanted === '') return { best: null, tied: [] }

  const wantedTokens = wanted.split(' ').filter(Boolean)
  const wantedDigits = digitRuns(guess)

  const scored = accounts.map((account) => ({
    account,
    score: scoreAccount(account, wanted, wantedTokens, wantedDigits),
  }))
  const top = scored.reduce<{ account: AccountRef; score: number } | null>(
    (best, entry) => (!best || entry.score > best.score ? entry : best),
    null
  )

  if (!top || top.score < 12) return { best: null, tied: [] }
  // A tie means we genuinely can't tell the two apart — better to flag for review
  // and name the candidates than to guess, e.g. two sub-ledgers on one card number.
  const tiedWith = scored.filter((entry) => entry.account !== top.account && entry.score === top.score)
  if (tiedWith.length === 0) return { best: top.account, tied: [] }
  return { best: null, tied: [top.account, ...tiedWith.map((e) => e.account)] }
}

function scoreAccount(account: AccountRef, wanted: string, wantedTokens: string[], wantedDigits: string[]): number {
  const name = simplify(account.name)
  if (name === wanted) return 100
  let score = 0
  // A bare "card" is a substring of half the accounts — it has to carry at least
  // one distinguishing word before a substring hit means anything.
  const hasStrongToken = wantedTokens.some((token) => !WEAK_ACCOUNT_TOKENS.has(token))
  if (hasStrongToken && (name.includes(wanted) || wanted.includes(name))) score += 40
  for (const token of name.split(' ').filter(Boolean)) {
    if (!wantedTokens.includes(token)) continue
    score += WEAK_ACCOUNT_TOKENS.has(token) ? 2 : 12
  }
  // "VISA ****1234" against an account named "ENBD Visa 1234".
  const nameDigits = digitRuns(account.name)
  if (wantedDigits.some((d) => nameDigits.includes(d))) score += 45
  return score
}

function digitRuns(value: string): string[] {
  return (value.match(/\d{3,}/g) ?? []).map((run) => run.slice(-4))
}

function simplify(value: string): string {
  return value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
}

// ── replies ────────────────────────────────────────────────────────────────

async function announce(
  transactionId: string,
  extraction: Extraction,
  resolved: Resolved,
  message: TelegramMessage,
  deps: IntakeDeps,
  opts: { corrected?: boolean; duplicate?: PossibleDuplicate | null } = {}
): Promise<void> {
  const summary = describe(extraction, resolved)
  const itemLines = formatItems(extraction.items)
  const duplicateLines = formatDuplicateWarning(opts.duplicate ?? null, extraction.currency)

  if (!resolved.needsReview) {
    const verb = opts.corrected ? 'Updated' : 'Logged'
    const lines = [`${verb}: ${summary} ✓`, ...itemLines, ...duplicateLines]
    await deps.messenger.sendMessage(message.chat.id, lines.join('\n'), {
      replyToMessageId: message.message_id,
      ...(opts.duplicate ? { inlineKeyboard: deleteKeyboard(transactionId) } : {}),
    })
    return
  }

  const gaps = missingFields(extraction, resolved)
  const lines = [
    opts.corrected ? 'Updated, but still worth a look:' : 'Logged — worth a quick check:',
    summary,
    ...itemLines,
    formatDate(extraction.date),
    ...duplicateLines,
  ]
  if (gaps.length) lines.push(`Not sure about: ${gaps.join(', ')}.`)

  const keyboard = opts.duplicate
    ? [...confirmFixKeyboard(transactionId), ...deleteKeyboard(transactionId)]
    : confirmFixKeyboard(transactionId)

  const sent = await deps.messenger.sendMessage(message.chat.id, lines.join('\n'), {
    replyToMessageId: message.message_id,
    inlineKeyboard: keyboard,
  })
  await deps.store.updateTransaction(transactionId, { telegram_prompt_msg_id: sent.message_id })
}

/** ⚠️ Looks like a duplicate of Thu 6 Aug, 84 AED · Karak House. */
function formatDuplicateWarning(duplicate: PossibleDuplicate | null, currency: string): string[] {
  if (!duplicate) return []
  const noteSuffix = duplicate.note ? ` · ${duplicate.note}` : ''
  return [`⚠️ Looks like a duplicate of ${formatDate(duplicate.date)}, ${formatAmount(duplicate.amount)} ${currency}${noteSuffix}.`]
}

function deleteKeyboard(transactionId: string): InlineKeyboardButton[][] {
  return [[{ text: '🗑 Delete this one', callback_data: `delete:${transactionId}` }]]
}

export function describe(extraction: Extraction, resolved: Resolved): string {
  const parts = [
    extraction.category ?? 'Uncategorised',
    extraction.amount === null ? `amount unreadable (${extraction.currency})` : `${formatAmount(extraction.amount)} ${extraction.currency}`,
    extraction.note,
    resolved.accountName ?? 'account unknown',
  ]
  return parts.filter(Boolean).join(' · ')
}

function describeRow(row: TransactionRow, household: HouseholdContext): string {
  const account = household.accounts.find((a) => a.id === row.account_id)
  return [
    row.category ?? 'Uncategorised',
    `${formatAmount(Number(row.amount))} ${row.currency}`,
    row.note,
    account?.name ?? 'account unknown',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Caps the breakdown at a readable length — a 40-item Noon cart still fits in one reply. */
const MAX_ITEM_LINES = 8

function formatItems(items: Extraction['items']): string[] {
  if (!items || items.length === 0) return []
  const lines = items.slice(0, MAX_ITEM_LINES).map(formatItemLine)
  const rest = items.length - MAX_ITEM_LINES
  if (rest > 0) lines.push(`  +${rest} more`)
  return lines
}

function formatItemLine(item: { name: string; qty: number | null; price: number | null }): string {
  const qty = item.qty !== null && item.qty !== 1 ? `${item.qty}× ` : ''
  const price = item.price !== null ? ` ${formatAmount(item.price)}` : ''
  return `  • ${qty}${item.name}${price}`
}

function missingFields(extraction: Extraction, resolved: Resolved): string[] {
  const gaps: string[] = []
  if (extraction.amount === null) gaps.push('the amount')
  if (extraction.category === null) gaps.push('the category')
  if (resolved.accountId === null) {
    gaps.push(
      resolved.tiedAccountNames.length
        ? `which account — could be ${resolved.tiedAccountNames.join(' or ')}`
        : 'which account'
    )
  }
  return gaps
}

function formatAmount(amount: number): string {
  return amount.toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

/** Rebuilds the extraction shape from a stored row so a fix can be merged into it. */
export function extractionFromRow(row: TransactionRow, household: HouseholdContext): Extraction {
  const account = household.accounts.find((a) => a.id === row.account_id)
  return {
    date: row.date,
    amount: Number(row.amount) || null,
    currency: row.currency,
    category: row.category,
    paid_by: row.owner,
    paid_with: account?.name ?? null,
    note: row.note,
    confidence: row.needs_review ? 0.5 : 1,
    items: row.items,
  }
}

function today(deps: IntakeDeps): string {
  const now = deps.now ? deps.now() : new Date()
  return todayInTz(now)
}
