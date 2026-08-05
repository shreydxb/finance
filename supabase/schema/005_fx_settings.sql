-- Our Money v4 — FX rates setting
-- Default currency conversion rates to AED, used by net worth calculations.
-- Editable later via the Settings screen; these are reasonable starting values
-- (AED/USD is a hard peg, AED/INR is an approximation) not live market data.

insert into settings (key, value) values
  ('fx_rates', '{"AED": 1, "USD": 3.6725, "INR": 0.044}'::jsonb)
on conflict (key) do nothing;
