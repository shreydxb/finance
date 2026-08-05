-- Our Money v4 — seed data
-- Idempotent: safe to re-run. Uses ON CONFLICT / WHERE NOT EXISTS guards
-- everywhere so nothing duplicates and nothing is ever deleted.
--
-- Owner names: "Shrey" and "Tarika" (per prior household app reference).
-- If "Tarika" isn't right, update these rows via the app once Settings/
-- Accounts screens exist — nothing here is destructive to correct later.

-- ── categories ────────────────────────────────────────────────────────────
insert into categories (name, "group", icon) values
  ('Rent', 'Needs', '🏠'),
  ('Utilities', 'Needs', '💡'),
  ('Groceries', 'Needs', '🛒'),
  ('Transport & Fuel', 'Needs', '⛽'),
  ('Dining Out', 'Wants', '🍽️'),
  ('Entertainment', 'Wants', '🎬'),
  ('Shopping', 'Wants', '🛍️'),
  ('Travel', 'Wants', '✈️'),
  ('Subscriptions', 'Wants', '🔁'),
  ('Personal Care', 'Wants', '🧴'),
  ('Other', 'Wants', '❓'),
  ('Savings & Investments', 'Savings', '💰'),
  ('Family Support', 'Needs', '👪'),
  ('Clothing', 'Wants', '👕'),
  ('Medical', 'Needs', '🩺'),
  ('Gifts', 'Wants', '🎁'),
  ('Car Insurance & Registration', 'Needs', '🚗'),
  ('Car Servicing', 'Needs', '🔧')
on conflict (name) do nothing;

-- ── goals: Emergency Fund ─────────────────────────────────────────────────
insert into goals (name, kind, icon, target_amount, priority)
select 'Emergency Fund', 'save_up', '🛟', 70000, 1
where not exists (select 1 from goals where name = 'Emergency Fund');

-- ── recurring: income ─────────────────────────────────────────────────────
insert into recurring (name, kind, amount, currency, owner, months)
select 'Shrey Salary', 'income', 20000, 'AED', 'Shrey', '{}'
where not exists (select 1 from recurring where name = 'Shrey Salary');

insert into recurring (name, kind, amount, currency, owner, months)
select 'Tarika Salary', 'income', 8500, 'AED', 'Tarika', '{}'
where not exists (select 1 from recurring where name = 'Tarika Salary');

insert into recurring (name, kind, amount, currency, owner, months)
select 'Shrey Bonus', 'income', 6000, 'AED', 'Shrey', '{6,12}'
where not exists (select 1 from recurring where name = 'Shrey Bonus');

insert into recurring (name, kind, amount, currency, owner, months)
select 'Shrey Flight Allowance', 'income', 3400, 'AED', 'Shrey', '{5}'
where not exists (select 1 from recurring where name = 'Shrey Flight Allowance');

insert into recurring (name, kind, amount, currency, owner, months)
select 'Tarika Flight Allowance', 'income', 2500, 'AED', 'Tarika', '{12}'
where not exists (select 1 from recurring where name = 'Tarika Flight Allowance');

-- ── settings ──────────────────────────────────────────────────────────────
insert into settings (key, value) values
  ('income_split', '{"shrey": 0.69, "tarika": 0.31}'::jsonb),
  ('fire_swr', '0.04'::jsonb),
  ('fire_return', '0.07'::jsonb),
  ('fire_expense', 'null'::jsonb)
on conflict (key) do nothing;
