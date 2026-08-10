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
import { extractCorrection, extractFromImage, extractFromImages, extractFromText, ExtractionError } from './extract.ts'
import { promptContextFrom } from './prompt.ts'
import type { PromptContext } from './prompt.ts'
import { confirmFixKeyboard, largestPhoto, parseCallbackData, toBase64 } from '../_shared/telegram.ts'
import type {
  AccountRef,
  Extraction,
  HouseholdContext,
  IntakeOutcome,
  IntakeStore,
  Messenger,
  ModelClient,
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
    success: true,
    durationMs: Date.now() - t0,
    transactionId: row.id,
    model: usage.model,
    usage: usage.usage,
  })

  await announce(row.id, extraction, resolved, message, deps)
  return { status: 'logged', transactionId: row.id, needsReview: resolved.needsReview }
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

  const row = await deps.store.getTransaction(parsed.transactionId)
  if (!row) {
    await deps.messenger.answerCallbackQuery(query.id, 'That one is gone from the app.')
    await logCallback(deps, query, chatId, parsed.action, { success: false, error: 'transaction not found' })
    return { status: 'ignored', reason: `transaction ${parsed.transactionId} not found` }
  }

  if (parsed.action === 'confirm') {
    if (!Number(row.amount)) {
      // Confirming a row we never managed to read an amount for would bless a
      // zero into the budget. Ask for the number instead.
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
  opts: { corrected?: boolean } = {}
): Promise<void> {
  const summary = describe(extraction, resolved)
  const itemLines = formatItems(extraction.items)

  if (!resolved.needsReview) {
    const verb = opts.corrected ? 'Updated' : 'Logged'
    const lines = [`${verb}: ${summary} ✓`, ...itemLines]
    await deps.messenger.sendMessage(message.chat.id, lines.join('\n'), {
      replyToMessageId: message.message_id,
    })
    return
  }

  const gaps = missingFields(extraction, resolved)
  const lines = [
    opts.corrected ? 'Updated, but still worth a look:' : 'Logged — worth a quick check:',
    summary,
    ...itemLines,
    formatDate(extraction.date),
  ]
  if (gaps.length) lines.push(`Not sure about: ${gaps.join(', ')}.`)

  const sent = await deps.messenger.sendMessage(message.chat.id, lines.join('\n'), {
    replyToMessageId: message.message_id,
    inlineKeyboard: confirmFixKeyboard(transactionId),
  })
  await deps.store.updateTransaction(transactionId, { telegram_prompt_msg_id: sent.message_id })
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
