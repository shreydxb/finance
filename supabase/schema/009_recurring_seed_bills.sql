-- Our Money v4 — seed real recurring bills/EMIs
-- Idempotent: guarded by name, safe to re-run. Exact due-days weren't given
-- for the EMIs/LIC entries, so day_of_month is left null — editable later
-- via the Recurring screen once known. Rent cheque dates and amounts
-- confirmed directly with Shrey.

insert into recurring (name, kind, amount, currency, owner, months, end_date)
select 'Car Loan EMI', 'emi', 2194, 'AED', 'Shrey', '{}', null
where not exists (select 1 from recurring where name = 'Car Loan EMI');

insert into recurring (name, kind, amount, currency, owner, months, end_date)
select 'Car Down-Payment CC EMI', 'emi', 1542, 'AED', 'Shrey', '{}', '2027-05-31'
where not exists (select 1 from recurring where name = 'Car Down-Payment CC EMI');

insert into recurring (name, kind, amount, currency, owner, months, end_date)
select '0% CC Loan', 'emi', 5207, 'AED', 'Shrey', '{}', '2026-12-31'
where not exists (select 1 from recurring where name = '0% CC Loan');

insert into recurring (name, kind, amount, currency, owner, months, end_date)
select 'Mobile EMI', 'emi', 134, 'AED', 'Shrey', '{}', null
where not exists (select 1 from recurring where name = 'Mobile EMI');

insert into recurring (name, kind, amount, currency, owner, months, end_date)
select 'LIC Premium (Tarika)', 'expense', 125, 'AED', 'Tarika', '{}', null
where not exists (select 1 from recurring where name = 'LIC Premium (Tarika)');

insert into recurring (name, kind, amount, currency, owner, months, end_date)
select 'LIC Premium (Shrey)', 'expense', 150000, 'INR', 'Shrey', '{12}', null
where not exists (select 1 from recurring where name = 'LIC Premium (Shrey)');

insert into recurring (name, kind, amount, currency, owner, day_of_month, months, end_date)
select 'Rent Cheque (Sep/Nov/Jan)', 'expense', 11700, 'AED', 'Joint', 6, '{9,11,1}', null
where not exists (select 1 from recurring where name = 'Rent Cheque (Sep/Nov/Jan)');

insert into recurring (name, kind, amount, currency, owner, day_of_month, months, end_date)
select 'Rent Cheque (Mar/May)', 'expense', 11600, 'AED', 'Joint', 6, '{3,5}', null
where not exists (select 1 from recurring where name = 'Rent Cheque (Mar/May)');
