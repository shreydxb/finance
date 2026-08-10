-- Itemized summary (docs/telegram-bot-round2-design.md §5).
-- Additive only, never destructive — this database carries real money data.
--
-- Display-only line items extracted from a receipt/order, when the source
-- itemizes one. Not quantity/avg_cost/last_price territory (that's investment
-- holdings on accounts, binding rule #4) — this is groceries and orders on
-- transactions, and nothing in Budget/Reports reads it.

alter table transactions add column if not exists items jsonb;
