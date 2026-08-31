# Our Money v4

Private household finance app for Shrey + wife (Dubai, AED/INR). React + Vite +
Tailwind frontend, Supabase (Postgres/Auth/Realtime/Edge Functions) backend, deployed
via Netlify.

See `PLAN.md` for the full product plan, data model, and decisions log.

## Development

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env` and fill in Supabase project credentials once the
Supabase project exists (see Epic 1 task: Supabase schema setup).

```bash
npm test              # Edge Function tests (no network, no keys needed)
npm run demo:telegram # walk the Telegram intake flow against mocked payloads
```

## Structure

- `docs/v6/reference` — authoritative SHR-151 V6 visual artifact, tokens, and desktop/mobile/accessibility parity checklists
- `src/components` — shared UI components
- `src/screens` — one folder/file per Phase-1 screen (Home, Accounts, Transactions,
  Cash Flow, Budget, Recurring, Goals, Settings)
- `src/lib` — Supabase client + helpers
- `supabase/schema` — SQL migrations
- `supabase/functions` — Edge Functions; `telegram-intake/` is the Telegram/AI
  spend intake (see its README for bot setup and how the confirm/fix loop works)
- `legacy/` — reference-only old single-file build, superseded by this project
