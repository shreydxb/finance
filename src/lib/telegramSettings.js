// Telegram intake configuration rules.
//
// These exist because the Settings screen and the Edge Function disagreed
// about what a valid configuration is, and the screen was the optimistic one
// (UI-03). Three specific mismatches:
//
//   - The screen said "until both are filled in, the bot ignores everything".
//     The backend accepts either person alone; one configured id is a working
//     setup, and the copy told the household otherwise.
//   - The screen counted an entry as configured when only the id was filled.
//     The backend requires BOTH a name and an id (`buildHouseholdContext`:
//     `if (person && Number.isInteger(id) && id !== 0)`), so a nameless id was
//     silently ignored while the screen reported it as set up.
//   - The account picker offered every account. The backend only ever loads
//     `cash` and `credit_card` and discards anything else, so choosing a loan
//     or an investment account did nothing at all.
//
// The rules below are the backend's, restated once so both sides can use them.

/** Account types the intake function will actually match a receipt against. */
export const PAYABLE_ACCOUNT_TYPES = ['cash', 'credit_card']

/**
 * Is this person entry one the bot will honour?
 *
 * Mirrors `buildHouseholdContext` exactly: a name and a positive integer id.
 * Either alone is ignored by the function, so neither alone counts here.
 */
export function isEffectivePerson(entry) {
  const id = Number(String(entry?.telegramUserId ?? '').trim())
  return Boolean(entry?.person?.trim()) && Number.isInteger(id) && id > 0
}

/**
 * Accounts a receipt can plausibly have been paid with.
 *
 * Type only — a credit card is a liability and still the most common way a
 * receipt gets paid, so `is_liability` is deliberately not consulted. This
 * matches the backend's `type=in.(cash,credit_card)` filter exactly.
 */
export function payableAccounts(accounts) {
  return (accounts ?? []).filter((a) => PAYABLE_ACCOUNT_TYPES.includes(a.type))
}

/**
 * Validate the form before saving.
 *
 * Returns `{ ok: true }` or `{ ok: false, error }`. The messages name the
 * remedy, not the rule — "send /id to the bot" is more use than "invalid id".
 */
export function validateTelegramSettings({ people, thresholdPercent, defaultAccountId, accounts }) {
  for (const entry of people ?? []) {
    const rawId = String(entry?.telegramUserId ?? '').trim()
    const name = entry?.person?.trim() ?? ''

    if (rawId && !/^\d+$/.test(rawId)) {
      return { ok: false, error: 'A Telegram user id is a plain number — send /id to the bot to get yours.' }
    }
    // The mismatch that made the screen lie: the backend drops a nameless id,
    // so accepting one here would report a person as configured who is not.
    if (rawId && !name) {
      return { ok: false, error: 'Add a name for each Telegram id — the bot ignores an id with no name.' }
    }
    if (name && !rawId) {
      return { ok: false, error: `Add ${name}'s Telegram user id, or clear the name.` }
    }
  }

  const percent = Number(thresholdPercent)
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return { ok: false, error: 'Confidence threshold must be between 0 and 100.' }
  }

  if (defaultAccountId) {
    const account = (accounts ?? []).find((a) => a.id === defaultAccountId)
    if (!account || !PAYABLE_ACCOUNT_TYPES.includes(account.type)) {
      return {
        ok: false,
        error: 'The fallback account must be a cash or credit-card account — the bot cannot pay a receipt from anything else.',
      }
    }
  }

  return { ok: true }
}

/**
 * How the household should be told what the bot will currently do.
 *
 * Replaces "until both are filled in, the bot ignores everything", which was
 * simply untrue with one person configured.
 */
export function describeConfiguration(people) {
  const effective = (people ?? []).filter(isEffectivePerson)

  if (effective.length === 0) {
    return { level: 'none', message: 'The bot ignores every message until at least one name and id are filled in.' }
  }
  if (effective.length === 1) {
    return {
      level: 'partial',
      message: `Only ${effective[0].person.trim()} can log spends. Messages from anyone else are ignored.`,
    }
  }
  return { level: 'complete', message: 'Both people can log spends.' }
}
