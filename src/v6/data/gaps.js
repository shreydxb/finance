/**
 * Named contract gaps for the V6 Overview.
 *
 * Each entry is a slot the frozen prototype shows but no approved contract can
 * truthfully fill yet. The Overview renders the `reason` in a deliberate
 * unavailable state instead of a number. Nothing here is a TODO in code: the
 * gap text is the product surface.
 */
export const OVERVIEW_GAPS = Object.freeze({
  runway: Object.freeze({
    id: 'runway',
    contract: 'SHR-153 — Overview canonical read composition and runway contract',
    reason: 'Runway is not available yet.',
    detail: 'No approved contract defines the household runway calculation, and a months-of-cover figure invented in the browser would be a fabricated metric.',
  }),
  netWorthChange: Object.freeze({
    id: 'net-worth-change',
    contract: 'SHR-153 — Overview canonical read composition',
    reason: 'Change over the period is not available yet.',
    detail: 'A net-worth change needs an approved comparison contract that states its anchor date and how snapshot gaps and quality are handled. Subtracting two stored rows in the browser would not be that contract.',
  }),
  twelveMonthChange: Object.freeze({
    id: 'twelve-month-change',
    contract: 'SHR-153 — Overview canonical read composition',
    reason: '12-month change is not available yet.',
    detail: 'The same approved comparison contract is required. No trailing-year net-worth series is exposed as canonical truth.',
  }),
  equityShare: Object.freeze({
    id: 'equity-share',
    contract: 'SHR-156 / SHR-195 — economic-party mapping and stable attribution',
    reason: 'Per-person share is not available.',
    detail: 'Whole-household truth is counted once. A personal share requires stable economic-party facts; the prototype’s half-shared allocation is a quarantined exception and is never implemented.',
  }),
  investmentDayChange: Object.freeze({
    id: 'investment-day-change',
    contract: 'SHR-176 — historical portfolio performance and attribution',
    reason: 'Daily investment change is not available.',
    detail: 'Trustworthy position and cash-flow history does not exist. Prototype investment history and performance are a quarantined exception.',
  }),
  budgetRemaining: Object.freeze({
    id: 'budget-remaining',
    contract: 'SHR-166 — versioned monthly budget plan and projected-close contract',
    reason: 'Budget left is not available yet.',
    detail: 'Canonical budget actuals exist, but no versioned plan contract supplies the period’s planned amounts, so a remaining figure cannot be stated truthfully.',
  }),
  upcoming: Object.freeze({
    id: 'upcoming',
    contract: 'SHR-171 — recurring and expected-income plan contract',
    reason: 'Upcoming obligations are not available yet.',
    detail: 'The legacy recurring schedule is not a canonical contract, so projecting the next 30 days of bills and expected income from it would present a non-canonical calculation as household truth.',
  }),
  attentionRegistry: Object.freeze({
    id: 'attention-registry',
    contract: 'SHR-192 — attention condition, event and producer registry',
    reason: 'The ranked attention feed is not available yet.',
    detail: 'No registry defines which conditions raise attention, who produces them, or how they are resolved. The canonical data-quality counts reported by the read contracts are listed below instead, unranked and unsummarised.',
  }),
  integrationStatus: Object.freeze({
    id: 'integration-status',
    contract: 'SHR-190 — integration observation and truthful status foundation',
    reason: 'Integration and sync status is not available.',
    detail: 'Deployment or configuration alone is not evidence that an integration is healthy, so no sync claim is made here.',
  }),
})

export function gapSlot(gapId) {
  const gap = OVERVIEW_GAPS[gapId]
  if (!gap) throw new Error(`Unknown Overview gap: ${String(gapId)}`)
  return Object.freeze({ status: 'unavailable', gap })
}
