-- Edit Rules: match a transaction's note against a merchant/pattern and
-- auto-apply a category on create. One rule per matched pattern (case-
-- insensitive substring match against `note`); newest-first when more than
-- one rule matches, so a more specific rule added later can override.
--
-- Additive only: nothing here alters or drops an existing table.

create table if not exists category_rules (
  id uuid primary key default gen_random_uuid(),
  pattern text not null,
  category text not null,
  created_at timestamptz not null default now()
);

alter table category_rules enable row level security;

drop policy if exists "category_rules household all" on category_rules;
create policy "category_rules household all" on category_rules
  for all to authenticated using (true) with check (true);

create index if not exists category_rules_created_idx on category_rules (created_at desc);
