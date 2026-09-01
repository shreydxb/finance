# Money → Activity — screen-specific contract gaps (SHR-164)

The fresh V6 Activity screen is built from the frozen Command Center
prototype. The prototype shows a server-backed search, a monetary calendar,
editable rows and a delete affordance. Each of those needs a contract that does
not exist yet, so Activity fills a slot only when an approved canonical
contract can supply it truthfully. `src/v6/data/activityGaps.js` is the
machine-readable version of the tables below and is what the screen renders.

## Canonical values connected

| Activity slot | Canonical source |
|---|---|
| Transaction rows | `v_canonical_ledger_aed` via `listCanonicalLedgerRows` over the month |
| Row amount | the row's own `amount_aed` (never a client-side conversion or sum) |
| Category label, owner label, description | the row's own `category`, `owner`, `note`, verbatim |
| Economic classification and its reason | `economic_classification`, `classification_reason` |
| Review state and quality | `needs_review`, `quality_status` |
| Transfer direction, split group | `transfer_direction`, `group_kind` |
| Account name | `v_canonical_accounts_aed.name`, joined by the row's `account_id` |
| Period consumption spend / posted income | `canonical_period_metrics` for the month |
| Calendar day counts | cardinality of the canonical rows returned for that date |

## Deliberately withheld, with the contract that would supply it

| Capability | Why it is withheld | Closing issue |
|---|---|---|
| Search and filter across the whole ledger | The controls narrow the canonical rows already read for the month. There is no stable household-wide search or filter contract, and an empty result must never read as "the household has no such transaction". | SHR-163 |
| Per-day monetary totals in the calendar | No contract publishes a per-day total; adding the rows up in the browser would create a household figure nothing stands behind. | SHR-163 |
| Bill / EMI / expected-income markers | The legacy recurring schedule is not canonical. | SHR-171 |
| Owner as a stable economic-party reference | Owner is a recorded text label, not a stable attribution, and must not be read as ownership or as a share of a shared fact. | SHR-195 |
| Stable category identity | The label is shown exactly as the ledger reports it and is never inferred from description text. | SHR-198 |
| Merchant / payee identity | The ledger carries the free-text note recorded with the entry; there is no resolved merchant behind it. | SHR-169 |
| The paired side of a transfer | Pairing entries in the browser could join two unrelated movements. | SHR-159 |
| Refund / reimbursement linkage | Nothing canonical links a refund to what it reverses. | SHR-162 |
| Provenance and audit history | Not exposed by any canonical read yet. | SHR-161 |
| Add a transaction | No canonical write contract is wired into the V6 boundary. | SHR-126 / SHR-159 / SHR-165 |
| Edit an entry | Correction has to go through the approved path so quality, review state and audit history stay consistent. | SHR-126 / SHR-161 |
| Delete / restore | Deleting one side of an owned-account transfer without its pair corrupts a single economic event. | SHR-126 / SHR-159 |
| Split by category | Split creation has its own safety contract. An existing split group is still reported as a fact. | SHR-165 |
| Mark reviewed | Review state is a canonical fact here; changing it is a write with quality and audit consequences. | SHR-161 |

## Read-only, by decision

Every write above is rendered as a **visible, disabled control that names its
missing contract** rather than hidden or wired to a legacy path. Hiding them
would misrepresent the product as not having the idea; wiring them to
`src/lib/transactions.js` would create a parallel client-side mutation path
that bypasses exactly the safety those contracts own.

Two tests hold this closed: `buildCapabilities()` must report every capability
`unavailable` and `isWriteEnabled()` must be `false`; and no V6 Activity module
may import a legacy reader/writer or call one.

## Quality is not attention

The separation established in SHR-155 carries over. Activity shows the quality
facts the canonical contract states about a row — `needs_review`,
`quality_status`, `classification_reason` — as facts on that row. It does not
rank them, score them, aggregate them into a queue, or present them as
attention conditions. The attention registry remains SHR-192's.

## Deliberate deviations from the prototype

* **A real `table`.** The prototype uses a grid of clickable `div`s; the
  implementation uses a semantic table with a row header per entry, so row and
  column relationships survive for assistive technology.
* **Touch targets.** Every control carries `min-height: 44px`, as
  `ACCESSIBILITY.md` requires. The prototype's own ~31px control is explicitly
  not a compliant token.
* **Hidden columns keep their information.** Owner and Account hide below
  900px exactly as the prototype encodes, and both remain available in the
  row's drawer — the information is never simply dropped.
* **Calendar cells count entries.** The prototype prints a money figure per
  day; see the withheld table above.
* **Summary line.** Counts are cardinalities of rows the contract returned; the
  money comes from `canonical_period_metrics`, not from adding the visible rows.
* **Month navigation.** The prototype shows a static range caption. Activity
  navigates by month through the route query, and cannot step past the current
  month.

## Prototype demo values

None are used. `v6-activity.ui.test.jsx` asserts that no value from the
prototype's Activity or Overview pages appears in the rendered screen.
