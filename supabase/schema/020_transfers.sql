-- Fund transfers between the household's own accounts (docs/telegram-bot-round2-design.md §3).
-- Additive only, never destructive — this database carries real money data.
--
-- A transfer is not a spend — categorizing it as one double-counts it against
-- a budget. It also can't touch accounts.value (the money-data rule: balances
-- come from broker/bank screenshots only, never a chat message). So a
-- transfer instead writes two ordinary `transactions` rows tagged with a new
-- Transfer category, excluded from every spend/budget total by the paired
-- src/lib/reports.js and Budget.jsx change that ships alongside this.
--
-- The category "group" check constraint only allowed Needs/Wants/Savings —
-- widening it is the only way to add a fourth value without dropping the
-- constraint's coverage of the existing three.
alter table categories drop constraint if exists categories_group_check;
alter table categories add constraint categories_group_check
  check ("group" in ('Needs', 'Wants', 'Savings', 'Transfer'));

insert into categories (name, "group") values ('Transfer', 'Transfer')
on conflict (name) do nothing;
