-- 037_pending_actions.sql — Taskiv #60
--
-- Generic propose-then-tap write plumbing. Transactions are write-then-flag
-- (a spend not written is a spend lost forever — nobody remembers the
-- coffee). That justification does not transfer to any other write: nobody
-- forgets moving 2,000 AED into a goal, and an unwanted accounts.value
-- overwrite corrupts nw_daily permanently — nw_daily is explicitly never
-- backfilled (036_money_view.sql's sibling rule for that table). So every
-- other bot write proposes first: nothing hits the database until a
-- household member taps Apply.
--
-- callback_data is capped at 64 bytes, so the full action payload cannot
-- live in the Telegram button — only this row's id does. `kind`/`payload`
-- are deliberately generic (jsonb): this migration builds the storage and
-- the propose/expire/resolve plumbing only. No `kind` is implemented yet —
-- each future action (goal contribution, balance update, income log,
-- category rule; Taskiv #63-67) registers its own apply() handler against
-- this same table.
--
-- Not deleted on resolution, unlike 019_pending_income.sql's pending_income
-- (which is single-purpose and consumed once): resolved_at/resolution are
-- kept so a redelivered Telegram callback — and a human debugging "what
-- happened to that proposal" — can tell an applied action from a cancelled
-- or expired one, rather than finding nothing at all.

create table if not exists pending_actions (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null,
  chat_id bigint not null,
  prompt_msg_id bigint,
  requested_by bigint not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour',
  resolved_at timestamptz,
  resolution text check (resolution in ('applied', 'cancelled', 'expired'))
);

-- The only query pattern this table serves from the bot: "is there an open
-- proposal in this chat" — never a lookup by kind or requester alone.
create index if not exists pending_actions_open_idx
  on pending_actions (chat_id, created_at desc) where resolved_at is null;

alter table pending_actions enable row level security;

drop policy if exists "pending_actions household all" on pending_actions;
create policy "pending_actions household all" on pending_actions
  for all to authenticated using (true) with check (true);

comment on table pending_actions is
  'Taskiv #60: propose-then-tap holding spot for any bot write that is not a transaction. A row here is not itself a write to the real tables — only resolving it with resolution=''applied'' triggers the kind-specific handler''s actual write. The service-role Edge Function is the only writer; RLS here (like pending_income''s) exists to keep it out of anon/unauthenticated reach, not to scope by household.';

-- Verify:
--   select * from pending_actions limit 1;
--   -- (empty table until the first proposal is sent)
--   \d pending_actions
--   -- expect: pending_actions_open_idx present, resolution CHECK constraint present.
--
-- Rollback:
--   drop table if exists pending_actions;
