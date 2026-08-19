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
import { GuardedMessenger, allowedChatIds } from '../_shared/guardedMessenger.ts'
import { routeMessage } from './route.ts'
import { handlePendingActionCallback } from './actions/pending.ts'
import type { PendingActionHandlers } from './actions/pending.ts'
import type { QueryStore } from './query/types.ts'
import { matchAccount, matchAccountTies } from './accountMatch.ts'
export { matchAccount, matchAccountTies } from './accountMatch.ts'
import { formatAmount, formatDate } from './format.ts'
import { errorHint } from './errorHint.ts'
import { answerQuestion } from './query/refusal.ts'
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
  /** Backs the intent router's question path (Taskiv #50/#51/#52) — reads through v_transactions_aed, never transactions.amount directly. */
  queryStore: QueryStore
  messenger: Messenger
  model: ModelClient
  /**
   * The intent router's classifier (Taskiv #50) calls this instead of
   * `model`. A separate field, not a reused call to `model`, so a fake
   * queue seeded for extraction responses in a test is never desynced by an
   * extra classifier call in front of it — in production both fields can
   * point at the same real client, which has no such queue to desync.
   */
  classifierModel: ModelClient
  /** Taskiv #60: registered handlers for propose-then-tap actions, keyed by kind. Empty until #63-67 register into it. */
  pendingActionHandlers: PendingActionHandlers
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

// Taskiv #53: keep this an honest catalogue of what's actually deployed, not
// an aspirational one — a /help promising features that don't exist yet is
// worse than a short one. Add a line here in the SAME sprint each feature
// ships (Sprint 3 adds /undo and /review; Sprint 4 adds "action" — money
// moves, balance updates, standing rules), never before.
const HELP_TEXT = [
  '📸 Log a spend',
  '  • a photo of the receipt',
  '  • a voice note ("spent 84 dirhams at Carrefour")',
  '  • or just type it ("84 lunch noon")',
  '  • several spends in one message works too ("45 groceries, 12 coffee")',
  '',
  '💸 Cashback or a transfer',
  '  • "15 aed cashback from the ENBD card" — proposes an income entry, nothing logs until you tap Apply',
  '  • "transferred 500 from Wio to ENBD" — logs both sides, never counted as spend',
  '',
  '❓ Ask me',
  '  • how much did we spend on groceries this month',
  '  • what did Tarika spend last week',
  '  • how much is left on the ENBD card',
  '  • what did we spend today',
  '',
  '⚙️ Commands',
  '  /help — this message',
  '',
  "If I'm not sure, I'll show you what I got with Confirm / Fix buttons.",
  'Anything unconfirmed shows up as “Needs review” in the app.',
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

  const capturedChatId = await captureChatId(message, deps)

  // Every reply from here on is chat-id-guarded (Taskiv #49) — a forged
  // `from.id` cannot redirect a Confirm/Fix prompt or any other reply to an
  // arbitrary chat. Uses the just-resolved capture result, not the raw
  // `message.chat.id`, so a message from a second, unstored chat (the
  // scenario captureChatId itself refuses to follow) is not silently
  // admitted here either. Only `/id` above bypassed the guard, and it only
  // ever answers into the chat that asked.
  deps = {
    ...deps,
    messenger: new GuardedMessenger(deps.messenger, allowedChatIds(new Set(household.people.keys()), capturedChatId), deps.log),
  }

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

  // The intent router (Taskiv #50). Photo and voice never reach here — their
  // messageType already routes straight past this block, receipt/voice
  // captions live in `message.caption`, never `text`, so a photo captioned
  // "how much is this?" can't accidentally trip the router either. Only a
  // plain typed message that survived the cashback/transfer/bulk pre-checks
  // above gets classified.
  if (messageType === 'text' && text) {
    const intent = await routeMessage(text, deps.classifierModel)
    if (intent === 'chatter') {
      // Silence is correct — a bot that answers "ok" is a bot people stop using.
      return { status: 'ignored', reason: 'chatter' }
    }
    if (intent === 'question') {
      return handleQuestion(text, message, household, ctx, deps)
    }
    // 'action' has no handler yet (that's Sprint 2/3's propose-then-tap work,
    // #60+) — falls through to the spend path deliberately, on the same
    // "a misrouted spend is a lost spend" bias every other fallback here uses.
  }

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
 * Answers a question routed here by the intent router (Taskiv #50), via the
 * query toolbox built in #51/#52: plan it against the closed query enum,
 * run it through v_transactions_aed, template the reply. Never writes a
 * transaction — a question that can't be planned is an honest refusal, not a
 * guess. The exact refusal wording is Taskiv #59's job (Sprint 3); this is a
 * deliberately plain placeholder until then.
 */
async function handleQuestion(
  text: string,
  message: TelegramMessage,
  household: HouseholdContext,
  ctx: PromptContext,
  deps: IntakeDeps
): Promise<IntakeOutcome> {
  const senderId = message.from?.id ?? 0
  const t0 = Date.now()

  const answer = await answerQuestion(text, ctx, deps.model, deps.queryStore, household.accounts, deps.now ?? (() => new Date()))
  await deps.messenger.sendMessage(message.chat.id, answer.text, { replyToMessageId: message.message_id })
  await logInbound(deps, message, household, senderId, 'text', {
    stage: 'answer_question',
    success: answer.success,
    error: answer.refusalReason,
    durationMs: Date.now() - t0,
  })
  // Every refusal is worth a console line too — this is the backlog signal
  // for which queries to add next (Taskiv #59), separate from the per-row
  // intake_logs entry above.
  if (!answer.success) deps.log?.('question refused', { text, reason: answer.refusalReason })
  return { status: 'ignored', reason: answer.success ? 'answered question' : `question refused: ${answer.refusalReason}` }
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
  // Keyed on the message, so a redelivery updates this row instead of adding
  // another. The write happens before the reply is sent, so anything that
  // fails afterwards — a revoked bot token, a Telegram outage — makes Telegram
  // retry an update whose spend is already recorded.
  const row = await deps.store.insertTransactionOnce(
    {
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
    },
    `tg:${message.chat.id}:${message.message_id}:single`
  )

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

  const resolvedRows = extractions.map((extraction) => ({ extraction, resolved: resolve(extraction, household, senderId) }))

  // One transaction, not N concurrent inserts (BOT-01). Any subset of the old
  // parallel requests could fail, leaving a partial batch nobody was told
  // about. The idempotency base makes a redelivered update — Telegram retries
  // on timeout or 5xx — write nothing rather than a second copy of the batch.
  //
  // telegram_msg_id is deliberately left unset on these rows: all N share one
  // inbound message, so setting it would make a bare reply match an arbitrary
  // row. Fix #n still threads correctly because it sends its own prompt
  // message per row.
  const rows = await deps.store.createBulkTransactions(
    resolvedRows.map(({ extraction, resolved }) => ({
      date: extraction.date,
      amount: extraction.amount ?? 0,
      currency: extraction.currency,
      account_id: resolved.accountId,
      category: extraction.category,
      owner: resolved.owner,
      note: extraction.note,
      needs_review: resolved.needsReview,
      items: extraction.items,
    })),
    message.chat.id,
    `tg:${message.chat.id}:${message.message_id}:bulk`
  )

  // A replay writes nothing and returns no rows. The batch is already in the
  // ledger, so there is nothing to announce and nothing to log — announcing
  // again would tell the household they had spent the money twice.
  if (rows.length === 0) {
    return { status: 'ignored', reason: 'bulk batch already recorded for this message' }
  }

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

  // One transaction, and idempotent by construction (BOT-01): the function
  // deletes the proposal first and only logs the income if that delete found
  // something. A replayed tap — or a retry after a timeout — therefore returns
  // null and logs nothing, where the old insert-then-delete pair could record
  // the same cashback twice.
  const applied = await deps.store.applyPendingIncome(pendingId)
  if (applied === null) {
    await deps.messenger.answerCallbackQuery(query.id, 'Already logged')
    return { status: 'ignored', reason: `pending income ${pendingId} was already applied` }
  }
  await deps.messenger.answerCallbackQuery(query.id, 'Logged')
  if (query.message) {
    await deps.messenger.editMessageText(chatId, query.message.message_id, `Logged: ${describeCashback(pending)} ✓`)
  }
  await logCallback(deps, query, chatId, 'cashback_apply', { success: true })
  return { status: 'cashback_applied', pendingId }
}

/**
 * Routes an apply:/cancel: tap to the generic propose-then-tap plumbing
 * (Taskiv #60). No `kind` has a registered handler yet (#63-67 add them) —
 * `deps.pendingActionHandlers` starts empty, so `applied` is unreachable in
 * production today. Reuses the same household allowlist `handleCallback`
 * already loaded, and the same edit-the-original-message pattern
 * `handleCashbackCallback` uses, rather than composing a new summary this
 * module has no way to describe (it never learns what a given `kind` means).
 */
async function handlePendingCallback(
  action: 'apply' | 'cancel',
  pendingId: string,
  chatId: number,
  query: TelegramCallbackQuery,
  household: HouseholdContext,
  deps: IntakeDeps
): Promise<IntakeOutcome> {
  const outcome = await handlePendingActionCallback(
    action,
    pendingId,
    query.from.id,
    new Set(household.people.keys()),
    deps.store,
    deps.pendingActionHandlers
  )
  const baseText = query.message?.text ?? ''
  switch (outcome.status) {
    case 'not_found':
      await deps.messenger.answerCallbackQuery(query.id, 'That proposal is gone.')
      break
    case 'already_resolved':
      await deps.messenger.answerCallbackQuery(query.id, 'Already handled.')
      break
    case 'forbidden':
      // Silent, same as the rejected-sender path elsewhere: a stranger shouldn't learn the bot noticed them.
      await deps.messenger.answerCallbackQuery(query.id)
      break
    case 'expired':
      await deps.messenger.answerCallbackQuery(query.id, 'That one expired')
      if (query.message) {
        await deps.messenger.editMessageText(chatId, query.message.message_id, `${baseText}\n\nExpired — nothing was applied.`)
      }
      break
    case 'cancelled':
      await deps.messenger.answerCallbackQuery(query.id, 'Cancelled')
      if (query.message) {
        await deps.messenger.editMessageText(chatId, query.message.message_id, `${baseText}\n\nCancelled.`)
      }
      break
    case 'applied':
      await deps.messenger.answerCallbackQuery(query.id, 'Applied')
      if (query.message) {
        await deps.messenger.editMessageText(chatId, query.message.message_id, `${baseText} ✓`)
      }
      break
  }
  await logCallback(deps, query, chatId, `pending_${action}`, {
    success: outcome.status === 'applied' || outcome.status === 'cancelled',
    error: outcome.status === 'applied' || outcome.status === 'cancelled' ? undefined : outcome.status,
    transactionId: pendingId,
  })
  return { status: 'ignored', reason: `pending action ${action}: ${outcome.status}` }
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
 * Two rows land immediately, category='Transfer', sharing one transaction_group_id with group_kind='transfer' and opposite transfer_direction
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
  // Both rows in one transaction (BOT-01). They used to be two sequential
  // inserts, so a failure between them left half a transfer: money leaving an
  // account and arriving nowhere. The idempotency base makes a redelivered
  // update a no-op instead of a second pair.
  const transferRows = await deps.store.createTransfer({
    date: extraction.date,
    amount: extraction.amount ?? 0,
    currency: extraction.currency,
    fromAccountId: fromAccount?.id ?? null,
    toAccountId: toAccount?.id ?? null,
    fromLabel: fromAccount?.name ?? extraction.fromAccount ?? null,
    toLabel: toAccount?.name ?? extraction.toAccount ?? null,
    owner,
    needsReview,
    chatId: message.chat.id,
    messageId: message.message_id,
    idempotencyBase: `tg:${message.chat.id}:${message.message_id}:transfer`,
  })

  // A replay writes nothing and returns no rows; the original pair is already
  // in the ledger, so there is nothing to announce again.
  if (transferRows.length === 0) {
    return { status: 'ignored', reason: 'transfer already recorded for this message' }
  }
  const outRow = transferRows.find((r) => r.transfer_direction === 'out') ?? transferRows[0]

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
// (made group-aware below) applies to both rows of the pair.
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
 * Confirm all cascades via transaction_group_id (confirm_group, below); Fix #n is
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
 *
 * Returns the chat id this request should treat as authoritative — the
 * pre-existing stored one if there is a mismatch, otherwise this message's
 * chat. The outbound guard (Taskiv #49) uses this return value rather than
 * `message.chat.id` directly, so a message from a second, unstored chat
 * doesn't also talk its way into this request's own allowlist.
 */
async function captureChatId(message: TelegramMessage, deps: IntakeDeps): Promise<number> {
  try {
    const existing = (await deps.store.getSetting(TG_CHAT_ID_SETTING)) as { chat_id?: number } | null
    if (existing?.chat_id != null) {
      if (existing.chat_id !== message.chat.id) {
        deps.log?.('chat id capture: a second chat spoke to the bot, leaving the stored one untouched', {
          stored: existing.chat_id,
          seen: message.chat.id,
        })
      }
      return existing.chat_id
    }
    await deps.store.putSetting(TG_CHAT_ID_SETTING, {
      chat_id: message.chat.id,
      chat_type: message.chat.type,
      title: message.chat.title ?? null,
      captured_at: new Date().toISOString(),
    })
    return message.chat.id
  } catch (error) {
    deps.log?.('chat id capture failed (non-fatal)', { error: String(error) })
    return message.chat.id
  }
}

class UnsupportedMessage extends Error {}

export { errorHint } from './errorHint.ts'

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

  // A callback can only exist on a message the bot already sent (the
  // inline-keyboard Confirm/Fix tap), which itself only reached this chat if
  // the outbound guard already allowed it — so, unlike handleMessage, there
  // is no "not yet captured" case to fall back on here.
  deps = {
    ...deps,
    messenger: new GuardedMessenger(deps.messenger, allowedChatIds(new Set(household.people.keys()), household.chatId), deps.log),
  }

  if (parsed.action === 'cashback_apply' || parsed.action === 'cashback_cancel') {
    return handleCashbackCallback(parsed.action, parsed.transactionId, chatId, query, deps)
  }

  if (parsed.action === 'apply' || parsed.action === 'cancel') {
    return handlePendingCallback(parsed.action, parsed.transactionId, chatId, query, household, deps)
  }

  const row = await deps.store.getTransaction(parsed.transactionId)
  if (!row) {
    await deps.messenger.answerCallbackQuery(query.id, 'That one is gone from the app.')
    await logCallback(deps, query, chatId, parsed.action, { success: false, error: 'transaction not found' })
    return { status: 'ignored', reason: `transaction ${parsed.transactionId} not found` }
  }

  if (parsed.action === 'confirm_group') {
    // Unlike the single-row 'confirm' below (and its transfer-only cascade
    // for a transfer pair, where both rows always share one amount), a bulk
    // group's rows can have independently zero amounts — so each sibling is
    // guarded individually rather than blessing the whole group at once.
    const groupId = row.transaction_group_id
    const siblings = groupId ? await deps.store.findTransactionsByGroup(groupId) : [row]
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
    // Only a transfer confirms as a unit: its two halves are one movement, so
    // blessing one must bless the other. A bulk batch must NOT cascade — its
    // rows are independent spends, and confirming one says nothing about the
    // rest (they use the confirm_group action instead).
    if (updated.transaction_group_id && updated.group_kind === 'transfer') {
      const siblings = await deps.store.findTransactionsByGroup(updated.transaction_group_id)
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

export { formatAmount, formatDate } from './format.ts'

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
