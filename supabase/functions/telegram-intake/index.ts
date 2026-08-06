// Supabase Edge Function: telegram-intake
//
// Telegram webhook → extraction → transactions row → reply. All of the actual
// logic lives in intake.ts; this file is transport: verify, wire up, always 200.
//
// Deploy:  supabase functions deploy telegram-intake --no-verify-jwt
// (--no-verify-jwt because Telegram can't send a Supabase JWT. The request is
// authenticated by the webhook secret header, and the *data* is gated by the
// household allowlist inside handleUpdate.)

import { loadConfig } from './config.ts'
import { OpenRouterClient } from './extract.ts'
import { handleUpdate } from './intake.ts'
import type { IntakeDeps } from './intake.ts'
import { PostgrestStore } from './store.ts'
import { TelegramClient } from './telegram.ts'
import { GroqWhisper } from './transcribe.ts'
import type { DownloadedFile, Messenger, SendOptions, TelegramMessage, TelegramUpdate } from './types.ts'

declare const Deno: {
  env: { toObject(): Record<string, string | undefined> }
  serve(handler: (request: Request) => Response | Promise<Response>): unknown
}

const SECRET_HEADER = 'x-telegram-bot-api-secret-token'

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

  const isDemo = config.demoMode && request.headers.get('x-demo-mode') === '1'

  if (!isDemo) {
    if (config.telegramWebhookSecret) {
      if (request.headers.get(SECRET_HEADER) !== config.telegramWebhookSecret) {
        console.warn('rejected webhook: bad secret header')
        return json({ ok: false, error: 'forbidden' }, 403)
      }
    } else {
      console.warn('TELEGRAM_WEBHOOK_SECRET is unset — anyone who guesses this URL can post updates')
    }
  }

  let update: TelegramUpdate
  try {
    update = (await request.json()) as TelegramUpdate
  } catch {
    return json({ ok: false, error: 'invalid JSON' }, 400)
  }

  const telegram = new TelegramClient(config.telegramBotToken)
  const recorder = isDemo ? new RecordingMessenger(telegram) : null

  const deps: IntakeDeps = {
    store: new PostgrestStore({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.supabaseServiceKey,
      fallbackThreshold: config.confidenceThreshold,
      fallbackTelegramIds: config.allowedTelegramIds,
    }),
    messenger: recorder ?? telegram,
    model: new OpenRouterClient(config.openRouterApiKey, config.openRouterModel),
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
