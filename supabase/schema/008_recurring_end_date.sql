-- Our Money v4 — recurring end date
-- Some recurring EMIs are finite (e.g. a loan that finishes in a known
-- month), not perpetual. Additive, nullable — null means "no end, recurs
-- indefinitely."

alter table recurring add column if not exists end_date date;
