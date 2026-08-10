-- Bot expansion Sprint 1 foundations: soft delete for /undo, and a dedupe
-- ledger for scheduled pushes. Additive only, never destructive — this
-- database carries real money data.

-- Soft delete for /undo. Never a hard DELETE: the bot is reachable from a
-- webhook, and a bot that can erase rows is far worse to own than one that
-- can only add them. Existing read paths (src/lib/transactions.js) are
-- updated alongside this migration to exclude soft-deleted rows.
alter table transactions add column if not exists deleted_at timestamptz;

create index if not exists transactions_not_deleted_idx
  on transactions (date desc) where deleted_at is null;

-- Push dedupe ledger (Taskiv #69). The unique key is what makes an hourly
-- cron job idempotent: insert-before-send, and a unique-constraint violation
-- means "already sent this dedupe key, skip".
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  dedupe_key text not null unique,
  chat_id bigint,
  telegram_msg_id bigint,
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now()
);

create index if not exists notifications_kind_sent_idx
  on notifications (kind, sent_at desc);

alter table notifications enable row level security;

drop policy if exists "notifications household all" on notifications;
create policy "notifications household all" on notifications
  for all to authenticated using (true) with check (true);
