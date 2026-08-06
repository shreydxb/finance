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

import { extractCorrection, extractFromImage, extractFromText, ExtractionError } from './extract.ts'
import { promptContextFrom } from './prompt.ts'
import type { PromptContext } from './prompt.ts'
import { confirmFixKeyboard, largestPhoto, parseCallbackData, toBase64 } from './telegram.ts'
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
  Transcriber,
  TransactionRow,
} from './types.ts'

export interface IntakeDeps {
  store: IntakeStore
  messenger: Messenger
  model: ModelClient
  /** null when GROQ_API_KEY isn't set: voice notes are then answered with a nudge. */
  transcriber: Transcriber | null
  defaultCurrency: string
  now?: () => Date
  log?: (message: string, data?: Record<string, unknown>) => void
}

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
  })

  await announce(row.id, extraction, resolved, message, deps)
  return { status: 'logged', transactionId: row.id, needsReview: resolved.needsReview }
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
    const file = await deps.messenger.downloadFile(largestPhoto(message.photo).file_id)
    const dataUrl = `data:${file.mimeType};base64,${toBase64(file.bytes)}`
    return extractFromImage({ dataUrl, caption: message.caption ?? null }, ctx, deps.model)
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

async function applyCorrection(
  row: TransactionRow,
  correction: string,
  message: TelegramMessage,
  household: HouseholdContext,
  ctx: PromptContext,
  deps: IntakeDeps
): Promise<IntakeOutcome> {
  let extraction: Extraction
  try {
    extraction = await extractCorrection(extractionFromRow(row, household), correction, ctx, deps.model)
  } catch (error) {
    deps.log?.('correction failed', { error: String(error), transactionId: row.id })
    await deps.messenger.sendMessage(message.chat.id, "I couldn't apply that fix — try rephrasing it.", {
      replyToMessageId: message.message_id,
    })
    return { status: 'error', reason: String(error) }
  }

  const senderId = message.from?.id ?? 0
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
    return { status: 'fix_requested', transactionId: row.id }
  }

  await deps.messenger.answerCallbackQuery(query.id)
  return { status: 'ignored', reason: `unknown callback action: ${parsed.action}` }
}

// ── resolution + gating ────────────────────────────────────────────────────

export interface Resolved {
  accountId: string | null
  accountName: string | null
  owner: string | null
  needsReview: boolean
}

export function resolve(extraction: Extraction, household: HouseholdContext, senderId: number): Resolved {
  const matched = matchAccount(extraction.paid_with, household.accounts)
  const accountId = matched?.id ?? household.defaultAccountId
  const account = household.accounts.find((a) => a.id === accountId) ?? null

  const owner = resolveOwner(extraction.paid_by, household, senderId)

  // Gate: the model's confidence, plus the fields we could not resolve ourselves.
  const needsReview =
    extraction.confidence < household.confidenceThreshold ||
    extraction.amount === null ||
    extraction.category === null ||
    accountId === null

  return { accountId, accountName: account?.name ?? null, owner, needsReview }
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
  if (!guess) return null
  const wanted = simplify(guess)
  if (wanted === '') return null

  const wantedTokens = wanted.split(' ').filter(Boolean)
  const wantedDigits = digitRuns(guess)

  const scored = accounts.map((account) => ({
    account,
    score: scoreAccount(account, wanted, wantedTokens, wantedDigits),
  }))
  const best = scored.reduce<{ account: AccountRef; score: number } | null>(
    (top, entry) => (!top || entry.score > top.score ? entry : top),
    null
  )

  if (!best || best.score < 12) return null
  // A tie means we genuinely can't tell the two apart — better to flag for review.
  const tied = scored.some((entry) => entry.account !== best.account && entry.score === best.score)
  return tied ? null : best.account
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

  if (!resolved.needsReview) {
    const verb = opts.corrected ? 'Updated' : 'Logged'
    await deps.messenger.sendMessage(message.chat.id, `${verb}: ${summary} ✓`, {
      replyToMessageId: message.message_id,
    })
    return
  }

  const gaps = missingFields(extraction, resolved)
  const lines = [
    opts.corrected ? 'Updated, but still worth a look:' : 'Logged — worth a quick check:',
    summary,
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

function missingFields(extraction: Extraction, resolved: Resolved): string[] {
  const gaps: string[] = []
  if (extraction.amount === null) gaps.push('the amount')
  if (extraction.category === null) gaps.push('the category')
  if (resolved.accountId === null) gaps.push('which account')
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
  }
}

function today(deps: IntakeDeps): string {
  const now = deps.now ? deps.now() : new Date()
  return now.toISOString().slice(0, 10)
}
