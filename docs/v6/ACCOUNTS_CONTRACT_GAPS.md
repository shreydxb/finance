# Wealth → Accounts — screen-specific contract gaps (SHR-180)

The fresh V6 Accounts screen preserves the frozen Command Center prototype's
grouping controls, its Account / Type / Owner / Native / AED / Updated table,
its Net footer and its account drill-in. It fills only facts directly supported
by approved canonical reads. Every other prototype position stays visible as an
honest unavailable state naming the issue that owns the future contract.

The screen makes exactly two reads — `canonical_balance_sheet` and
`v_canonical_accounts_aed` — and no ledger read at all. That is structural, not
conventional: there are no posted rows in scope for a balance to be
reconstructed from, and `v6-boundary.test.js` fails the build if one appears.

## Canonical values connected

| Screen position | Canonical source and exact meaning |
|---|---|
| Account name, type, asset/liability side | `v_canonical_accounts_aed` `name`, `type`, `is_liability` |
| Native value | `v_canonical_accounts_aed.canonical_value_native`, rendered beside its own `currency` |
| AED value | `v_canonical_accounts_aed.canonical_value_aed` |
| Valuation method | `v_canonical_accounts_aed.valuation_method` |
| Valued as of | `v_canonical_accounts_aed.valuation_as_of`, rendered as an exact Asia/Dubai wall-clock timestamp |
| Valuation timestamp basis | `v_canonical_accounts_aed.freshness_status` — the view's own category for *where* the timestamp comes from, not a verdict on how current it is |
| Per-account quality | `v_canonical_accounts_aed.quality_status` |
| Published FX evidence | `v_canonical_accounts_aed.fx_rate_to_aed` and `fx_updated_at` |
| Household assets / liabilities / net | `canonical_balance_sheet.assets_aed` / `liabilities_aed` / `net_worth_aed` at `scope = household` |
| Household quality evidence | `canonical_balance_sheet` `quality_status`, incomplete/provisional/missing-FX counts, `quality_metadata.fx_basis` and `quality_metadata.fx_updated_at` |
| Account count, currency count | Counts of canonical rows and of the distinct canonical `currency` codes on them |

`canonical_value_native` and `freshness_status` were added to
`ACCOUNT_COLUMNS`/`normalizeCanonicalAccountRows` by this issue. Both are
columns `041_canonical_financial_metrics_phase_a.sql` already publishes on the
view; selecting them is additive and optional, exactly like the `name` column
SHR-155 added, so a caller that does not select them still validates.

## Native value versus AED value

They are two separately published facts about the same account, not two
renderings of one. The screen states both and derives neither:

* the AED column is **never** filled from the native value, and no FX rate is
  applied anywhere in the browser;
* a row whose contract published a native value and no AED value — a currency
  `settings.fx_rates` carries no rate for — renders the native figure and an
  explicit *"No published FX rate for &lt;CCY&gt;, so the canonical contract
  states no AED value. It is not converted here."*;
* the contract itself now refuses a row that carries an AED value with no
  published FX evidence, so the pairing cannot be broken upstream either.

## Deliberately withheld

| Prototype position | Smallest missing canonical truth | Owner |
|---|---|---|
| Owner column | A published economic-ownership fact per account | SHR-154 / SHR-156 |
| "By owner" grouping | The same ownership truth, plus a grouping contract over it | SHR-154 / SHR-156 |
| Me / Wife / Both scope | Economic-party mapping and party-scoped wealth semantics | SHR-156 / SHR-173 |
| Per-group AED subtotal | A published scope-aware wealth aggregate with its own quality rule | SHR-173 |
| "All valued today", fresh/stale/delayed | A contract-published freshness status or threshold policy | SHR-172 / SHR-173 |
| Full valuation provenance (provider, feed, source system, author) | Published valuation provenance identity | SHR-172 |
| Per-account balance or valuation history | A published per-account time series | SHR-172 / SHR-173 |
| Performance, cost basis, P&L, allocation, price movement | The Investments composition and its performance contracts | SHR-174 / SHR-176 |
| "Counts toward net worth" switch | A published per-account inclusion flag or share | SHR-173 |
| Add / Edit / Update valuation / Archive / Delete | An approved safe account lifecycle contract that records valuation provenance | SHR-172 |
| Change owner | Ownership reconciliation, which SHR-154 makes operator authority, executable by no browser role | SHR-154 / SHR-156 |

## Ownership and household scope

This is the sharpest boundary on the screen, and it fails closed completely.

`accounts.owner` is legacy display text. SHR-194 established that identity
cannot be derived from presentation evidence, and a label on an account is
presentation evidence. The V6 model therefore **discards `owner` at the data
boundary** — no position row carries an owner field at all — so no component
downstream can render it as ownership by accident, and `v6-boundary.test.js`
fails the build if the executable code in the Accounts tree reads it.

SHR-154 (`049_account_ownership_stable_refs.sql`) is the stable reference that
would answer the Owner column: `accounts.ownership_kind`, `owner_party_id`,
`public.v_account_ownership_v2` and `canonical_balance_sheet_v2`. Two facts
make consuming it out of scope for SHR-180:

1. **SHR-154's own package assigns the consumer cutover elsewhere.** Its §7
   comment states plainly that nothing consumes the V2 adapter yet and that
   "the consumer cutovers belong to SHR-173 (wealth scope), SHR-153
   (Overview), SHR-172 (valuation) and SHR-158 (Settings)."
2. **The migration is not deployed to the environment this screen runs
   against.** The repository carries migrations `045`–`050`; the `our-rokda`
   project is applied through `044_manual_transaction_safety`. Verified by
   read-only query: `to_regclass('public.v_account_ownership_v2')` and
   `to_regprocedure('public.canonical_balance_sheet_v2(text,uuid)')` both
   return `NULL`, and `public.accounts` has no `ownership_kind` or
   `owner_party_id` column. Applying a migration is outside SHR-180's safety
   envelope.

Even once applied, 049 leaves every account at `ownership_kind =
'unreconciled'` with a null party — nothing is inferred, and populating it is
an operator-authority reconciliation against an SHR-194-approved manifest. So
the Owner column would still be unavailable until that reconciliation runs.

The screen is therefore whole-household truth, counted once:

* every account appears exactly once, in one group;
* no account is duplicated into a per-person view;
* no shared position is divided 50/50, 69/31 or in any other ratio;
* household totals come from `canonical_balance_sheet` at household scope,
  where the shared-counted-once semantics are contractual — they are never a
  browser sum of the visible rows, which is why an account whose AED value the
  contract withholds cannot silently drop out of a total and leave a
  plausible, quietly-too-low number.

The composition is N-party capable: nothing anywhere assumes two members, and
the scope position is a single named gap rather than a hard-coded pair of
people.

### Smallest missing contract, if SHR-180's Owner column is to be filled

1. `049` applied to the target environment;
2. an SHR-194-approved ownership manifest reconciled through
   `private.reconcile_account_ownership_v1`, so `ownership_kind` is something
   other than `unreconciled`;
3. an approved read that publishes, per account, the ownership kind and the
   economic party's display identity for presentation — `v_account_ownership_v2`
   supplies exactly this shape today, but its consumer cutover is SHR-173's;
4. for a *personal* scope selector, SHR-156's economic-party ↔ household-member
   mapping, so the app can say which party the signed-in person is.

## Classification

Grouping uses `type` and `is_liability` from the canonical row, and nothing
else. No account name, note or amount is inspected. A fixed type order decides
where a group appears; it never decides which side of the balance sheet an
account is on. `v6-boundary.test.js` fails any name-matching heuristic in the
Accounts tree — a name like "Mortgage · ENBD" looks like a liability, and
matching on it would move an account between the sides of the balance sheet on
the strength of a label the household typed.

Liabilities keep the canonical positive magnitude and carry "Liability" as
text on the row and in the group heading, so the distinction never rests on a
minus sign or on colour.

## Valuation, provenance and freshness

The screen reports the valuation method, the exact valuation timestamp, the
published FX rate and FX timestamp, and the contract's own
`freshness_status` category. It infers nothing:

* provenance is not read from transaction history, the last transaction, the
  account's creation date, its name, its type or any display label;
* no timestamp becomes a verdict. There is no client-side stale threshold, no
  "valued today", no "up to date", no relative "N days ago", and no combined
  freshness score. `v6-boundary.test.js` fails `Date.now()`, `isStale`,
  `staleAfter`, `daysSince` and similar in the Accounts tree's executable code;
* the prototype's "10 accounts · 3 currencies · all valued today" meta line
  keeps its two counts and drops its third clause, which is precisely the
  claim no contract supports.

## Writes

Read-only. Opening the screen performs two selects and no write of any kind,
including no screen-open snapshot. The prototype's account drawer edits name,
type, currency, balance and owner and toggles net-worth inclusion; each of
those is rendered as a visible, disabled control with a named unavailable
region beside it. No legacy account writer is imported anywhere in the tree.

## Detail and deep links

`/wealth/accounts/:id` opens a read-only drawer over the loaded canonical set,
using the shared SHR-152 `DetailShell` for focus trapping, background
inertness, Escape and focus return. An id that is not in the set the household
could read fails closed with the access gap and renders no partial record and
no maintenance control — an identifier in a link is not evidence that a record
exists or that it may be disclosed. The drawer manufactures no balance
history, valuation history, contribution total, return or ownership share.

## Route note

`/planning/forecasts` has always resolved to whatever component the legacy
`src/screens/Accounts.jsx` module rendered, because that module hosts the
forecast card. SHR-180 gives it its own `Forecasts` screen key so unmounting
legacy Accounts from `/wealth/accounts` does not silently remove a Planning
surface this issue was not asked to touch. Repointing Forecasts itself belongs
to the Planning work.
