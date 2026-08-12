// Calendar dates for a household that lives in Dubai.
//
// `new Date().toISOString().slice(0, 10)` is UTC, and Dubai is UTC+4 with no
// DST. Between 00:00 and 03:59 local time that yields *yesterday* — so a spend
// logged just after midnight is filed on the wrong day, and a net-worth
// snapshot taken then overwrites the previous day's row.
//
// The Edge Functions already solved this in `_shared/dates.ts` (`todayInTz`).
// This is the same fix for the browser, which never got it.

export const HOUSEHOLD_TZ = 'Asia/Dubai'

/**
 * Today's date in the household's timezone, as `YYYY-MM-DD`.
 *
 * `en-CA` is used because it formats as ISO-style `YYYY-MM-DD`, which avoids
 * hand-assembling the parts.
 */
export function todayLocal(now = new Date(), timeZone = HOUSEHOLD_TZ) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
