// Currency conversion + formatting.
//
// `fx_rates` in settings stores "1 unit of X is worth N AED" (AED: 1,
// USD: 3.6725, INR: 0.044), so AED is the pivot: convert into AED by
// multiplying, out of AED by dividing. Every stored `value` keeps its own
// account currency; conversion happens only at display time, so switching
// the display currency never rewrites data.

export const DISPLAY_CURRENCIES = ['AED', 'USD', 'INR']

const SYMBOLS = { AED: 'AED', USD: '$', INR: '₹' }

/**
 * Is there a usable rate for `currency`?
 *
 * AED is the pivot and always 1 by definition. Everything else needs a rate
 * that is a finite positive number — 0, a negative, NaN or a missing key are
 * all "we do not know", not "one to one".
 */
export function isRateAvailable(currency, fxRates) {
  if (currency === 'AED') return true
  const rate = fxRates?.[currency]
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0
}

/** Which of the given currencies cannot currently be converted. */
export function missingCurrencies(currencies, fxRates) {
  return [...new Set(currencies)].filter((c) => c && !isRateAvailable(c, fxRates))
}

/**
 * Convert an amount from one currency to another via the AED pivot.
 *
 * Returns NaN when either side's rate is unknown. It used to substitute 1,
 * which silently treated 100 USD as 100 AED — a wrong number that looked
 * entirely plausible. NaN is deliberately contagious: it propagates through
 * any sum it enters, and `formatMoney` renders it as "—", so an unknown rate
 * can never masquerade as a real total.
 */
export function convert(amount, from, to, fxRates) {
  if (from === to) return amount
  if (!isRateAvailable(from, fxRates) || !isRateAvailable(to, fxRates)) return NaN
  const fromRate = from === 'AED' ? 1 : fxRates[from]
  const toRate = to === 'AED' ? 1 : fxRates[to]
  return (amount * fromRate) / toRate
}

/** Convert an already-in-AED figure into the display currency. */
export function fromAED(aed, to, fxRates) {
  return convert(aed, 'AED', to, fxRates)
}

/**
 * Convert an amount in `currency` into AED.
 *
 * Moved here from settings.js, which imports the Supabase client and so cannot
 * be loaded outside a browser/Vite context — that made every calculation
 * depending on it untestable. Conversion is pure arithmetic and belongs beside
 * the other conversion helpers, as one FX source rather than two.
 *
 * Returns NaN when the rate is unknown — see `convert` for why that is
 * preferable to the old behaviour of returning the figure unchanged, which
 * quietly asserted that 1 USD equals 1 AED.
 */
export function toAED(value, currency, fxRates) {
  if (!isRateAvailable(currency, fxRates)) return NaN
  return currency === 'AED' ? value : value * fxRates[currency]
}

/**
 * Format a bare number as money in `currency`.
 *
 * Sign goes before the symbol ("-$1,200", not "$-1,200") because a leading
 * minus is what scanning a column of figures relies on.
 */
export const UNAVAILABLE = '—'

export function formatMoney(amount, currency, { decimals = 0 } = {}) {
  const symbol = SYMBOLS[currency] ?? currency
  // An unconvertible figure must not render as a number. `Number(x) || 0` used
  // to turn NaN into a confident "AED 0", which is the same silent-wrong-number
  // failure as the 1:1 fallback, one layer further down.
  const numeric = Number(amount)
  if (!Number.isFinite(numeric)) return UNAVAILABLE
  const sign = numeric < 0 ? '-' : ''
  const abs = Math.abs(numeric)
  const body = abs.toLocaleString('en-AE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  // "AED" is a word, not a glyph, so it needs a space; $ and ₹ don't.
  const gap = symbol.length > 1 ? ' ' : ''
  return `${sign}${symbol}${gap}${body}`
}
