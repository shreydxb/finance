// Timezone-correct "today" for the household.
//
// Dubai is UTC+4 with no DST. `new Date().toISOString().slice(0,10)` resolves
// to UTC, so anything between 00:00 and 04:00 Gulf time lands on the previous
// calendar day — which then poisons the extraction prompt's "today" and every
// "yesterday"/"this week"/"due tomorrow" feature built on top of it.
//
// Uses Intl.DateTimeFormat rather than a hardcoded +4h offset: an offset is
// exactly the kind of thing that silently breaks if the household ever moves
// or a DST rule changes upstream. Both Deno and Node support IANA zones here,
// so this needs no dependency and no shim to run under `node --test`.

export const HOUSEHOLD_TZ = 'Asia/Dubai'

/** Calendar date in the household's timezone, as YYYY-MM-DD. */
export function todayInTz(now: Date, timeZone: string = HOUSEHOLD_TZ): string {
  // en-CA formats as YYYY-MM-DD directly, avoiding a manual field reassembly.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
