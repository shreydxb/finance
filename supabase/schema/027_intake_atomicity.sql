-- 027_intake_atomicity.sql — BOT-01
--
-- The Telegram pipeline writes money across several independent HTTP calls and
-- has no defence against the same update arriving twice. Telegram retries an
-- update when the webhook times out or answers 5xx, so redelivery is a normal
-- operating condition, not an edge case.
--
-- Five distinct failures, all of which end in money being lost or duplicated:
--
--   1. A transfer inserts its two rows sequentially. A failure between them
--      leaves half a transfer: money left an account and arrived nowhere.
--   2. Bulk input inserts N rows as N concurrent requests. Any subset can fail,
--      leaving a partial batch nobody is told about.
--   3. Cashback apply inserts income, then deletes the proposal. A retry
--      between the two logs the same income twice.
--   4. joinMediaGroup reads a JSON array, appends, and writes it back. Two
--      photos from one album arriving together overwrite each other's file id,
--      so a photo silently vanishes from the album.
--   5. claimMediaGroup checks processed_at and then patches it. Two
--      invocations can both pass the check and both extract the same album.
--
-- Nothing here is theoretical: an album is several updates delivered in
-- parallel by design, which is exactly the shape that breaks 4 and 5.

begin;

-- ---------------------------------------------------------------------------
-- 1. Idempotency for inbound writes
-- ---------------------------------------------------------------------------
--
-- A stable key derived from the Telegram message plus the row's position
-- within it. Replaying an update then collides instead of inserting again.
-- Nullable, because manual rows have no Telegram identity — the unique index
-- is partial so those are unaffected.

alter table transactions add column if not exists idempotency_key text;

create unique index if not exists transactions_idempotency_key_idx
  on transactions (idempotency_key)
  where idempotency_key is not null;

comment on column transactions.idempotency_key is
  'Stable per-row key for Telegram-sourced writes (chat:message:slot). Makes webhook redelivery a no-op instead of a duplicate spend.';

-- ---------------------------------------------------------------------------
-- 2. Album membership as rows, not a JSON array
-- ---------------------------------------------------------------------------
--
-- The primary key does the work the read-modify-write could not: two photos
-- arriving at once each insert their own row, and neither can clobber the
-- other. A duplicate delivery of the same photo collides harmlessly.

create table if not exists media_group_files (
  media_group_id text not null,
  file_id        text not null,
  chat_id        bigint not null,
  created_at     timestamptz not null default now(),
  primary key (media_group_id, file_id)
);

alter table media_group_files enable row level security;
drop policy if exists "media_group_files household all" on media_group_files;
create policy "media_group_files household all" on media_group_files for all to authenticated
  using (is_household_member()) with check (is_household_member());

comment on table media_group_files is
  'One row per photo in a Telegram album. Replaces the file_ids JSON array on media_groups, whose read-modify-write dropped photos when an album arrived in parallel.';

-- Carry over anything already recorded. Zero rows in production today.
insert into media_group_files (media_group_id, file_id, chat_id)
select g.media_group_id, f.value #>> '{}', g.chat_id
from media_groups g, lateral jsonb_array_elements(coalesce(g.file_ids, '[]'::jsonb)) f
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Atomic album claim
-- ---------------------------------------------------------------------------
--
-- One conditional UPDATE. Postgres serialises the row lock, so of two racing
-- callers exactly one sees a row updated and returns true. The loser gets
-- false and stops, instead of extracting the same album a second time.

create or replace function claim_media_group(p_media_group_id text)
returns boolean
language plpgsql
as $$
declare v_claimed int;
begin
  update media_groups
  set processed_at = now()
  where media_group_id = p_media_group_id
    and processed_at is null;

  get diagnostics v_claimed = row_count;
  return v_claimed = 1;
end;
$$;

comment on function claim_media_group(text) is
  'BOT-01: compare-and-set claim. Returns true to exactly one caller, so an album is extracted once even when its photos arrive in parallel.';

-- ---------------------------------------------------------------------------
-- 4. Transfers: two rows or none
-- ---------------------------------------------------------------------------

create or replace function create_transfer(
  p_date            date,
  p_amount          numeric,
  p_currency        text,
  p_from_account_id uuid,
  p_to_account_id   uuid,
  p_from_label      text,
  p_to_label        text,
  p_owner           text,
  p_needs_review    boolean,
  p_chat_id         bigint,
  p_message_id      bigint,
  p_idempotency_base text
)
returns setof transactions
language plpgsql
as $$
declare v_group uuid := gen_random_uuid();
begin
  return query
  insert into transactions (
    date, amount, currency, account_id, category, owner, note, source, needs_review,
    telegram_chat_id, telegram_msg_id, transaction_group_id, group_kind, transfer_direction,
    idempotency_key
  )
  values
    (p_date, p_amount, p_currency, p_from_account_id, 'Transfer', p_owner,
     'Transfer out → ' || coalesce(p_to_label, 'unknown account'), 'telegram', p_needs_review,
     p_chat_id, p_message_id, v_group, 'transfer', 'out', p_idempotency_base || ':out'),
    (p_date, p_amount, p_currency, p_to_account_id, 'Transfer', p_owner,
     'Transfer in ← ' || coalesce(p_from_label, 'unknown account'), 'telegram', p_needs_review,
     p_chat_id, p_message_id, v_group, 'transfer', 'in', p_idempotency_base || ':in')
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning *;
end;
$$;

comment on function create_transfer is
  'BOT-01: both sides of a transfer in one transaction, keyed so a redelivered update writes nothing rather than a second pair.';

-- ---------------------------------------------------------------------------
-- 5. Bulk input: every row or none
-- ---------------------------------------------------------------------------
--
-- p_rows is an array of objects; the array index becomes each row's
-- idempotency slot, so a replay collides row for row.

create or replace function create_bulk_transactions(
  p_rows             jsonb,
  p_chat_id          bigint,
  p_idempotency_base text
)
returns setof transactions
language plpgsql
as $$
declare
  v_group uuid := gen_random_uuid();
  v_row   jsonb;
  v_index int := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'create_bulk_transactions requires at least one row';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    return query
    insert into transactions (
      date, amount, currency, account_id, category, owner, note, source, needs_review,
      telegram_chat_id, items, transaction_group_id, group_kind, idempotency_key
    )
    values (
      (v_row ->> 'date')::date,
      (v_row ->> 'amount')::numeric,
      coalesce(v_row ->> 'currency', 'AED'),
      nullif(v_row ->> 'account_id', '')::uuid,
      nullif(v_row ->> 'category', ''),
      nullif(v_row ->> 'owner', ''),
      nullif(v_row ->> 'note', ''),
      'telegram',
      coalesce((v_row ->> 'needs_review')::boolean, false),
      p_chat_id,
      v_row -> 'items',
      v_group,
      'bulk_batch',
      p_idempotency_base || ':' || v_index
    )
    on conflict (idempotency_key) where idempotency_key is not null do nothing
    returning *;

    v_index := v_index + 1;
  end loop;
end;
$$;

comment on function create_bulk_transactions is
  'BOT-01: all rows of a bulk message in one transaction. Each row carries its own slot key, so a replay writes nothing.';

-- ---------------------------------------------------------------------------
-- 6. Cashback apply: idempotent by construction
-- ---------------------------------------------------------------------------
--
-- The proposal is deleted first, in the same transaction, and its deletion is
-- the guard: a replay finds nothing to delete and returns null, so the income
-- cannot be logged twice. No separate ledger needed.

create or replace function apply_pending_income(p_pending_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_pending pending_income%rowtype;
  v_income  income%rowtype;
begin
  delete from pending_income where id = p_pending_id returning * into v_pending;
  if not found then
    return null; -- already applied, or cancelled
  end if;

  if v_pending.amount is null then
    raise exception 'pending income % has no amount', p_pending_id;
  end if;

  insert into income (person, source, kind, amount, currency, date)
  values (v_pending.person, v_pending.source, v_pending.kind,
          v_pending.amount, v_pending.currency, v_pending.date)
  returning * into v_income;

  return to_jsonb(v_income);
end;
$$;

comment on function apply_pending_income(uuid) is
  'BOT-01: deletes the proposal and logs the income in one transaction. The delete is the idempotency guard — a replay finds nothing and returns null.';

commit;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
--
--   -- No function here may bypass RLS.
--   select proname, prosecdef from pg_proc
--   where proname in ('claim_media_group','create_transfer',
--                     'create_bulk_transactions','apply_pending_income');
--
--   -- Expect zero duplicate keys, always.
--   select idempotency_key, count(*) from transactions
--   where idempotency_key is not null group by 1 having count(*) > 1;
--
-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
--
--   drop function if exists claim_media_group(text);
--   drop function if exists create_transfer(date, numeric, text, uuid, uuid, text, text, text, boolean, bigint, bigint, text);
--   drop function if exists create_bulk_transactions(jsonb, bigint, text);
--   drop function if exists apply_pending_income(uuid);
--   drop index if exists transactions_idempotency_key_idx;
--
-- media_group_files and the idempotency_key column can stay: both are additive
-- and nothing breaks by leaving them in place.
