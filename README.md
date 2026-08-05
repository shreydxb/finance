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

## Structure

- `src/components` — shared UI components
- `src/screens` — one folder/file per Phase-1 screen (Home, Accounts, Transactions,
  Cash Flow, Budget, Recurring, Goals, Settings)
- `src/lib` — Supabase client + helpers
- `supabase/schema` — SQL migrations
- `supabase/functions` — Edge Functions (Telegram intake, price quotes, etc.)
- `legacy/` — reference-only old single-file build, superseded by this project
