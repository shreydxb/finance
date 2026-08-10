-- Multi-photo album batching (docs/telegram-bot-round2-design.md §6).
-- Additive only, never destructive — this database carries real money data.
--
-- Telegram delivers each photo in an album as its own webhook call, sharing
-- one media_group_id. This table lets a stateless Edge Function invocation
-- discover "did another album member arrive after me" without a cron job:
-- each photo upserts its file_id here and bumps updated_at; after a short
-- wait, whichever invocation's write is still the most recent claims the
-- whole group and runs one extraction across every photo in it. See
-- intake.ts's extractFromAlbumPhoto for the claim logic.

create table if not exists media_groups (
  media_group_id text primary key,
  chat_id bigint not null,
  file_ids jsonb not null default '[]'::jsonb,
  caption text,
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists media_groups_updated_idx on media_groups (updated_at desc);

alter table media_groups enable row level security;

drop policy if exists "media_groups household all" on media_groups;
create policy "media_groups household all" on media_groups
  for all to authenticated using (true) with check (true);
