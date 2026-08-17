import assert from 'node:assert/strict'
import test from 'node:test'

import { GuardedMessenger, allowedChatIds } from './guardedMessenger.ts'
import type { DownloadedFile, Messenger, SendOptions, TelegramMessage } from './types.ts'

class RecordingInner implements Messenger {
  sent: Array<{ method: string; chatId: number }> = []

  sendMessage(chatId: number, text: string, _opts?: SendOptions): Promise<TelegramMessage> {
    this.sent.push({ method: 'sendMessage', chatId })
    return Promise.resolve({ message_id: 1, chat: { id: chatId, type: 'group' }, text })
  }

  editMessageText(chatId: number, _messageId: number, _text: string, _opts?: SendOptions): Promise<unknown> {
    this.sent.push({ method: 'editMessageText', chatId })
    return Promise.resolve(null)
  }

  answerCallbackQuery(_callbackQueryId: string, _text?: string): Promise<unknown> {
    this.sent.push({ method: 'answerCallbackQuery', chatId: -1 })
    return Promise.resolve(null)
  }

  downloadFile(_fileId: string): Promise<DownloadedFile> {
    this.sent.push({ method: 'downloadFile', chatId: -1 })
    return Promise.resolve({ bytes: new Uint8Array(), mimeType: 'image/jpeg', filePath: 'x' })
  }
}

test('allowedChatIds includes every allowlisted person plus the captured chat', () => {
  const allowed = allowedChatIds(new Set([111, 222]), -999)
  assert.deepEqual([...allowed].sort(), [-999, 111, 222])
})

test('allowedChatIds tolerates a not-yet-captured chat (null)', () => {
  const allowed = allowedChatIds(new Set([111]), null)
  assert.deepEqual([...allowed], [111])
})

test('a send to an allowed chat reaches the inner messenger', async () => {
  const inner = new RecordingInner()
  const guarded = new GuardedMessenger(inner, new Set([-999]))

  await guarded.sendMessage(-999, 'hello')

  assert.deepEqual(inner.sent, [{ method: 'sendMessage', chatId: -999 }])
})

test('a send to an unlisted chat never reaches the inner messenger', async () => {
  const inner = new RecordingInner()
  const logs: Array<[string, Record<string, unknown> | undefined]> = []
  const guarded = new GuardedMessenger(inner, new Set([-999]), (msg, data) => logs.push([msg, data]))

  const result = await guarded.sendMessage(-111, 'attacker-controlled chat')

  assert.deepEqual(inner.sent, [], 'the forged chat never received the real Telegram call')
  assert.equal(result.chat.id, -111, 'the stub echoes the requested chat id, not a thrown error')
  assert.ok(logs.some(([msg, data]) => msg.includes('blocked') && data?.chatId === -111))
})

test('editMessageText to an unlisted chat is blocked the same way', async () => {
  const inner = new RecordingInner()
  const guarded = new GuardedMessenger(inner, new Set([-999]))

  const result = await guarded.editMessageText(-111, 42, 'edited')

  assert.deepEqual(inner.sent, [])
  assert.equal(result, null)
})

test('answerCallbackQuery and downloadFile are never gated by chat id', async () => {
  const inner = new RecordingInner()
  const guarded = new GuardedMessenger(inner, new Set())

  await guarded.answerCallbackQuery('cb-1')
  await guarded.downloadFile('file-1')

  assert.deepEqual(
    inner.sent.map((s) => s.method),
    ['answerCallbackQuery', 'downloadFile']
  )
})
