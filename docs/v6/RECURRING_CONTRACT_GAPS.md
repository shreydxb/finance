# Money → Recurring — screen-specific contract gaps (SHR-200)

The fresh V6 Recurring screen is built from the frozen Command Center
prototype. The prototype's Recurring page is built almost entirely out of
*plans*: a list of bills and EMIs with an amount, a cadence, a next due date
and an autopay setting; a list of expected income beside it; a committed total
and a count of the ones without autopay in the header; and a fixed-versus-
variable card underneath that splits the period's spend into the part
committed before the month started and the part that was not.

**None of that is a posted fact, and none of it has an approved contract.**

Exactly one figure on the whole page exists as canonical truth today — the
period's consumption spend — and it is the *denominator* of the last item, not
any of the plans. So Recurring renders the prototype's composition in full and
fills only the half a canonical contract can answer. Every remaining slot
states its own gap and names the issue that would close it.
`src/v6/data/recurringGaps.js` is the machine-readable version of the tables
below and is what the screen renders.

## The rule this screen exists to keep

A posted transaction that looks like last month's electricity bill is **not**
evidence that an electricity bill is a recurring commitment. It is evidence
that money moved once.

Turning the second into the first — clustering merchants that repeat, reading a
monthly rhythm out of the spacing of dates, calling a similar amount on a
similar day "paid" — would manufacture the entire SHR-171 contract in the
browser: a schedule, a due date, a paid/unpaid status and a missed-bill claim,
none of it versioned, none of it correctable by the household, and all of it
rendered with the same authority as a canonical figure.

The screen is built so that inference has nowhere to live rather than merely
being told not to do it:

* `composeRecurring.js` makes **one** read — `canonical_period_metrics`. It
  never reads the canonical ledger, canonical income rows, raw transactions or
  `src/lib/recurring.js`. There is no posted row in scope to cluster.
* `recurringModel.js` takes no row collection of any kind as an input. Its
  `items` array is empty by construction and there is no code path that fills
  it.
* `src/v6/v6-boundary.test.js` fails the build if any file in the Recurring
  tree names one of those reads, or carries a similarity score, an interval
  detector, a cadence guess or a paid-status assignment.

## Canonical values connected

| Recurring slot | Canonical source |
|---|---|
| Consumption spend posted in the period | `canonical_period_metrics.consumption_spend_aed` for the calendar month |
| Period quality, review count, missing-FX count and currencies | `canonical_period_metrics.quality_status`, `needs_review_count`, `missing_fx_count`, `quality_metadata.missing_fx_currencies` |
| The month grid and its day numbers | a calendar fact from the household's own date boundary |
| Days left in the month | the same calendar fact, never a plan-relative claim |

That is the complete list, and it is short on purpose. The consumption-spend
figure sits in the prototype's fixed-versus-variable position as the total the
split would be taken *of*, labelled as whole-period posted spend. It is never
described as committed, fixed, recurring or expected, and the committed half of
the split stays explicitly unavailable beside it — the same treatment SHR-199
gave Budget's plan-versus-actual pairs.

## Deliberately withheld, with the contract that would supply it

| Capability | Why it is withheld | Closing issue |
|---|---|---|
| Recurring bills and EMIs | A bill here is a commitment the household declared — name, amount, cadence, account, effective window. No approved contract publishes that set. | SHR-171 |
| Expected income | Expected income is a plan, not a summary of income that already landed. | SHR-171 |
| The committed total and the "without autopay" count | Both halves of the prototype's header need the commitment set itself. | SHR-171 |
| Recurrence cadence | Monthly, quarterly, annual-billed-monthly, "the 15th" — declared on a commitment, never inferred from the spacing of posted dates. A wrong guess would then drive a due date, a reminder and a missed-bill claim. | SHR-171 |
| Next due date | The cadence projected forward from an effective window. Nothing to project from. | SHR-171 |
| Paid / unpaid status | Paid means an explicit link to a posted fact. It is never inferred from a similar transaction. Nothing is marked paid, unpaid, due, overdue or missed. | SHR-171 |
| Autopay / manual | A setting on the commitment, not something visible in a posted transaction. | SHR-171 |
| Effective and archive semantics | A commitment that ended last year must not appear as this month's obligation, and one starting next month must not be counted as missed today. Without these there is no truthful way to decide what belongs in a period at all. | SHR-171 |
| The fixed-versus-variable split, its bar and its percentage | The committed half is the recurring plan. The bar is **absent**, not drawn empty and not drawn against something else. | SHR-171 |
| Expected-versus-posted variance | Compares a plan with the fact linked to it. Neither exists. No row is described as higher, lower, early, late or short. | SHR-171 |
| Suggested matches | SHR-171 defines matching as a deterministic suggestion plus explicit confirmation. Both halves are missing, and the half a browser could fake is the half that must never be presented as authoritative. No suggestion is generated, ranked or shown. | SHR-171 |
| Mark paid | Either records an explicit link or creates a fact through an approved writer. No such writer is approved, and the legacy transaction writer is deliberately not wired in. | SHR-171 |
| Link a posted entry to a commitment | An explicit write against the plan contract. Nothing is linked, unlinked or silently converted. | SHR-171 |
| Add a bill / add an expected income | Both create a plan row. The legacy `src/lib/recurring.js` writer has no period versioning, no effective/archive semantics and no matching model. | SHR-171 |
| Edit a commitment | An edit to a plan is a new version of it from a date onward — the semantics SHR-171 owns. | SHR-171 |
| Archive / end a commitment | Ending a commitment must preserve the periods it was effective for; deleting a legacy row does the opposite. | SHR-171 |
| Expected events on the calendar | Every marker the prototype places on a day is an expected event projected from a cadence. See "The calendar" below. | SHR-171 |
| The account a commitment is paid from | Canonical accounts exist, but which account a commitment draws on is a property of the commitment. Picking the account a similar posted entry used would attach a plan to an account nobody nominated. | SHR-171 |
| Budget-period posted income and its per-source breakdown | Which income counts towards a period, and how it breaks down by source, is what the posted-income truth contract settles. This screen's only income position is *expected* income, so borrowing a period total defined for a different question would answer the wrong question in the right-looking place. | SHR-167 |
| Who pays or earns a commitment | Legacy owner text is a recorded label, not a stable economic party: editable, sometimes blank, never a durable identity. No person or shared allocation is shown. | SHR-195 / SHR-156 |

## The calendar

The prototype's Recurring calendar places a marker on each day a bill lands or
income arrives. Every one of those markers is an **expected** event, so the
grid renders the household's real calendar month — Monday first, today marked
from the household's own date boundary — and places nothing on it.

Posted entries are deliberately **not** plotted here either, even though a
canonical read could supply them. A posted entry sitting in a day cell of a
*recurring* calendar reads as "the expected event landed on this day", which is
exactly the plan-to-posted conversion this screen must not perform — and no
contract publishes a per-day total to draw in any case. Posted daily activity
lives on Money → Activity, where a day cell means what it says.

## Two decisions worth recording

**Bills and Income became a mode switch rather than two columns.** The
prototype places them side by side. Both are the same missing plan contract,
and a two-column layout of two identical unavailable states reads as a
rendering fault rather than as an answer. `type=bills|income` was already the
approved route contract for `/money/recurring`, it is what makes the mobile
hierarchy work at 320px, and it survives a reload — so the two columns became
the two positions of one real control. This is a composition decision, not a
scope reduction: both surfaces are built, and each renders its own gap.

**There is no recurring-plan fixture, deliberately.**
`src/v6/fixtures/recurringFixture.js` covers `canonical_period_metrics` only.
A fixture for a recurring plan would be a fixture for a shape nobody has
agreed, and once it existed the screen could be made to look finished by
rendering it. The screen must look exactly as unfinished as the contracts
actually are.

## What this screen deliberately does not reuse

* `src/screens/Recurring.jsx` — the legacy Recurring composition. It stays in
  the repository (nothing is deleted in SHR-200) but no longer renders at
  `/money/recurring`, and `src/App.jsx` no longer imports it.
* `src/lib/recurring.js` — the legacy recurring reader *and* writer. Not a
  canonical contract, and the writer would create commitments SHR-171's plan
  contract could not later version, interpret or supersede.
* `src/lib/transactions.js` — the raw-transaction reader and its writers. A
  recurring screen reaching for posted rows is the first step of the exact
  inference this slice refuses to make.
* `src/lib/recurringSchedule.js`'s cadence rules — a legacy projection over
  legacy rows, and not a canonical contract for what is due when.
