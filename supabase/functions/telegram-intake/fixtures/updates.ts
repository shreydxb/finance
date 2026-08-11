// Hand-written Telegram payloads. Used by the tests and by demo.ts, so the
// pipeline can be exercised end to end without the live bot.

import type { TelegramMessage, TelegramUpdate } from '../../_shared/types.ts'

export const SHREY_ID = 111111111
export const TARIKA_ID = 222222222
export const STRANGER_ID = 999999999
export const CHAT_ID = -1001234567890

let nextMessageId = 1000

function baseMessage(from: number, overrides: Partial<TelegramMessage> = {}): TelegramMessage {
  return {
    message_id: nextMessageId++,
    from: { id: from, first_name: from === SHREY_ID ? 'Shrey' : 'Tarika' },
    chat: { id: CHAT_ID, type: 'group', title: 'Our Money' },
    date: 1786000000,
    ...overrides,
  }
}

export function textUpdate(text: string, from = SHREY_ID): TelegramUpdate {
  return { update_id: nextMessageId, message: baseMessage(from, { text }) }
}

export function photoUpdate(caption: string | null = null, from = SHREY_ID): TelegramUpdate {
  return {
    update_id: nextMessageId,
    message: baseMessage(from, {
      caption: caption ?? undefined,
      photo: [
        { file_id: 'small-thumb', width: 90, height: 120, file_size: 1200 },
        { file_id: 'receipt-full', width: 1280, height: 1706, file_size: 240000 },
      ],
    }),
  }
}

export function albumPhotoUpdate(
  mediaGroupId: string,
  fileId: string,
  caption: string | null = null,
  from = SHREY_ID
): TelegramUpdate {
  return {
    update_id: nextMessageId,
    message: baseMessage(from, {
      caption: caption ?? undefined,
      media_group_id: mediaGroupId,
      photo: [{ file_id: fileId, width: 1280, height: 1706, file_size: 240000 }],
    }),
  }
}

export function documentUpdate(caption: string | null = null, from = SHREY_ID): TelegramUpdate {
  return {
    update_id: nextMessageId,
    message: baseMessage(from, {
      caption: caption ?? undefined,
      document: { file_id: 'doc-1', file_name: 'invoice.pdf', mime_type: 'application/pdf' },
    }),
  }
}

export function voiceUpdate(from = TARIKA_ID): TelegramUpdate {
  return {
    update_id: nextMessageId,
    message: baseMessage(from, {
      voice: { file_id: 'voice-note-1', duration: 6, mime_type: 'audio/ogg' },
    }),
  }
}

export function replyUpdate(text: string, replyToMessageId: number, from = SHREY_ID): TelegramUpdate {
  return {
    update_id: nextMessageId,
    message: baseMessage(from, {
      text,
      reply_to_message: {
        message_id: replyToMessageId,
        chat: { id: CHAT_ID, type: 'group' },
      },
    }),
  }
}

export function callbackUpdate(
  action: 'confirm' | 'confirm_group' | 'fix' | 'delete' | 'cashback_apply' | 'cashback_cancel',
  transactionId: string,
  from = SHREY_ID,
  promptMessageId = 5000
): TelegramUpdate {
  return {
    update_id: nextMessageId++,
    callback_query: {
      id: `cb-${nextMessageId}`,
      from: { id: from, first_name: from === SHREY_ID ? 'Shrey' : 'Tarika' },
      data: `${action}:${transactionId}`,
      message: {
        message_id: promptMessageId,
        chat: { id: CHAT_ID, type: 'group' },
        text: 'Logged — worth a quick check:',
      },
    },
  }
}
