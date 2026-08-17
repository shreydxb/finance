// Supabase Edge Function: telegram-intake
//
// Telegram webhook → extraction → transactions row → reply. All of the actual
// logic lives in intake.ts; this file is transport: verify, wire up, always 200.
//
// Deploy:  supabase functions deploy telegram-intake --no-verify-jwt
// (--no-verify-jwt because Telegram can't send a Supabase JWT. The request is
// authenticated by the webhook secret header, and the *data* is gated by the
// household allowlist inside handleUpdate.)

// The only non-relative import in the function, and it's types-only: it gives
// this file the Deno globals. Everything else is plain fetch.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { loadConfig } from './config.ts'
import { authorizeWebhook } from './gate.ts'
import { OpenRouterClient } from './extract.ts'
import { handleUpdate } from './intake.ts'
import type { IntakeDeps } from './intake.ts'
import { PostgrestStore } from '../_shared/store.ts'
import { PostgrestQueryStore } from './query/store.ts'
import { TelegramClient } from '../_shared/telegram.ts'
import { GroqWhisper } from './transcribe.ts'
import type { DownloadedFile, IntakeStore, Messenger, SendOptions, TelegramMessage, TelegramUpdate } from '../_shared/types.ts'

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'POST only' }, 405)
  }

  let config
  try {
    config = loadConfig(Deno.env.toObject())
  } catch (error) {
    console.error('config error', error)
    return json({ ok: false, error: 'function is not configured' }, 500)
  }

  // Fail closed, before the body is read and before any store/Telegram client
  // exists: a rejected request must cost zero DB and zero API calls.
  const gate = authorizeWebhook(request.headers, config, request.headers.get('content-length'))
  if (!gate.ok) {
    console.warn('rejected webhook', gate.reason)
    return json({ ok: false, error: gate.error }, gate.status)
  }
  const isDemo = gate.demo

  let update: TelegramUpdate
  try {
    update = (await request.json()) as TelegramUpdate
  } catch {
    return json({ ok: false, error: 'invalid JSON' }, 400)
  }

  const store = new PostgrestStore({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.supabaseServiceKey,
    fallbackThreshold: config.confidenceThreshold,
    fallbackTelegramIds: config.allowedTelegramIds,
  })
  const queryStore = new PostgrestQueryStore({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.supabaseServiceKey,
  })
  const telegram = new TelegramClient(config.telegramBotToken)
  const recorder = isDemo ? new RecordingMessenger(telegram) : null
  // One real client, used for both extraction and classification — it has no
  // per-call queue to desync, unlike the fakes in tests, so there's no
  // reason to pay for a second connection/config just to keep the two calls
  // apart.
  const model = new OpenRouterClient(config.openRouterApiKey, config.openRouterModel)

  const deps: IntakeDeps = {
    store,
    queryStore,
    messenger: new LoggingMessenger(recorder ?? telegram, store),
    model,
    classifierModel: model,
    transcriber: config.groqApiKey ? new GroqWhisper(config.groqApiKey, config.groqWhisperModel) : null,
    defaultCurrency: config.defaultCurrency,
    log: (message, data) => console.log(message, data ?? ''),
  }

  try {
    const outcome = await handleUpdate(update, deps)
    console.log('intake outcome', outcome)
    return json({ ok: true, outcome, ...(recorder ? { sent: recorder.sent } : {}) })
  } catch (error) {
    // Never hand Telegram a non-2xx: it would redeliver this update forever.
    console.error('intake failed', error)
    return json({ ok: false, error: String(error) })
  }
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Wraps any Messenger to log every outbound reply (a Confirm/Fix prompt, an
 * FYI, an error hint, a /help answer) to `intake_logs` — success, latency and
 * the text sent. This is the other half of the observability trail: intake.ts
 * logs what came in, this logs what went back out. A broken log write must
 * never cost the household a reply, so it's swallowed, not thrown.
 */
class LoggingMessenger implements Messenger {
  constructor(private inner: Messenger, private store: IntakeStore) {}

  async sendMessage(chatId: number, text: string, opts: SendOptions = {}): Promise<TelegramMessage> {
    const t0 = Date.now()
    try {
      const result = await this.inner.sendMessage(chatId, text, opts)
      await this.log('send_message', chatId, text, result.message_id, true, null, Date.now() - t0)
      return result
    } catch (error) {
      await this.log('send_message', chatId, text, null, false, String(error), Date.now() - t0)
      throw error
    }
  }

  async editMessageText(chatId: number, messageId: number, text: string, opts: SendOptions = {}): Promise<unknown> {
    const t0 = Date.now()
    try {
      const result = await this.inner.editMessageText(chatId, messageId, text, opts)
      await this.log('edit_message', chatId, text, messageId, true, null, Date.now() - t0)
      return result
    } catch (error) {
      await this.log('edit_message', chatId, text, messageId, false, String(error), Date.now() - t0)
      throw error
    }
  }

  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<unknown> {
    // Ephemeral popups aren't worth their own row — the tap they answer is
    // already logged by intake.ts, and the send/edit it triggers is logged here.
    return this.inner.answerCallbackQuery(callbackQueryId, text)
  }

  downloadFile(fileId: string): Promise<DownloadedFile> {
    return this.inner.downloadFile(fileId)
  }

  private async log(
    stage: string,
    chatId: number,
    text: string,
    telegramMsgId: number | null,
    success: boolean,
    error: string | null,
    durationMs: number
  ): Promise<void> {
    try {
      await this.store.logEvent({
        direction: 'outbound',
        stage,
        messageType: 'reply',
        chatId,
        person: 'bot',
        telegramMsgId,
        inputSummary: text.length > 200 ? `${text.slice(0, 200)}…` : text,
        success,
        error,
        durationMs,
      })
    } catch (logError) {
      console.error('intake log write failed (non-fatal)', logError)
    }
  }
}

/**
 * Demo mode: run a mocked update through the real pipeline without sending
 * anything to Telegram. What the bot *would* have said comes back in the
 * response body. Rows are still written — that's the point of the exercise.
 */
class RecordingMessenger implements Messenger {
  sent: Record<string, unknown>[] = []
  telegram: TelegramClient

  constructor(telegram: TelegramClient) {
    this.telegram = telegram
  }

  sendMessage(chatId: number, text: string, opts: SendOptions = {}): Promise<TelegramMessage> {
    this.sent.push({ method: 'sendMessage', chatId, text, opts })
    return Promise.resolve({
      message_id: 900000 + this.sent.length,
      chat: { id: chatId, type: 'group' },
      text,
    })
  }

  editMessageText(chatId: number, messageId: number, text: string, opts: SendOptions = {}): Promise<unknown> {
    this.sent.push({ method: 'editMessageText', chatId, messageId, text, opts })
    return Promise.resolve(null)
  }

  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<unknown> {
    this.sent.push({ method: 'answerCallbackQuery', callbackQueryId, text })
    return Promise.resolve(null)
  }

  /** Files still come from Telegram — a demo photo/voice fixture needs real bytes. */
  downloadFile(fileId: string): Promise<DownloadedFile> {
    return this.telegram.downloadFile(fileId)
  }
}
