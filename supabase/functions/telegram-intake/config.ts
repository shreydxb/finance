// Env-backed config for telegram-intake.
//
// Nothing here is committed: every value is a Supabase Edge Function secret
// (`supabase secrets set ...`). SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
// injected by the platform.
//
// The model name is a config value on purpose — swapping the extraction model
// must not need a code change. That flexibility already paid for itself once:
// see DEFAULTS.openRouterModel below.

import { resolveServiceKey } from '../_shared/serviceKey.ts'

export interface Config {
  telegramBotToken: string
  /** Telegram echoes this back in X-Telegram-Bot-Api-Secret-Token. */
  telegramWebhookSecret: string | null
  openRouterApiKey: string
  openRouterModel: string
  groqApiKey: string | null
  groqWhisperModel: string
  supabaseUrl: string
  supabaseServiceKey: string
  /** Fallback when settings.ai_confidence_threshold is unset. */
  confidenceThreshold: number
  /** Fallback allowlist when settings.tg_id_1/tg_id_2 are unset. */
  allowedTelegramIds: number[]
  defaultCurrency: string
  demoMode: boolean
}

export const DEFAULTS = {
  // Gemini Flash-Lite rather than the originally-planned GPT-4o-mini: this
  // workload is ~90% photographs, and GPT-4o-mini bills an image at the same
  // dollar cost as full GPT-4o (it inflates image token counts ~33x to keep
  // per-image price constant). Flash-Lite reads a receipt for roughly a
  // fifteenth of the price. See PLAN.md decision 5.
  openRouterModel: 'google/gemini-2.5-flash-lite',
  groqWhisperModel: 'whisper-large-v3',
  /** Deliberately conservative to start: more review pings, fewer silent wrong rows. */
  confidenceThreshold: 0.85,
  defaultCurrency: 'AED',
}

export type Env = Record<string, string | undefined>

function required(env: Env, key: string): string {
  const value = env[key]
  if (!value) throw new Error(`Missing required secret: ${key}`)
  return value
}

export function parseThreshold(raw: string | undefined | null, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 1) return fallback
  return value
}

export function parseIdList(raw: string | undefined): number[] {
  if (!raw) return []
  return raw
    .split(/[,\s]+/)
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id !== 0)
}

export function loadConfig(env: Env): Config {
  return {
    telegramBotToken: required(env, 'TELEGRAM_BOT_TOKEN'),
    // Trimmed on purpose. This value is pasted into a dashboard field by
    // hand, which very easily carries a trailing newline or space; the header
    // Telegram sends never does, so an untrimmed comparison fails forever with
    // nothing to see but a 403. Trimming cannot weaken the check — the
    // comparison is still the full secret, still constant-time.
    telegramWebhookSecret: (env.TELEGRAM_WEBHOOK_SECRET ?? '').trim() || null,
    openRouterApiKey: required(env, 'OPENROUTER_API_KEY'),
    openRouterModel: env.OPENROUTER_MODEL || DEFAULTS.openRouterModel,
    groqApiKey: env.GROQ_API_KEY || null,
    groqWhisperModel: env.GROQ_WHISPER_MODEL || DEFAULTS.groqWhisperModel,
    supabaseUrl: required(env, 'SUPABASE_URL'),
    // See _shared/serviceKey.ts for the full precedence and why: the
    // platform-injected key is now minted per request and started failing
    // outright on 13 Aug 2026 with PGRST303 "JWT issued at future".
    supabaseServiceKey: resolveServiceKey(env),
    confidenceThreshold: parseThreshold(env.AI_CONFIDENCE_THRESHOLD, DEFAULTS.confidenceThreshold),
    allowedTelegramIds: parseIdList(env.TELEGRAM_ALLOWED_IDS),
    defaultCurrency: env.DEFAULT_CURRENCY || DEFAULTS.defaultCurrency,
    demoMode: env.DEMO_MODE === 'true',
  }
}
