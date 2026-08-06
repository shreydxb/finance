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
   │  ├─ photo  → getFile → base64 → GPT-4o-mini vision ─┐
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
| `intake.ts` | The flow: allowlist, confidence gate, confirm/fix loop, replies |
| `extract.ts` | OpenRouter call + the hardening that validates whatever comes back |
| `transcribe.ts` | Groq Whisper for voice notes |
| `prompt.ts` | The extraction prompt (categories, currency rules, confidence rubric) |
| `store.ts` | Postgres over PostgREST with the service-role key |
| `telegram.ts` | Bot API client |
| `config.ts` | Secrets → typed config, with defaults |
| `demo.ts` | Runs the whole flow locally against mocked payloads |
| `fixtures/` | Mock Telegram updates, fakes, and the receipt-response corpus |

There are no external imports — just `fetch` — so the same modules run under
Deno on Supabase and under `node --test` locally.

## Setup

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

Run `supabase/schema/011_telegram_intake.sql` (see `supabase/schema/README.md`).

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
| Secret `OPENROUTER_MODEL` | Extraction model | `openai/gpt-4o-mini` |
| Secret `GROQ_WHISPER_MODEL` | Transcription model | `whisper-large-v3` |

The threshold starts conservative on purpose: more Confirm/Fix pings early,
fewer wrong numbers landing silently. Lower it once the extraction has earned
trust on real receipts.

## Testing

```bash
npm test              # 62 tests, no network, no keys
npm run demo:telegram # prints the whole conversation against mocked payloads
```

`npm run demo:telegram` walks a scripted session — a clean typed spend, a
receipt photo, a low-confidence voice note corrected via Fix, an unreadable
total, and a stranger being ignored — and prints both sides of the conversation
plus the resulting ledger. Model responses are the only faked part; the
allowlist, gate, writes and confirm/fix loop are the real code.

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

What that **cannot** cover is whether GPT-4o-mini reads *your* photographs
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
