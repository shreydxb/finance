// SHR-111 read-only pre-migration parity probe.
//
// This deliberately does not depend on migration 041, so it can compare the
// approved canonical classification with the current production schema before
// any canonical surface is applied. It performs SELECTs in a READ ONLY
// transaction and prints JSON evidence. Never pass a production URL via a
// command argument (which can leak through process lists); use the environment.

import pg from 'pg'

const { Client } = pg
const connectionString = process.env.PARITY_DATABASE_URL
const start = process.env.PARITY_START
const end = process.env.PARITY_END
const owner = process.env.PARITY_OWNER || null

if (!connectionString || !start || !end) {
  console.error('PARITY_DATABASE_URL, PARITY_START, and PARITY_END are required')
  process.exit(2)
}

const client = new Client({ connectionString })
await client.connect()

try {
  await client.query('begin read only')
  const { rows: periodRows } = await client.query(
    `with fx as (
       select value as rates, updated_at from settings where key='fx_rates'
     ), tx as (
       select t.*,
              t.amount * (fx.rates ->> t.currency)::numeric as amount_aed,
              case
                when t.group_kind='transfer' or t.category='Transfer' then 'internal_transfer'
                when t.category='Savings & Investments' then 'savings_movement'
                else 'consumption_spend'
              end as canonical_class
       from transactions t left join fx on true
       where t.deleted_at is null and t.date between $1 and $2
         and ($3::text is null or t.owner is not distinct from $3)
     ), inc as (
       select i.*, i.amount * (fx.rates ->> i.currency)::numeric as amount_aed
       from income i left join fx on true
       where i.date between $1 and $2
         and ($3::text is null or i.person is not distinct from $3)
     ), a as (
       select
         coalesce(sum(amount_aed) filter (where category is distinct from 'Transfer'),0) as legacy_app_spend_partial,
         coalesce(sum(amount_aed) filter (where category is distinct from 'Savings & Investments'),0) as legacy_telegram_spend_partial,
         coalesce(sum(amount_aed) filter (where canonical_class='consumption_spend'),0) as canonical_consumption_partial,
         coalesce(sum(amount_aed) filter (where canonical_class='savings_movement'),0) as canonical_savings_movement_partial,
         coalesce(sum(amount_aed) filter (where canonical_class='internal_transfer'),0) as excluded_transfer_movement,
         count(*) filter (where amount_aed is null) as transaction_missing_fx_count,
         count(*) filter (where amount_aed is null and canonical_class='consumption_spend') as consumption_missing_fx_count,
         count(*) filter (where amount_aed is null and canonical_class='savings_movement') as savings_movement_missing_fx_count,
         count(*) filter (where needs_review and amount<>0) as provisional_review_count,
         count(*) filter (where needs_review and amount=0) as zero_placeholder_count,
         count(*) filter (where group_kind='transfer') as typed_transfer_row_count,
         count(*) filter (where group_kind is distinct from 'transfer' and category='Transfer') as legacy_transfer_row_count,
         count(*) filter (where category='Savings & Investments') as savings_movement_row_count,
         count(*) filter (where category is null) as uncategorised_row_count
       from tx
     ), i as (
       select coalesce(sum(amount_aed),0) as income_partial,
              count(*) filter (where amount_aed is null) as income_missing_fx_count
       from inc
     )
     select a.*, i.*,
       case when i.income_missing_fx_count=0 then round(i.income_partial,2) end as canonical_posted_income,
       case when a.consumption_missing_fx_count=0 and a.zero_placeholder_count=0
         then round(a.canonical_consumption_partial,2) end as canonical_consumption_spend,
       case when a.savings_movement_missing_fx_count=0 then round(a.canonical_savings_movement_partial,2) end
         as canonical_savings_movement,
       round(a.legacy_app_spend_partial-a.canonical_consumption_partial,2) as app_delta_savings_exclusion,
       round(a.legacy_telegram_spend_partial-a.canonical_consumption_partial,2) as telegram_delta_transfer_exclusion
     from a cross join i`,
    [start, end, owner]
  )

  const { rows: balanceRows } = await client.query(
    `with fx as (select value as rates from settings where key='fx_rates'), a as (
       select accounts.*,
         accounts.value * (fx.rates ->> accounts.currency)::numeric as legacy_value_aed,
         (case when type='investment' and last_price is not null and quantity is not null
            then quantity*last_price else value end) * (fx.rates ->> accounts.currency)::numeric
            as canonical_value_aed,
         (fx.rates ->> accounts.currency)::numeric as rate,
         case when type='investment' and last_price is not null and quantity is not null
           then round(value,2)<>round(quantity*last_price,2) else false end as quote_mismatch,
         is_liability <> (type in ('credit_card','loan','mortgage','other_liability')) as type_mismatch
       from accounts left join fx on true
       where ($1::text is null or owner is not distinct from $1)
     ) select
       round(coalesce(sum(legacy_value_aed) filter(where not is_liability),0),2) as legacy_assets_partial,
       round(coalesce(sum(legacy_value_aed) filter(where is_liability),0),2) as legacy_liabilities_partial,
       round(coalesce(sum(canonical_value_aed) filter(where not is_liability),0),2) as canonical_assets_partial,
       round(coalesce(sum(canonical_value_aed) filter(where is_liability),0),2) as canonical_liabilities_partial,
       count(*) filter(where rate is null) as missing_fx_count,
       count(*) filter(where value<0) as negative_value_count,
       count(*) filter(where type_mismatch) as type_mismatch_count,
       count(*) filter(where quote_mismatch) as quoted_value_mismatch_count,
       count(*) filter(where type='investment' and last_price is null) as manual_investment_count,
       count(*) filter(where type='investment' and (quantity is null or avg_cost is null)) as missing_cost_basis_count
     from a`,
    [owner]
  )

  await client.query('rollback')
  console.log(JSON.stringify({
    contractVersion: 'shr-111-phase-a-v1',
    readOnly: true,
    period: { start, end, owner },
    periodParity: periodRows[0],
    balanceParity: balanceRows[0],
    intentionalDeltas: [
      'legacy app spend includes Savings & Investments; canonical consumption_spend does not',
      'legacy Telegram total_spend includes Transfer; canonical consumption_spend does not',
      'canonical balance uses quantity × authoritative last_price for quoted investments',
    ],
  }, null, 2))
} catch (error) {
  await client.query('rollback').catch(() => {})
  throw error
} finally {
  await client.end()
}
