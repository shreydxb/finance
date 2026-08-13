-- 026_atomic_writes.sql — DATA-02 (frontend paths)
--
-- Two operations in the app delete or write financial rows across several
-- independent REST calls. Between any two of them the browser can lose its
-- connection, the tab can close, or the request can fail — and the database is
-- left in a state neither the user nor the code expects.
--
--   1. Editing a category split DELETES the whole group, then inserts the
--      replacement. A failure in between destroys the original transaction
--      outright. Same for converting a single transaction into a split: the
--      original is deleted first.
--
--   2. A goal contribution is inserted, then its matching Transfer transaction
--      is inserted separately. A failure in between leaves a contribution with
--      no corresponding money movement, so Goals and Transactions disagree
--      about the same event.
--
-- A PL/pgSQL function body runs inside a single transaction, so moving these
-- into the database makes them all-or-nothing without any client coordination.
--
-- SECURITY INVOKER (the default) is deliberate: these run as the calling user,
-- so the membership policies from 023 still apply. A SECURITY DEFINER function
-- here would hand any caller a way around RLS, which is exactly what 023 just
-- closed.

begin;

-- ---------------------------------------------------------------------------
-- replace_category_split
-- ---------------------------------------------------------------------------
--
-- Replaces an existing split group, or an existing single row, with a new set
-- of category lines — atomically. Passing neither creates a new split.
--
-- Returns the rows it created, so the caller does not need a follow-up read.

create or replace function replace_category_split(
  p_group_id       uuid,
  p_transaction_id uuid,
  p_base           jsonb,
  p_lines          jsonb
)
returns setof transactions
language plpgsql
as $$
declare
  v_group_id uuid := gen_random_uuid();
  v_line     jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'replace_category_split requires at least one line';
  end if;

  -- The delete and the insert below are one transaction. If anything raises,
  -- the original rows are still there — which is the entire point.
  if p_group_id is not null then
    delete from transactions where transaction_group_id = p_group_id;
  elsif p_transaction_id is not null then
    delete from transactions where id = p_transaction_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    if (v_line ->> 'amount') is null then
      raise exception 'every split line needs an amount';
    end if;

    return query
    insert into transactions (
      date, amount, currency, account_id, category, owner, note, tags,
      source, needs_review, transaction_group_id, group_kind
    )
    values (
      (p_base ->> 'date')::date,
      (v_line ->> 'amount')::numeric,
      coalesce(p_base ->> 'currency', 'AED'),
      nullif(p_base ->> 'account_id', '')::uuid,
      v_line ->> 'category',
      nullif(p_base ->> 'owner', ''),
      nullif(p_base ->> 'note', ''),
      coalesce(
        (select array_agg(value) from jsonb_array_elements_text(coalesce(p_base -> 'tags', '[]'::jsonb))),
        '{}'::text[]
      ),
      'manual',
      false,
      v_group_id,
      'category_split'
    )
    returning *;
  end loop;
end;
$$;

comment on function replace_category_split(uuid, uuid, jsonb, jsonb) is
  'DATA-02: replaces a split group or single transaction with new category lines in one transaction, so a failure cannot destroy the original.';

-- ---------------------------------------------------------------------------
-- create_goal_contribution
-- ---------------------------------------------------------------------------
--
-- Records a contribution and, when funded from an account, the Transfer
-- transaction that represents the money leaving it — as one unit.
--
-- Never touches accounts.value: the money-data rule (PLAN.md decision 8) says
-- balances come from statements, not from a typed figure.

create or replace function create_goal_contribution(
  p_goal_id          uuid,
  p_amount           numeric,
  p_date             date,
  p_note             text,
  p_from_account_id  uuid,
  p_goal_name        text
)
returns jsonb
language plpgsql
as $$
declare
  v_contribution transactions%rowtype;
  v_contrib      goal_contributions%rowtype;
  v_txn          transactions%rowtype;
  v_currency     text;
  v_owner        text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'a contribution needs a positive amount';
  end if;

  insert into goal_contributions (goal_id, amount, date, note)
  values (p_goal_id, p_amount, p_date, p_note)
  returning * into v_contrib;

  if p_from_account_id is not null then
    select currency, owner into v_currency, v_owner
    from accounts where id = p_from_account_id;

    if not found then
      -- Rolls back the contribution too: a contribution funded from an account
      -- that does not exist is not a half-success worth keeping.
      raise exception 'account % not found', p_from_account_id;
    end if;

    insert into transactions (
      date, amount, currency, account_id, category, owner, note, source, needs_review
    )
    values (
      p_date, p_amount, coalesce(v_currency, 'AED'), p_from_account_id,
      'Transfer', v_owner,
      'Transfer out → Goal: ' || coalesce(p_goal_name, 'goal'),
      'manual', false
    )
    returning * into v_txn;
  end if;

  return jsonb_build_object(
    'contribution', to_jsonb(v_contrib),
    'transaction', case when v_txn.id is null then null else to_jsonb(v_txn) end
  );
end;
$$;

comment on function create_goal_contribution(uuid, numeric, date, text, uuid, text) is
  'DATA-02: writes a goal contribution and its funding Transfer transaction in one transaction, so Goals and Transactions cannot disagree about the same event.';

commit;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
--
--   select proname, prosecdef from pg_proc
--   where proname in ('replace_category_split','create_goal_contribution');
--   -- prosecdef must be false: these must run as the caller so RLS applies.
--
-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
--
--   drop function if exists replace_category_split(uuid, uuid, jsonb, jsonb);
--   drop function if exists create_goal_contribution(uuid, numeric, date, text, uuid, text);
--
-- The application code falls back to its previous multi-call behaviour when
-- these are absent only if reverted with it — the client change and this file
-- belong to the same commit.
