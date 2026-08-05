-- Our Money v4 — Row Level Security
-- Household model: any authenticated user (the 2 accounts) gets full access.
-- Not per-user isolation — both partners see and edit everything.
-- Policies are re-declared idempotently (drop-if-exists + create); this never
-- touches table data, only access rules, so it stays within additive-only
-- discipline for the schema itself.

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'accounts', 'transactions', 'categories', 'budgets', 'recurring',
      'goals', 'goal_contributions', 'income', 'settings', 'nw_snapshots',
      'forecast_events'
    ])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists household_all on %I', t);
    execute format(
      'create policy household_all on %I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;
