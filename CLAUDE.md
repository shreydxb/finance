# Our Money v4 — working notes

Private household finance app for a couple in Dubai. See `PLAN.md` for the
product plan, data model and decisions log. This file is for the operational
things that are easy to get wrong.

## Deploys cost real money — batch them

Netlify is on the **free tier: 300 build minutes/month, resetting on the 20th**.
Every push to the production branch triggers a build.

- Verify locally first (`npm run build`, `npm test`, `npm run lint`), then push
  **once** with the work batched. Don't push per-commit while iterating.
- Check that Netlify's branch-deploy setting is "production branch only" — if
  it's set to all branches, every push to every branch burns minutes.
- Edge Function deploys go through Supabase, not Netlify, and cost nothing here.
  Backend-only changes never need a Netlify build.

## Branches

`main` is the trunk and holds Epics 1–7. Netlify's production branch must point
at `main` — it was originally pinned to `claude/epic-1-task-3-continue-fsbdo9`,
which is why Epic 7's UI was invisible on the live site for a while.

## Supabase

Project `our-rokda` (`wrxqgfbolryveivgdjia`).

- Schema lives in `supabase/schema/NNN_*.sql`, applied in order. Additive-only,
  never destructive — this database carries real money data.
- `001`–`007` were run by hand in the SQL Editor so they don't appear in
  `supabase migration list`; `008`+ do.
- The `telegram-intake` Edge Function is deployed straight from
  `supabase/functions/telegram-intake/`. Keep the deployed copy in sync with the
  repo — after deploying, diff the two.

## Tests

```bash
npm test              # Edge Function tests: node --test, no network, no keys
npm run demo:telegram # walks the Telegram flow against mocked payloads
```

There are no frontend tests yet. `npm run build` is the only check the React
side gets.

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
