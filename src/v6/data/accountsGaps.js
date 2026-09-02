import { gapSlotFactory } from './slots.js'

/**
 * Named contract gaps for Wealth → Accounts (SHR-180).
 *
 * Each entry is a position the frozen Command Center prototype shows and no
 * approved contract can truthfully fill. The screen renders the `reason` where
 * the prototype put the value, so the composition survives without the number
 * being invented. None of these is a TODO: the gap text is the product
 * surface, and the `contract` field names who owns closing it.
 */
export const ACCOUNTS_GAPS = Object.freeze({
  ownership: Object.freeze({
    id: 'account-ownership',
    contract: 'SHR-154 / SHR-156 — stable account ownership reference and economic-party semantics',
    reason: 'Account ownership is not available yet.',
    detail: 'The prototype’s Owner column is an economic fact, and no approved contract publishes one for these accounts. SHR-154 installs the stable reference (ownership_kind, owner_party_id) and states that consumer cutovers belong to a later issue; SHR-156 owns the economic-party mapping and household-scope semantics. The legacy accounts.owner text is presentation evidence, so it is discarded before this screen’s model and is never shown as ownership.',
  }),
  ownerGrouping: Object.freeze({
    id: 'account-owner-grouping',
    contract: 'SHR-154 / SHR-156 — stable account ownership reference and economic-party semantics',
    reason: 'Grouping by owner is not available yet.',
    detail: 'Grouping accounts by person requires the same stable ownership truth the Owner column needs. Grouping by the legacy owner label would publish a household-ownership claim the database has never recorded, so the control stays visible and disabled rather than silently grouping by text.',
  }),
  scope: Object.freeze({
    id: 'account-scope',
    contract: 'SHR-156 / SHR-173 — economic-party mapping and canonical wealth scope adapter',
    reason: 'Personal and shared account scopes are not available yet.',
    detail: 'This screen is whole-household truth and every account is counted exactly once. A Me/Partner scope needs published party scope semantics. A shared account is never duplicated into two people and never divided 50/50, so no scope selector is offered until those semantics exist.',
  }),
  groupTotals: Object.freeze({
    id: 'account-group-totals',
    contract: 'SHR-173 — canonical wealth scope, quality and freshness adapter',
    reason: 'Per-group totals are not available yet.',
    detail: 'Adding the AED column inside a group would create a wealth aggregate no contract publishes, computed over rows whose quality differs. Household assets, liabilities and net worth come from canonical_balance_sheet instead, where the aggregation and its quality rule are contractual.',
  }),
  provenance: Object.freeze({
    id: 'account-valuation-provenance',
    contract: 'SHR-172 — account valuation provenance reconciliation and safe lifecycle',
    reason: 'Full valuation provenance is not available yet.',
    detail: 'The screen reports only the valuation method, valuation timestamp and FX evidence each canonical account row already publishes. No provider, feed, source system or entry author is published, and none is inferred from transaction history, account name, account type or the date a row last changed.',
  }),
  freshness: Object.freeze({
    id: 'account-freshness-judgement',
    contract: 'SHR-172 / SHR-173 — valuation lifecycle and canonical freshness semantics',
    reason: 'A fresh, stale or delayed judgement is not available yet.',
    detail: 'Exact contract timestamps and the canonical freshness category are shown as published. No browser-side threshold turns a timestamp into "valued today", "up to date" or "needs attention", and the prototype’s "all valued today" summary is exactly the claim that cannot be made without a published policy.',
  }),
  history: Object.freeze({
    id: 'account-balance-history',
    contract: 'SHR-172 / SHR-173 — account valuation history and canonical wealth history composition',
    reason: 'Balance and valuation history for a single account is not available yet.',
    detail: 'No contract publishes a per-account time series. It is not reconstructed from the ledger: contributions minus withdrawals is not a current value, and a run of transactions is not a valuation record.',
  }),
  performance: Object.freeze({
    id: 'account-performance',
    contract: 'SHR-174 / SHR-176 — Investments composition and historical portfolio performance',
    reason: 'Performance and return figures are not available here.',
    detail: 'Cost basis, unrealised profit and loss, allocation and price movement belong to the Investments screen and its own contracts. Accounts states current canonical valuation only, so an investment account appears here as a position, not as a portfolio.',
  }),
  maintenance: Object.freeze({
    id: 'account-maintenance',
    contract: 'SHR-172 — account valuation provenance reconciliation and safe lifecycle',
    reason: 'Account maintenance is not available yet.',
    detail: 'Adding, editing, revaluing, archiving or deleting an account changes wealth truth permanently and flows into every published balance sheet and snapshot. No approved lifecycle contract states how a valuation write records its provenance, so the prototype’s controls stay visible and inert rather than being wired to a legacy writer.',
  }),
  ownershipMaintenance: Object.freeze({
    id: 'account-ownership-maintenance',
    contract: 'SHR-154 / SHR-156 — stable account ownership reference and economic-party semantics',
    reason: 'Changing account ownership is not available here.',
    detail: 'SHR-154 makes ownership an operator-authority, evidence-gated reconciliation against an approved manifest, executable by no browser role. A screen control that appeared to set an owner would misrepresent both what happens and who may do it.',
  }),
  netWorthContribution: Object.freeze({
    id: 'account-net-worth-contribution',
    contract: 'SHR-173 — canonical wealth scope, quality and freshness adapter',
    reason: 'Per-account contribution to net worth is not available yet.',
    detail: 'The prototype’s "counts toward net worth" switch is a scope rule. No contract publishes a per-account inclusion flag or share, and dividing a published total by a row would be a browser-authored allocation.',
  }),
  access: Object.freeze({
    id: 'account-access',
    contract: 'SHR-180 — Accounts reads the household’s canonical account set',
    reason: 'This account is not available.',
    detail: 'The requested account is not in the canonical account set this household can read. Nothing is shown for it: an identifier in a link is not evidence that a record exists or that it may be disclosed.',
  }),
})

export const accountsGapSlot = gapSlotFactory(ACCOUNTS_GAPS, 'Accounts')
