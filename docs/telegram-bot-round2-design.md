# Telegram bot round 2 — design

Status: **design, nothing built** except where marked (✅ shipped). Written
10 Aug 2026, the day the household's first real messages went through the
bot. This document is a sibling to `docs/telegram-bot-expansion.md`, not a
replacement — that doc designs *ask/do/be told*; this one designs six gaps
that real usage surfaced in the *existing* receipt-intake path itself.

## Where this came from

The new `intake_logs` table (`016_intake_logs.sql`) made the first real
session fully replayable. Nine issues came back from it in one sitting:

| # | Report | Status |
| --- | --- | --- |
| 1 | Duplicate payments — add something, forget, add again | ✅ Shipped (§1), `telegram-intake` v19 |
| 2 | Bulk input — several spends in one message | ✅ Shipped (§2), `telegram-intake` v22 |
| 3 | Wrong/no account match, no way to pick | ✅ Fixed — tied accounts are now named in the review prompt (`0f547f3`) |
| 4 | Fund transfer between the household's own accounts | ✅ Shipped (§3), `telegram-intake` v21 |
| 5 | One purchase needs 2+ screenshots (first one cropped the price) | ✅ Shipped (§6) — album batching, `telegram-intake` v17 |
| 6 | Cashback | ✅ Shipped (§4), `telegram-intake` v20 |
| 7 | 3 screenshots of one grocery order → 3 separate transactions | ✅ Shipped — §6 (the multi-transaction half) and §5 (itemized summary, `telegram-intake` v18) |
| 8 | PDF invoices not read | ✅ Fixed — refused with a clear reason instead of silently degrading (`0f547f3`) |
| 9 | Random items logged with no amount/qty/account | ✅ Root cause was #8 (the PDF caption became the whole message) — fixed with it |

#3, #8, #9 turned out to be one or two small, unambiguous bugs and shipped
same-day. The other six are real feature gaps with genuine design tradeoffs,
which is why they're here instead of in a commit message.

Every design below has to sit inside the four rules already binding on this
codebase (`CLAUDE.md`, "Telegram bot expansion"):

1. The model never writes SQL and never does arithmetic.
2. The router defaults to "spend" on any doubt.
3. Transactions keep write-then-flag; every other write is propose-then-tap.
4. The bot never writes `quantity`/`avg_cost`/`last_price`.

---

## 1. Duplicate detection

**✅ Shipped** — `telegram-intake` redeployed as v19. Built as designed below,
including the soft-delete "Delete this one" button (`deleted_at`, already in
`015_bot_expansion.sql` — this is the first code to actually use that column).

**The report:** log a spend, forget you already did, log it again.

### Design

Purely deterministic — no model call, no new inference. After a spend is
written (write-then-flag stays intact; a duplicate warning must never block
or delay the actual write), run one lookback query against `transactions`
scoped to the household:

```sql
select id, note, amount, date, created_at
from transactions
where deleted_at is null
  and amount = $1
  and currency = $2
  and date between $3::date - 1 and $3::date + 1   -- catches a UTC/GST date-boundary re-send
  and account_id is not distinct from $4
  and id != $5
order by created_at desc
limit 3;
```

Exact amount + currency + a 1-day date window + same account (when known) is
deliberately tight — a monthly recurring bill has the same amount in a
different month, so it never matches this window. If it finds a hit, the spend
is **not blocked** (never lose a spend), but the confirmation reply grows an
extra line and button:

```
Logged: Dining Out · 84 AED · Karak House · Wio Personal ✓
⚠️ Looks like a duplicate of Thu 6 Aug, 84 AED · Karak House.
[🗑 Delete this one]
```

`Delete this one` is a soft-delete (`deleted_at`, already in `015`) on the
*new* row — the household decides which of the two was the mistake, the bot
never guesses. No new table; one new query function in `store.ts`
(`findPossibleDuplicate`), one new outbound line in `announce()`.

**False positives are cheap.** A dirham-for-dirham coincidence (two separate
84 AED Karak runs, two days apart) shows the same warning; tapping past it
costs nothing since it never blocked the write. Getting it wrong the other way
— staying silent on a real duplicate — is the actual failure being designed
against.

---

## 2. Bulk input

**✅ Shipped** — `telegram-intake` redeployed as v22. No migration needed:
`split_group_id` and `telegram_prompt_msg_id` already existed (`006`/`011`),
so a bulk batch reuses both exactly as designed. Built mostly as designed
below, with corrections in three places:

1. **Fix #n needed zero new mechanism**, not the `fix:<row>:<n>` namespace or
   reply-by-position this section floated. Each numbered button just carries
   the *existing* per-row `fix:<transactionId>` callback — the single-row Fix
   flow (its own forceReply prompt, its own `telegram_prompt_msg_id`) already
   isolates a correction to one row with no bulk awareness at all. This also
   resolves open question #3 below: a reply describing several corrections at
   once was never in scope, and now there's no shared prompt message for such
   a reply to even land on — each Fix tap spawns its own.
2. **Confirm all is a new `confirm_group` action, not a reuse of `confirm`.**
   The existing `confirm` handler's `split_group_id` cascade (built for
   transfers, where both halves always share one amount) blindly clears
   `needs_review` on every sibling. A bulk group's rows can have
   independently-zero amounts, so blindly cascading would bless an unreadable
   amount into the budget — exactly the case `confirm`'s own top-level guard
   exists to prevent. `confirm_group` clears each sibling individually,
   skipping (not blocking the whole tap on) any row whose amount is still
   zero, and reports "Confirmed N of M" when some are left over.
3. **Buttons appear only when ≥1 row needs review** — a design call this
   section left implicit (its own mockup shows buttons on an example that
   reads as already-clean). Chosen to mirror the single-spend precedent
   exactly: a fully clean write is a bare "Logged N: ①...②... ✓" with no taps
   needed, rather than a functional no-op Confirm all on a batch that didn't
   need it.

One more hardening beyond the original design: the amount-count pre-check can
false-positive on a card number ("43.05 to Noon, card ending 1657" reads as
two amounts). Rather than tighten the regex, `parseExtractionArray` degrades a
bare-object model response into a one-element array instead of throwing — the
model reasonably answers with a single object when it decides (correctly or
not) that the message was really one transaction, and that's treated as the
N=1 fallback (below) rather than a failed message.

**The report:** "spent 45 on groceries, 12 on coffee, and paid 3000 rent" —
today this is fed whole to `extractFromText`, which is built for exactly one
transaction and picks (silently) only one of the three.

### Design

`Extraction` becomes `Extraction[]` at the boundary. The prompt contract
changes from "return one JSON object" to "return a JSON array of one or more
transaction objects" — every existing single-spend message just becomes a
one-element array, so `parseExtraction` runs unchanged per-element and every
existing fixture in `fixtures/receipts.ts` still passes with `[response]`
wrapped once.

```
"45 groceries, 12 coffee, paid rent 3000"
   → [ {amount:45, category:Groceries, note:"groceries"},
       {amount:12, category:Dining Out, note:"coffee"},
       {amount:3000, category:Rent, note:"rent"} ]
```

**Still write-then-flag, scaled to N.** All N rows are written immediately
(never lose any of them), then one reply summarizes all of them together
instead of N separate messages:

```
Logged 3:
① Groceries · 45 AED
② Dining Out · 12 AED
③ Rent · 3,000 AED
[✅ Confirm all]  [✏️ Fix #1]  [✏️ Fix #2]  [✏️ Fix #3]
```

Fix on a numbered item threads a correction to that specific row (reuses the
existing `telegram_prompt_msg_id` threading — a new `fix:<row>:<n>` callback
namespace, or simpler: reply "2: it was 15 not 12" and match by position).
Photos and voice notes are **not** in scope for this — a receipt photo is
still exactly one purchase; bulk only applies to typed text, where a
household member is describing several things from memory.

**Routing risk:** the classifier from `docs/telegram-bot-expansion.md` §1
(not yet built) will eventually need a third bucket alongside spend/question —
"this text has more than one number in it." Until that router exists, a
cheap deterministic pre-check works: count `\d+(\.\d+)?\s*(aed|dhs|rs|₹|\$)?`
matches in the text; more than one → ask the model for the array shape
instead of the single-object shape. Same model call either way, just a
different `response_format` schema requested.

---

## 3. Fund transfers

**✅ Shipped** — `020_transfers.sql` applied, `telegram-intake` redeployed as
v21, `src/lib/reports.js`/`Budget.jsx` filter shipped in the same batch. Built
mostly as designed below, with two corrections: (1) the router gate isn't a
"transfer" keyword — the example message never says the word — it's a
move-verb plus a "from ... to ..." shape, or an explicit "transfer" mention;
(2) "Confirm/Fix applies to the pair as a unit — Fix on either half offers to
fix both" shipped as **Confirm-only**. Fix would need its own from/to
correction-extraction prompt (the existing one is shaped for spend fields —
category/paid_with — and would silently misapply to a transfer's account
pair); that's real scope, not folded in here. Confirm *is* pair-aware: it
clears `needs_review` on both rows via `split_group_id`, not just the row the
button was attached to. `src/screens/Home.jsx`'s own "spent this month" stat
also had a bespoke, unfiltered sum — switched to reuse `reports.js`'s
`totalAED` (which it was already supposed to match, per its own comment).

**The report:** moving money between two of the household's own accounts
("moved 2,000 from Wio to ENBD savings") isn't a spend — categorizing it as
one would double-count it against a budget.

### Design — the constraint that shapes this

`accounts.value` is the one field this app is unusually strict about: the
money-data rule in `CLAUDE.md` says balances come from **broker/bank
screenshots only, never a chat message**, and the existing binding rule #3
already forbids the bot from writing `accounts.value` at all (propose-then-tap
territory, and even then only for the *general* balance-update flow in the
original expansion doc — not this one). So a transfer **cannot** move a
number between two `accounts.value` fields from a typed message, full stop.

What it *can* do safely: leave an audit-trail row that is excluded from
every spend/budget total, so "I moved money" is remembered without ever
touching a balance or corrupting `nw_daily`.

**Chosen: a `Transfer` category, always excluded from spend aggregation.**

```sql
-- categories currently has group in ('Needs','Wants','Savings')
insert into categories (name, "group") values ('Transfer', 'Transfer');
```

`sumByCategoryAED`/`sumByGroupAED`/`totalAED` in `src/lib/reports.js` and the
Budget screen's category join both need one filter added: `group != 'Transfer'`
(today they iterate every category unconditionally — this is the one app-side
change this design requires, tracked as its own task, not bundled silently
into a bot change). Two `transactions` rows are written — one negative-facing
entry isn't used anywhere else in this schema (`amount` is always positive,
per `normalizeAmount`), so a transfer instead writes **two positive rows**,
one per account, both tagged `category = 'Transfer'`, linked by a shared
`split_group_id` (the column already exists — `006_transaction_splits.sql`):

```
"moved 2000 from Wio to ENBD savings"
→ row 1: -source marker via note "Transfer out → ENBD savings", account_id = Wio,   amount 2000
  row 2: note "Transfer in ← Wio",              account_id = ENBD savings, amount 2000
  both: category = Transfer, split_group_id = shared uuid
```

Both rows show in the Transactions list (so the household can see the
transfer happened) and both are invisible to every spend total. Confirm
applies to the pair as a unit (via `split_group_id`); Fix does not — see the
shipped-note at the top of this section.

**Open question:** is a same-amount in/out pair confusing net-worth-wise if
someone reads the raw `transactions` table directly (e.g. via `/review`)?
Alternative considered: a single row with a new `kind = 'transfer'` column
instead of two rows — simpler to reason about, but loses the "money left this
account, money entered that one" symmetry that makes per-account history
correct if accounts are ever reconciled against `transactions` instead of
`accounts.value`. Leaning toward the two-row version; revisit if `/review`
ships and reads confusingly.

---

## 4. Cashback

**✅ Shipped** — `019_pending_income.sql` applied, `telegram-intake` redeployed
as v20. Built mostly as designed below, with one correction: the "no new
columns" assumption in the schema summary didn't survive contact with
propose-then-tap's "nothing written until the tap" requirement. A stateless
Edge Function invocation has nowhere to hold a not-yet-written proposal
between the propose message and the button tap, so a small `pending_income`
table holds it; `income` itself gained no columns, as planned. A cheap
deterministic router gate (`/\bcash\s?back/i` on typed text only, same
text-only scoping as §2) decides "cashback, not spend" — CLAUDE.md rule #2
("router defaults to spend on any doubt") means only an explicit mention
leaves the spend path.

**The report:** a card credits money back — is it a spend, income, or
something else?

### Design

Cashback is real income, but it's small, frequent, and tied to a specific
card rather than a paycheck. `income` (kind enum: `salary`, `bonus`,
`dividend`, `interest`, `trading_pnl`, `other`) already has a shape for this —
**cashback logs as `income` with `kind = 'other'`**, not as a negative-amount
transaction:

```
"got 15 aed cashback from the ENBD card"
→ income row: person = Shrey, source = "ENBD Credit Card cashback",
  kind = 'other', amount = 15, currency = AED, date = today
```

**Why not net it against category spend instead** (the alternative: a
negative-amount transaction in whatever category earned it, so "Dining Out"
shows 15 AED lower)? Because `amount` is positive-only by design
(`normalizeAmount` takes `Math.abs()` — see the comment: *"Spend is stored as
a positive number"*) and every rollup in `reports.js`/Budget assumes that.
Making amounts signed is a real schema and app-wide logic change (Budget
progress bars, category totals, the Sankey diagram) that this one feature
does not justify. Logging cashback as income keeps net worth and monthly
income correct immediately, at the cost of category spend not reflecting the
discount — an acceptable trade until/unless signed amounts are designed
properly as their own project.

This reuses `income` inserts exactly like the existing (currently unbuilt)
"log my salary" verb from the original expansion doc §3 — same write path,
same propose-then-tap treatment (income isn't "a spend not written is a spend
lost forever"; a missed cashback entry costs nothing but a slightly-off
income total, so it can safely follow the softer gate).

---

## 5. Itemized summary before/after logging

**✅ Shipped** — `018_transaction_items.sql` applied, `telegram-intake`
redeployed as v18. Built as designed below.

**The report:** "can it not give a summary of what it extracted — item, qty,
price?" — right now the reply is one line (`Groceries · 41.95 AED · Makhana,
Dosa Batter, Oats, Cucumber, Red Onion · account unknown`), which is the
`note` field doing double duty as an item list.

### Design

Add an optional `items` array to the `Extraction` contract:

```ts
interface Extraction {
  // ...existing fields unchanged
  items: { name: string; qty: number | null; price: number | null }[] | null
}
```

`null`/`[]` when the source doesn't itemize (an SMS debit alert, a typed
"84 lunch") — this is additive, not required, so it costs nothing on the
inputs that already work well. When the model *can* read line items (a
grocery receipt, a Noon order), the reply grows a real breakdown instead of
squashing everything into `note`:

```
Logged — worth a quick check:
Groceries · 41.95 AED · Joint Current
  • Makhana              12.00
  • Dosa Batter           9.50
  • Oats                  8.00
  • Cucumber               3.45
  • Red Onion              9.00
Mon 10 Aug
Not sure about: which account.
[✅ Confirm] [✏️ Fix]
```

Capped at ~8 lines with a "+N more" tail to keep the message short on a
40-item Noon cart. `items` is stored — a new `jsonb` column,
`transactions.items`, additive migration — but is **display-only**: nothing
in Budget/Reports reads it, and it is explicitly not `quantity`/`avg_cost`
territory (binding rule #4 is about investment holdings, not grocery items;
this doesn't touch `accounts` at all). Cost: item lists add maybe 100–200
output tokens per photo — still a rounding error against the $0.04/month
receipt-reading budget already costed in `PLAN.md`.

This is also the tool that makes §6 (multi-photo batching) legible: a
consolidated item list across 3 photos of one order is the difference between
"looks right" and "wait, are Oats listed twice?" at a glance.

---

## 6. Multiple screenshots — one purchase (#5) or one order (#7)

**✅ Shipped** — `017_media_groups.sql` applied, `telegram-intake` redeployed
as v17. Built as designed below, including the debounce-race claim logic;
`ALBUM_DEBOUNCE_MS` is still the untuned 1200ms guess pending real album
sends.

**The two reports, same mechanism:** (a) a single receipt cropped the total,
needing a second screenshot to complete it; (b) three screenshots of one
grocery order, sent as a photo album, logged as three unrelated transactions
(`41.95 AED`, `53.70 AED`, `45.70 AED` — all within 5 seconds, all "Groceries",
clearly one order split across the phone's multi-select).

### Design

Telegram's `media_group_id` is exactly the signal for "these were sent
together" — a phone's multi-select album always shares one. The problem is
architectural: each album photo arrives as its **own webhook call**, and the
Edge Function is stateless between calls, so nothing today knows "wait for
the rest."

**A short claim-and-debounce table, no cron required:**

```sql
create table media_groups (
  media_group_id text primary key,
  chat_id bigint not null,
  file_ids jsonb not null default '[]'::jsonb,
  caption text,
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);
```

On a photo message carrying `media_group_id`:

1. Upsert: append this photo's `file_id` to `file_ids`, bump `updated_at`.
2. `await sleep(1200ms)` — inside the same invocation, no external job.
3. Re-read the row. If `updated_at` moved past what this invocation just
   wrote (a later sibling arrived and upserted after us), **stand down**:
   reply nothing, `{status: 'ignored', reason: 'superseded by a later album
   member'}`. Exactly one of the N invocations survives this race — whichever
   one's photo was the last to arrive.
4. The surviving invocation sets `processed_at`, downloads every `file_id` in
   the group, and runs **one** extraction call with all images attached —
   `extractFromImage` becomes `extractFromImages(images[], ctx, model)`,
   building one user message with N `image_url` parts instead of one. Gemini
   already accepts multiple images per call; this is a prompt change
   (`buildImageUserPrompt` gets a count: *"These N images are one purchase —
   a receipt cropped across shots, or a bill's front and back. Extract one
   transaction."*), not a new API integration.

This directly fixes both reports: (a) a cropped total is now visible because
both crops are in the same model call; (b) three shots of one order become
one transaction instead of three, and — combined with §5 — the reply lists
every item found across all three images so nothing looks silently merged
away.

**The 1.2s number is a heuristic, not a guarantee.** A slow phone upload
could in principle straddle it and still split into two groups; a very fast
album could theoretically all land before the first `sleep` resolves (fine —
step 3 just finds nothing to stand down for, first invocation wins outright).
Worth tuning against real album sends once this ships rather than guessing
further from a desk.

**Open question — is "one album = one transaction" always right?** The
reported case is unambiguous (one order, one total, cropped or multi-photo).
It stops being right if someone genuinely photographs two *different*
receipts and multi-selects them together by habit. No good deterministic way
to tell those apart from the photos alone; the mitigation is the confidence
rubric — if the combined extraction looks inconsistent (two totals, two
merchants visible), the model should say so and drop confidence, same as any
other ambiguous receipt today. `/help` gets a line: *"Send unrelated receipts
one at a time, not as a multi-select album."*

---

## Schema summary

All additive, `supabase/schema/`. **Numbering note:** `docs/telegram-bot-sprint-plan.md`'s
ledger (§4) reserves its own numbers for unbuilt work (`pending_actions`,
`push_cron`, `statement_cycle`) that don't match what actually shipped here —
whoever picks up either doc first should renumber on the fly rather than trust
placeholder numbers blindly. `017_media_groups.sql` (§6), `018_transaction_items.sql`
(§5), `019_pending_income.sql` (§4) and `020_transfers.sql` (§3) are all
applied. §2 (bulk input) is also now shipped, and needed no migration of its
own — every table it touches (`split_group_id`, `telegram_prompt_msg_id`)
already existed. Every item in this epic is now shipped.

Duplicate detection (§1) needs no schema — it's a query against existing
columns. Cashback (§4) needed one table after all, `pending_income` — see §4's
own note on why the original "no new columns" plan didn't hold up. Transfers
(§3) needed the category check constraint widened (Needs/Wants/Savings →
+Transfer), not just a plain insert as originally sketched — a `check`
constraint can't be loosened without being redefined.

## Phasing

Rough value/cost ordering, independent of each other except where noted:

1. **§6 multi-photo batching** — directly fixes two of the nine real reports,
   the only one that's a correctness bug rather than a missing feature.
2. **§5 itemized summary** — cheap (prompt-only + one column), and makes §6's
   output trustworthy at a glance.
3. **§1 duplicate detection** — cheap, deterministic, no model changes.
4. **§2 bulk input** — needs the array-shaped extraction contract; touches
   `parseExtraction` and every fixture, so budget real test time.
5. **§3 transfers** — needs the `src/lib/reports.js`/Budget exclusion filter
   as a paired app change, not bot-only.
6. **§4 cashback** — smallest change (reuses `income` as-is), lowest urgency
   (never reported as broken, just asked about).

## Testing

Same principle as everywhere else in this pipeline: every new decision point
takes injected deps (`store`/`messenger`/`model`/`now()`) so it runs under
`npm test` with no network. §6 specifically needs an injectable `sleep()` (a
`deps.wait?: (ms: number) => Promise<void>` defaulting to real `setTimeout`,
faked to resolve instantly in tests) — otherwise every album test takes 1.2
real seconds and the debounce race can't be deterministically exercised.

## Open questions

1. **§1** — does a duplicate warning need a cooldown (don't re-flag the same
   pair if the household already dismissed it once)?
2. **§3** — one transfer row with a `kind` column vs. two linked rows (leaning
   two; see §3's own open question).
3. **§2** — ~~how does Fix-by-number interact with a *reply* that itself
   describes several corrections at once ("2 was 15, 3 was groceries")?~~
   Resolved by the shipped implementation: Fix #n is a plain per-row button,
   not a reply-parsing scheme, so there's no shared prompt for a multi-fix
   reply to land on in the first place — moot rather than out of scope.
4. **§6** — is 1200ms right, or should it scale with how many photos have
   landed so far (a 5-photo album needs longer than a 2-photo one)?
