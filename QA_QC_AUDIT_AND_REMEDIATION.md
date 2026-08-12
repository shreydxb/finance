# Our Money v4 — QA/QC Audit and Remediation

**Original audit:** 12 August 2026 (repository-only; no live connector available).
**Live validation pass:** 12 August 2026, against `our-rokda` (`wrxqgfbolryveivgdjia`)
via Supabase MCP, plus a full local build/test/lint/audit run.

This file is the tracked status record. The original audit's findings are preserved;
each now carries a **verified status** and the evidence behind it.

---

## Live validation corrected three load-bearing assumptions

The original audit inherited its production claims from `CLAUDE.md` and said so.
`CLAUDE.md` was materially stale. Verified against the live database:

| Claim in `CLAUDE.md` / audit | Live reality (12 Aug 2026) |
|---|---|
| "Zero transactions logged in production, ever" | **13 real transactions**, all Telegram-sourced, 11 Jul – 10 Aug (plus 50 `[TEST]` fixtures, since deleted) |
| "`refresh-prices` has never completed a successful run" | **HTTP 200 on 11 Aug**; `refresh-fx` 200 on 12 Aug and FX rates written |
| "Receipt-photo accuracy is unproven, no real photo through the pipeline" | **8 real photo extractions: 4 succeeded, 4 failed** — and neither failure cause was accuracy (BOT-02) |

This raises SEC-01's severity: the fail-open webhook guards real financial rows
in a live group chat, not an empty table.

### Live database facts

Counts below are **post-cleanup** (see `docs/data-ops/2026-08-12-test-data-cleanup.md`).
The first pass of this audit read 63 transactions; 50 of those were `[TEST]`
fixtures and are gone.

- Schema: repo migrations `008`–`022` are **all applied**; `001`–`007` manual, as documented. **No repo/live schema drift.**
- 46 accounts — **25 INR, 16 USD, 5 AED**. Mixed currency is the norm, not an edge case.
- **13 transactions**; 3 zero-amount; 3 uncategorised; 4 `needs_review`; **none ever reviewed**. Real spend total **2,717.57 AED**.
- **0 `split_group_id` groups.** All 3 belonged to the fixture set, so no real category split or transfer has ever been recorded — DATA-01 has nothing to backfill.
- **0** duplicate budgets, **0** orphaned category names, **0** account type/liability contradictions, **0** malformed investment rows.
- All 19 RLS policies are `using(true) with check(true)` for role `authenticated`.
- Edge Functions: `telegram-intake` v22 (`verify_jwt: false`), `refresh-prices` v2 and `refresh-fx` v1 (both `verify_jwt: true`).
- Deployed `telegram-intake` source vs repo: identical apart from 4 comment-width lines.
- Security advisor: one WARN — leaked-password protection disabled.

### Baseline gates (local, this machine)

`npm ci` succeeded — the original audit's `SELF_SIGNED_CERT_IN_CHAIN` was its own
machine, not the project. **139/139 Edge tests passed, `npm run build` succeeded,
`oxlint` reported 0 errors / 9 warnings, `npm audit --omit=dev` found 0 vulnerabilities.**

### Not verifiable in this session

- **`TELEGRAM_WEBHOOK_SECRET` / `DEMO_MODE` presence** — no secrets-listing tool; last Telegram traffic (10 Aug) is outside the 24h log window. SEC-01's live status is genuinely unknown. The code path is fail-open regardless, so the fix stands either way.
- **Auth configuration** — signup status, providers, user list, MFA, redirect URLs.
- **Backups / PITR** — no tool. **This gates SEC-02.**
- **Netlify**: project is `apna-rokda` (team `nf_team_dev`), production serves `main--apna-rokda.netlify.app`, current deploy `ready`. Build settings and env-var names were not enumerated.

---

## Remediation register

| ID | Pri | Finding | Verified status |
|---|---|---|---|
| SEC-01 | P0 | Missing webhook secret fails open; body-supplied identity is forgeable | **Confirmed, severity raised** — ✅ **fixed in repo** |
| SEC-02 | P0 | Any authenticated user has full CRUD on all finance data | **Confirmed live** (19/19 policies) — ⛔ blocked on backup + Auth UUIDs |
| DATA-01 | P0 | `split_group_id` conflates split / transfer / bulk batch | **Confirmed in code; zero live rows to migrate** — pending |
| MONEY-01 | P0 | Duplicated, stale FX state; silent 1:1 fallback | **Confirmed, worse than audited** — ✅ **fixed in repo** |
| DATA-02 | P0 | Multi-row writes not atomic or idempotent | Confirmed (code structure) — pending |
| SEC-03 | P1 | Function JWT config not versioned | **Partially disproven** — prod is correct; ✅ now pinned |
| MONEY-02 | P1 | Transfers inflate merchant + trend reports | **Confirmed, wider than audited** — ✅ **fixed in repo** |
| MONEY-03 | P1 | UTC dates wrong around Dubai midnight | **Confirmed (4 sites)** — ✅ **fixed in repo** |
| MONEY-04 | P1 | Raw mixed currencies compared/summed | **Confirmed; latent, not live** — ✅ **fixed in repo** |
| DATA-03 | P1 | Free-text categories; duplicate budgets possible | **Partially disproven** — 0 live violations; preventive only |
| BOT-01 | P1 | Telegram concurrency/idempotency gaps | Confirmed — pending |
| UI-01 | P1 | Investment delete no-op; zero-cost crash | **Confirmed**, crash latent (0 live rows with `avg_cost=0`) — pending |
| UI-02 | P1 | Bills include income; calendar ignores `end_date` | Confirmed — pending |
| UI-03 | P1 | Telegram settings UI/backend mismatch | Confirmed — pending |
| INT-01 | P1 | Realtime published but never subscribed | **Confirmed** — zero `.channel(` calls in `src/` |
| OPS-01 | P1 | Migration/doc drift | **Confirmed — docs only**; repo and live schema agree |
| TEST-01 | P1 | No frontend/DB/E2E/CI gates | Confirmed — partially addressed |

### Findings added by the live pass (not in the original audit)

| ID | Pri | Finding |
|---|---|---|
| MONEY-02b | P1 | `sumByOwnerAED` also lacked the transfer guard — ✅ fixed |
| MONEY-01b | P0 | FX conversion duplicated across two modules with independent silent fallbacks (`settings.js:toAED`, `money.js:convert`) — ✅ fixed |
| BOT-02 | **P1** | **50% receipt-photo extraction failure rate** in real usage (4 of 8). Root-caused — ✅ **fixed in repo** |
| DATA-05 | P2 | 3 of 13 real transactions have `amount = 0`; no constraint prevents them |
| OPS-03 | P2 | None of the 13 real transactions has ever been marked reviewed |
| OPS-04 | P2 | `netlify.toml` sets no security headers (no CSP, HSTS, `X-Frame-Options`) |

---

## Work package status

### ✅ WP1 — SEC-01: fail-closed Telegram webhook

**Changed:** `supabase/functions/telegram-intake/gate.ts` (new),
`gate.test.ts` (new, 16 tests), `index.ts` (wired).

- Authorization extracted from the `Deno.serve` closure into a pure function — it was previously untestable, which is why the fail-open path had no coverage.
- **Fails closed:** an unset `TELEGRAM_WEBHOOK_SECRET` now returns **503** and processes nothing. Previously it logged a warning and continued.
- **Demo bypass removed.** `x-demo-mode` no longer bypasses authentication; it only selects the recording messenger, and only after the secret is verified. Verified safe: `npm run demo:telegram` drives `handleUpdate` in-process with fakes and never crosses this gate, so nothing legitimate depended on the bypass.
- Constant-time secret comparison (the old `!==` leaked length and a prefix oracle).
- 1 MiB body cap, checked *after* the secret so an unauthenticated caller learns nothing.
- **Ordering guarantee:** the gate runs before `request.json()` and before any `PostgrestStore`/`TelegramClient` is constructed — a rejected request costs zero DB and zero API calls.

**Rollback:** revert the three files; no migration, no production state touched.

**Still required to close (needs approval):** set `TELEGRAM_WEBHOOK_SECRET` in Supabase
and re-run `setWebhook` with the identical value in one sitting, confirm `DEMO_MODE`
is absent/false, deploy, then run the live negative test.

### ✅ WP3 — SEC-03: version-controlled function auth

**Changed:** `supabase/config.toml` (new).

Pins `verify_jwt` for all three functions to the values verified in production
(`telegram-intake` false; `refresh-prices`/`refresh-fx` true). Production was
already correct — the gap was that nothing pinned it, so an accidental
`--no-verify-jwt` on a later deploy would go unnoticed.

**Rollback:** delete the file.

### ✅ WP7a — MONEY-02: canonical spend predicate

**Changed:** `src/lib/reports.js`, `src/lib/reports.test.js` (new, 7 tests),
`src/lib/money.js`, `src/lib/settings.js`, `package.json`, and 8 import sites.

- Introduced `isSpend()` / `spendOnly()` as the single predicate deciding whether a row counts as household spending. The transfer check was previously inlined per function, which is exactly how three functions came to omit it.
- Added the missing guard to `sumByMerchantAED`, `monthlyTrend`, **and `sumByOwnerAED`** (the last not identified by the original audit).
- Moved `toAED` from `settings.js` into `money.js`. `settings.js` imports the Supabase client and `import.meta.env`, so anything depending on it could not be loaded outside Vite — that is why none of these calculations had tests. Behaviour is preserved verbatim; the silent 1:1 fallback is deliberately left for MONEY-01 so this diff stays single-purpose.
- Added the first frontend test infrastructure (`src/**/*.test.js` in the `test` script).

**Live reconciliation (read-only):**

| Metric | Before fix | After fix | Delta |
|---|---|---|---|
| Total spend | 33,264.07 | **32,264.07** | −1,000.00 (−3.1%) |
| Shrey owner total | 28,607.57 | **27,607.57** | −1,000.00 |
| Tarika owner total | 4,656.50 | 4,656.50 | 0 |

The 1,000 AED is the live transfer's two rows. Merchant breakdown and spending
trends were overstated by the same amount. **No data was modified** — this is a
calculation fix; the reconciliation is a read-only confirmation of its effect.

**Rollback:** revert the listed files. No migration, no data change.

### ✅ WP8 — BOT-02: receipt-photo extraction failures

**Changed:** `supabase/functions/telegram-intake/extract.ts`, `extract.test.ts`
(3 tests), `CLAUDE.md`.

`intake_logs` root-causes all 4 real failures, and **neither cause was model
accuracy** — the framing recorded in `CLAUDE.md` and inherited by the audit:

| Failures | Cause | Status |
|---|---|---|
| 2 (10 Aug 15:59) | `Unsupported MIME type: application/octet-stream` — Telegram serves photos as generic binary | **Already fixed** in `f829ce9`, deployed |
| 2 (10 Aug 16:12) | Model cut off at the `max_tokens: 500` cap mid-array | **Fixed here** |

The second pair is the interesting one. A truncated response is *valid JSON that
stops mid-object*, so `parseJsonObject` reported `Model returned malformed JSON`.
That error names the symptom and hides the cause — the model had been correct up
to the byte it was cut off at. It is why the project notes say receipt accuracy
is unproven, and why this went unfixed for two days.

- `max_tokens` 500 → **2,000**. The pipeline asks for an *array* — one object per line item for itemized receipts (018) and bulk messages (round2 §2) — at roughly 60–80 tokens each, so 500 covered about six items. This is a ceiling, not a spend: tokens bill as generated.
- `finish_reason: 'length'` is now detected and raised as an explicit truncation error, so a future cap breach names itself instead of masquerading as a parse failure.

**Rollback:** revert the two files. No migration, no production state touched.

**Not verifiable locally:** that a real receipt now extracts end to end. That
needs a deploy and a live photo — the remaining acceptance criterion.

### ✅ WP9 — MONEY-01 / MONEY-03: fail-visible FX and Dubai dates

**Changed:** `src/lib/money.js`, `money.test.js` (new, 12 tests),
`src/lib/dates.js` (new), `dates.test.js` (new, 8 tests), `src/lib/snapshots.js`,
`src/lib/PrefsContext.jsx`, `src/screens/Settings.jsx`, and the three date-defaulting forms.

**The silent 1:1 fallback is gone.** `toAED`/`convert`/`fromAED` return `NaN`
when a rate is missing, zero, negative, non-finite or non-numeric — instead of
substituting 1, which rendered 100 USD as "AED 100": a wrong number
indistinguishable from a right one. NaN is contagious by design, so one unknown
rate invalidates the sum rather than quietly under-counting it.

`formatMoney` was the last place a missing rate could still become plausible:
`Number(x) || 0` turned NaN into a confident "AED 0". It now renders any
non-finite figure as `—`.

**Changing `toAED`'s contract was rejected as too risky** — 24 call sites, and
returning `null` would have propagated arithmetic errors into live totals. The
NaN-plus-formatter approach makes an unconvertible figure unrenderable without
touching a single call site.

**`nw_daily` is now protected.** It is keyed by day, upserted and never
backfilled, and the household holds 25 INR and 16 USD accounts — so an unloaded
rate would have written a permanent NaN. `recordDailyNetWorth` now refuses to
write when any account currency is unconvertible and returns
`{ skipped: true, reason: 'fx-unavailable', currencies }`. Skipping costs one
day of history; writing costs a corrupt chart with no way back.

**The stale second copy is fixed.** `PrefsContext` exposes `refreshFx()` and a
`fxLoaded` flag that distinguishes "not loaded yet" from "loaded, and USD
genuinely has no rate". Settings' FX refresh now updates both copies, so the app
no longer formats every screen with the rates it read at login.

**MONEY-03**: all four UTC date sites now use `todayLocal()` (`Asia/Dubai`, via
`Intl.DateTimeFormat` with `en-CA`) — the same fix `_shared/dates.ts` already
had server-side. Tested across the 20:00–23:59 UTC window, month end, year end,
and the no-DST property.

**Live safety check:** production `settings.fx_rates` holds AED, USD and INR,
refreshed 12 Aug 09:39 UTC. With all three present, behaviour is byte-identical
to before; the new path engages only where the old one would have shown a wrong
number.

**Rollback:** revert the listed files. No migration, no data change.

**MONEY-04 followed in WP10.**

### ✅ WP10 — MONEY-04: one FX snapshot, no raw-currency comparisons

**Changed:** `src/lib/reports.js`, `reports.test.js` (+8 tests),
`src/lib/useAccountsAndFx.js`, `src/screens/Reports.jsx`, `Budget.jsx`,
`Transactions.jsx`, `Goals.jsx`, `Debts.jsx`.

**Four independent FX copies collapsed into one.** `useAccountsAndFx`, Reports
and Budget each fetched `fx_rates` separately, then formatted the result with
`PrefsContext`'s copy — so a screen could compute an AED subtotal from one
snapshot and display it using another. All three now read `usePrefs().fxRates`.
Settings keeps its own copy deliberately: it displays the stored rates and
their timestamp, which is a different job. This is the half of MONEY-01 that
WP9 did not reach.

**Raw-currency comparisons removed:**

- `transactionStats` — `largest`/`average` were computed on stored amounts, so ₹1,000 outranked $100 despite being worth a twelfth as much, and the result was then formatted as AED. Now converted first, and both callers pass rates.
- **Sorting by amount** — Postgres orders by the raw column. Added `sortByAmountAED`, applied when the amount sort is active. Unconvertible rows sort last rather than being dropped; the input array is not mutated.
- **Goals** — `savedFor` returned a linked account's raw balance and compared it against an AED target. Now converted.
- **Debts** — `totalPrincipal`, `DebtCard` and `DebtDetail` all compared raw linked balances against an AED `starting_balance` and passed them to `fmt`, which assumes AED. All converted.

**Live status: latent, not live.** All six goals/debts currently link to AED
accounts, so no figure on screen was wrong today. It would have become wrong
the first time a goal linked to one of the 41 non-AED accounts — which is most
of them.

**Rollback:** revert the listed files. No migration, no data change.

### Gate results after WP1 + WP3 + WP7a + WP8 + WP9 + WP10

**190/190 tests pass** — 139 pre-existing plus 51 added across the gate, reports, extraction, money, dates and mixed-currency suites.
`npm run build` succeeds. `oxlint`: 0 errors, 9 warnings (unchanged from baseline).

---

## Remaining sequence

1. **SEC-02** — membership RLS + Auth hardening. ⛔ **Blocked**: needs a verified backup/restore path and both users' Auth UUIDs, or it can lock the household out of its own data.
2. **DATA-01** — explicit `group_kind`. Now a 3-row classification, not a bulk migration; recommend promoting it ahead of the heavier work.
3. **DATA-02 / BOT-01** — transactional, idempotent RPCs.
4. **MONEY-01** — one authenticated FX source, fail-visible on missing rates.
5. **MONEY-03 / 04** — Dubai dates (4 sites), mixed-currency normalisation.
6. **DATA-03** — category FKs, unique budgets. Safe: 0 live violations, no dedup needed.
7. **P1 UI / recurring / realtime / CI**, plus BOT-02 (photo failure rate).

## Production operations still requiring explicit approval

Migrations 023+; `household_members` and the RLS replacement; setting
`TELEGRAM_WEBHOOK_SECRET` + `setWebhook`; any Auth change; any Edge Function
deploy; any Netlify change; any push to `main`.

## Documentation corrections owed

`CLAUDE.md` open-items (3 of 5 obsolete), `supabase/schema/README.md` (stops at
011, says "all eleven"; repo has 022), `PLAN.md` (lists shipped tables as planned).
