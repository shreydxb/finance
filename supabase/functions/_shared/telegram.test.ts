import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TelegramClient } from './telegram.ts'

function fakeFetch(fileContentType: string | null) {
  const calls: string[] = []
  const impl = ((url: string) => {
    calls.push(url)
    if (url.includes('/getFile')) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/file_1.jpg' } }), { status: 200 })
      )
    }
    const headers = fileContentType ? { 'content-type': fileContentType } : {}
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers }))
  }) as unknown as typeof fetch
  return { impl, calls }
}

test('downloadFile falls back to the extension guess when Telegram answers application/octet-stream', async () => {
  const { impl } = fakeFetch('application/octet-stream')
  const client = new TelegramClient('token', impl)

  const file = await client.downloadFile('file-id')

  // This is the exact bug that broke the first live receipt photo: Gemini
  // rejects a JPEG labeled as generic binary with "Unsupported MIME type".
  assert.equal(file.mimeType, 'image/jpeg')
})

test('downloadFile trusts a real content-type header when Telegram sends one', async () => {
  const { impl } = fakeFetch('image/png')
  const client = new TelegramClient('token', impl)

  const file = await client.downloadFile('file-id')

  assert.equal(file.mimeType, 'image/png')
})

test('downloadFile falls back to the extension guess when there is no content-type at all', async () => {
  const { impl } = fakeFetch(null)
  const client = new TelegramClient('token', impl)

  const file = await client.downloadFile('file-id')

  assert.equal(file.mimeType, 'image/jpeg')
})
