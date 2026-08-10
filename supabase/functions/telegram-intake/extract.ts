// Extraction: model call + the hardening that turns "whatever the model said"
// into a validated Extraction. Every path (text, voice transcript, photo,
// correction) funnels through parseExtraction, so the guarantees below hold
// regardless of input type:
//
//   - the result is always valid JSON-shaped data, never free text
//   - confidence is always a number in 0–1
//   - an unreadable amount or an unmatched category force the confidence down,
//     so an over-confident model can't slip a bad row past the review gate
//
// The model itself is behind ModelClient, so tests drive these rules without a
// network call.

import { buildCorrectionUserPrompt, buildImageUserPrompt, buildSystemPrompt, buildTextUserPrompt } from './prompt.ts'
import type { PromptContext } from './prompt.ts'
import type { ChatMessage, Extraction, ModelClient } from '../_shared/types.ts'

export class ExtractionError extends Error {}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

type FetchLike = typeof fetch

export class OpenRouterClient implements ModelClient {
  apiKey: string
  model: string
  fetchImpl: FetchLike

  constructor(apiKey: string, model: string, fetchImpl: FetchLike = fetch) {
    this.apiKey = apiKey
    this.model = model
    this.fetchImpl = fetchImpl
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const res = await this.fetchImpl(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        // ASCII only. HTTP header values are ByteString (Latin-1), so a stray
        // em dash here makes Deno throw while *building* the request — the call
        // never reaches OpenRouter, and the failure looks nothing like a header
        // problem from the outside.
        'x-title': 'Our Money v4 - Telegram intake',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages,
      }),
    })
    if (!res.ok) {
      throw new ExtractionError(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`)
    }
    const payload = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const content = payload.choices?.[0]?.message?.content
    if (!content) throw new ExtractionError('OpenRouter returned no content')
    return content
  }
}

export function extractFromText(
  text: string,
  ctx: PromptContext,
  model: ModelClient,
  opts: { spoken?: boolean } = {}
): Promise<Extraction> {
  return runExtraction(
    [
      { role: 'system', content: buildSystemPrompt(ctx) },
      { role: 'user', content: buildTextUserPrompt(text, opts.spoken) },
    ],
    ctx,
    model
  )
}

export function extractFromImage(
  image: { dataUrl: string; caption?: string | null },
  ctx: PromptContext,
  model: ModelClient
): Promise<Extraction> {
  return runExtraction(
    [
      { role: 'system', content: buildSystemPrompt(ctx) },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildImageUserPrompt(image.caption ?? null) },
          { type: 'image_url', image_url: { url: image.dataUrl } },
        ],
      },
    ],
    ctx,
    model
  )
}

export function extractCorrection(
  current: Extraction,
  correction: string,
  ctx: PromptContext,
  model: ModelClient
): Promise<Extraction> {
  return runExtraction(
    [
      { role: 'system', content: buildSystemPrompt(ctx) },
      { role: 'user', content: buildCorrectionUserPrompt(current, correction) },
    ],
    ctx,
    model
  )
}

async function runExtraction(
  messages: ChatMessage[],
  ctx: PromptContext,
  model: ModelClient
): Promise<Extraction> {
  return parseExtraction(await model.chat(messages), ctx)
}

// ── hardening ──────────────────────────────────────────────────────────────

export function parseExtraction(raw: string, ctx: PromptContext): Extraction {
  const parsed = parseJsonObject(raw)

  const amount = normalizeAmount(parsed.amount)
  const category = matchCategory(parsed.category, ctx.categories)
  let confidence = clampConfidence(parsed.confidence)

  // The model's own score is advisory. A missing total or an unmatched category
  // is objectively unreviewable data, so cap the score regardless of what it claimed.
  if (amount === null) confidence = Math.min(confidence, 0.2)
  if (category === null) confidence = Math.min(confidence, 0.6)

  return {
    date: normalizeDate(parsed.date, ctx.today),
    amount,
    currency: normalizeCurrency(parsed.currency, ctx.defaultCurrency),
    category,
    paid_by: cleanString(parsed.paid_by, 60),
    paid_with: cleanString(parsed.paid_with, 60),
    note: cleanString(parsed.note, 200),
    confidence,
  }
}

/** Models wrap JSON in fences or add a sentence of preamble often enough to handle it here. */
export function parseJsonObject(raw: string): Record<string, unknown> {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ExtractionError('Model returned an empty response')
  }
  const withoutFences = raw.replace(/```(?:json)?/gi, '').trim()
  const start = withoutFences.indexOf('{')
  const end = withoutFences.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new ExtractionError(`Model returned no JSON object: ${raw.slice(0, 200)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(withoutFences.slice(start, end + 1))
  } catch {
    throw new ExtractionError(`Model returned malformed JSON: ${raw.slice(0, 200)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ExtractionError('Model returned JSON that is not an object')
  }
  return parsed as Record<string, unknown>
}

const CURRENCY_ALIASES: Record<string, string> = {
  'AED': 'AED', 'DHS': 'AED', 'DH': 'AED', 'DIRHAM': 'AED', 'DIRHAMS': 'AED', 'د.إ': 'AED',
  'INR': 'INR', 'RS': 'INR', 'RS.': 'INR', '₹': 'INR', 'RUPEE': 'INR', 'RUPEES': 'INR',
  'USD': 'USD', '$': 'USD', 'US$': 'USD', 'DOLLAR': 'USD', 'DOLLARS': 'USD',
}

export function normalizeCurrency(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const key = raw.trim().toUpperCase()
  if (key === '') return fallback
  return CURRENCY_ALIASES[key] ?? (/^[A-Z]{3}$/.test(key) ? key : fallback)
}

export function normalizeAmount(raw: unknown): number | null {
  let value: number
  if (typeof raw === 'number') {
    value = raw
  } else if (typeof raw === 'string') {
    // Strip currency symbols/letters and thousands separators: "AED 1,234.50" → 1234.50
    const cleaned = raw.replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '')
    if (cleaned === '') return null
    value = Number(cleaned.replace(/,/g, '.'))
  } else {
    return null
  }
  if (!Number.isFinite(value)) return null
  // Spend is stored as a positive number; a model returning -84 means the same spend.
  value = Math.abs(value)
  if (value === 0) return null
  return Math.round(value * 100) / 100
}

export function normalizeDate(raw: unknown, today: string): string {
  const fallback = today
  if (typeof raw !== 'string') return fallback
  const value = raw.trim().toLowerCase()
  if (value === '' || value === 'today') return fallback
  if (value === 'yesterday') return shiftDays(today, -1)

  let iso: string | null = null
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    iso = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  } else {
    // UAE receipts print day-first; treat dd/mm/yyyy and dd-mm-yy alike.
    const dmy = value.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
    if (dmy) {
      const day = dmy[1].padStart(2, '0')
      const month = dmy[2].padStart(2, '0')
      const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]
      iso = `${year}-${month}-${day}`
    }
  }
  if (!iso || !isValidIsoDate(iso)) return fallback
  // A receipt is never dated in the future; a mis-read year shouldn't land there either.
  return iso > today ? fallback : iso
}

function isValidIsoDate(iso: string): boolean {
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day || month > 12 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function shiftDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function clampConfidence(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value)) return 0
  // Some models answer 85 when asked for 0–1. 1.2 is an overshoot, not a
  // percentage, so only rescale once the value is unambiguously on that scale.
  const scaled = value > 1.5 && value <= 100 ? value / 100 : value
  return Math.min(1, Math.max(0, Math.round(scaled * 100) / 100))
}

export function cleanString(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.replace(/\s+/g, ' ').trim()
  if (value === '' || value.toLowerCase() === 'null' || value.toLowerCase() === 'unknown') return null
  return value.length > maxLength ? value.slice(0, maxLength).trimEnd() : value
}

/** Category must be one the household actually has — never a freeform label. */
export function matchCategory(raw: unknown, categories: string[]): string | null {
  if (typeof raw !== 'string') return null
  const wanted = simplify(raw)
  if (wanted === '') return null

  const exact = categories.find((c) => simplify(c) === wanted)
  if (exact) return exact

  // "Dining" → "Dining Out", "Fuel" → "Transport & Fuel".
  const contained = categories.filter((c) => {
    const simple = simplify(c)
    return simple.includes(wanted) || wanted.includes(simple)
  })
  return contained.length === 1 ? contained[0] : null
}

function simplify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
