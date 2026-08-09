// Currency conversion + formatting.
//
// `fx_rates` in settings stores "1 unit of X is worth N AED" (AED: 1,
// USD: 3.6725, INR: 0.044), so AED is the pivot: convert into AED by
// multiplying, out of AED by dividing. Every stored `value` keeps its own
// account currency; conversion happens only at display time, so switching
// the display currency never rewrites data.

export const DISPLAY_CURRENCIES = ['AED', 'USD', 'INR']

const SYMBOLS = { AED: 'AED', USD: '$', INR: '₹' }

/** Convert an amount from one currency to another via the AED pivot. */
export function convert(amount, from, to, fxRates) {
  if (from === to) return amount
  const fromRate = fxRates?.[from] ?? 1
  const toRate = fxRates?.[to] ?? 1
  return (amount * fromRate) / toRate
}

/** Convert an already-in-AED figure into the display currency. */
export function fromAED(aed, to, fxRates) {
  return convert(aed, 'AED', to, fxRates)
}

/**
 * Format a bare number as money in `currency`.
 *
 * Sign goes before the symbol ("-$1,200", not "$-1,200") because a leading
 * minus is what scanning a column of figures relies on.
 */
export function formatMoney(amount, currency, { decimals = 0 } = {}) {
  const symbol = SYMBOLS[currency] ?? currency
  const sign = amount < 0 ? '-' : ''
  const abs = Math.abs(Number(amount) || 0)
  const body = abs.toLocaleString('en-AE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  // "AED" is a word, not a glyph, so it needs a space; $ and ₹ don't.
  const gap = symbol.length > 1 ? ' ' : ''
  return `${sign}${symbol}${gap}${body}`
}
