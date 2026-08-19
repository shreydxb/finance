// Portfolio summary & needs-review count (Taskiv #58). Every figure in
// computePortfolioSummary is ported from src/screens/Investments.jsx's row
// and total maths — not reinvented, same rule as query/goals.ts.
//
// The one subtlety worth restating: totalCost is NOT the sum of each
// holding's own cost basis. It's `valueAed - gainAed`. A holding missing
// `avg_cost`/`quantity` contributes 0 to gain but its full value still
// flows into that subtraction — the screen effectively treats an
// unknown-cost holding as break-even rather than excluding it, and this
// mirrors that exactly.

import { formatAmount, formatDate } from '../format.ts'
import type { InvestmentHolding, PortfolioSummaryResult } from './types.ts'

/** Ported from src/lib/money.js's toAED — null (not NaN) when the rate is unknown. */
function convertToAed(value: number, currency: string, fxRates: Record<string, number>): number | null {
  if (currency === 'AED') return value
  const rate = fxRates[currency]
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null
  return value * rate
}

/** Ported from Investments.jsx's `refreshable` filter — currency USD or INR, a real ticker, and a known quantity. */
function isTickerPriced(h: InvestmentHolding): boolean {
  return (h.currency === 'USD' || h.currency === 'INR') && Boolean(h.ticker) && h.quantity !== null
}

export function computePortfolioSummary(allHoldings: InvestmentHolding[], owner: string | undefined, fxRates: Record<string, number>): PortfolioSummaryResult {
  const holdings = owner ? allHoldings.filter((h) => h.owner === owner) : allHoldings

  let valueAed = 0
  let gainAed = 0
  let unconvertedCount = 0
  const byOwner = new Map<string, number>()

  for (const h of holdings) {
    const vAed = convertToAed(h.value, h.currency, fxRates)
    if (vAed === null) {
      unconvertedCount += 1
      continue
    }
    valueAed += vAed
    byOwner.set(h.owner, (byOwner.get(h.owner) ?? 0) + vAed)

    const hasCost = h.quantity !== null && h.avgCost !== null
    if (hasCost) {
      const cost = h.quantity! * h.avgCost!
      const gain = h.value - cost
      const gainAedValue = convertToAed(gain, h.currency, fxRates)
      // Same currency as h.value, whose conversion just succeeded above, so
      // this can only be null in a currency whose rate vanished between the
      // two calls — never happens with one fxRates snapshot, but treated as
      // 0 rather than trusted blindly either way.
      gainAed += gainAedValue ?? 0
    }
    // No cost basis: contributes 0 to gain, and its full value already
    // landed in valueAed above — see the file header for why that's correct.
  }

  const costAed = valueAed - gainAed
  const gainPct = costAed > 0 ? (gainAed / costAed) * 100 : null

  const tickerPriced = holdings.filter(isTickerPriced)
  const latestPriceUpdate = tickerPriced.reduce<string | null>(
    (latest, h) => (h.priceUpdatedAt && (!latest || h.priceUpdatedAt > latest) ? h.priceUpdatedAt : latest),
    null
  )

  return {
    ...(owner ? { owner } : {}),
    holdingsCount: holdings.length,
    valueAed,
    costAed,
    gainAed,
    gainPct,
    byOwner: owner ? {} : Object.fromEntries(byOwner),
    unconvertedCount,
    tickerPricedCount: tickerPriced.length,
    manualCount: holdings.length - tickerPriced.length,
    latestPriceUpdate,
  }
}

function unconvertedSuffix(count: number): string {
  if (count === 0) return ''
  return ` (${count} holding${count === 1 ? '' : 's'} could not be converted — check the FX rate)`
}

function freshnessLine(result: PortfolioSummaryResult): string | null {
  if (result.tickerPricedCount === 0) {
    return result.manualCount > 0 ? 'All holdings are valued manually — no ticker prices to refresh.' : null
  }
  const parts = [`${result.tickerPricedCount} ticker-priced`]
  if (result.manualCount > 0) parts.push(`${result.manualCount} valued manually`)
  const when = result.latestPriceUpdate ? formatDate(result.latestPriceUpdate.slice(0, 10)) : 'never refreshed'
  return `Prices last refreshed: ${when} (${parts.join('; ')})`
}

export function formatPortfolioSummaryReply(result: PortfolioSummaryResult): string {
  if (result.holdingsCount === 0) {
    return result.owner ? `${result.owner} has no investment holdings.` : "You don't have any investment holdings yet."
  }

  const header = `Portfolio — ${result.owner ?? 'combined'}`
  const sign = result.gainAed >= 0 ? '+' : '-'
  const pctText = result.gainPct !== null ? `  (${sign}${Math.abs(result.gainPct).toFixed(1)}%)` : ''
  const lines = [
    header,
    `Value        ${formatAmount(result.valueAed)} AED`,
    `Cost basis   ${formatAmount(result.costAed)} AED`,
    `Unrealised   ${sign}${formatAmount(Math.abs(result.gainAed))}${pctText}`,
  ]

  const ownerNames = Object.keys(result.byOwner)
  if (ownerNames.length > 0) {
    lines.push('', ownerNames.map((name) => `${name} ${formatAmount(result.byOwner[name])}`).join(' · '))
  }

  const freshness = freshnessLine(result)
  if (freshness) lines.push(freshness)

  if (result.unconvertedCount > 0) {
    lines.push(`Some holdings excluded from these totals${unconvertedSuffix(result.unconvertedCount)}`)
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
}

export function formatNeedsReviewCountReply(count: number): string {
  if (count === 0) return 'Nothing flagged. All clean.'
  return `${count} transaction${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} a look.\nSend /review to go through them.`
}
