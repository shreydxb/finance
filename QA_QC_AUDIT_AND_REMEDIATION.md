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
| "Zero transactions logged in production, ever" | **63 active transactions** — 41 Telegram, 21 manual, dated 18 May – 10 Aug |
| "`refresh-prices` has never completed a successful run" | **HTTP 200 on 11 Aug**; `refresh-fx` 200 on 12 Aug and FX rates written |
| "Receipt-photo accuracy is unproven, no real photo through the pipeline" | **8 real photo extractions: 4 succeeded, 4 failed (50% failure rate)** |

This raises SEC-01's severity: the fail-open webhook guards 63 real financial
rows in a live group chat, not an empty table.

### Live database facts

- Schema: repo migrations `008`–`022` are **all applied**; `001`–`007` manual, as documented. **No repo/live schema drift.**
- 46 accounts — **25 INR, 16 USD, 5 AED**. Mixed currency is the norm, not an edge case.
- 63 transactions (62 AED, 1 USD); 0 soft-deleted; 3 zero-amount; 9 `needs_review`; **39 never reviewed**.
- 3 `split_group_id` groups total: 2 real category splits, 1 transfer (2 rows, 1,000 AED).
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
- **Netlify entirely** — connector exposes no tools in this session. Only `netlify.toml` was read.

---

## Remediation register

| ID | Pri | Finding | Verified status |
|---|---|---|---|
| SEC-01 | P0 | Missing webhook secret fails open; body-supplied identity is forgeable | **Confirmed, severity raised** — ✅ **fixed in repo** |
| SEC-02 | P0 | Any authenticated user has full CRUD on all finance data | **Confirmed live** (19/19 policies) — ⛔ blocked on backup + Auth UUIDs |
| DATA-01 | P0 | `split_group_id` conflates split / transfer / bulk batch | **Confirmed, scope tiny** (3 groups) — pending |
| MONEY-01 | P0 | Duplicated, stale FX state; silent 1:1 fallback | **Confirmed, worse than audited** — partially addressed |
| DATA-02 | P0 | Multi-row writes not atomic or idempotent | Confirmed (code structure) — pending |
| SEC-03 | P1 | Function JWT config not versioned | **Partially disproven** — prod is correct; ✅ now pinned |
| MONEY-02 | P1 | Transfers inflate merchant + trend reports | **Confirmed, wider than audited** — ✅ **fixed in repo** |
| MONEY-03 | P1 | UTC dates wrong around Dubai midnight | Confirmed (4 sites) — pending |
| MONEY-04 | P1 | Raw mixed currencies compared/summed | Confirmed — pending |
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
| MONEY-01b | P0 | FX conversion duplicated across two modules with independent silent fallbacks (`settings.js:toAED`, `money.js:convert`) — partially addressed |
| BOT-02 | **P1** | **50% receipt-photo extraction failure rate** in real usage (4 of 8). Real telemetry; appears in no other document |
| DATA-05 | P2 | 3 zero-amount transactions live; no constraint prevents them |
| OPS-03 | P2 | 39 of 63 transactions never reviewed — reconciliation backlog |
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

### Gate results after WP1 + WP3 + WP7a

**162/162 tests pass** (139 pre-existing + 16 gate + 7 reports).
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
