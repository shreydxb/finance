// Outbound chat-id allowlist — the belt-and-braces second layer behind
// TELEGRAM_WEBHOOK_SECRET (Taskiv #49).
//
// The household allowlist in intake.ts gates on `message.from.id`, a field
// read straight out of the request body. If the webhook secret were ever
// lost or misconfigured, a forged request naming an allowlisted `from.id`
// but pointing `chat.id` at an attacker's own chat would turn every reply —
// a Confirm/Fix prompt, an FYI, eventually a query answer — into a leak of
// the household's financial position to that chat.
//
// This wraps the real Messenger and refuses to send anywhere outside a
// small, explicit set of permitted chat ids, no matter what the rest of the
// pipeline believes about the sender. One class, checked at the one place
// every outbound send funnels through, rather than a check duplicated at
// each of the ~10 call sites — a single missed site would defeat the whole
// control.

import type { DownloadedFile, Messenger, SendOptions, TelegramMessage } from './types.ts'

export class GuardedMessenger implements Messenger {
  inner: Messenger
  allowed: ReadonlySet<number>
  log?: (message: string, data?: Record<string, unknown>) => void

  constructor(inner: Messenger, allowed: ReadonlySet<number>, log?: (message: string, data?: Record<string, unknown>) => void) {
    this.inner = inner
    this.allowed = allowed
    this.log = log
  }

  sendMessage(chatId: number, text: string, opts?: SendOptions): Promise<TelegramMessage> {
    if (!this.allowed.has(chatId)) {
      this.log?.('blocked outbound sendMessage: chat id not in allowlist', { chatId })
      return Promise.resolve(stubMessage(chatId, text))
    }
    return this.inner.sendMessage(chatId, text, opts)
  }

  editMessageText(chatId: number, messageId: number, text: string, opts?: SendOptions): Promise<unknown> {
    if (!this.allowed.has(chatId)) {
      this.log?.('blocked outbound editMessageText: chat id not in allowlist', { chatId })
      return Promise.resolve(null)
    }
    return this.inner.editMessageText(chatId, messageId, text, opts)
  }

  // Neither call below is keyed by an arbitrary chat id we're being asked to
  // trust: answerCallbackQuery is routed by Telegram via the callback query
  // id, and downloadFile only ever reads bytes, never sends anywhere. Both
  // pass straight through.
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<unknown> {
    return this.inner.answerCallbackQuery(callbackQueryId, text)
  }

  downloadFile(fileId: string): Promise<DownloadedFile> {
    return this.inner.downloadFile(fileId)
  }
}

function stubMessage(chatId: number, text: string): TelegramMessage {
  return { message_id: -1, chat: { id: chatId, type: 'private' }, text }
}

/**
 * The chat ids a guarded messenger may send to, given the household context
 * already loaded for this request: every allowlisted person's own id (their
 * private DM with the bot) plus the household's captured group chat, if any.
 *
 * Deliberately does NOT include the inbound chat of the current update — that
 * would let a forged `chat.id` re-admit itself the moment any real message
 * arrived, defeating the guard for exactly the attack it exists to stop.
 * `/id` is the one legitimate reply that must work in a chat outside this
 * set (initial setup, before anything is configured); it is answered via the
 * unguarded messenger before this set is even computed — see intake.ts.
 */
export function allowedChatIds(people: ReadonlySet<number>, chatId: number | null): Set<number> {
  const allowed = new Set<number>(people)
  if (chatId != null) allowed.add(chatId)
  return allowed
}
