# Our Money v4 — working notes

Private household finance app for a couple in Dubai. See `PLAN.md` for the
product plan, data model and decisions log. This file is for the operational
things that are easy to get wrong.

## Handover — 19 Aug 2026 (updated, reconciliation session)

Picking this up in a fresh chat? Read this section first, then the rest of
the file for detail.

**Branch:** `claude/money-v4-open-items-mdw27c`. Working tree clean, all
commits pushed to `origin`. `main` has **not** been touched this session —
nothing here is deployed to production yet except what's noted below.

**Branch reconciliation, same day, later session:** a second, parallel
session had independently built `/review` (#62) and its own `/undo` (#61) on
a sibling branch (`claude/money-v4-open-items-5njpob`) without knowing this
branch existed — discovered only when asked to deploy. This branch's #61
(built on the #60 propose-then-tap plumbing, matching the original task
spec) was kept as canonical; the sibling branch's standalone #61 was
discarded. Its #62 (`/review`) was ported onto this branch's `intake.ts`
using the identical `REVIEW_ACTIONS` prefix-routing pattern already
established here for confirm/fix/delete reuse: `rconfirm`/`rfix`/`rskip`/
`rdelete` callback actions route through the exact same branches as the
original inline Confirm/Fix/Delete prompt, plus a new `skip` branch and
`presentReview`/`advanceReview`/`sendReviewCard` helpers. Queue position is
stateless — `IntakeStore.findNextNeedsReview(afterCreatedAt)` and
`countNeedsReview()`, using a `created_at` field newly added to
`TransactionRow` — so Skip, concurrent reviewers, and a row resolved
elsewhere mid-review all just work without a stored cursor. Sibling branch
`5njpob` is now superseded for `/review`/`/undo` and should not be merged;
its other content (if any is later needed) would need re-review first.

**What shipped this session (#54–#62), all built, tested, committed, pushed,
sitting in Taskiv state **Review** (not Done — see the deferred-verification
rule below):**
- #54 `budget_status`, #55 `net_worth`, #56 goal/debt progress, #57 upcoming
  bills, #58 portfolio summary + needs-review count — five new bot query
  types added to the Sprint 3 query toolbox.
- #60 generic propose-then-tap plumbing: `037_pending_actions.sql` (applied
  live to `our-rokda`), `actions/pending.ts` (`PendingActionStore`,
  `proposeAction`, `handlePendingActionCallback`), `PendingActionHandler.apply(payload, ctx)` returns the confirmation text; `ctx` carries `store`/`messenger` so a
  handler can do more than a bare write.
- #61 `/undo`: `actions/undo.ts`, soft-deletes the last bot-logged
  transaction in the chat (`deleted_at`, never a hard DELETE), edits away any
  open Confirm/Fix keyboard on that row. Wired into `intake.ts` and
  `index.ts`.
- #62 `/review`: walks the `needs_review` queue one row at a time via
  Confirm/Fix/Skip/Remove, reusing the existing confirm/fix/delete callback
  logic verbatim. See the reconciliation note above for how it landed here.
- Test suite is at **570 `npm test`** cases (564 + 6 new `/review` cases),
  lint and build clean. `npm run test:db` cannot run in this sandbox (no
  local Postgres) — schema changes were instead verified applied live via
  Supabase `execute_sql`.

**Deploy status: none of #54–#62 is live in `telegram-intake` yet — a deploy
package for all of it (33 files, the full transitive closure from
`index.ts`) was assembled and handed to Shrey this session as a zip
(`telegram-intake-deploy-v41.zip`) for dashboard browser-paste.** Production
is still whatever `main`/the last dashboard paste had (through the v40
deploy, which hit the `SERVICE_ROLE_KEY` staleness issue below). Deploy
method by explicit standing instruction: **dashboard browser-paste, not
MCP or CLI** — give Shrey the file contents and path, he pastes, then verify
via `mcp__Supabase__get_edge_function`. Remember the `../_shared/` naming
trap documented further down when constructing any file list.

**Standing constraint — do not violate this without the user saying so
explicitly:** bot query/action tasks (#54–#61 and everything that follows in
this vein) stay in Taskiv **Review**, never **Done**, until a live Telegram
round-trip actually verifies them. This was an explicit user instruction
("Let's fix telegram related stuff later... it needs review and testing once
we've completed building everything else that's pending"). Don't attempt
live verification again until asked — the last attempt surfaced a real
blocker (below) that needs Shrey, not more code.

**Known blocker, not a code bug:** the most recent live test got no bot
reply. Diagnosed via `intake_logs`/`edge_logs` as `PGRST303: "JWT issued at
future"` — the `SERVICE_ROLE_KEY` custom secret in the Supabase dashboard has
gone stale again (same failure mode as the 16 Aug entry below). Fails inside
`_shared/store.ts`'s `loadHouseholdContext`, before any router/query code
runs — not something this session's code changes caused or can fix. **Needs
Shrey to re-paste a fresh service-role key** from Project Settings → API,
same fix as before.

**Backlog sweep done this session:** #93 and #94 were found to be stale
tickets for already-shipped work (Budget sticky panel, Fixed Deposits) and
moved straight to Done, no code changes. The rest of the open backlog —
#21, #23, #24, #62–79, #102 — was checked against the live codebase and
confirmed genuinely open, each for a documented reason (blocked on Shrey, or
verifiably unbuilt).

**Logical next steps, in the order the backlog suggests:** #62 is now done
(see above) — next up is #63–67 (goal contribution, balance update, income
log, category rule handlers), which all build on the now-proven #60
propose-then-tap pattern, so they should be straightforward extensions.
After that, #24 and #68–79 (push infrastructure). #21, #23 and #102 stay
blocked on Shrey (FIRE expense figure, leaked-password-protection dashboard
toggle, backup passphrase/chat-id secrets) — don't attempt those without him
providing the missing input first. Also filed this session (separate track,
not bot-related): **#103**, a Monarch-style "this period vs. comparison
period" spending chart for Reports — not started.

## Deploys cost real money — batch them

Netlify is on the **free tier: 300 build minutes/month, resetting on the 20th**.
Every push to the production branch triggers a build.

- Verify locally first (`npm run build`, `npm test`, `npm run lint`), then push
  **once** with the work batched. Don't push per-commit while iterating.
- Check that Netlify's branch-deploy setting is "production branch only" — if
  it's set to all branches, every push to every branch burns minutes.
- Edge Function deploys go through Supabase, not Netlify, and cost nothing here.
  Backend-only changes never need a Netlify build.

## Screens

10 nav tabs: Home, Accounts, Investments, Transactions, Reports, Budget, Recurring,
Goals, Debts, Settings. Investments and Debts were split out of Accounts and Goals
respectively once real data made the combined screens too crowded; Reports (was Cash
Flow) gained Cash Flow/Spending/Income sub-tabs and leads with a Sankey diagram. Dark
mode and a global AED/USD/INR currency toggle apply across all of them — both
device-local (localStorage via `PrefsContext`), not synced between Shrey's and
Tarika's devices on purpose. See `PLAN.md` for the full per-screen breakdown.

## Deploy — 18 Aug 2026

`telegram-intake` redeployed to production: **v35**, `verify_jwt: false`
(unchanged). Carries everything built since the last live deploy — Taskiv
#48 (`v_transactions_aed` FX view, migration already live), #49 (outbound
chat-id allowlist via `GuardedMessenger`), #50 (the intent router —
`spend | question | action | chatter` classification on every plain typed
message), and #51/#52 (the query toolbox: `category_spend`, `total_spend`,
`merchant_spend`, `account_spend`, `recent_transactions`, answered live from
`v_transactions_aed`). Sprint 2 is now 4 of 5 shipped; only **#53** (router
fixture corpus + `/help` rewrite) is still open. Bot-expansion Sprint 1 was
already fully live from the 14–16 Aug deploy below.

**#53 is done in code, not yet deployed** — `fixtures/routing.ts` (a 30-case
corpus covering spend/question/action/chatter plus the adversarial cases:
"how much was that Carrefour trip, 240?" resolves via the classifier, a bare
"240"/"groceries"/"84" resolve via the router's classifier-failure fallback,
never a live model call) and `routing.test.ts` (3 tests: the regex fast path
alone never misroutes a spend case as a question, every corpus case reaches
its expected intent, and every spend case survives a simulated total
classifier outage). `HELP_TEXT` in `intake.ts` is rewritten as an honest
📸/💸/❓/⚙️ catalogue of what's actually live — cashback, transfers, bulk
input and the #50–#52 query toolbox are now listed; `/undo`, `/review` and
any "action" capability are deliberately left out until they ship, with a
comment in the file saying so. 410 `npm test` (was 407), lint and build
clean, `npm run demo:telegram` unaffected.

**#53 is now deployed too — `telegram-intake` v36, `verify_jwt: false`
(unchanged).** This deploy went through cleanly on the first attempt: the
`../_shared/` naming fix above was applied from the start of the payload
instead of being rediscovered. Sprint 2 of the bot expansion (#48–#53) is
now fully shipped and live. `main` was also fast-forwarded and pushed to
GitHub the same session (9 commits) — Netlify's build queued and will fail
on the exhausted free-tier minutes (resets 20 Aug), but the commit is on
`main` and will deploy automatically the next time Netlify builds it; no
further push needed once credits reset.

Deploying this one cost real time to work out, worth recording so it isn't
relearned: `mcp__Supabase__deploy_edge_function` is **not additive** — every
call must carry the function's *complete* file set (entrypoint + every
relative import, transitively), or the bundler fails atomically and nothing
changes in production. The actual trap, though, was file naming. Inside the
`files` array, a name like `intake.ts` or `query/store.ts` lands under the
bundler's `source/` root exactly where the repo's own relative imports
(`./intake.ts`, `./query/store.ts`) expect it. But `_shared/*.ts` is a
**sibling** of `telegram-intake/`, one level up — matching the real
`../_shared/serviceKey.ts` import in `config.ts` — so those six files must be
named `../_shared/types.ts`, `../_shared/store.ts`, etc. in the `files`
array, *not* `_shared/types.ts`. The wrong prefix nests `_shared/` a level
too deep, and every call using it fails with `Module not found
".../_shared/serviceKey.ts"` regardless of whether every other file is
present and correct — which is exactly the failure mode this session hit
repeatedly before finding the real cause. No code changed as a result of any
of this; it was purely a deploy-payload construction issue, and every failed
attempt was rejected before touching production, so the previously-deployed
version stayed live and unaffected throughout.

**Taskiv #59 (honest-refusal path) is done in code and deployed —
`telegram-intake` v37, `verify_jwt: false` (unchanged), on top of v36.
Deployed cleanly on the first attempt using the `../_shared/` naming fix from
the start, no retries needed. Not pushed to `main` — only the #53 work was
explicitly authorized for `main`; this stays on
`claude/money-v4-open-items-mdw27c` until asked.**
`planQuery` (query/plan.ts) gained a `planQueryDetailed` sibling that returns
*why* a question couldn't be planned — `call_failed` (the model threw or
returned unparseable JSON), `unknown_category` (a real category name was
named but didn't match), or `unsupported` (everything else the closed query
enum doesn't reach) — instead of collapsing all three into one `null`.
`planQuery` itself is now a thin wrapper over `planQueryDetailed` so every
existing `plan.test.ts` assertion (`assert.equal(plan, null)`) still holds
unchanged. New `query/refusal.ts` owns the actual reply text: an
advice-shaped question ("should we...", "can we afford...") is refused
before the model is ever called — a deliberate product boundary, not a
missing feature; a planner failure gets "try rephrasing", distinct from the
generic "I can't answer that one yet" for an out-of-enum question; an
unknown category lists the household's real ones; and a `runQuery`/store
failure reuses `errorHint` (now split out of `intake.ts` into its own
`errorHint.ts` — the same circular-import problem `accountMatch.ts`/
`format.ts` solved for Taskiv #50, since `intake.ts` imports
`query/refusal.ts` and `query/refusal.ts` needs `errorHint`). `answerQuestion`
in `refusal.ts` is the single entry point — `intake.ts`'s `handleQuestion` is
now a thin wrapper around it, which is also why the whole thing is testable
in `query/refusal.test.ts` (10 new tests: the five cases the task named —
null/unsupported plan, planner throw, store throw, advice question, unknown
category — plus the advice-detection regex and the success path) without a
Telegram harness. 420 `npm test` (was 410), lint and build clean,
`npm run demo:telegram` unaffected.

**Taskiv #54 (budget vs actual query) is done in code and deployed, but not yet verified live — held in Review, not Done.**
Sprint 3's first query: `{ q: 'budget_status'; category?: string; period: Period }`
added to the closed enum (`query/types.ts`, `query/plan.ts`), backed by a new
`query/budget.ts` module and a real `PostgrestQueryStore.budgetStatus`
(`query/store.ts`) that joins `budgets`→`categories` for the limit and
`v_transactions_aed` for the spend, same FX-normalised source every other
query reads. The one rule the task called out as easy to get wrong: a
category with no `budgets` row is not a category with a zero limit —
`query/budget.ts`'s `classify`/`partitionAndClassify` treat a `null` **or**
`0` `monthly_limit` identically as unbudgeted, so it can never render as
"0/0" or "over budget", and a real zero-limit row (`Gifts` in the tests)
proved the same path handles both without a special case. Full grid groups
by status (Over/Close ≥80%/On track, not by the Fixed/Non-monthly/Flexible
budget group — status is what the question asks), sorted by percentage
descending within each group, capped at 15 rows with a "+N more" tail, with
unbudgeted categories listed separately and never mixed into the three
status buckets. Single-category replies add a daily-pace line
("21 days left, ~13.81/day to stay inside") only when `isCurrentMonth` is
true and money remains — `isCurrentMonth` is stamped by `run.ts` from
`plan.period.kind === 'this_month'` rather than re-derived from raw dates in
the formatter, so a `last_month` or `explicit` query can never accidentally
show a misleading pace line. 20 new tests in `query/budget.test.ts` (the
task's five named cases plus classification/truncation/zero-division
edge cases), 3 in `plan.test.ts`, 2 in `run.test.ts`, 1 in `reply.test.ts`.
440 `npm test` (was 420), lint and build clean, `npm run demo:telegram`
unaffected (the question path was already routed through `answerQuestion`
before this task; `intake.ts` needed no changes).

**Taskiv #55 (net worth query) is done in code and deployed, also held in
Review, not Done — same reason as #54.** `{ q: 'net_worth'; owner?: string;
compare?: Period }` added to the enum, reading `nw_daily` (never recomputed
from `accounts` — one source of truth with the app's own Home/Accounts net
worth). `by_owner`'s real keys (`Shrey`, `Tarika`) were confirmed against the
live table before coding, per the task's own warning not to assume them.
`compare` computes a delta against the closest `nw_daily` row on or before
the period's start; when no such row exists (the earliest recorded day falls
*inside* the requested window — real risk right now, since the table only
goes back to 9 Aug), the reply says so honestly instead of faking a number,
per `nw_daily`'s forward-only, never-backfilled rule in PLAN.md. New
`query/networth.ts` module + `query/networth.test.ts` (19 new tests total
across networth/plan/run/reply). 459 `npm test` (was 440), lint and build
clean, demo unaffected.

**Deploy — 19 Aug 2026: `telegram-intake` v40, carrying #54 and #55.** Got
there in three attempts, all via the Supabase dashboard's in-browser code
editor (this session's sandbox network policy blocks `api.supabase.com` and
`mcp.supabase.com` outright, so neither the Supabase CLI nor a from-scratch
MCP deploy could run from here — dashboard paste was the only path). v38's
first paste pass corrupted `query/plan.ts` and `query/store.ts` with
runaway auto-indentation from the editor's paste handling (each line gained
more leading whitespace than the last) — harmless everywhere except inside
`plan.ts`'s multi-line prompt template literals, where the extra whitespace
became literal characters in the actual text sent to the LLM planner. Fixed
by rewriting those files from clean source. v39's second pass then cut
`query/plan.ts` off mid-paste, mid-sentence, missing the entire
`validatePlanDetailed` switch statement including the whole `net_worth`
case — a real functional bug, not cosmetic. v40's third pass has been
verified byte-for-byte against the repo (every deployed file matches
exactly, modulo a harmless trailing newline) via `mcp__Supabase__get_edge_function`.

**Live end-to-end verification is still blocked, and deliberately left
that way.** A real Telegram message sent right after the v40 deploy got no
reply. `intake_logs` had no new rows, and Supabase's own `function_logs`
showed why: `loadHouseholdContext`'s `settings` query failed with
`PGRST303: "JWT issued at future"` — the exact same service-role-key
freshness failure documented in "Deploy — 14–16 Aug 2026" below, where the
fix was Shrey re-pasting a fresh `service_role` key from Project Settings →
API into the `SERVICE_ROLE_KEY` custom secret. `accounts`/`categories`
succeeded in the same request while `settings` alone 401'd, consistent with
a key sitting right at its freshness boundary rather than being wholesale
invalid. **Not a code bug in #54/#55 — the failure is entirely inside
`_shared/store.ts`'s `loadHouseholdContext`, before the router or query
code is ever reached.** Explicitly deferred: don't re-attempt live
Telegram verification of #54/#55 until the rest of the currently-pending
backlog is built, per Shrey's instruction 19 Aug. When it's picked back up,
the sequence is: refresh `SERVICE_ROLE_KEY`, send a real budget/net-worth
question, confirm a reply, then move both tasks from Review to Done.

**Taskiv #56, #57 and #58 followed the same session** (bot queries:
goal/debt progress, upcoming bills, portfolio summary + needs-review
count) — same status as #54/#55: done in code, pushed, held in Review, not
yet deployed or live-verified, pending the same `SERVICE_ROLE_KEY` refresh
above. 544 `npm test` by the end of #58 (was 440 at the start of this run).

**Taskiv #60 (generic propose-then-tap plumbing) is also done in code and
pushed, held in Review.** Migration `037_pending_actions.sql` applied live
to `our-rokda` — `pending_actions` (kind/payload jsonb, chat_id,
requested_by, expires_at defaulting to 1 hour, resolved_at/resolution) plus
its `pending_actions_open_idx`. New `telegram-intake/actions/pending.ts`
owns propose/expire/idempotent-resolve/allowlist for any bot write that
isn't a transaction — transactions keep write-then-flag, everything else
proposes first, per the design rule the task restates. Idempotency is a
PostgREST `PATCH ... WHERE resolved_at is null`, not a lock: a redelivered
callback finds nothing left to claim. Wired into `intake.ts`'s
`handleCallback` as a sibling of the existing `confirm:`/`fix:` and
`cashback_apply:`/`cashback_cancel:` branches, which are untouched.
**No action `kind` has a registered handler yet** — `IntakeDeps.pendingActionHandlers`
starts as `{}` in `index.ts`, so tapping Apply on a real proposal can't
happen in production today because nothing calls `proposeAction` yet
either; an unregistered kind throws loudly rather than a silent no-op,
since the row is already claimed as applied by the time that check runs.
Taskiv #63–67 (goal contribution, balance update, income log, category
rule) register real handlers against this same table next. 555 `npm test`
(was 544), lint and build clean, demo unaffected; `test:db` not runnable
in-session (no local Postgres) — the migration was verified applied
cleanly against the live database directly instead.

## Deploy — 14–16 Aug 2026

Migration `034_transfer_direction_null_safe` applied to `our-rokda` (found by
the new `npm run test:db` suite — 025's transfer-direction CHECK let a NULL
direction through via Postgres's NULL-is-satisfied CHECK semantics; verified
live, both that zero rows were affected and that the bad case is now
rejected). All four Edge Functions redeployed carrying that fix plus the
`_shared/serviceKey.ts` consolidation (Taskiv #100): `telegram-intake` v33,
`refresh-prices` v10, `refresh-fx` v9, `backup` v7. `verify_jwt` unchanged per
function (`telegram-intake` false, the other three true).

**Verified live end to end, 16 Aug.** A real Telegram message ("9.19 Carrefour
snacks") round-tripped through the full pipeline: logged with `needs_review`,
Confirm tap cleared it, row landed correctly (`transactions.id
0f6fbe5a-46b4-4f66-bac2-b1ee5f719f1a`). One real bug surfaced and was fixed in
the process: the `SERVICE_ROLE_KEY` custom secret's stored value had gone
stale — the first test after deploy still failed with the old `PGRST303:
"JWT issued at future"`. Shrey re-pasted a fresh copy from Project Settings →
API and the retry succeeded. **`SUPABASE_SECRET_KEYS` is confirmed absent**
from this project's secrets (only `TELEGRAM_BOT_TOKEN`, `OPENROUTER_API_KEY`,
`OPENROUTER_MODEL`, `TELEGRAM_WEBHOOK_SECRET`, `SERVICE_ROLE_KEY` exist) — so
`resolveServiceKey`'s `SUPABASE_SECRET_KEYS` branch is still genuinely
unexercised. Harmless (falls through cleanly when absent, which is what
happened), but if this project ever actually migrates to JWT Signing Keys,
recheck `SERVICE_ROLE_CANDIDATE_KEYS` in `serviceKey.ts` against whatever
`SUPABASE_SECRET_KEYS` turns out to look like then — nothing has verified
those candidate names against a real value.

**`claude/money-v4-post-qac-s2rnm9` merged into `main` 16 Aug** (clean
fast-forward, `main` was not ahead — no merge commit). Production and `main`
are back in sync; the "branch ahead of production" drift this deploy created
is resolved. Taskiv #100 and #101 are both Done.

## Deploy — 17 Aug 2026

Three real bugs found and fixed, then a large real-data pass, all deployed to
production (`main` at `e9cdba4`, fast-forward, no drift).

**Bugs fixed:**
- **Budget screen layout was broken** (`8e5d5f5`, `f52321b`): stray `order`
  classes put the category table into the sidebar's 280px column instead of
  the flexible one, clipping Planned/Actual/Remaining off the right edge and
  collapsing the category-name column to zero width. Removed the `order`
  classes and widened Budget to `max-w-6xl` to match every other data-dense
  screen (it was the only one at `5xl`).
- **`PrefsContext` loaded FX rates before the auth gate** (`4da8392`): it sits
  above `<Gate />` in `App.jsx`, so its one-time effect ran pre-login, the
  RLS-protected `settings` read threw, and the rates stayed at the AED-only
  starting value for the rest of the session — every non-AED figure on
  Investments, Reports and Transactions rendered as `—` for good, only fixable
  by manually hitting Refresh FX in Settings. Now gated on the signed-in
  user's id.
- **`cardSummary`'s cycle spend counted `Transfer` rows** (bundled into the
  card-detail work below): a card used to pay off another of the household's
  own bills inflated its own "spend" number. Fixed with a regression test.

**Real bank/card data entered — all reconciled to the penny against source
statements or the live banking apps, per the money-data rule.** Five accounts
went from placeholder/nonexistent to real:

| Account | Balance (17 Aug) | Source |
|---|---|---|
| FAB Current …9002 | 1,708.40 | Shrey, live app figure |
| Wio Current …0318 | 4,135.21 | Shrey, live app figure |
| FAB Etihad CC …0570 | 651.52 | 5 statements (Apr–Aug) + live app activity |
| ENBD Noon CC …1657 | 5,487.56 | 5 statements (Mar–Jul) + live app activity |
| Wio Credit Card …6981 | 2,590.20 | 5 statements (Mar–Aug) + live app activity |

Plus two loan accounts split out of card balances so they're visible as their
own liabilities rather than blended into a card's headline number:
`QC 12M @ 0% Instalment (FAB Etihad CC ...0570)` (15,619.97) and confirmation
that the two pre-existing `ENBD Noon CC ...1657` EMI loan rows (Car
Down-Payment 8,333.24, Mobile 1,208.52) were already correct — cross-checked
against the statements' own installment tables to the cent, which also
resolved what looked like a duplicate line item in the ENBD statements: there
really are **two** identical AED 10,000/24-month Arabian Automobiles
instalment plans running concurrently, not a PDF rendering artifact.

**Migration `035_statement_cycle.sql`** applied (statement_day/due_day/
credit_limit on `accounts`) — see the reconciled ledger note in
`docs/telegram-bot-sprint-plan.md` §4b.

**The "Example" AED 10,000 placeholder cash account is gone.** It wasn't
empty when checked — two real AED 9.99 Telegram-bot transactions (10 Aug, no
merchant name, still uncategorised) had drifted onto it, reassigned to Wio
Current before deleting. Worth a look: nobody knows yet what that 9.99 charge
actually was.

**New: a card tracking view** (`0fc1b86`, `25bf9ec`, `e9cdba4`). Click a card
on Accounts for balance/limit/utilisation, spend-by-category for the open
cycle, a 6-cycle trend bar chart, and inline category editing on flagged
transactions. No forecast/projection number — that was built once, then
explicitly removed same-day: "forecast" turned out to mean the plain running
total (already shown as "Logged this cycle"), not a blended/historical
projection. Don't re-add projection logic without being asked again.

**~35 transactions still carry `needs_review = true`** across the three
cards — ambiguous merchants (`Paymob**Al WATHBA`, `Dubai Digital Authority`,
`Millennium Place Barsha`, `Al Kabayel Trading`, the two AED 9.99 rows) that
need a human eye, not a guess. Query: `select * from transactions where
needs_review = true and deleted_at is null`.

**Two bank-level transfers ended up flagged with the destination unclear**
even after entry: FAB's `UADDS Cr Trf -2,193.00` (3 Aug) and `To Shreyash
Chawhan -45.32` (11 Aug) — recorded as `Transfer` category, but where the
money actually went isn't known. Ask Shrey.

## New open items — 17 Aug 2026

- **~35 flagged transactions need review** (see above) — the household's own
  task, not an agent's; categorising `Paymob**Al WATHBA` (AED 3,160.50) or
  deciding what "Urban" (AED 238) actually was needs Shrey or Tarika's memory.
- **Two bank transfers with an unclear destination**: FAB's `UADDS Cr Trf`
  (AED 2,193, 3 Aug) and `To Shreyash Chawhan` (AED 45.32, 11 Aug). Neither
  matches a tracked account.
- **Still no real sign-in.** The URL was handed to Shrey this session; whether
  he's actually logged in yet is unconfirmed. Don't assume it happened without
  him saying so.
- **FAB debit card …3585 has no account of its own** — deliberate, it draws
  from FAB Current …9002, which now exists. Revisit only if Shrey wants it
  tracked separately.

## Open items (as of 16 Aug 2026, verified against the live DB and deploy)

Everything below is still genuinely open. Two items that lived in this list for
weeks — the webhook secret failing open, and `telegram-intake` running stale
code — are **resolved**: `gate.ts`'s fail-closed 503 and the `serviceKey.ts`
consolidation are both live and proven end to end (see "Deploy — 14–16 Aug
2026" above). Don't re-open either without new evidence; the last "still
broken" claim about them was itself stale by several versions.

- **BTC is not tracked, and Shrey confirmed 16 Aug he no longer holds it** —
  he sold it. There was never an `accounts` row for it (confirmed live: zero
  matches for `ticker ilike '%btc%' or name ilike '%btc%'`), so there was
  nothing to delete. No action needed unless he re-enters crypto later.
- **Encrypted nightly backups are built and deployed, not enabled** (Taskiv
  #102). Needs Shrey to set `BACKUP_PASSPHRASE` and `BACKUP_CHAT_ID` in the
  Supabase dashboard himself — deliberately not something an agent should
  generate or hold. Once those exist, installing `pg_cron`/`pg_net` and
  writing the cron schedule needs no secrets and can be done via the Supabase
  MCP. See `supabase/functions/backup/README.md`.
- **`pg_cron` and `pg_net` are available but not installed** on `our-rokda`
  (re-verified 14 Aug via `list_extensions`). Bundled with the #102 backup
  work above, not a standalone task.
- **Supabase Auth: leaked-password protection is disabled** (security
  advisor WARN). Dashboard-only toggle (Authentication → Policies) — no tool
  in the Supabase MCP reaches Auth config. (Taskiv #23)
- **Neither Shrey nor Tarika has signed into the app since RLS went live.**
  The membership policies are proven by SQL-role probes and now by one real
  bot round-trip, but a real browser sign-in for each of them is the only
  thing that proves the *app's* auth flow, not just the predicate.
- **Two tickers remain unproven against Yahoo specifically**: `SKHY` (an ADR)
  and any future NSE symbol. Watch `refresh-prices`'s `failed` array.
- **FIRE assumptions in Settings are dead.** `fire_swr`/`fire_return` are set,
  `fire_expense` is null, and nothing in `src/` reads any `fire_*` key — no
  screen calculates or shows a FIRE number. Deliberately not built (Shrey
  hasn't given a real monthly-expense figure yet). (Taskiv #21)
- **Bot-expansion Sprint 1 foundations are now all 6 of 6 done** (as of 17 Aug
  — #48 and #49, the last two, shipped this session). Of Sprint 2, **#51, #52
  and #50 are also done this session**; only **#53 (router fixture corpus +
  `/help` rewrite)** is left. The query toolbox is now actually reachable
  from a live chat message — **#50 wired it in**, see below — though nothing
  from this session (#49's guard or #50's router) has been deployed yet;
  `telegram-intake` in production is still whatever `main` last had.
  - **#50 — `telegram-intake/route.ts` (the intent router) wired into
    `intake.ts`'s `handleMessage`.** Every plain typed message that survives
    the existing cashback/transfer/bulk pre-checks is now classified
    `spend | question | action | chatter` before extraction — `question`
    answers via the #51/#52 toolbox and never writes a row, `chatter` gets
    silence (no reply, no row — "a bot that answers 'ok' is a bot people stop
    using"), `action` has no handler yet (Sprint 2/3's propose-then-tap work)
    so it deliberately falls through to spend. Every failure mode — regex
    near-miss, malformed classifier JSON, a thrown model call, confidence
    below 0.6 — resolves to spend, never silence, per the task's one rule: a
    misrouted spend is a lost spend. Photo/voice and captions never reach
    the router at all (unchanged code path), so "a receipt is always a
    receipt" holds structurally, not just by convention.
    Two extractions made along the way, both to protect existing behaviour
    rather than change it: `matchAccount`/`matchAccountTies` moved out of
    `intake.ts` into `accountMatch.ts`, and `formatAmount`/`formatDate` into
    `format.ts` — `intake.ts` now imports `query/run.ts` and `query/reply.ts`
    for the router, and both of those already needed those functions, so
    leaving them in `intake.ts` would have created a circular import.
    `IntakeDeps` gained `queryStore` and a **separate** `classifierModel`
    field — reusing `model` for both extraction and classification would
    have desynced every existing test's `FakeModel` response queue with an
    extra call in front of it; in production both fields point at the same
    real `OpenRouterClient` instance, so this costs nothing live. All 84
    pre-existing `intake.test.ts` cases pass with **zero assertion changes**
    (only the shared `harness()` fixture gained the two new deps), plus 9 new
    end-to-end routing cases and `route.test.ts`'s 19 unit cases (regex fast
    path + classifier + fallback). `npm run demo:telegram` output is
    byte-identical to before. Full suite: 407 `npm test`, 41 `test:db`, lint
    and build clean.
  - **#51 — `telegram-intake/query/{types,period,plan,run}.ts`.** `types.ts`
    is the closed `QueryPlan`/`Period` vocabulary (5 queries: category/total/
    merchant/account spend + recent transactions — Sprint 3 adds budget/net
    worth/goals/bills/portfolio, not built here) plus the `QueryStore`
    interface #52 implements. `period.ts`'s `resolvePeriod` turns any `Period`
    into concrete from/to dates and a human label ("1–17 Aug", "Jul", "last 7
    days") using `todayInTz`, never a raw `toISOString()` slice; weeks start
    **Monday** — no existing app screen groups by week to match, so this is a
    new convention, not an inherited one. `plan.ts`'s `planQuery` is the only
    place a model response is trusted at all, and even there every field is
    validated against the household's real category/account/people lists in
    code before use — an unknown category, account, owner, or `q` outside the
    5-entry enum all return `null` (the honest-refusal path, not an error).
  - **#52 — `query/store.ts` (real `PostgrestQueryStore` against
    `v_transactions_aed`), `query/reply.ts` (templated replies), `run.ts`
    filled in.** One correction made mid-build: the original #51 draft had
    `account_spend`'s account name exact-matched against the household's list
    *inside the planner*, but #52's own spec calls for resolving it with the
    same `matchAccount()` scorer a receipt's `paid_with` already goes
    through — so `plan.ts` was revised to treat `account` as free text (like
    `merchant`), and `run.ts` now does the real resolution, including the tie
    case (`matchAccountTies` → "Which account did you mean — X or Y?" instead
    of guessing). `total_spend` excludes `Savings & Investments` from the sum
    and reports the excluded amount in a footer, only when non-zero. All
    filtering goes through `URLSearchParams` against `v_transactions_aed` —
    no string-built SQL. `formatAmount`/`formatDate` exported from
    `intake.ts` for reuse rather than re-implemented. 64 new tests total
    across #51+#52 (16 period, 22 planner, 13 executor, 15 reply templates),
    all passing, plus the existing 312 + 41 db-test suites untouched. Not yet
    reachable from a live chat message — that's #50's job.
  - **#48 — `036_money_view.sql`, applied to `our-rokda`.** `v_transactions_aed`
    joins `accounts` and bakes in `deleted_at is null`. Per the correction
    logged on the task (the spec's `coalesce(rate, 1)` skeleton was wrong —
    would have reintroduced the 1:1-AED-fallback bug `src/lib/money.js`
    deliberately removed), `amount_aed` is `NULL`, not defaulted, for a
    currency `settings.fx_rates` has no rate for. Verified live: 432 AED rows
    and 1 USD row all convert, zero unconverted. One sharp edge worth
    remembering before Sprint 2/3/5/6 queries get written: Postgres's `sum()`
    silently skips `NULL` rather than propagating it the way client-side NaN
    does — a query must separately check `count(*) filter (where amount_aed
    is null)` or it will report a plausible, silently-too-low total. 7 new
    `test:db` cases cover this (`money_view.test.mjs`).
  - **#49 — outbound chat-id allowlist**, in `_shared/guardedMessenger.ts`
    (`GuardedMessenger`) and wired into `intake.ts`'s `handleMessage`/
    `handleCallback`. Every reply after the household allowlist check is
    guarded against a forged `chat.id`; `/id` alone still bypasses it (must
    work in an unrecognised chat during setup — see the file's own comment
    for why that's not itself a hole). 9 new tests (6 unit in
    `guardedMessenger.test.ts`, 3 integration in `intake.test.ts` covering the
    forged-chat, normal-group and `/id`-in-unknown-chat cases from the task's
    acceptance criteria). All 312 `npm test` cases and all 41 `test:db` cases
    pass.

Resolved since the last pass — **Taskiv #44 is fixed**: `intake.ts` now resolves
"today" via `_shared/dates.ts`'s `todayInTz` (Asia/Dubai via `Intl.DateTimeFormat`,
not a UTC string slice). **Bot-expansion Sprint 1 foundations are also in**:
`015_bot_expansion.sql` is applied to `our-rokda` — `transactions.deleted_at` for
soft-delete-based `/undo`, and a `notifications` table with a unique `dedupe_key`
so the future hourly push cron is idempotent (verified live: a duplicate
`dedupe_key` insert throws `23505`). `store.ts`/`telegram.ts`/`types.ts` moved to
`supabase/functions/_shared/` so `telegram-push` can reuse them without depending
on `telegram-intake`'s config. `src/lib/transactions.js` reads now filter out
soft-deleted rows.

**The Telegram pipeline now logs itself.** `016_intake_logs.sql` is applied —
every inbound attempt (text/photo/voice/correction/callback) and every outbound
reply writes a row to `intake_logs`: who sent or received it, which pipeline
stage, the model and token counts when one was called, success/failure, the
error if any, and latency in `duration_ms`. See "Observability" in
`supabase/functions/telegram-intake/README.md` for the query patterns. Used
live 16 Aug to diagnose the stale-`SERVICE_ROLE_KEY` failure (see "Deploy —
14–16 Aug 2026" above) — `select * from intake_logs where success = false`
is where to look first whenever intake goes quiet.

**task #6 is done**. Real data is in production:
41 investment holdings (25 Zerodha India equities, 8 Shrey US/gold, 8 Tarika
US/metals), 4 liability accounts (ENBD car loan, 2 ENBD Noon CC EMIs, FAB 0%
cash advance), all recurring bills and salaries, 12 budget limits and 6 goals.
Every portfolio reconciles to its source statement. The 3 pay-down goals are
seeded (`012_seed_paydown_goals.sql`) and now linked to real liability accounts.

**Money data comes from broker screenshots, never from a web price lookup or a
verbally-quoted figure.** Both alternatives were tried this session and both
introduced real error — web prices were ~$600 out across two tickers, and two
separately-typed average prices were wrong. Neither would have surfaced as a
visible bug; they would just have made net worth quietly incorrect.

## Branches

`main` is the trunk and holds Epics 1–7 plus the Monarch-parity backlog
(#20, #25–33). Netlify's production branch points at `main` and deploys on
push — confirmed via the live deploy record matching `main`'s HEAD commit.
Put `[skip netlify]` in the commit message for docs-only changes so they
don't burn a production build.

## Supabase

Project `our-rokda` (`wrxqgfbolryveivgdjia`).

- Schema lives in `supabase/schema/NNN_*.sql`, applied in order. Additive-only,
  never destructive — this database carries real money data.
- `001`–`007` were run by hand in the SQL Editor so they don't appear in
  `supabase migration list`; `008`+ do.
- The `telegram-intake` Edge Function is deployed straight from
  `supabase/functions/telegram-intake/`. Keep the deployed copy in sync with the
  repo — after deploying, diff the two.
- `refresh-prices` is the second Edge Function: manually triggered from the
  Investments view, fetches US stock/ETF prices from Yahoo's unofficial chart
  endpoint and BTC from CoinGecko (both keyless), and writes `last_price`/
  `value` back. It only touches accounts with `type='investment'`,
  `currency='USD'` and a non-null `ticker` + `quantity`; metals and the India
  equities are excluded by having no ticker, on purpose. Because it is called
  **from a browser** it must answer the CORS preflight — the OPTIONS handler is
  load-bearing, unlike in `telegram-intake`.

## Tests

```bash
npm test              # 278 tests: Edge Functions + src/, node --test, no network, no keys
npm run test:db       # 32 tests: supabase/schema/*.sql applied from empty against real Postgres
npm run lint          # oxlint — 0 errors, 6 warnings
npm run build         # vite
npm run demo:telegram # walks the Telegram flow against mocked payloads
```

`.github/workflows/ci.yml` runs two jobs on every push: `check` (`npm ci`,
lint, `npm test`, build, advisory audit) and `db-integration` (`npm run
test:db` against a `postgres:16` service container). See
`supabase/db-test/README.md` for what the second one stands in for and what
it deliberately doesn't.

**What `npm test`'s fakes do not cover, and `test:db` now does:** RPCs
(`replace_category_split`, `create_transfer`, `create_bulk_transactions`,
`apply_pending_income`, `claim_media_group`, `save_telegram_settings`)
against the real schema, the RLS matrix (anon / non-member / member), the
zero-amount and transfer-direction constraints, and — the point of the whole
exercise — `supabase/schema/*.sql` applied in order from an empty database,
which had never been tested before Taskiv #101. Building it surfaced one more
real gap the same shape as the three below: `transactions_transfer_direction_valid`
(025) used `transfer_direction in ('out','in')`, and Postgres CHECK
constraints treat a NULL result as satisfied — so a transfer row with a null
direction passed a constraint written to block exactly that. Fixed in `034`.
Nothing in the app had ever hit it; `create_transfer` always sets both sides
explicitly.

**Still not covered:** browser rendering, Auth from a real client (a signed-in
session, not just the RLS predicate), and the external APIs (Yahoo, CoinGecko,
Telegram). Those still need a person.

One rule learned three times this round: **pure logic must not live in a module
that imports the Supabase client**, because Node cannot load it and it silently
becomes untestable. That is how `toAED`, the transaction grouping and the
recurring schedule rules all went untested while carrying bugs. Data access in
one module, rules in another.

## Telegram bot expansion (designed 10 Aug 2026, not yet built)

Three design docs, all binding on the implementation:

- `docs/telegram-bot-expansion.md` — architecture: the intent router, the query
  toolbox, propose-then-tap writes, the push function.
- `docs/telegram-bot-sprint-plan.md` — feature-by-feature feasibility against the
  live schema, cost analysis, the four settled decisions (§6), and the migration
  numbering ledger (§4b). **The ledger was reconciled 16 Aug** — all four of its
  original 016–019 slots had been taken by other work. `035_statement_cycle` is
  now applied (it jumped its sprint because the Accounts screen needed the card
  limit fields), leaving `036_money_view`, `037_pending_actions` and
  `038_push_cron`. Always take the next free number in `supabase/schema/`, never
  a reserved one — reserving slots for unbuilt work is what made this ledger
  stale in the first place.
- `docs/telegram-bot-round2-design.md` — six gaps the household's first real
  usage session surfaced in the *existing* receipt-intake path (duplicates,
  bulk input, transfers, cashback, itemized summaries, multi-photo albums).
  Two other issues from that same session (PDF handling, ambiguous account
  matches) turned out to be same-day bug fixes, not design work — already
  shipped as `telegram-intake` v15.

Backlog is in Taskiv as epics 8–13, tasks **#44–79**. Four rules from that design
that are easy to violate later and expensive to undo:

1. **The model never writes SQL and never does arithmetic.** It picks one entry
   from a closed query enum; Postgres computes every digit. The function holds
   the service-role key, so text-to-SQL here has an unbounded blast radius.
2. **The router defaults to "spend" on any doubt.** A misrouted question costs an
   `/undo`; a misrouted spend is money that never enters the ledger.
3. **Transactions keep write-then-flag; every other write is propose-then-tap.**
   The "never lose a spend" rule justifies optimistic writes only for
   transactions — nobody forgets moving 2,000 AED into a goal, and a bad
   `accounts.value` write corrupts `nw_daily` permanently.
4. **The bot never writes `quantity`/`avg_cost`/`last_price`.** A typed stock buy
   logs a cash outflow only; holdings stay screenshot-sourced. See the money-data
   rule above — this is the same rule, applied to chat.

Push alerts need no model call at all: SQL computes the number, a template writes
the sentence. Whole expansion costs under $0.50/month in API spend; the binding
constraint is alert volume, because the bot pushes into the same chat intake uses
and **a muted bot is a broken intake pipeline.**

## Telegram intake

Setup, troubleshooting and the receipt-tuning pass are documented in
`supabase/functions/telegram-intake/README.md`. Two things that cost hours once:

- Group privacy must be **off in BotFather**, and the bot must be **removed and
  re-added** to any group it had already joined — the setting doesn't apply
  retroactively, and the symptom is that `/commands` arrive but plain messages
  silently don't.
- HTTP header values are Latin-1 only. A single non-ASCII character (an em dash)
  in an outgoing header makes Deno throw while constructing the request, so the
  call never leaves the function and the upstream API records nothing.
