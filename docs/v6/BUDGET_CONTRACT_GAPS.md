# Money → Budget — screen-specific contract gaps (SHR-199)

The fresh V6 Budget screen is built from the frozen Command Center prototype.
The prototype's Budget page is built almost entirely out of plan-versus-actual:
a limit per category, a progress bar, a pace marker, a projected close, a year
grid whose last four columns are the plan, and a "Net saved" line. Exactly one
half of every one of those pairs exists as canonical truth today — the actual.
The plan does not.

So Budget renders the prototype's composition in full and fills only the half a
canonical contract can answer. Every remaining slot states its own gap and names
the issue that would close it. `src/v6/data/budgetGaps.js` is the
machine-readable version of the tables below and is what the screen renders.

## Canonical values connected

| Budget slot | Canonical source |
|---|---|
| Category rows and their actuals | `canonical_budget_actuals` via `listCanonicalBudgetActuals`, one call per calendar month |
| Period consumption spend (the "Spent" headline) | `canonical_period_metrics.consumption_spend_aed` for the month |
| Per-category quality, transaction, review, zero-placeholder and missing-FX counts | the actuals contract's own counters, shown beside the label each came from |
| Period quality, review count, missing-FX count and currencies | `canonical_period_metrics.quality_status`, `needs_review_count`, `missing_fx_count`, `quality_metadata.missing_fx_currencies` |
| Year grid cells | twelve separate `canonical_budget_actuals` reads, one per month of the year |
| Year grid "Consumption spend" row | twelve separate `canonical_period_metrics` reads, one per month |
| Days left in the month | a calendar fact from the household's own date boundary, never a plan-relative claim |

Both contracts are already consumed by the V6 Overview, so Budget consumes
canonical truth from the start. It never reads raw transactions and never
converts a currency in the browser: an entry with no canonical FX rate makes its
category actual `null`, and the screen states that rather than under-reporting.

## Deliberately withheld, with the contract that would supply it

| Capability | Why it is withheld | Closing issue |
|---|---|---|
| The planned amount, per category and per period | No versioned monthly plan contract exists. The legacy `budgets` table is deliberately not read: one undated limit per category, no period version, no effective history, no quality semantics — presenting it as *this* month's plan would state a number the household never set for this month. | SHR-166 |
| Budget left / remaining | Remaining is plan minus actual. The actual is canonical; the plan is not published, so the difference cannot be stated. | SHR-166 |
| The progress bar and "% used" | A bar in that position means actual over plan. No contract publishes that ratio, so the bar is **absent**, not drawn empty and not drawn against something else. The bars beside the category actuals are relative magnitude between canonical actuals only (see below). | SHR-166 |
| Pace and the pace marker | Days elapsed is a calendar fact, but the comparison it feeds is a plan judgement. No "under pace", "on pace" or "over by" claim is made. | SHR-166 |
| Projected close | Projecting where a period closes needs an approved contract stating its inputs, its treatment of irregular spend and its behaviour on incomplete inputs. | SHR-166 |
| Variance and "on track" judgements | Over, under, on track and by how much are all statements about a plan. Nothing ranks, colours or narrates a category against a target that does not exist. | SHR-166 |
| Rollover between periods | Explicitly outside the approved plan contract unless separately approved. No balance is carried, and none is implied. | SHR-166 |
| Year totals, averages and net saved | The year view navigates twelve canonical monthly reads. Totalling or averaging them in the browser would publish an annual figure no contract computed, and the prototype's planned Sep–Dec cells have no canonical source at all. | SHR-166 |
| Budget-period income and its per-source breakdown | Which income counts towards a budget period, and how it breaks down by source, is what the posted-income truth contract settles. Budget states no income figure rather than borrowing a period total defined for a different question. | SHR-167 |
| Savings and net-saved positions | Canonical category actuals are consumption spend only — transfers and savings movements are excluded by the contract — so a savings position cannot be assembled from them. | SHR-167 |
| Per-person budget allocation | Budget is whole-household truth, counted once. Splitting a plan or an actual between people needs stable economic-party facts; the prototype's per-person allocation is a quarantined exception. | SHR-156 / SHR-195 |
| Stable category identity | Each row is one label as the actuals contract reported it, shown verbatim. It is never treated as a durable key, never merged with a similar one, never inferred from description text. | SHR-198 |
| Category groups | The contract reports a flat list of labels. Grouping them into parents would invent a taxonomy the household never defined. | SHR-198 |
| Setting a budget | Writing a plan needs the versioned plan contract: which period a plan belongs to, how an edit versions the previous one, what happens to historical plans. The legacy budget writer has none of that and is deliberately not wired in. | SHR-166 |
| Editing a category plan | The prototype opens an editor from a category row and from each planned cell of the year grid. Both write a period-specific plan — the same missing contract. | SHR-166 |
| Renaming / archiving / deleting a category | Category lifecycle is not a Budget-screen concern and is not introduced here. | SHR-198 |

## Two rules that shape the composition

**`Uncategorised` is not `Other`.** `Uncategorised` is the actuals contract's own
bucket for entries carrying no category (`coalesce(l.category, 'Uncategorised')`
in `041_canonical_financial_metrics_phase_a.sql`). `Other` is a category a
household can genuinely have named. They are distinct facts, they render as
distinct rows, and neither is ever folded into the other. Both fixtures and
tests pin this.

**The bars are magnitude, not progress.** Each category actual carries a bar
whose width is that actual relative to the largest canonical actual in the same
period — drawing geometry over canonical values, exactly as the Overview's
top-spend bars already are. It states no number, it is no share of any total, it
is hidden from assistive technology because the figure beside it is the datum,
and it is drawn **only** when every category actual in the period is a canonical
number *and* those numbers reconcile to `canonical_period_metrics`'s own
consumption total at two-decimal precision. If either check fails, no bar is
drawn at all and the screen says why. The prototype's plan progress bar is a
separate slot and stays unavailable.

## What this screen deliberately does not reuse

* `src/screens/Budget.jsx` — the legacy Budget composition. It stays in the
  repository (nothing is deleted in SHR-199) but no longer renders at
  `/money/budget`, and `src/App.jsx` no longer imports it.
* `src/lib/budgets.js` — `listBudgets` / `upsertBudget`. Not a canonical
  contract, and the writer would create plan rows the versioned plan contract
  could not later version, interpret or supersede.
* The legacy screen's derived `Remaining` column, its `toAED` browser-side
  conversion and its `listTransactions` raw-transaction reads — precisely the
  frontend financial truth SHR-167 exists to remove.
