-- 031_transaction_integrity.sql — DATA-05
--
-- Three of the thirteen real transactions carry `amount = 0`. The audit read
-- that as "no constraint prevents a zero amount", but a constraint blocking
-- zero outright would break the most important rule in this system.
--
-- All three are Telegram-sourced with `needs_review = true`. They are the
-- write-then-flag placeholders the intake pipeline creates deliberately when it
-- cannot read an amount: CLAUDE.md rule #2 — "a misrouted question costs an
-- /undo; a misrouted spend is money that never enters the ledger". Refusing to
-- write them would lose the spend entirely, which is worse than recording a
-- flagged zero.
--
-- So the invariant is not "never zero". It is:
--
--   a zero amount is a placeholder awaiting a human, never a finished record
--
-- Two constraints encode that. Both validate against the current data, which is
-- why they are added VALID rather than NOT VALID.

begin;

-- A zero amount is only acceptable while something is still flagging it.
alter table transactions drop constraint if exists transactions_zero_amount_flagged;
alter table transactions add constraint transactions_zero_amount_flagged check (
  amount <> 0 or needs_review
);

-- And it can never be signed off while still zero. This is the failure that
-- would actually corrupt a total: someone taps "looks right" on a placeholder,
-- and a row that means "we don't know" silently becomes a row that means
-- "this cost nothing".
alter table transactions drop constraint if exists transactions_reviewed_not_zero;
alter table transactions add constraint transactions_reviewed_not_zero check (
  reviewed_at is null or amount <> 0
);

comment on constraint transactions_zero_amount_flagged on transactions is
  'DATA-05: a zero amount is a placeholder the intake pipeline writes when it cannot read a figure. Allowed only while needs_review is set.';
comment on constraint transactions_reviewed_not_zero on transactions is
  'DATA-05: a placeholder cannot be marked reviewed while still zero — that would turn "unknown" into "free".';

commit;

-- Negative amounts are deliberately NOT constrained. There is no documented
-- sign convention and no refund model, so a rule here would be a guess; the
-- live data contains none today.
--
-- Verify:
--   select count(*) from transactions where amount = 0 and not needs_review;      -- 0
--   select count(*) from transactions where amount = 0 and reviewed_at is not null; -- 0
--
-- Rollback:
--   alter table transactions
--     drop constraint if exists transactions_zero_amount_flagged,
--     drop constraint if exists transactions_reviewed_not_zero;
