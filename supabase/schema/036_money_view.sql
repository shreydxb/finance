-- 036_money_view.sql — Taskiv #48
--
-- Bot-expansion Sprint 1's last foundation piece: a single FX-normalised view
-- every bot money query (Sprints 2, 3, 5, 6) sums through, instead of each
-- query converting `transactions.currency` to AED itself. If each query did
-- its own conversion those conversions would drift from each other and from
-- the app; skip conversion entirely and one stray INR row silently corrupts
-- every total that includes it — the exact class of quiet wrongness this
-- project exists to avoid.
--
-- `deleted_at is null` is baked in so no caller can forget it (015_bot_expansion).
--
-- Correction logged on Taskiv #48 (16 Aug 2026), binding on this file:
-- an unmatched currency must NOT fall back to a 1:1 rate. `src/lib/money.js`'s
-- `toAED` deliberately returns NaN rather than treat an unknown rate as parity
-- — silently asserting "1 USD = 1 AED" is a wrong number that looks entirely
-- plausible. This view keeps that contract in SQL: `amount_aed` is NULL for a
-- currency `fx_rates` doesn't have a rate for, and stays NULL through any sum
-- it enters, exactly like NaN does client-side. Callers must treat a NULL
-- amount_aed in an aggregate as "we don't actually know", never as "ignore
-- this row and keep going" — the whole point is that the bot and the app can
-- never quietly disagree about a total.
--
-- Sharp edge for whoever builds the query toolbox next: Postgres's sum()
-- silently SKIPS NULL inputs rather than propagating them (unlike the
-- NaN-through-arithmetic behaviour this mirrors client-side) — so
-- `sum(amount_aed)` alone does NOT surface an unconverted row, it just quietly
-- omits it from the total. Every money query must pair a sum with a check
-- such as `count(*) filter (where amount_aed is null)` over the same rows and
-- report that separately, or the exact quiet-wrongness this view exists to
-- prevent slips back in one level up.
--
-- Caveat, deliberately not fixed here: `fx_rates` is one static row, not a
-- history. A transaction from six months ago is converted at today's rate —
-- the same approximation the app's Reports screen already makes, so this
-- stays consistent with it rather than more "correct" and inconsistent.

create or replace view v_transactions_aed as
select
  t.*,
  t.amount * (select (s.value ->> t.currency)::numeric from settings s where s.key = 'fx_rates') as amount_aed,
  a.name as account_name,
  a.type as account_type,
  a.is_liability
from transactions t
left join accounts a on a.id = t.account_id
where t.deleted_at is null;

comment on view v_transactions_aed is
  'Every money query the Telegram bot runs (Sprints 2/3/5/6) sums amount_aed from here, never transactions.amount directly. amount_aed is NULL — not 1:1 AED — for a currency fx_rates has no rate for; see 036_money_view.sql for why that is deliberate. Soft-deleted rows are already excluded.';

-- Verify:
--   select amount, currency, amount_aed from v_transactions_aed limit 5;
--   -- a row in a currency missing from settings.fx_rates must show amount_aed = NULL, not a number.
--   select amount_aed from v_transactions_aed where currency = 'AED' limit 1;
--   -- must equal amount exactly (fx_rates seeds "AED": 1 — see 005_fx_settings.sql).
--
-- Rollback: drop view if exists v_transactions_aed;
