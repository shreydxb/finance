// Free-text → account resolution. Split out of intake.ts (where it
// originally lived) so query/run.ts (Taskiv #52) can resolve an
// account_spend guess the same way a receipt's paid_with is resolved,
// without intake.ts and query/run.ts importing each other — intake.ts
// itself now imports query/run.ts for the intent router (#50), and a
// circular import between the two is easy to get wrong.

import type { AccountRef } from '../_shared/types.ts'

const WEAK_ACCOUNT_TOKENS = new Set([
  'card', 'credit', 'debit', 'bank', 'account', 'the', 'my', 'visa', 'mastercard', 'pay', 'wallet',
])

/** Maps a free-text payment hint ("VISA ****1234", "ENBD credit card") to an account. */
export function matchAccount(guess: string | null, accounts: AccountRef[]): AccountRef | null {
  return bestAccountMatch(guess, accounts).best
}

/** The accounts a guess tied on, when that tie is why matchAccount abstained. Empty otherwise. */
export function matchAccountTies(guess: string | null, accounts: AccountRef[]): AccountRef[] {
  return bestAccountMatch(guess, accounts).tied
}

function bestAccountMatch(guess: string | null, accounts: AccountRef[]): { best: AccountRef | null; tied: AccountRef[] } {
  if (!guess) return { best: null, tied: [] }
  const wanted = simplify(guess)
  if (wanted === '') return { best: null, tied: [] }

  const wantedTokens = wanted.split(' ').filter(Boolean)
  const wantedDigits = digitRuns(guess)

  const scored = accounts.map((account) => ({
    account,
    score: scoreAccount(account, wanted, wantedTokens, wantedDigits),
  }))
  const top = scored.reduce<{ account: AccountRef; score: number } | null>(
    (best, entry) => (!best || entry.score > best.score ? entry : best),
    null
  )

  if (!top || top.score < 12) return { best: null, tied: [] }
  // A tie means we genuinely can't tell the two apart — better to flag for review
  // and name the candidates than to guess, e.g. two sub-ledgers on one card number.
  const tiedWith = scored.filter((entry) => entry.account !== top.account && entry.score === top.score)
  if (tiedWith.length === 0) return { best: top.account, tied: [] }
  return { best: null, tied: [top.account, ...tiedWith.map((e) => e.account)] }
}

function scoreAccount(account: AccountRef, wanted: string, wantedTokens: string[], wantedDigits: string[]): number {
  const name = simplify(account.name)
  if (name === wanted) return 100
  let score = 0
  // A bare "card" is a substring of half the accounts — it has to carry at least
  // one distinguishing word before a substring hit means anything.
  const hasStrongToken = wantedTokens.some((token) => !WEAK_ACCOUNT_TOKENS.has(token))
  if (hasStrongToken && (name.includes(wanted) || wanted.includes(name))) score += 40
  for (const token of name.split(' ').filter(Boolean)) {
    if (!wantedTokens.includes(token)) continue
    score += WEAK_ACCOUNT_TOKENS.has(token) ? 2 : 12
  }
  // "VISA ****1234" against an account named "ENBD Visa 1234".
  const nameDigits = digitRuns(account.name)
  if (wantedDigits.some((d) => nameDigits.includes(d))) score += 45
  return score
}

function digitRuns(value: string): string[] {
  return (value.match(/\d{3,}/g) ?? []).map((run) => run.slice(-4))
}

function simplify(value: string): string {
  return value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
}
