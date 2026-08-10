// Voice notes: Groq Whisper turns the .oga into a transcript, and that
// transcript is then fed to the *same* text extraction as a typed message.
// There is deliberately no separate voice extraction path to drift out of sync.

import type { DownloadedFile, Transcriber } from '../_shared/types.ts'

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'

type FetchLike = typeof fetch

export class TranscriptionError extends Error {}

export class GroqWhisper implements Transcriber {
  apiKey: string
  model: string
  fetchImpl: FetchLike

  constructor(apiKey: string, model: string, fetchImpl: FetchLike = fetch) {
    this.apiKey = apiKey
    this.model = model
    this.fetchImpl = fetchImpl
  }

  async transcribe(file: DownloadedFile): Promise<string> {
    const form = new FormData()
    form.append('file', new Blob([file.bytes as BlobPart], { type: file.mimeType }), fileName(file))
    form.append('model', this.model)
    form.append('response_format', 'json')
    // The household speaks English with Arabic/Hindi merchant names mixed in;
    // pinning the language stops Whisper flipping the whole transcript.
    form.append('language', 'en')
    form.append(
      'prompt',
      'A short spoken note about money spent in Dubai. Amounts are usually in dirhams (AED), sometimes rupees.'
    )

    const res = await this.fetchImpl(GROQ_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
    })
    if (!res.ok) {
      throw new TranscriptionError(`Groq Whisper ${res.status}: ${(await res.text()).slice(0, 300)}`)
    }
    const payload = (await res.json()) as { text?: string }
    const text = payload.text?.trim()
    if (!text) throw new TranscriptionError('Groq Whisper returned an empty transcript')
    return text
  }
}

function fileName(file: DownloadedFile): string {
  const fromPath = file.filePath.split('/').pop()
  if (fromPath && fromPath.includes('.')) return fromPath
  if (file.mimeType.includes('mpeg')) return 'voice.mp3'
  if (file.mimeType.includes('mp4')) return 'voice.m4a'
  return 'voice.ogg'
}
