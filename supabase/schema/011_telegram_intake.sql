-- Our Money v4 — Telegram/AI intake (Epic 7)
--
-- The three columns the intake flow was designed around (source, needs_review,
-- telegram_msg_id) already exist from 001_init. This file adds what the
-- confirm/fix loop needs on top, and the settings keys that configure it.
-- Additive-only and safe to re-run, like every other file here.

-- ── threading the confirm/fix conversation ────────────────────────────────
-- A correction can be replied onto either the household's original message
-- (telegram_msg_id) or the bot's follow-up prompt (telegram_prompt_msg_id).
-- Storing both means a fix always updates the row it belongs to instead of
-- creating a second one. chat_id scopes the lookup to the household group.
alter table transactions add column if not exists telegram_chat_id bigint;
alter table transactions add column if not exists telegram_prompt_msg_id bigint;

-- ── an intake row may land before its account is known ────────────────────
-- Confidence gating writes the row immediately and flags it, rather than
-- dropping a spend because the receipt didn't name a card. Relaxing the
-- constraint loses no data and no existing row changes.
alter table transactions alter column account_id drop not null;

create index if not exists transactions_telegram_msg_idx
  on transactions (telegram_chat_id, telegram_msg_id);
create index if not exists transactions_telegram_prompt_msg_idx
  on transactions (telegram_chat_id, telegram_prompt_msg_id);
create index if not exists transactions_needs_review_idx
  on transactions (needs_review) where needs_review;

-- ── settings ──────────────────────────────────────────────────────────────
-- telegram_user_id stays null until each person sends /id to the bot and the
-- number is filled in from Settings → Telegram intake. Until then the function
-- fails closed: nobody is in the allowlist, so nothing is written.
insert into settings (key, value) values
  ('tg_id_1', '{"person": "Shrey", "telegram_user_id": null}'::jsonb),
  ('tg_id_2', '{"person": "Tarika", "telegram_user_id": null}'::jsonb),
  -- Deliberately conservative: more Confirm/Fix pings early, fewer wrong rows
  -- landing silently in the budget. Tune it down once the extraction is trusted.
  ('ai_confidence_threshold', '0.85'::jsonb),
  -- Fallback account for spends whose payment method can't be matched.
  -- Null means "flag it for review instead of guessing".
  ('tg_default_account_id', 'null'::jsonb)
on conflict (key) do nothing;
