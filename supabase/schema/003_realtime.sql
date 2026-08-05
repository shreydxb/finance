-- Our Money v4 — Realtime
-- Supabase projects ship a `supabase_realtime` publication by default.
-- Enable it on the tables both partners need to see update live across phones.

do $$
declare
  t text;
begin
  for t in
    select unnest(array['transactions', 'income', 'accounts', 'goal_contributions'])
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
