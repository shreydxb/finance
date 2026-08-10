-- Observability trail for the Telegram intake pipeline (bot-expansion Sprint 1
-- follow-up). Additive only, never destructive — this database carries real
-- money data.
--
-- One row per inbound extraction attempt (text/photo/voice/correction/callback)
-- and per outbound reply, so a failure anywhere in the pipeline — a bad photo,
-- an expired API key, a misrouted correction — leaves a queryable trace instead
-- of scrolling off Supabase's short-lived function logs.

create table if not exists intake_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  direction text not null check (direction = any (array['inbound'::text, 'outbound'::text])),
  chat_id bigint,
  telegram_user_id bigint,
  person text,
  telegram_msg_id bigint,
  stage text not null,
  message_type text,
  input_summary text,
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  success boolean not null,
  error text,
  duration_ms integer,
  transaction_id uuid references transactions(id) on delete set null
);

create index if not exists intake_logs_created_idx on intake_logs (created_at desc);
create index if not exists intake_logs_chat_idx on intake_logs (chat_id, created_at desc);
create index if not exists intake_logs_failed_idx on intake_logs (created_at desc) where success = false;

alter table intake_logs enable row level security;

drop policy if exists "intake_logs household all" on intake_logs;
create policy "intake_logs household all" on intake_logs
  for all to authenticated using (true) with check (true);
