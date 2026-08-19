// Net-worth formatting (Taskiv #55). Kept separate from reply.ts for the
// same reason query/budget.ts is: the shaping here is more involved than
// every other query's one-liner, and the task calls for its own test file
// exercising it without a Telegram harness.
//
// The one rule that must never be broken: `nw_daily` is recorded
// forward-only and never backfilled or estimated (PLAN.md). A `compare`
// whose baseline predates the earliest recorded row is not computed at all —
// `change.kind === 'unavailable'` is the honest answer, never an interpolated
// or otherwise fabricated delta.

import { formatAmount, formatDate } from '../format.ts'
import type { NetWorthChange, NetWorthResult } from './types.ts'

function changeHeadline(change: NetWorthChange | undefined, headline: string): string {
  if (!change || change.kind !== 'delta') return headline
  const sign = change.deltaAed >= 0 ? '+' : '-'
  return `${headline}  (${sign}${formatAmount(Math.abs(change.deltaAed))} ${change.periodLabel}, ${sign}${Math.abs(change.deltaPct).toFixed(1)}%)`
}

function unavailableLine(change: NetWorthChange | undefined): string | null {
  if (!change || change.kind !== 'unavailable') return null
  return `I only have history back to ${formatDate(change.earliestDay)}, so I can't show a change for that period yet.`
}

export function formatNetWorthReply(owner: string | undefined, result: NetWorthResult): string {
  if (!result.asOf) {
    return "I don't have a net worth snapshot recorded yet."
  }

  if (owner) {
    const ownerTotal = result.byOwner[owner]
    if (ownerTotal === undefined) {
      return `I don't have any accounts recorded for ${owner} yet.`
    }
    const lines = [changeHeadline(result.change, `${owner}'s net worth: ${formatAmount(ownerTotal)} AED`)]
    const unavailable = unavailableLine(result.change)
    if (unavailable) lines.push(unavailable)
    lines.push(`As of ${formatDate(result.asOf)}.`)
    return lines.join('\n')
  }

  const lines = [changeHeadline(result.change, `Net worth: ${formatAmount(result.totalAed)} AED`)]
  lines.push(`Assets ${formatAmount(result.assetsAed)} · Liabilities ${formatAmount(result.liabilitiesAed)}`)
  const ownerNames = Object.keys(result.byOwner)
  if (ownerNames.length > 0) {
    lines.push(ownerNames.map((name) => `${name} ${formatAmount(result.byOwner[name])}`).join(' · '))
  }
  const unavailable = unavailableLine(result.change)
  if (unavailable) lines.push(unavailable)
  lines.push(`As of ${formatDate(result.asOf)}.`)
  return lines.join('\n')
}
