// Resolves the Supabase service-role key. Shared by telegram-intake,
// refresh-prices, refresh-fx and backup — all four call this instead of
// reading SUPABASE_SERVICE_ROLE_KEY directly, so the precedence only has to
// be right in one place. See Taskiv #100.
//
// Three possible sources, in order of preference:
//
//   1. SUPABASE_SECRET_KEYS — the JSON dictionary Supabase's newer "API Keys"
//      dashboard (JWT Signing Keys) exposes secret keys under, once a project
//      has migrated off the single legacy service-role key. ITS EXACT SHAPE
//      HAS NOT BEEN VERIFIED AGAINST A LIVE PROJECT — this session has no
//      Supabase dashboard or authenticated MCP access to inspect it, and the
//      Taskiv task this closes says explicitly to inspect it first rather
//      than write this blind. Parsing here is therefore defensive on
//      purpose: anything that isn't a flat JSON object of string values, or
//      that doesn't contain one of a few plausible key names, falls through
//      to the next source instead of throwing or returning something wrong.
//      Confirm the real shape (`supabase secrets list` / dashboard) and, if
//      the candidate key names below don't match it, update
//      SERVICE_ROLE_CANDIDATE_KEYS before treating this source as load-bearing.
//   2. SERVICE_ROLE_KEY — a custom secret this project sets itself, holding a
//      static copy of the legacy key. Can't be named SUPABASE_* (the
//      dashboard forbids that prefix on custom secrets).
//   3. SUPABASE_SERVICE_ROLE_KEY — platform-injected, now deprecated. Started
//      failing outright on 13 Aug 2026 with PGRST303 "JWT issued at future" —
//      the platform mints it per request now, and the freshly-stamped `iat`
//      ran ahead of the server checking it.

export type Env = Record<string, string | undefined>

const SERVICE_ROLE_CANDIDATE_KEYS = ['service_role', 'secret', 'sb_secret', 'default']

function extractFromSecretKeys(raw: string | undefined): string | null {
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const dict = parsed as Record<string, unknown>

  for (const key of SERVICE_ROLE_CANDIDATE_KEYS) {
    const value = dict[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

export function resolveServiceKey(env: Env): string {
  const fromSecretKeys = extractFromSecretKeys(env.SUPABASE_SECRET_KEYS)
  if (fromSecretKeys) return fromSecretKeys

  const override = (env.SERVICE_ROLE_KEY ?? '').trim()
  if (override) return override

  const legacy = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (legacy) return legacy

  throw new Error(
    'No service-role key found in SUPABASE_SECRET_KEYS, SERVICE_ROLE_KEY, or SUPABASE_SERVICE_ROLE_KEY'
  )
}
