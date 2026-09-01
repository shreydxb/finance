import { gapSlotFactory } from './slots.js'

/**
 * Named contract gaps for the V6 Activity screen.
 *
 * The prototype's Activity page shows a server-backed search, a monetary
 * calendar, editable rows and a delete affordance. Each of those needs a
 * contract that does not exist yet. Rather than approximate one in the
 * browser, Activity renders the affordance in its honest state and names the
 * issue that would supply it.
 *
 * Read-only first: every write capability below is reported as unsupported
 * rather than implemented against a legacy non-canonical path.
 */
export const ACTIVITY_GAPS = Object.freeze({
  search: Object.freeze({
    id: 'activity-search',
    contract: 'SHR-163 — stable Activity read, search, filter and calendar contract',
    reason: 'Search and filters cover the loaded period only.',
    detail: 'No canonical contract supplies a stable search or filter across the whole ledger, so these controls narrow the canonical rows already read for this period. They are not a household-wide search, and a row outside this period is not missing — it was never requested.',
  }),
  calendarTotals: Object.freeze({
    id: 'activity-calendar-totals',
    contract: 'SHR-163 — stable Activity read, search, filter and calendar contract',
    reason: 'Daily monetary totals are not available.',
    detail: 'No canonical contract publishes a per-day total. Adding the rows up in the browser would create a household figure no contract stands behind, so the calendar shows how many canonical entries fall on each day and leaves the money to the period totals.',
  }),
  calendarBills: Object.freeze({
    id: 'activity-calendar-bills',
    contract: 'SHR-171 — recurring and expected-income plan contract',
    reason: 'Scheduled bills and expected income are not marked.',
    detail: 'The prototype marks bill, EMI and salary days. That needs the recurring and expected-income plan contract; the legacy recurring schedule is not canonical.',
  }),
  stableAttribution: Object.freeze({
    id: 'activity-attribution',
    contract: 'SHR-195 — transaction and posted-income stable attribution references',
    reason: 'The owner column is a recorded text label, not household ownership.',
    detail: 'Whatever text was recorded on the entry is shown verbatim and can be filtered on exactly. It is not a stable economic-party reference, so it must not be read as who owns the money, as a share of a shared fact, or as an attribution the household can rely on. Nothing here normalises it into an economic party.',
  }),
  directLookup: Object.freeze({
    id: 'activity-direct-lookup',
    contract: 'SHR-163 — stable Activity read, search, filter and calendar contract',
    reason: 'This entry is not in the period being reviewed.',
    detail: 'Detail resolution is scoped to the month Activity has loaded, because no canonical contract supports reading a single entry directly by id. This entry is not missing and may well exist — it simply was never requested. Choose the month it belongs to and open it from the list.',
  }),
  categoryIdentity: Object.freeze({
    id: 'activity-category-identity',
    contract: 'SHR-198 — Category v2 resolver, canonical classification and writer compatibility',
    reason: 'Category is the classification label carried by the entry.',
    detail: 'No stable category identity or resolver is available, so the label is shown exactly as the canonical ledger reports it and is never inferred from description text.',
  }),
  transferPairing: Object.freeze({
    id: 'activity-transfer-pairing',
    contract: 'SHR-159 — owned-account transfer event lifecycle',
    reason: 'The paired side of this transfer is not resolvable.',
    detail: 'The canonical ledger reports this entry’s own transfer direction. Matching it to its counterpart is the transfer event lifecycle contract’s job; pairing entries in the browser could join two unrelated movements.',
  }),
  refundLinkage: Object.freeze({
    id: 'activity-refund-linkage',
    contract: 'SHR-162 — refund and reimbursement event linkage contract',
    reason: 'Refund and reimbursement links are not available.',
    detail: 'Nothing canonical links a refund to what it reverses, and inferring the link from amounts or dates would assert a relationship the ledger does not record.',
  }),
  provenance: Object.freeze({
    id: 'activity-provenance',
    contract: 'SHR-161 — transaction quality, provenance, review and audit integration',
    reason: 'Provenance and audit history are not available.',
    detail: 'Where an entry came from, who last changed it and what the change was are not exposed by any canonical read yet.',
  }),
  createTransaction: Object.freeze({
    id: 'activity-create',
    contract: 'SHR-126 / SHR-159 / SHR-165 — capture and correction safety on canonical contracts',
    reason: 'Adding a transaction is not available on this screen yet.',
    detail: 'No canonical write contract is wired into the V6 boundary. A parallel client-side write path would bypass the safety, transfer-pairing and audit semantics those contracts own, so the control states its gap instead of acting.',
  }),
  editTransaction: Object.freeze({
    id: 'activity-edit',
    contract: 'SHR-126 / SHR-161 — capture and correction safety, quality and audit integration',
    reason: 'Editing is not available on this screen yet.',
    detail: 'Correcting an entry has to go through the approved correction path so quality, review state and audit history stay consistent. Until that contract is wired in, Activity is a read surface.',
  }),
  deleteTransaction: Object.freeze({
    id: 'activity-delete',
    contract: 'SHR-126 / SHR-159 — capture and correction safety, pair-atomic transfer lifecycle',
    reason: 'Delete and restore are not available on this screen yet.',
    detail: 'Deleting one side of an owned-account transfer without its pair corrupts a single economic event. The pair-atomic lifecycle contract governs this; nothing here may delete around it.',
  }),
  categorySplit: Object.freeze({
    id: 'activity-split',
    contract: 'SHR-165 — safe fresh category-split creation',
    reason: 'Splitting an entry across categories is not available yet.',
    detail: 'Split creation has its own safety contract. The canonical ledger does report an existing split group, which is shown as a fact.',
  }),
  reviewAction: Object.freeze({
    id: 'activity-review-action',
    contract: 'SHR-161 — transaction quality, provenance, review and audit integration',
    reason: 'Marking an entry reviewed is not available yet.',
    detail: 'Review state is shown exactly as the canonical contract reports it. Changing it is a write with quality and audit consequences and belongs to that contract.',
  }),
  descriptionIdentity: Object.freeze({
    id: 'activity-description-identity',
    contract: 'SHR-169 — description/payee identity decision',
    reason: 'Merchant identity is not available.',
    detail: 'The canonical ledger carries the free-text note recorded with the entry. There is no resolved merchant or payee identity behind it, so the note is shown as written and never normalised into a merchant.',
  }),
})

export const activityGapSlot = gapSlotFactory(ACTIVITY_GAPS, 'Activity')
