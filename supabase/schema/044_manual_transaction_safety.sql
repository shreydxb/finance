-- 044_manual_transaction_safety.sql — SHR-126
--
-- Minimum authoritative write contract for ordinary manual transactions.
-- This migration adds no tables, columns, triggers, policies, backfills, or
-- financial calculation changes. The function executes as its caller so the
-- existing household RLS policies remain the authorization boundary.

begin;

create or replace function public.save_manual_transaction(
  p_transaction_id uuid,
  p_request_key     text,
  p_date            date,
  p_amount          numeric,
  p_currency        text,
  p_account_id      uuid,
  p_category        text,
  p_owner           text,
  p_note            text,
  p_tags            text[],
  p_assigned_to     text,
  p_goal_id         uuid
)
returns public.transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.transactions%rowtype;
  v_saved    public.transactions%rowtype;
  v_category text := nullif(btrim(p_category), '');
  v_note     text := nullif(btrim(p_note), '');
  v_tags     text[] := coalesce(p_tags, '{}'::text[]);
begin
  -- A create replay is checked before current-reference validation. If a save
  -- committed and its response was lost, a later category/account change must
  -- not turn that already-completed request into an ambiguous failure or a
  -- second financial fact.
  if p_transaction_id is null then
    if p_request_key is null or p_request_key !~
      '^manual:[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then
      raise exception using errcode = 'P0001', message = 'SHR126_REQUEST_KEY_INVALID';
    end if;

    select t.* into v_existing
    from public.transactions t
    where t.idempotency_key = p_request_key;

    if found then
      if v_existing.deleted_at is not null then
        raise exception using errcode = 'P0001', message = 'SHR126_REQUEST_ALREADY_DELETED';
      end if;

      if v_existing.source = 'manual'
        and not v_existing.needs_review
        and v_existing.reviewed_at is not null
        and v_existing.transaction_group_id is null
        and v_existing.group_kind is null
        and v_existing.date is not distinct from p_date
        and v_existing.amount is not distinct from p_amount
        and v_existing.currency is not distinct from p_currency
        and v_existing.account_id is not distinct from p_account_id
        and v_existing.category is not distinct from v_category
        and v_existing.owner is not distinct from p_owner
        and v_existing.note is not distinct from v_note
        and v_existing.tags is not distinct from v_tags
        and v_existing.assigned_to is not distinct from p_assigned_to
        and v_existing.goal_id is not distinct from p_goal_id
      then
        return v_existing;
      end if;

      raise exception using errcode = 'P0001', message = 'SHR126_REQUEST_KEY_CONFLICT';
    end if;
  else
    select t.* into v_existing
    from public.transactions t
    where t.id = p_transaction_id
    for update;

    if not found then
      raise exception using errcode = 'P0001', message = 'SHR126_TRANSACTION_NOT_FOUND';
    end if;
    if v_existing.deleted_at is not null then
      raise exception using errcode = 'P0001', message = 'SHR126_TRANSACTION_DELETED';
    end if;
    if v_existing.transaction_group_id is not null or v_existing.group_kind is not null then
      raise exception using errcode = 'P0001', message = 'SHR126_GROUPED_CORRECTION_UNSUPPORTED';
    end if;
    if v_existing.category = 'Transfer' then
      raise exception using errcode = 'P0001', message = 'SHR126_TRANSFER_UNSUPPORTED';
    end if;
  end if;

  if p_date is null then
    raise exception using errcode = 'P0001', message = 'SHR126_DATE_REQUIRED';
  end if;
  if p_date > (now() at time zone 'Asia/Dubai')::date then
    raise exception using errcode = 'P0001', message = 'SHR126_DATE_FUTURE';
  end if;
  if p_amount is null
    or p_amount::text in ('NaN', 'Infinity', '-Infinity')
    or p_amount <= 0
    or round(p_amount, 2) <> p_amount
  then
    raise exception using errcode = 'P0001', message = 'SHR126_AMOUNT_INVALID';
  end if;
  if p_currency is null or p_currency not in ('AED', 'USD', 'INR') then
    raise exception using errcode = 'P0001', message = 'SHR126_CURRENCY_INVALID';
  end if;
  if p_account_id is null then
    raise exception using errcode = 'P0001', message = 'SHR126_ACCOUNT_REQUIRED';
  end if;

  perform 1 from public.accounts a where a.id = p_account_id for key share;
  if not found then
    raise exception using errcode = 'P0001', message = 'SHR126_ACCOUNT_INVALID';
  end if;

  if v_category is null then
    raise exception using errcode = 'P0001', message = 'SHR126_CATEGORY_REQUIRED';
  end if;
  if v_category = 'Transfer' then
    raise exception using errcode = 'P0001', message = 'SHR126_TRANSFER_UNSUPPORTED';
  end if;

  perform 1 from public.categories c where c.name = v_category for key share;
  if not found then
    raise exception using errcode = 'P0001', message = 'SHR126_CATEGORY_INVALID';
  end if;

  if p_owner is null or p_owner not in ('Shrey', 'Tarika', 'Joint') then
    raise exception using errcode = 'P0001', message = 'SHR126_OWNER_INVALID';
  end if;
  if p_assigned_to is not null and p_assigned_to not in ('Shrey', 'Tarika') then
    raise exception using errcode = 'P0001', message = 'SHR126_ASSIGNEE_INVALID';
  end if;
  if p_goal_id is not null then
    perform 1 from public.goals g where g.id = p_goal_id for key share;
    if not found then
      raise exception using errcode = 'P0001', message = 'SHR126_GOAL_INVALID';
    end if;
  end if;

  if p_transaction_id is null then
    begin
      insert into public.transactions (
        date, amount, currency, account_id, category, owner, note, tags,
        assigned_to, goal_id, source, needs_review, reviewed_at, idempotency_key
      ) values (
        p_date, p_amount, p_currency, p_account_id, v_category, p_owner, v_note, v_tags,
        p_assigned_to, p_goal_id, 'manual', false, now(), p_request_key
      )
      returning * into v_saved;
    exception when unique_violation then
      -- A concurrent retry can win the unique-key race after our initial read.
      -- Read it back and apply the same exact-payload replay contract.
      select t.* into v_saved
      from public.transactions t
      where t.idempotency_key = p_request_key;

      if not found
        or v_saved.deleted_at is not null
        or v_saved.source <> 'manual'
        or v_saved.needs_review
        or v_saved.reviewed_at is null
        or v_saved.transaction_group_id is not null
        or v_saved.group_kind is not null
        or v_saved.date is distinct from p_date
        or v_saved.amount is distinct from p_amount
        or v_saved.currency is distinct from p_currency
        or v_saved.account_id is distinct from p_account_id
        or v_saved.category is distinct from v_category
        or v_saved.owner is distinct from p_owner
        or v_saved.note is distinct from v_note
        or v_saved.tags is distinct from v_tags
        or v_saved.assigned_to is distinct from p_assigned_to
        or v_saved.goal_id is distinct from p_goal_id
      then
        raise exception using errcode = 'P0001', message = 'SHR126_REQUEST_KEY_CONFLICT';
      end if;
    end;

    return v_saved;
  end if;

  update public.transactions
  set date = p_date,
      amount = p_amount,
      currency = p_currency,
      account_id = p_account_id,
      category = v_category,
      owner = p_owner,
      note = v_note,
      tags = v_tags,
      assigned_to = p_assigned_to,
      goal_id = p_goal_id,
      needs_review = false,
      reviewed_at = now()
  where id = p_transaction_id
  returning * into v_saved;

  return v_saved;
end;
$$;

comment on function public.save_manual_transaction(
  uuid, text, date, numeric, text, uuid, text, text, text, text[], text, uuid
) is
  'SHR-126: validates and atomically creates/replays or corrects one ordinary manual transaction as explicit human-confirmed truth. SECURITY INVOKER; existing household RLS remains authoritative.';

revoke all on function public.save_manual_transaction(
  uuid, text, date, numeric, text, uuid, text, text, text, text[], text, uuid
) from public, anon;
grant execute on function public.save_manual_transaction(
  uuid, text, date, numeric, text, uuid, text, text, text, text[], text, uuid
) to authenticated, service_role;

-- Keep the existing four-argument split API and atomic soft-replacement model.
-- SHR-126 adds only authoritative input checks, Transfer containment, and the
-- confirmed-review timestamp required for new/replaced manual split rows.
create or replace function public.replace_category_split(
  p_group_id       uuid,
  p_transaction_id uuid,
  p_base           jsonb,
  p_lines          jsonb
)
returns setof public.transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_group_id         uuid := extensions.gen_random_uuid();
  v_line             jsonb;
  v_original_amount  numeric := 0;
  v_line_amount      numeric;
  v_category         text;
  v_date             date;
  v_account_id       uuid;
  v_owner            text;
  v_currency         text := coalesce(nullif(p_base ->> 'currency', ''), 'AED');
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = 'P0001', message = 'SHR126_SPLIT_LINES_REQUIRED';
  end if;
  if p_group_id is not null and p_transaction_id is not null then
    raise exception using errcode = 'P0001', message = 'SHR126_SPLIT_REPLACEMENT_INVALID';
  end if;

  begin
    v_date := nullif(p_base ->> 'date', '')::date;
    v_account_id := nullif(p_base ->> 'account_id', '')::uuid;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception using errcode = 'P0001', message = 'SHR126_SPLIT_BASE_INVALID';
  end;
  v_owner := nullif(p_base ->> 'owner', '');

  if v_date is null or v_date > (now() at time zone 'Asia/Dubai')::date then
    raise exception using errcode = 'P0001', message = 'SHR126_DATE_INVALID';
  end if;
  if v_currency not in ('AED', 'USD', 'INR') then
    raise exception using errcode = 'P0001', message = 'SHR126_CURRENCY_INVALID';
  end if;
  if v_owner is null or v_owner not in ('Shrey', 'Tarika', 'Joint') then
    raise exception using errcode = 'P0001', message = 'SHR126_OWNER_INVALID';
  end if;

  perform 1 from public.accounts a where a.id = v_account_id for key share;
  if not found then
    raise exception using errcode = 'P0001', message = 'SHR126_ACCOUNT_INVALID';
  end if;

  if p_group_id is not null then
    perform 1 from public.transactions t
    where t.transaction_group_id = p_group_id
      and t.group_kind = 'category_split'
      and t.deleted_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'SHR126_SPLIT_NOT_FOUND';
    end if;
  elsif p_transaction_id is not null then
    perform 1 from public.transactions t
    where t.id = p_transaction_id
      and t.deleted_at is null
      and t.transaction_group_id is null
      and t.group_kind is null
      and t.category is distinct from 'Transfer'
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'SHR126_SPLIT_SOURCE_INVALID';
    end if;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    begin
      v_line_amount := nullif(v_line ->> 'amount', '')::numeric;
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = 'SHR126_AMOUNT_INVALID';
    end;
    v_category := nullif(btrim(v_line ->> 'category'), '');

    if v_line_amount is null
      or v_line_amount::text in ('NaN', 'Infinity', '-Infinity')
      or v_line_amount <= 0
      or round(v_line_amount, 2) <> v_line_amount
    then
      raise exception using errcode = 'P0001', message = 'SHR126_AMOUNT_INVALID';
    end if;
    if v_category is null then
      raise exception using errcode = 'P0001', message = 'SHR126_CATEGORY_REQUIRED';
    end if;
    if v_category = 'Transfer' then
      raise exception using errcode = 'P0001', message = 'SHR126_TRANSFER_UNSUPPORTED';
    end if;

    perform 1 from public.categories c where c.name = v_category for key share;
    if not found then
      raise exception using errcode = 'P0001', message = 'SHR126_CATEGORY_INVALID';
    end if;

    v_original_amount := v_original_amount + v_line_amount;
  end loop;

  if round(v_original_amount, 2) <> v_original_amount then
    raise exception using errcode = 'P0001', message = 'SHR126_AMOUNT_INVALID';
  end if;

  if p_group_id is not null then
    update public.transactions
    set deleted_at = now()
    where transaction_group_id = p_group_id and deleted_at is null;
  elsif p_transaction_id is not null then
    update public.transactions
    set deleted_at = now()
    where id = p_transaction_id and deleted_at is null;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_amount := (v_line ->> 'amount')::numeric;
    v_category := btrim(v_line ->> 'category');

    return query
    insert into public.transactions (
      date, amount, currency, account_id, category, owner, note, tags,
      source, needs_review, reviewed_at, transaction_group_id, group_kind,
      split_original_amount, split_original_currency
    ) values (
      v_date,
      v_line_amount,
      v_currency,
      v_account_id,
      v_category,
      v_owner,
      nullif(btrim(p_base ->> 'note'), ''),
      coalesce(
        (select array_agg(value) from jsonb_array_elements_text(coalesce(p_base -> 'tags', '[]'::jsonb))),
        '{}'::text[]
      ),
      'manual',
      false,
      now(),
      v_group_id,
      'category_split',
      v_original_amount,
      v_currency
    )
    returning *;
  end loop;
end;
$$;

comment on function public.replace_category_split(uuid, uuid, jsonb, jsonb) is
  'SHR-111/126: atomically replaces a validated category split, preserves original amount/currency identity, soft-deletes replaced rows, rejects Transfer lines, and records explicit manual confirmation.';

comment on column public.transactions.idempotency_key is
  'Stable per-row request key. Telegram uses chat/message/slot keys; SHR-126 ordinary manual creates use manual:<uuid> so a lost response or retry has one financial effect.';

commit;

-- Verification (scratch DB only; never production during SHR-126 implementation):
--   select prosecdef, proconfig
--   from pg_proc where oid = 'public.save_manual_transaction(uuid,text,date,numeric,text,uuid,text,text,text,text[],text,uuid)'::regprocedure;
--   -- prosecdef=false; proconfig={search_path=""}
--
-- Rollback after first rolling back the frontend:
--   drop function if exists public.save_manual_transaction(uuid,text,date,numeric,text,uuid,text,text,text,text[],text,uuid);
--   restore public.replace_category_split(uuid,uuid,jsonb,jsonb) from migration 041.
