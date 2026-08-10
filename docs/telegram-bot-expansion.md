# Telegram bot expansion — design

Status: **design, nothing built**. Written 10 Aug 2026 against `telegram-intake`
as deployed (v1 pattern, `intake.ts` @ 475 lines).

Today the bot does exactly one thing: a photo/voice/typed message becomes a
`transactions` row. This document designs the expansion into three capabilities
it does not have — **ask** (read-only questions), **do** (writes beyond a
transaction), and **be told** (the bot messages you first) — and picks the
architecture that gets there without putting the receipt path at risk.

Read `supabase/functions/telegram-intake/README.md` first for how intake works
now. Everything here is additive to it.

---

## 1. The structural problem to solve first

`handleMessage` in `intake.ts` treats **every** non-command text as a spend:

```
text → extractFromText → insertTransaction   // always
```

There is no branch for "this message isn't a spend". Send
*"how much did we spend on groceries this month?"* today and the bot will do its
honest best to extract a transaction from it and write a garbage row. So the
first piece of work is not a feature — it's a **router**, and the router has to
be conservative in a specific direction: **a misrouted spend is a lost spend**,
which is the one failure mode the whole design brief exists to prevent.

### Routing options

| Option | Cost/latency | Risk |
| --- | --- | --- |
| A. Slash commands only (`/ask …`, `/spend …`) | zero | Clunky; nobody types `/ask` on a phone; the bot stays a form |
| B. Add `intent` to the existing extraction JSON | zero extra calls | Couples classification to the extraction prompt — which is **still unproven on real receipts**. Regressing it to add Q&A is a bad trade |
| C. Separate cheap classifier call before extraction | +1 call, ~300ms, ~20 tokens | Extraction prompt untouched. Costs a rounding error on Flash-Lite |

**Recommendation: C, fronted by deterministic rules**, so the model is only
consulted when it has to be:

```
update
 ├─ callback_query           → confirm/fix/push-action   (existing)
 ├─ reply to a logged row    → correction                (existing)
 ├─ photo / voice            → spend                     (existing, never routed)
 ├─ /command                 → command handler           (deterministic)
 └─ plain text               → classifier → spend | question | action | chatter
                                            └─ default on any doubt: spend
```

Photos and voice notes never go near the classifier — a receipt photo is always
a receipt. Only typed text is ambiguous, and typed text is the cheapest thing to
classify. The classifier returns `{intent, confidence}`; anything below ~0.6, or
any parse failure, falls through to **spend**, preserving today's behaviour
exactly. The bot getting a question wrong costs one flagged row and an `/undo`;
the bot getting a spend wrong costs a number that never enters the ledger.

---

## 2. Ask — the read-only question surface

### The hard rule: the model never writes SQL, and never does arithmetic

Two reasons, both non-negotiable here:

1. The function holds the **service-role key**. RLS is bypassed. Text-to-SQL
   against a live real-money database is an unbounded blast radius for a feature
   whose entire value is convenience.
2. CLAUDE.md already states the principle in the money-data rule: figures come
   from a source of record, never from a model's recollection. An LLM that
   adds up eleven transactions and reports a total will be quietly wrong
   occasionally, and *quietly wrong* is precisely the failure this app is built
   to avoid.

### Instead: a fixed query toolbox

The model's only job is to map a question onto one entry in a closed enum, plus
parameters. The function then runs a **hand-written, parameterised** PostgREST
call or SQL RPC, and formats the answer from the returned numbers. The model may
be given the result rows back to write one natural sentence around them, but it
is never the source of a digit.

```ts
type Query =
  | { q: 'category_spend';    category: string; period: Period }
  | { q: 'total_spend';       period: Period }
  | { q: 'merchant_spend';    merchant: string; period: Period }
  | { q: 'budget_remaining';  category?: string }        // null = all
  | { q: 'recent_transactions'; limit: number; owner?: string }
  | { q: 'net_worth';         compare?: Period }
  | { q: 'account_balance';   account: string }
  | { q: 'upcoming_bills';    days: number }
  | { q: 'goal_progress';     goal?: string }
  | { q: 'debt_outstanding';  account?: string }
  | { q: 'needs_review_count' }
  | { q: 'income_summary';    period: Period }

type Period = { kind: 'this_month' | 'last_month' | 'ytd' | 'last_n_days' | 'explicit'; ... }
```

Twelve entries covers, in plain language:

- "how much have we spent on dining out this month?"
- "what did we spend at Carrefour in July?"
- "how much is left in the groceries budget?"
- "what's our net worth?" / "how did it move this month?"
- "what's due this week?"
- "how much is left on the car loan?"
- "how's the emergency fund doing?"
- "what did Tarika spend yesterday?"
- "what still needs review?"

Anything outside the enum gets an honest *"I can't answer that one — it's in the
app under Reports"* rather than an improvised answer. That refusal is a feature:
it's what stops the surface silently widening into invented numbers.

Every query is **scoped to whole rows the app already computes** where possible
(`nw_daily` for net worth, `budgets` for limits) so the bot and the app can't
disagree with each other. Where a genuinely new aggregate is needed, it goes in
as a SQL view in `supabase/schema/NNN_*.sql`, not as ad-hoc string-built SQL in
the function — additive-only, same as every other schema change here.

### Answer format

Short, and always with the window stated, because the ambiguity in
"this month" is where trust dies:

```
Dining Out, 1–10 Aug: 1,240 AED
Budget 1,800 → 560 left, 21 days to go.
```

Currency follows the household default (AED); no per-device currency toggle
applies here — that's deliberately a device-local app preference and shouldn't
leak into a shared group chat where two people would see the same message.

---

## 3. Do — writes beyond a transaction

Candidate verbs, roughly in value order:

| Verb | Example | Writes to |
| --- | --- | --- |
| `/undo` | "/undo" | soft-delete the last row this chat logged |
| Review queue | "/review" | walks `needs_review` rows one at a time, existing Confirm/Fix keyboard |
| Update a balance | "Wio savings is now 41,300" | `accounts.value` |
| Goal contribution | "put 2,000 into the emergency fund" | `goal_contributions` |
| Log income | "salary landed, 20,000" | `income` |
| Mark a bill paid | tap on a due-bill push | `transactions` from the `recurring` template |
| Teach a rule | "always put Talabat under Dining Out" | `category_rules` (table already exists, `014`) |
| Add a category | "add a category for school fees" | `categories` |

### The gate is different for these than for spends

Intake writes optimistically and flags (`needs_review`) because **a spend not
written is a spend lost forever** — the human will not remember the coffee. That
justification does *not* transfer:

- Nobody forgets they moved 2,000 AED into a goal.
- An unwanted `accounts.value` overwrite corrupts `nw_daily` history permanently,
  and `nw_daily` is explicitly "recorded from now forward, never backfilled".

So: **transactions keep write-then-flag. Everything else is propose-then-tap.**

```
"Wio savings is now 41,300"
→ Wio Savings: 38,900 → 41,300 AED  (+2,400)
  [✅ Apply]  [✖️ Cancel]
```

Same mechanism as the existing confirm keyboard, inverted: nothing is written
until the tap. Cheap to build (the callback plumbing already exists) and it
keeps the destructive surface behind a human thumb.

`/undo` is a soft delete or a `voided` flag, never a hard `DELETE` — the schema
is additive-only and a bot that can erase rows on a forged webhook is a much
worse thing to own than one that can add them.

---

## 4. Be told — proactive pushes

This is the genuinely new capability: today the function is **purely reactive**,
it only ever replies to an incoming update.

### Two prerequisites that don't exist yet

1. **Nothing stores the group chat id.** Every send today uses
   `message.chat.id` from the inbound update. A scheduled job has no inbound
   update. Fix: capture `chat.id` into `settings.tg_chat_id` on the first
   allowlisted message from a group chat, and let Settings show/override it.
2. **`today()` is UTC, not Dubai.** `intake.ts:472` does
   `new Date().toISOString().slice(0,10)`. Dubai is UTC+4, so anything logged
   between 00:00 and 04:00 GST is dated to the **previous day**. Harmless-ish
   for a receipt (the printed date wins), wrong for a typed "84 lunch" at
   midnight, and actively broken for "spent X yesterday". A push scheduler makes
   it worse — "due tomorrow" would fire on the wrong day four hours a night. Fix
   this before, not after.

### Scheduling: pg_cron + pg_net

Both extensions are **available and not yet installed** on `our-rokda`
(confirmed via `list_extensions`).

| Option | Verdict |
| --- | --- |
| **pg_cron + pg_net → Edge Function** | **Chosen.** Free, in-database, and the schedule lives in `supabase/schema/NNN_*.sql` so the repo stays the source of truth |
| Supabase dashboard Cron UI | Same pg_cron underneath, but configured outside the repo — loses reproducibility |
| GitHub Actions cron | A third place holding a secret, and Actions cron drifts 5–20 min late. Acceptable for a weekly digest, wrong for "bill due tomorrow" |

Netlify is irrelevant here — this is backend-only and burns no build minutes.

### A separate `telegram-push` function, not a branch in `telegram-intake`

Different auth (a job key, not the Telegram webhook secret), different failure
semantics (a cron job *should* retry; an intake webhook must never return
non-2xx or Telegram redelivers forever), and — the deciding reason — the intake
path is still unproven against real receipts and should not be redeployed to
ship a digest. Shared code (`telegram.ts`, `store.ts`, types) moves to
`supabase/functions/_shared/`.

### Catalogue

| Push | Trigger | Cadence |
| --- | --- | --- |
| Bill due | `recurring.day_of_month` in 2 days, `autopay = false` | once per bill per month |
| Budget burn | a category past 85% with >25% of the month left | once per category per month |
| Review nag | `needs_review` rows older than 3 days | weekly, capped |
| Weekly digest | Sunday 09:00 GST | weekly |
| Monthly close | 1st, 09:00 GST — spend vs budget, savings rate, net-worth delta, goal progress | monthly |
| Salary check | payday per `recurring` income rows → "did it land?" with a log button | monthly per person |
| Unusual spend | a row >2× the 90-day median for its category | on write |
| Quiet spell | nothing logged in 4 days → "quiet few days — anything missing?" | max once per 4 days |

That last one is aimed squarely at the actual problem: **zero transactions have
ever been logged in production**. A finance bot's real enemy isn't accuracy, it's
being forgotten. But it's also the one most likely to become annoying, so it
ships behind a toggle and stays silent while other pushes are already firing.

### Dedupe and quiet hours are load-bearing

A naive cron that spams the group gets the bot muted, and a muted bot kills
intake too — the feature that actually matters. So:

```
notifications (id, kind, dedupe_key text unique, chat_id, telegram_msg_id,
               sent_at, payload jsonb)
```

Every push computes a `dedupe_key` (`bill_due:<recurring_id>:2026-08`) and
inserts before sending; a unique-constraint violation means "already sent, skip".
That makes the job **idempotent**, so it can run hourly without fear and a
retry can't double-post. Plus a hard rule: nothing sends between 22:00 and 07:00
GST, and a per-day cap of ~3 pushes total.

Per-push on/off lives in Settings (`settings` keys, like the existing intake
config) so tuning doesn't need a deploy.

---

## 5. Security — the unset webhook secret becomes a blocker

CLAUDE.md currently lists `TELEGRAM_WEBHOOK_SECRET` being unset as a known,
tolerated gap. It is a **much bigger deal** under this design, and the reasoning
is worth spelling out:

The allowlist gates on `message.from.id` — a value read straight out of the
**request body**. With no secret header verified, anyone who guesses the function
URL can forge `from.id` to an allowlisted number. Today the worst case is a
stranger injecting junk transactions (bad; visible; fixable with `/undo`).

Add Q&A, and the same forged request with `chat.id` set to *the attacker's own
chat* turns the bot into a **read endpoint for the household's entire financial
position**. Add writes, and it can overwrite account balances.

So, non-negotiable ordering:

1. `TELEGRAM_WEBHOOK_SECRET` set in Supabase **and** re-registered via
   `setWebhook` in one sitting (already tracked as Taskiv #22) — **before** any
   read or write surface beyond intake ships.
2. Defence in depth regardless: **only ever send to a known chat id.** Replies
   should go to `settings.tg_chat_id` or an allowlisted chat, never blindly to
   whatever `chat.id` arrived in the payload.
3. The push job authenticates with its own key, separate from the webhook secret.

### Cost

Flash-Lite classification on a ~20-token message is a fraction of a receipt read,
and the receipt read was already costed at ~$0.04/month for 150 receipts
(PLAN.md decision 5). Q&A adds a second call of similar size. Even at 20
messages/day the whole expansion stays in cents/month. Cost is not a constraint
here; annoyance and wrong numbers are.

---

## 6. Phasing

**Phase 0 — prerequisites (no AI, unblocks everything)**
Webhook secret restored · store `tg_chat_id` · fix the UTC/GST date bug ·
`/undo` · `/review` queue · shared `_shared/` folder extraction.
*Every item here is useful on its own even if the rest is never built.*

**Phase 1 — ask**
Intent router (deterministic + classifier, spend-by-default) · query toolbox ·
answer formatting · `/help` rewritten as a real catalogue.

**Phase 2 — be told**
pg_cron + pg_net migration · `telegram-push` function · `notifications` table ·
bill-due, budget-burn, weekly digest. Others follow once the cadence feels right
in practice.

**Phase 3 — do**
Propose-then-tap writes: balances, goal contributions, income, category rules.

Phases 1 and 2 are independent and can be built in either order. Phase 3 should
follow Phase 1 — it reuses the router.

### Testing

Everything stays in the injected-dependency style that makes `npm test` work
with no network and no keys: the router, the query toolbox and every push rule
take `store`/`messenger`/`model`/`now()` as deps. The push function especially
needs an injectable clock — quiet hours, "2 days before", and month boundaries
are all impossible to test otherwise. Router classification gets a fixture
corpus of ~30 real-shaped messages (spends, questions, chatter) in
`fixtures/`, same pattern as `fixtures/receipts.ts`.

---

## 7. Open questions

1. **Group or DMs?** Pushes to the shared group mean Tarika sees "you're at 85%
   of the dining budget" too. Right for a joint ledger, possibly nagging. Same
   channel for everything, or per-person DMs for the personal-account stuff?
2. **How chatty is too chatty?** The 8 pushes above at full tilt is roughly one
   message a day. Start with 3 (bill due, weekly digest, review nag)?
3. **Should the bot answer "should we…?" questions** — advice, not lookup? My
   view: no, not in v1. It's the one surface where a confident wrong answer
   costs real money, and the app's whole design premise is that numbers come
   from records.
4. **`/undo` window** — last row only, or last row within 24h?
5. **Does `/review` belong in Telegram at all**, given the app already has a
   Needs-review pill and filter? Argument for: the phone is where you are.
