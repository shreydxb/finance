-- 028_price_provenance.sql — UI-01
--
-- The Investments screen shows "prices last refreshed <time>", derived from
-- `accounts.updated_at`. That column moves on *any* write, so renaming a
-- holding or correcting its quantity makes the price look freshly fetched when
-- it has not been touched in weeks.
--
-- This matters more than a cosmetic timestamp. `refresh-prices` covers only US
-- tickers; the 25 India equities and the metals have no ticker on purpose and
-- are never auto-priced. Without a price-specific timestamp there is no way to
-- tell a stale quote from a current one, and a stale quote quietly misstates
-- net worth.

begin;

alter table accounts
  add column if not exists price_updated_at timestamptz,
  add column if not exists price_source text;

comment on column accounts.price_updated_at is
  'When last_price was last written by a price fetch. Distinct from updated_at, which moves on any edit — see 028.';
comment on column accounts.price_source is
  'Where last_price came from (e.g. yahoo, coingecko). Null means the price was entered by hand from a broker statement.';

-- Seed from updated_at for holdings that already carry a fetched price, so the
-- screen has something to show rather than reading "never" for everything.
-- Approximate by construction: it is the best evidence available, and it only
-- ever moves the displayed time *earlier* than the truth once real refreshes
-- start writing the column.
update accounts
set price_updated_at = updated_at,
    price_source = 'unknown (seeded from updated_at)'
where type = 'investment'
  and last_price is not null
  and price_updated_at is null;

commit;

-- Verify:
--   select name, last_price, price_source, price_updated_at
--   from accounts where type = 'investment' and last_price is not null;
--
-- Rollback: the columns are nullable and additive; dropping them is safe but
-- unnecessary. Reverting the application code is enough.
