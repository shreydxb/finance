-- 030_telegram_settings_rpc.sql — UI-03
--
-- The Settings screen saved the Telegram configuration as four independent
-- upserts fired concurrently. Any subset could fail, leaving the household with
-- a configuration they believe they saved and the bot reading something else —
-- a person's id stored without the threshold that governs their spends, say.
--
-- One call, one transaction. SECURITY INVOKER, so the membership policies from
-- 023 still apply.

create or replace function save_telegram_settings(
  p_person1            jsonb,
  p_person2            jsonb,
  p_threshold          numeric,
  p_default_account_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_threshold is null or p_threshold < 0 or p_threshold > 1 then
    raise exception 'confidence threshold must be between 0 and 1, got %', p_threshold;
  end if;

  -- The bot only ever matches a receipt against cash or credit_card accounts,
  -- so anything else here would be stored and then silently ignored.
  if p_default_account_id is not null
     and not exists (
       select 1 from accounts
       where id = p_default_account_id and type in ('cash', 'credit_card')
     ) then
    raise exception 'fallback account must be a cash or credit_card account';
  end if;

  -- An unconfigured person slot arrives as SQL NULL, and settings.value is
  -- NOT NULL jsonb — inserting it raw failed a one-person setup with 23502.
  -- JSON null is the right representation: the key exists and its value is
  -- "nobody", which is what the Edge Function's parser already handles.
  insert into settings (key, value) values
    ('tg_id_1', coalesce(p_person1, 'null'::jsonb)),
    ('tg_id_2', coalesce(p_person2, 'null'::jsonb)),
    ('ai_confidence_threshold', to_jsonb(p_threshold)),
    ('tg_default_account_id', case when p_default_account_id is null
                                   then 'null'::jsonb
                                   else to_jsonb(p_default_account_id) end)
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

comment on function save_telegram_settings(jsonb, jsonb, numeric, uuid) is
  'UI-03: writes the whole Telegram configuration in one transaction, and rejects a fallback account the bot could never use.';

-- Verify:
--   select key, value from settings
--   where key in ('tg_id_1','tg_id_2','ai_confidence_threshold','tg_default_account_id');
--
-- Rollback: drop function if exists save_telegram_settings(jsonb, jsonb, numeric, uuid);
