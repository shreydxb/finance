import { gapSlotFactory } from './slots.js'

export const NET_WORTH_GAPS = Object.freeze({
  change: Object.freeze({
    id: 'net-worth-change',
    contract: 'SHR-173 / SHR-153 — canonical wealth comparison semantics',
    reason: 'Net-worth change is not available yet.',
    detail: 'No approved contract publishes the required comparison, anchor date, or gap and quality policy. Two snapshot values are not subtracted in the browser.',
  }),
  composition: Object.freeze({
    id: 'wealth-composition',
    contract: 'SHR-173 — canonical wealth scope, quality and freshness adapter',
    reason: 'Wealth composition is not available yet.',
    detail: 'The prototype’s percentages require a canonical classification and scope-aware composition contract. Account rows are not regrouped into a new browser balance-sheet engine.',
  }),
  scope: Object.freeze({
    id: 'wealth-scope',
    contract: 'SHR-156 / SHR-173 — economic-party and wealth scope semantics',
    reason: 'Personal and shared wealth positions are not available yet.',
    detail: 'Whole-household truth is counted once. Legacy owner text is never treated as economic ownership, and shared wealth is neither duplicated nor silently divided.',
  }),
  saved: Object.freeze({
    id: 'historical-saved',
    contract: 'SHR-173 / SHR-153 — canonical wealth history composition',
    reason: 'Saved during the period is not available yet.',
    detail: 'Authoritative snapshots publish balance-sheet positions, not a saved-flow attribution. No transaction or snapshot difference is relabelled as saved.',
  }),
  provenance: Object.freeze({
    id: 'valuation-provenance',
    contract: 'SHR-172 / SHR-173 — valuation provenance and freshness semantics',
    reason: 'Full valuation provenance is not available yet.',
    detail: 'The screen reports only the canonical valuation method and timestamps already published per account. It does not infer a provider, ledger basis, or freshness judgement.',
  }),
  freshness: Object.freeze({
    id: 'freshness-interpretation',
    contract: 'SHR-173 — canonical wealth scope, quality and freshness adapter',
    reason: 'A combined freshness interpretation is not available yet.',
    detail: 'Exact contract timestamps and quality statuses are shown without a browser-authored stale threshold or combined score.',
  }),
})

export const netWorthGapSlot = gapSlotFactory(NET_WORTH_GAPS, 'Net Worth')
