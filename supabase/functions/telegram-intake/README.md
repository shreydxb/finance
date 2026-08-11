# telegram-intake

The Telegram/AI intake path for Our Money v4: a photo, a voice note or a typed
message in the household's Telegram group becomes a row in `transactions`.

This is what replaces "connect your bank" — no UAE bank sync exists, so the
alternative to this is remembering to open the app after every coffee.

```
Telegram group
   │  photo / voice / text
   ▼
telegram-intake (Edge Function)
   │  ├─ photo  → getFile → base64 → Gemini Flash-Lite ──┐
   │  ├─ voice  → getFile → Groq Whisper → transcript ───┤→ one JSON contract
   │  └─ text   ─────────────────────────────────────────┘   + confidence 0–1
   ▼
transactions row (always written)
   ├─ confidence ≥ threshold, everything resolved → needs_review = false, FYI ping
   └─ otherwise → needs_review = true, [✅ Confirm] [✏️ Fix] in Telegram
                                          │
                                          └─ Fix → threaded reply → same row updated
```

Two invariants the code is built around, both covered by tests:

1. **Nothing is ever silently lost.** Every recognised message writes a row
   immediately — even one whose total was unreadable (it lands at 0, flagged).
   Low confidence flags; it never discards.
2. **A correction updates the row it belongs to.** Fixes are threaded via
   `telegram_msg_id` / `telegram_prompt_msg_id` and never fork a second row.

## Files

| File | What it does |
| --- | --- |
| `index.ts` | HTTP entry: webhook secret, dependency wiring, always answers 200 |
| `intake.ts` | The flow: allowlist, chat-id capture, confidence gate, confirm/fix loop, replies |
| `extract.ts` | OpenRouter call + the hardening that validates whatever comes back |
| `cashback.ts` | The cashback router gate + its own small propose-then-tap extraction |
| `transfer.ts` | The transfer router gate + its own small write-then-flag extraction |
| `transcribe.ts` | Groq Whisper for voice notes |
| `prompt.ts` | The extraction prompt (categories, currency rules, confidence rubric) |
| `config.ts` | Secrets → typed config, with defaults |
| `demo.ts` | Runs the whole flow locally against mocked payloads |
| `fixtures/` | Mock Telegram updates, fakes, and the receipt-response corpus |

Shared with `telegram-push` (the bot-expansion push function) live in
`supabase/functions/_shared/`, not here:

| File | What it does |
| --- | --- |
| `_shared/store.ts` | Postgres over PostgREST with the service-role key |
| `_shared/telegram.ts` | Bot API client |
| `_shared/types.ts` | Shared types (Telegram payloads, Extraction, HouseholdContext, …) |
| `_shared/dates.ts` | `todayInTz` — resolves "today" in Asia/Dubai, not UTC |

`_shared/` never imports from a specific function's directory — that one-way
dependency is what makes it safe for `telegram-push` to reuse without pulling
in `telegram-intake`'s config or secrets shape.

There are no external imports anywhere — just `fetch` — so the same modules
run under Deno on Supabase and under `node --test` locally.

## Setup

Already done against the `our-rokda` project (`wrxqgfbolryveivgdjia`):

- **Migration 011 applied** — threading columns, indexes, and the four intake
  settings keys are live. `transactions.account_id` is now nullable.
- **Function deployed** — `telegram-intake` v1, `verify_jwt` off, source
  verified identical to this directory. It has never been invoked, and it will
  answer `500 {"error":"function is not configured"}` until step 3 below.

Steps 1, 2, 3, 5 and 7 still need you — they need BotFather and your own
Telegram accounts. Step 4 is only needed when you change the code.

### 1. Create the bot

1. Message [@BotFather](https://t.me/BotFather) → `/newbot`, follow the prompts.
2. Copy the token. **It never goes in the repo** — it's a Supabase secret.
3. `/setprivacy` → **Disable**, so the bot can read group messages that aren't
   commands. Without this it will only ever see `/commands`.

### 2. Create the group

Make a group with both partners and the bot in it. Group, not 1:1 DMs — the
whole point is that neither person has a private ledger the other can't see.

### 3. Set the secrets

```bash
cp supabase/functions/telegram-intake/.env.example supabase/functions/telegram-intake/.env
# fill it in, then:
supabase secrets set --env-file supabase/functions/telegram-intake/.env
```

### 4. Deploy

```bash
supabase functions deploy telegram-intake --no-verify-jwt
```

`--no-verify-jwt` is required: Telegram can't send a Supabase JWT. The request
is authenticated by the webhook secret header, and the *data* is gated by the
household allowlist inside the function.

### 5. Register the webhook

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H 'content-type: application/json' \
  -d '{
        "url": "https://<project-ref>.functions.supabase.co/telegram-intake",
        "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
        "allowed_updates": ["message", "edited_message", "callback_query"]
      }'
```

Check it took: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`.

### 6. Run the migration

Already applied to `our-rokda`. For a fresh project, run
`supabase/schema/011_telegram_intake.sql` (see `supabase/schema/README.md`).

### 7. Fill in the allowlist

Each person sends `/id` in the group; the bot replies with their Telegram user
id. Put both numbers into **Settings → Telegram intake** in the app, with their
names. **Until both are set the function accepts nothing** — it fails closed.

`/id` is the one thing answered before the allowlist check, because otherwise
there'd be no way to discover the ids. It only ever reveals the caller's own id.

## Using it

- **Photo** of a receipt — caption optional, but a caption helps.
- **Voice note** — "spent eighty four dirhams at Karak House on the Wio card".
- **Typed** — "84 lunch noon".
- `/help` — what the bot accepts.

High confidence gets a one-line FYI:

```
Logged: Dining Out · 84 AED · Noon · ENBD Credit Card 4412 ✓
```

Anything less gets buttons:

```
Logged — worth a quick check:
Dining Out · 48 AED · Karak stop · account unknown
Thu 6 Aug
Not sure about: which account.
[✅ Confirm] [✏️ Fix]
```

When the source itemizes (a grocery receipt, a Noon order), the reply grows a
line-by-line breakdown instead of squashing everything into the summary — capped
at 8 lines with a "+N more" tail:

```
Logged: Groceries · 79.95 AED · Carrefour · ENBD Credit Card 4412 ✓
  • Makhana 12
  • 2× Dosa Batter 9.5
  • Oats 8
```

`items` is stored on the row (`transactions.items`, `018_transaction_items.sql`)
but is display-only — nothing in Budget/Reports reads it.

Every new spend also runs a deterministic duplicate lookback (same amount,
currency and resolved account, within a day either side) — never blocking the
write, but the reply grows a warning and a delete button when one matches:

```
Logged: Dining Out · 84 AED · Karak House · Wio Personal ✓
⚠️ Looks like a duplicate of Thu 6 Aug, 84 AED · Karak House.
[🗑 Delete this one]
```

**Delete this one** soft-deletes (`deleted_at`) the *new* row only — the
household decides which of the two was the mistake, the bot never guesses.
Tapping it twice is a no-op, not an error.

Cashback is income, not a spend, so it's routed differently: typing anything
containing "cashback"/"cash back" skips the transaction pipeline entirely and
*proposes* an `income` row instead — genuinely nothing is written until the
household taps Apply (unlike a spend, which is always write-then-flag):

```
Log cashback?
15 AED · ENBD Credit Card cashback · Shrey · Thu 6 Aug
[✅ Apply] [✖️ Cancel]
```

The proposal lives in `pending_income` (`019_pending_income.sql`) until Apply
or Cancel; Cancel discards it, Apply writes it to `income` with
`kind = 'other'` and clears the proposal. Cashback detection only looks at
typed text, not photos or voice — same scoping as bulk input.

A transfer between the household's own accounts ("moved 2,000 from Wio to
ENBD savings") is not income and not propose-then-tap — it's still a
`transactions` write (write-then-flag, like a spend), just two rows instead
of one:

```
Logged: Transfer 2,000 AED · Wio Personal → ENBD Savings ✓
```

Both rows are tagged `category = 'Transfer'` and share one `split_group_id`
(`020_transfers.sql`) — `src/lib/reports.js` and the Budget screen exclude
that category from every spend/budget total, so the transfer is visible in
the Transactions list for audit but invisible to totals. `accounts.value` is
never touched: the money-data rule (balances from screenshots only) applies
here regardless of write style. When an account can't be resolved, both rows
land flagged and the reply offers **Confirm only** — no Fix, since correcting
a transfer would need its own from/to extraction prompt that doesn't exist
yet. Confirm is pair-aware: it clears the flag on both rows, not just the one
the button was attached to.

**Confirm** clears the flag. **Fix** asks for a correction; reply to that
message ("84 not 48", "it was groceries", "paid from the Wio account") and it
goes back through the same extraction, updating that row. Replying directly to
your own original message works too.

Confirm is refused on a row whose amount was never readable — it asks for the
number instead of blessing a zero into the budget.

Anything still flagged shows up as a **Needs review** pill in the app's
Transactions list, with a banner and a "show only these" filter. That's the
safety net for a Telegram prompt nobody answered.

## Configuration

| Where | Setting | Default |
| --- | --- | --- |
| Settings → Telegram intake | The two Telegram user ids (the allowlist) | unset — fails closed |
| Settings → Telegram intake | Auto-log confidence threshold | 85% |
| Settings → Telegram intake | Fallback account for unmatched payment methods | none → flag for review |
| Secret `OPENROUTER_MODEL` | Extraction model | `google/gemini-2.5-flash-lite` |
| Secret `GROQ_WHISPER_MODEL` | Transcription model | `whisper-large-v3` |

The threshold starts conservative on purpose: more Confirm/Fix pings early,
fewer wrong numbers landing silently. Lower it once the extraction has earned
trust on real receipts.

## Testing

```bash
npm test              # 123 tests, no network, no keys
npm run demo:telegram # prints the whole conversation against mocked payloads
```

`npm run demo:telegram` walks a scripted session — a clean typed spend, a
receipt photo, a low-confidence voice note corrected via Fix, an unreadable
total, and a stranger being ignored — and prints both sides of the conversation
plus the resulting ledger. Model responses are the only faked part; the
allowlist, gate, writes and confirm/fix loop are the real code.

`LoggingMessenger` (the class that logs every outbound reply — see
Observability below) lives in `index.ts` and isn't exercised by `npm test`,
since `index.ts` calls `Deno.serve` at import time and only runs under Deno.
It runs for real on every `npm run demo:telegram` invocation and every live
webhook call; there is no unit coverage for it in isolation.

## Observability

Every inbound attempt (a typed message, a photo, a voice note, a correction,
a Confirm/Fix tap) and every outbound reply writes a row to `intake_logs`
(`supabase/schema/016_intake_logs.sql`) — who sent or received it, what stage
of the pipeline it was, the model and token counts when one was called,
whether it succeeded, the error if not, and how long it took. This is the
place to look when something silently doesn't work, since Supabase's function
logs are short-retention and unstructured:

```sql
-- everything that failed today
select created_at, direction, stage, message_type, person, error, duration_ms
from intake_logs
where success = false and created_at > now() - interval '1 day'
order by created_at desc;

-- token spend by day, so a runaway prompt or a stuck retry loop shows up fast
select date_trunc('day', created_at) as day, model, sum(total_tokens) as tokens, count(*) as calls
from intake_logs
where model is not null
group by 1, 2
order by 1 desc;
```

A log write is best-effort: `intake.ts` and `index.ts` both swallow failures
from `store.logEvent()` (falling back to `console.error`) so a broken log
insert can never cost the household a reply or a logged spend — the same
principle behind the chat-id capture in `captureChatId()`.

### Demo mode against the deployed function

To push a mocked payload at the *deployed* function without involving the bot,
set `DEMO_MODE=true` and send the update yourself:

```bash
curl -X POST "https://<project-ref>.functions.supabase.co/telegram-intake" \
  -H 'content-type: application/json' \
  -H 'x-demo-mode: 1' \
  -d '{"message":{"message_id":1,"from":{"id":<your-id>},"chat":{"id":<your-id>,"type":"private"},"text":"84 aed lunch at Noon"}}'
```

The response body contains what the bot *would* have sent, under `sent`. Rows
are really written (they're `source = 'telegram'`, delete them from the app).
Turn `DEMO_MODE` off when you're done.

## Tuning against real receipts

`fixtures/receipts.ts` pins down the deterministic half — 16 model responses
covering Noon, Carrefour, Lulu, restaurant bills, ENOC fuel, DEWA, Talabat and a
Zerodha INR contract note, plus the misbehaviours worth guarding against
(markdown fences, prose preamble, a stringy amount, a 0–100 confidence, an
unreadable total, an invented category). Those run in CI with no keys.

What that **cannot** cover is whether the model reads *your* photographs
correctly. That needs live keys and real receipts, and it's the one part of this
epic that can't be finished from the repo:

1. Set the secrets and deploy.
2. Send 10–15 real receipts through the group — a Noon order, a Carrefour and a
   Lulu shop, two or three restaurant bills, a fuel receipt, a DEWA/Etisalat
   bill, an INR receipt, and at least one bad photo (glare, crumpled, partial).
3. Send 3–4 real voice notes, including one with a merchant name Whisper is
   likely to mangle.
4. For each, compare the logged row against the receipt. Watch specifically for:
   totals vs subtotals, VAT lines being picked up as the total, dd/mm vs mm/dd,
   and INR receipts landing as AED.
5. Fix systematic misreads in `prompt.ts` (the merchant hints and the confidence
   rubric are the levers), and add any newly-observed model response shape to
   `fixtures/receipts.ts` so it stays fixed.
6. Once the extraction is reliably right, consider lowering the threshold.
