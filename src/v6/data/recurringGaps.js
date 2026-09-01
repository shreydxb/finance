import { gapSlotFactory } from './slots.js'

/**
 * Named contract gaps for the V6 Recurring screen.
 *
 * Recurring is the screen where the plan-versus-fact boundary is easiest to
 * cross by accident and most expensive to cross. Every position the frozen
 * prototype puts on this page — a bill, its cadence, its next due date, its
 * autopay setting, whether it has been paid, the expected income beside it,
 * the fixed-versus-variable split underneath — is a statement about a *plan*
 * the household declared. None of it is a statement about a posted fact.
 *
 * A posted transaction that looks like last month's electricity bill is not
 * evidence that an electricity bill is a recurring commitment: it is evidence
 * that money moved once. Turning the second into the first — by clustering
 * merchants, by reading a monthly rhythm out of dates, by calling a similar
 * amount on a similar day "paid" — would manufacture the entire contract
 * SHR-171 exists to define, in the browser, with no versioning, no effective
 * or archive semantics, and no way for the household to correct it.
 *
 * So every plan position on this screen fails closed and names SHR-171. This
 * registry is the machine-readable form of that refusal, and the screen
 * renders it verbatim.
 */
export const RECURRING_GAPS = Object.freeze({
  billPlan: Object.freeze({
    id: 'recurring-bill-plan',
    contract: 'SHR-171 — recurring and expected-income plan contract with explicit posted matching',
    reason: 'Recurring bills and EMIs are not available yet.',
    detail: 'A bill on this screen is a commitment the household declared: a name, an amount, a cadence, an account and a period over which it is effective. No approved contract publishes that set. Reconstructing it from posted transactions — grouping a merchant that recurs, reading a monthly rhythm out of dates — would invent the plan rather than report it, so the list stays empty and says so.',
  }),
  incomePlan: Object.freeze({
    id: 'recurring-income-plan',
    contract: 'SHR-171 — recurring and expected-income plan contract with explicit posted matching',
    reason: 'Expected income is not available yet.',
    detail: 'Expected income is a plan — which source is expected, how much, on which day of which months — not a summary of income that already landed. No approved contract publishes it, and deriving it from posted income would state an expectation the household never set.',
  }),
  committedTotal: Object.freeze({
    id: 'recurring-committed-total',
    contract: 'SHR-171 — recurring and expected-income plan contract with explicit posted matching',
    reason: 'The committed total is not available yet.',
    detail: 'The prototype’s "Committed AED … · 3 without autopay" headline totals the recurring commitments and counts the ones without autopay. Both halves need the commitment set itself, so neither can be stated.',
  }),
  expectedIncomeTotal: Object.freeze({
    id: 'recurring-expected-income-total',
    contract: 'SHR-171 — recurring and expected-income plan contract with explicit posted matching',
    reason: 'The expected-income total is not available yet.',
    detail: 'Totalling expected income requires the expected-income plans to exist first. No posted total stands in for it: money that arrived is not money that was expected.',
  }),
  cadence: Object.freeze({
    id: 'recurring-cadence',
    contract: 'SHR-171 — recurring and expected-income plan contract with explicit posted matching',
    reason: 'Recurrence cadence is not available.',
    detail: 'Monthly, quarterly, annual-billed-monthly and "the 15th" are properties the household declares on a commitment. Inferring a cadence from the spacing of posted dates would be a guess presented as a schedule, and a wrong guess would then drive a due date, a reminder and a missed-bill claim.',
  }),
  nextDue: Object.freeze({
    id: 'recurring-next-due',
    contract: 'SHR-171 — recurring and expected-income plan contract with explicit posted matching',
    reason: 'Next due dates are not available.',
    detail: 'A next due date is the cadence projected forward from the commitment’s effective window. Without the commitment and its cadence there is nothing to project, and projecting from the last posted transaction of a similar merchant would be a forecast dressed as an obligation.',
  }),
  paidStatus: Object.freeze({
    id: 'recurring-paid-status',
    contract: 'SHR-171 — recurring and expected-income plan contract with explicit posted matching',
    reason: 'Paid and unpaid status is not available.',
    detail: 'Paid means an explicit link between a commitment and a posted fact. It is never inferred from a similar transaction on a similar day for a similar amount. Nothing on this screen is marked paid, unpaid, due, overdue or missed.',
  }),
  autopay: Object.freeze({
    id: 'recurring-autopay',
    contract: 'SHR-171 — recurring and expected-income plan contract with explicit posted matching',
    reason: 'Autopay and manual-payment status is not available.',
    detail: 'Whether a commitment pays itself is a setting on the commitment, not something visible in a posted transaction. The prototype’s "2 manual" count and its per-row Autopay/Manual column both need it.',
  }),
  effectiveWindow: Object.freeze({
    id: 'recurring-effective-window',
    contract: 'SHR-171 — recurring and expected-income plan contract with explicit posted matching',
    reason: 'Effective and archived commitments are not distinguished.',
    detail: 'A commitment that ended last year must not appear as an obligation this month, and one that starts next month must not be counted as missed today. Those are the effective/archive semantics SHR-171 defines; without them there is no truthful way to decide what belongs in a period at all.',
  }),
  fixedVariable: Object.freeze({
    id: 'recurring-fixed-variable',
    contract: 'SHR-171 — recurring and expected-income plan contract with explicit posted matching',
    reason: 'The fixed-versus-variable split is not available yet.',
    detail: 'The prototype splits the period’s spend into the part committed before the month started and the part that was not, and states a percentage. The period’s consumption spend is canonical and is shown beside this; the committed half is the recurring plan, so the split, its bar and its "% of spend is committed" sentence cannot be stated.',
  }),
  variance: Object.freeze({
    id: 'recurring-variance',
    contract: 'SHR-171 — recurring and expected-income plan contract with explicit posted matching',
    reason: 'Expected-versus-posted variance is not available.',
    detail: 'A variance compares a plan with the fact linked to it. Neither the plan nor the link exists, so no row is described as higher, lower, early, late or short this period.',
  }),
  matchSuggestions: Object.freeze({
    id: 'recurring-match-suggestions',
    contract: 'SHR-171 — recurring and expected-income plan contract with explicit posted matching',
    reason: 'Suggested matches between commitments and posted entries are not available.',
    detail: 'SHR-171 defines matching as a deterministic suggestion the household then confirms explicitly. Both halves are missing here, and the half that is easy to write in a browser — fuzzy merchant similarity, an amount-and-date heuristic — is exactly the half that must never be presented as authoritative. No suggestion is generated, ranked or shown.',
  }),
  markPaid: Object.freeze({
    id: 'recurring-mark-paid',
    contract: 'SHR-171 — recurring and expected-income plan contract with explicit posted matching',
    reason: 'Marking a bill paid is not available on this screen yet.',
    detail: 'Mark-paid either records an explicit link to an existing posted fact or creates a fact through an approved writer. No such writer is approved, and the legacy transaction writer is deliberately not wired in: a fact created outside the plan contract could not later be recognised as the payment of a commitment.',
  }),
  matchTransaction: Object.freeze({
    id: 'recurring-match-transaction',
    contract: 'SHR-171 — recurring and expected-income plan contract with explicit posted matching',
    reason: 'Linking a posted entry to a commitment is not available on this screen yet.',
    detail: 'Explicit linking is a write against the plan contract. Until it exists no posted entry is linked, unlinked or silently converted into the payment of a plan.',
  }),
  addCommitment: Object.freeze({
    id: 'recurring-add-commitment',
    contract: 'SHR-171 — recurring and expected-income plan contract with explicit posted matching',
    reason: 'Adding a bill or an expected income is not available on this screen yet.',
    detail: 'The prototype’s "+ Bill" and "+ Income" both create a plan row. The legacy `src/lib/recurring.js` writer has no period versioning, no effective or archive semantics and no matching model, so wiring it in would create commitments the plan contract could not later version, interpret or supersede.',
  }),
  editCommitment: Object.freeze({
    id: 'recurring-edit-commitment',
    contract: 'SHR-171 — recurring and expected-income plan contract with explicit posted matching',
    reason: 'Editing a commitment is not available on this screen yet.',
    detail: 'The prototype opens an editor from every bill and income row. An edit to a plan is a new version of that plan from a date onward — the semantics SHR-171 owns — so rows are read-only rather than editable through a legacy writer.',
  }),
  archiveCommitment: Object.freeze({
    id: 'recurring-archive-commitment',
    contract: 'SHR-171 — recurring and expected-income plan contract with explicit posted matching',
    reason: 'Archiving or ending a commitment is not available on this screen yet.',
    detail: 'Ending a commitment must preserve the periods it was effective for rather than erase them. Deleting a legacy recurring row would do the opposite, so nothing here archives, ends or deletes a commitment.',
  }),
  calendarExpected: Object.freeze({
    id: 'recurring-calendar-expected',
    contract: 'SHR-171 — recurring and expected-income plan contract with explicit posted matching',
    reason: 'Expected recurring events are not available on the calendar.',
    detail: 'Every marker the prototype places on a day of this calendar is an expected event — a bill landing, income arriving — projected from a commitment’s cadence. No commitment exists to project, so the grid shows the household’s real calendar month and places nothing on it. Posted entries are deliberately not plotted here either: a posted entry sitting in a day cell of a *recurring* calendar would read as the expected event having landed, which is the plan-to-posted conversion this screen must not perform. Posted daily activity is on Money → Activity, where it means what it says.',
  }),
  postedIncomePeriod: Object.freeze({
    id: 'recurring-posted-income-period',
    contract: 'SHR-167 — canonical Budget consumer migration and posted-income truth',
    reason: 'Posted income for this period is not stated on this screen.',
    detail: 'Which income counts towards a budget period, and how it breaks down by source, is what the posted-income truth contract settles. This screen’s only income position is the prototype’s *expected* income, so borrowing a period income total defined for a different question — and placing it where a household reads "expected" — would answer the wrong question in the right-looking place.',
  }),
  attribution: Object.freeze({
    id: 'recurring-attribution',
    contract: 'SHR-195 / SHR-156 — stable attribution references and economic-party mapping',
    reason: 'Who pays or earns a commitment is not available.',
    detail: 'The prototype gives every bill a "Paid by" and every income an "Earned by" owner, and splits them between the household’s people. Legacy owner text on a posted transaction is a recorded label, not a stable economic party: it can be edited, it can be blank, and it was never a durable identity. Presenting it as attribution would make a per-person claim the data cannot support, so no person or shared allocation is shown.',
  }),
  accountLink: Object.freeze({
    id: 'recurring-account-link',
    contract: 'SHR-171 — recurring and expected-income plan contract with explicit posted matching',
    reason: 'The account a commitment is paid from is not available.',
    detail: 'Canonical accounts exist, but which account a commitment draws on is a property of the commitment. Choosing the account a similar posted entry happened to use would attach a plan to an account the household never nominated.',
  }),
})

export const recurringGapSlot = gapSlotFactory(RECURRING_GAPS, 'Recurring')
