// Shared error-to-chat-text formatting. Split out of intake.ts so
// query/refusal.ts (Taskiv #59) can reuse the exact same "show the real
// upstream error, don't just say 'something went wrong'" behaviour the
// receipt pipeline's error replies already use — this is a private household
// group, so a shown error is more useful than a hidden one. Kept separate
// from intake.ts so intake.ts (which imports query/refusal.ts for the
// question path) and query/refusal.ts never import each other.

export function errorHint(error: unknown): string | null {
  const raw = error instanceof Error ? error.message : String(error)
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  return cleaned.length > 200 ? `${cleaned.slice(0, 200)}…` : cleaned
}
