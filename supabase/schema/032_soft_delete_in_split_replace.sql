-- 032_soft_delete_in_split_replace.sql — DATA-04
--
-- 026's replace_category_split issued a hard DELETE on the rows it replaced.
-- Now that the UI soft-deletes everywhere else, that was the last path in the
-- app that destroyed a financial row outright — and it is the one operating on
-- the most rows at once.
--
-- Soft-deleting instead keeps what the split used to be. Since the replacement
-- gets a fresh transaction_group_id and every read filters deleted_at, the old
-- lines simply disappear from view while remaining recoverable.

create or replace function replace_category_split(
  p_group_id       uuid,
  p_transaction_id uuid,
  p_base           jsonb,
  p_lines          jsonb
)
returns setof transactions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_group_id uuid := gen_random_uuid();
  v_line     jsonb;
  v_now      timestamptz := now();
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'replace_category_split requires at least one line';
  end if;

  -- Soft, not hard (DATA-04). Still one transaction, so a failure below leaves
  -- the originals visible exactly as they were.
  if p_group_id is not null then
    update transactions set deleted_at = v_now
    where transaction_group_id = p_group_id and deleted_at is null;
  elsif p_transaction_id is not null then
    update transactions set deleted_at = v_now
    where id = p_transaction_id and deleted_at is null;
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
