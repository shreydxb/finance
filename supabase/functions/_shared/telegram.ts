// Telegram Bot API client. Plain fetch — no SDK, so the same file runs under
// Deno (Edge Function) and under `node --test` with a stubbed fetch.

import type {
  DownloadedFile,
  InlineKeyboardButton,
  Messenger,
  SendOptions,
  TelegramMessage,
} from './types.ts'

const API_BASE = 'https://api.telegram.org'

type FetchLike = typeof fetch

interface TelegramApiResponse<T> {
  ok: boolean
  result?: T
  description?: string
}

export class TelegramClient implements Messenger {
  token: string
  fetchImpl: FetchLike

  constructor(token: string, fetchImpl: FetchLike = fetch) {
    this.token = token
    this.fetchImpl = fetchImpl
  }

  async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(`${API_BASE}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = (await res.json()) as TelegramApiResponse<T>
    if (!res.ok || !payload.ok) {
      throw new Error(`Telegram ${method} failed: ${payload.description ?? res.status}`)
    }
    return payload.result as T
  }

  sendMessage(chatId: number, text: string, opts: SendOptions = {}): Promise<TelegramMessage> {
    return this.call<TelegramMessage>('sendMessage', {
      chat_id: chatId,
      text,
      reply_to_message_id: opts.replyToMessageId,
      reply_markup: replyMarkup(opts),
    })
  }

  editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    opts: SendOptions = {}
  ): Promise<unknown> {
    return this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: replyMarkup(opts),
    })
  }

  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<unknown> {
    return this.call('answerCallbackQuery', { callback_query_id: callbackQueryId, text })
  }

  async downloadFile(fileId: string): Promise<DownloadedFile> {
    const file = await this.call<{ file_path: string }>('getFile', { file_id: fileId })
    const res = await this.fetchImpl(`${API_BASE}/file/bot${this.token}/${file.file_path}`)
    if (!res.ok) throw new Error(`Telegram file download failed: ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    // Telegram's file server answers almost everything with the generic
    // application/octet-stream, so a truthy-header check alone never falls
    // through to the extension guess — and OpenRouter/Gemini reject a photo
    // labeled as generic binary with "Unsupported MIME type".
    const contentType = res.headers.get('content-type')
    const mimeType = contentType && contentType !== 'application/octet-stream' ? contentType : guessMimeType(file.file_path)
    return {
      bytes,
      mimeType,
      filePath: file.file_path,
    }
  }
}

function replyMarkup(opts: SendOptions): unknown {
  if (opts.inlineKeyboard) return { inline_keyboard: opts.inlineKeyboard }
  if (opts.forceReply) return { force_reply: true, selective: true }
  return undefined
}

function guessMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'oga' || ext === 'ogg') return 'audio/ogg'
  if (ext === 'm4a') return 'audio/mp4'
  if (ext === 'mp3') return 'audio/mpeg'
  return 'application/octet-stream'
}

export function confirmFixKeyboard(transactionId: string): InlineKeyboardButton[][] {
  // callback_data is capped at 64 bytes; "confirm:" + uuid is 44.
  return [
    [
      { text: '✅ Confirm', callback_data: `confirm:${transactionId}` },
      { text: '✏️ Fix', callback_data: `fix:${transactionId}` },
    ],
  ]
}

export function parseCallbackData(data: string | undefined): { action: string; transactionId: string } | null {
  if (!data) return null
  const separator = data.indexOf(':')
  if (separator < 0) return null
  const action = data.slice(0, separator)
  const transactionId = data.slice(separator + 1)
  if (!action || !transactionId) return null
  return { action, transactionId }
}

/** base64 for a byte array, without Node/Deno-specific helpers. */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Largest available photo size — receipts need the detail. */
export function largestPhoto<T extends { file_size?: number; width: number }>(photos: T[]): T {
  return photos.reduce((best, photo) => {
    const bestSize = best.file_size ?? best.width
    const size = photo.file_size ?? photo.width
    return size > bestSize ? photo : best
  })
}
