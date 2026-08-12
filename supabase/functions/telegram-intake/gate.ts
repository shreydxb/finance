// Request authorization for the telegram-intake webhook.
//
// This is the *only* thing standing between the public Edge Function URL and a
// service-role key with full write access to the household's finances. It used
// to live inline in index.ts, which made it untestable — and it failed open:
// when TELEGRAM_WEBHOOK_SECRET was unset the function logged a warning and
// processed the update anyway. The allowlist behind it reads `message.from.id`
// straight out of the request *body*, so anyone who guessed the URL could name
// themselves an allowlisted user and write real transactions.
//
// It is now fail-closed, and lives here as a pure function so the negative
// cases are covered by `npm test` rather than by hope.

export interface GateConfig {
  telegramWebhookSecret: string | null
  demoMode: boolean
}

/** Just enough of `Headers` to be trivially fakeable in a test. */
export interface HeaderBag {
  get(name: string): string | null
}

export type GateDecision =
  | { ok: true; demo: boolean }
  | { ok: false; status: number; error: string; reason: string }

export const SECRET_HEADER = 'x-telegram-bot-api-secret-token'
export const DEMO_HEADER = 'x-demo-mode'

/**
 * Telegram updates are small — a photo arrives as a `file_id`, not as bytes.
 * A megabyte is already far more than any legitimate update, so this only ever
 * rejects something pathological.
 */
export const MAX_BODY_BYTES = 1_048_576

/**
 * Constant-time string comparison.
 *
 * The secret is compared on every inbound request, so a naive `!==` leaks its
 * length and a prefix oracle to anyone willing to time the endpoint. The cost
 * here is a few microseconds per request.
 */
export function secretsMatch(provided: string | null, expected: string): boolean {
  if (provided === null) return false
  // Compare against a fixed-length view so length itself isn't a fast path.
  const a = new TextEncoder().encode(provided)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return diff === 0
}

/**
 * Decide whether an inbound request may reach the intake pipeline.
 *
 * Ordering matters: every rejection must happen before the body is parsed and
 * before any store/Telegram client is constructed, so a rejected request costs
 * zero database and zero API calls.
 */
export function authorizeWebhook(headers: HeaderBag, config: GateConfig, contentLength?: string | null): GateDecision {
  // Fail closed. An unconfigured secret is a broken deployment, not a reason to
  // trust the caller: without it there is no authentication on this endpoint at
  // all. 503 (not 403) because the fault is ours, and because Telegram treats a
  // 5xx as retryable — a real update survives until the secret is set.
  if (!config.telegramWebhookSecret) {
    return {
      ok: false,
      status: 503,
      error: 'webhook is not configured',
      reason: 'TELEGRAM_WEBHOOK_SECRET is unset — refusing to process updates',
    }
  }

  if (!secretsMatch(headers.get(SECRET_HEADER), config.telegramWebhookSecret)) {
    return { ok: false, status: 403, error: 'forbidden', reason: 'bad or missing secret header' }
  }

  if (contentLength) {
    const size = Number(contentLength)
    if (Number.isFinite(size) && size > MAX_BODY_BYTES) {
      return { ok: false, status: 413, error: 'payload too large', reason: `body ${size} bytes exceeds cap` }
    }
  }

  // Demo mode no longer bypasses authentication — it only swaps the messenger
  // for a recording one, and only for a caller who already proved they hold the
  // webhook secret. `npm run demo:telegram` drives handleUpdate in-process with
  // fakes and never crosses this gate, so nothing legitimate depended on the
  // old bypass.
  const demo = config.demoMode && headers.get(DEMO_HEADER) === '1'
  return { ok: true, demo }
}
