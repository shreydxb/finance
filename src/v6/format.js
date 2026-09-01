// Presentation-only formatting for the V6 surface.
//
// Nothing here converts currency or derives a figure: canonical contracts
// return AED, and the V6 Overview renders AED. `src/lib/money.js`'s display
// conversion is deliberately not used, because re-deriving a canonical AED
// total into another currency in the browser is exactly the kind of financial
// arithmetic the V6 boundary keeps out of React.

const AED = new Intl.NumberFormat('en-AE', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const AED_PRECISE = new Intl.NumberFormat('en-AE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Whole-AED figure for headline/table use. Never invents a value for null. */
export function formatAed(value, { precise = false, signed = false } = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const formatter = precise ? AED_PRECISE : AED
  const magnitude = formatter.format(Math.abs(value))
  if (value < 0) return `−${magnitude}`
  return signed && value > 0 ? `+${magnitude}` : magnitude
}

export function formatPercent(value, { signed = false } = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const rounded = Math.round(value * 10) / 10
  const text = `${Math.abs(rounded).toFixed(1)}%`
  if (rounded < 0) return `−${text}`
  return signed && rounded > 0 ? `+${text}` : text
}

export function pluralise(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function utcDate(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`)
}

/** "28 Aug" — date-only strings are formatted in UTC so the day never shifts. */
export function formatDayMonth(isoDate) {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' })
    .format(utcDate(isoDate))
}

/** "28 Aug 2026" */
export function formatDayMonthYear(isoDate) {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
    .format(utcDate(isoDate))
}

/** "Friday, 28 August 2026" — the prototype's Overview context line. */
export function formatContextDate(isoDate) {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(utcDate(isoDate))
}

/** "Aug 2026" for a chart column. */
export function formatMonthShort(isoDate) {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short' }).format(utcDate(isoDate))
}

/**
 * A wall-clock timestamp rendered on the household's own clock. Freshness
 * claims are only meaningful next to the household's date boundary.
 */
export function formatTimestamp(value, timeZone = 'Asia/Dubai') {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}
