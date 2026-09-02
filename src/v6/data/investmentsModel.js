import { availableSlot, errorSlot, incompleteSlot } from './slots.js'
import { investmentsGapSlot } from './investmentsGaps.js'

/**
 * Wealth → Investments model (SHR-202).
 *
 * Two canonical reads and nothing else: `canonical_investment_metrics` for the
 * portfolio totals, and `v_canonical_accounts_aed` filtered to the canonical
 * investment type for the positions. There is no ledger input in scope at all,
 * which makes "no transaction-derived valuation, cost basis or history" a
 * structural property of this module rather than a convention — there are no
 * posted rows here to reconstruct anything from.
 *
 * Five rules shape everything below.
 *
 *  1. Every money figure is read, never computed. `quantity`, `last_price` and
 *     `fx_rate_to_aed` are all published, and multiplying them here would
 *     reproduce migration 041's arithmetic in the browser with none of its
 *     quality rules. They are carried as evidence — the price a holding is
 *     valued at, the rate that produced its AED figure — and the value itself
 *     comes from `canonical_value_aed`, which Postgres already computed.
 *  2. The portfolio total is the published total. It is never a sum of the
 *     rows below it, so a container and its contents can never both land in
 *     one figure, and an incomplete row can leave the total withheld while the
 *     rows themselves still render.
 *  3. Native and AED are separate published facts. A position with a native
 *     figure and no AED figure keeps its AED position empty and says why; the
 *     native number is never relabelled as AED.
 *  4. The contract's own quality verdicts gate its own figures. A row whose
 *     `quality_status` is incomplete withholds its value; a row whose
 *     `pnl_quality_status` is incomplete withholds its cost basis and profit.
 *     That mirrors exactly what `canonical_investment_metrics` does to the
 *     totals, applied per row, rather than inventing a second quality rule.
 *  5. Ownership and asset class are not in this model. The legacy `owner` text
 *     is discarded at the boundary — this module never receives it — so no
 *     component downstream can render it as an ownership claim by accident.
 */

const VALUATION_METHOD_LABELS = Object.freeze({
  account_balance: 'Recorded account balance',
  quantity_times_last_price: 'Quantity × last published price',
  manual_account_value: 'Manual account value',
})

// The canonical view's own categorisation of where a valuation timestamp comes
// from. These describe the published category; none is a verdict about how
// current a price is. "Manual entry" says who supplies the number, not whether
// it is old.
const FRESHNESS_EVIDENCE_LABELS = Object.freeze({
  account_balance: 'Recorded account balance',
  timestamped: 'Published price timestamp',
  manual: 'Manual entry, no published price',
  missing_timestamp: 'No price timestamp recorded',
})

const QUALITY_NOTES = Object.freeze({
  complete: 'The contract states this position in full.',
  provisional: 'The contract published this position and marked it provisional.',
  incomplete: 'The contract declined to state this position while its inputs are incomplete.',
})

function holdingName(row) {
  if (typeof row.name === 'string' && row.name.trim()) return row.name.trim()
  if (typeof row.ticker === 'string' && row.ticker.trim()) return row.ticker.trim()
  return 'Unnamed holding'
}

function nativeValueSlot(row) {
  if (row.canonical_value_native === null) {
    return incompleteSlot('The canonical contract publishes no native valuation for this holding.')
  }
  return availableSlot(row.canonical_value_native, { source: 'v_canonical_accounts_aed.canonical_value_native' })
}

/**
 * The AED value, gated by the contract's own quality verdict.
 *
 * Never filled from the native figure. A missing AED value means the canonical
 * contract could not state one — most often because `settings.fx_rates`
 * publishes no rate for this currency — and converting it here would answer a
 * question the contract deliberately declined to answer.
 */
function aedValueSlot(row) {
  if (row.quality_status === 'incomplete') {
    return incompleteSlot(
      row.fx_rate_to_aed === null
        ? `No published FX rate for ${row.currency}, so the canonical contract states no AED value. It is not converted here.`
        : 'The canonical contract withholds this AED value while its valuation inputs are incomplete.',
    )
  }
  if (row.canonical_value_aed === null) {
    return incompleteSlot('The canonical contract publishes no AED value for this holding.')
  }
  return availableSlot(row.canonical_value_aed, { source: 'v_canonical_accounts_aed.canonical_value_aed' })
}

/**
 * Cost basis and unrealized profit, gated by the contract's separate P&L
 * verdict.
 *
 * Both figures are published by migration 041 and read as published. Neither
 * is reconstructed from transaction history: there is no lot matching, no
 * FIFO, no weighted-average pass and no contributions-minus-withdrawals
 * approximation anywhere in this module, because the ledger is not read here
 * at all. When the contract marks the P&L incomplete, both are withheld
 * together — a cost basis without the profit it produced, or the reverse,
 * would invite the subtraction this screen must never perform.
 */
function pnlSlot(row, field, source) {
  if (row.pnl_quality_status === 'incomplete') {
    return incompleteSlot('The canonical contract withholds this holding’s cost basis and profit while its inputs are incomplete.')
  }
  if (row[field] === null) {
    return incompleteSlot('The canonical contract publishes no cost basis or profit for this holding.')
  }
  return availableSlot(row[field], { source })
}

function priceSlot(row) {
  if (row.last_price === null) {
    return incompleteSlot('No published price is recorded for this holding; its value is a manual account figure.')
  }
  return availableSlot(row.last_price, { source: 'v_canonical_accounts_aed.last_price' })
}

function quantitySlot(row) {
  if (row.quantity === null) {
    return incompleteSlot('No quantity is recorded for this holding.')
  }
  return availableSlot(row.quantity, { source: 'v_canonical_accounts_aed.quantity' })
}

function positionRow(row) {
  return Object.freeze({
    id: row.id,
    name: holdingName(row),
    ticker: row.ticker,
    currency: row.currency,
    quantity: quantitySlot(row),
    // The price is evidence about the valuation, carried with the currency it
    // is denominated in so it can never be read as an AED figure. It is not an
    // operand: nothing downstream multiplies it by anything.
    price: priceSlot(row),
    priceCurrency: row.currency,
    priceUpdatedAt: row.price_updated_at,
    priceSource: row.price_source,
    native: nativeValueSlot(row),
    aed: aedValueSlot(row),
    costBasisAed: pnlSlot(row, 'cost_basis_aed', 'v_canonical_accounts_aed.cost_basis_aed'),
    unrealizedPnlAed: pnlSlot(row, 'unrealized_pnl_aed', 'v_canonical_accounts_aed.unrealized_pnl_aed'),
    quality: row.quality_status,
    qualityNote: QUALITY_NOTES[row.quality_status] ?? null,
    pnlQuality: row.pnl_quality_status,
    valuationMethod: VALUATION_METHOD_LABELS[row.valuation_method] ?? row.valuation_method,
    valuationMethodKey: row.valuation_method,
    valuationAsOf: row.valuation_as_of,
    freshnessEvidence: row.freshness_status === null
      ? null
      : FRESHNESS_EVIDENCE_LABELS[row.freshness_status] ?? row.freshness_status,
    freshnessKey: row.freshness_status,
    fxRate: row.fx_rate_to_aed,
    fxUpdatedAt: row.fx_updated_at,
    // Both are the same gap for every row, held as slots so the prototype's
    // columns keep their place and state what is missing rather than printing
    // a value this screen would have had to author.
    ownership: investmentsGapSlot('ownership'),
    weight: investmentsGapSlot('allocation'),
    dayChange: investmentsGapSlot('dayChange'),
  })
}

function buildPositions(positions, error) {
  const empty = { rows: Object.freeze([]) }
  if (error) return Object.freeze({ status: 'unavailable', reason: error, ...empty })
  if (!Array.isArray(positions)) {
    return Object.freeze({
      status: 'unavailable',
      reason: 'Canonical investment positions have not been read.',
      ...empty,
    })
  }
  if (positions.length === 0) {
    return Object.freeze({
      status: 'empty',
      reason: 'No investment positions are recorded in the household’s canonical investment set.',
      ...empty,
    })
  }
  const rows = Object.freeze([...positions.map(positionRow)]
    .sort((left, right) => left.name.localeCompare(right.name, 'en')))
  return Object.freeze({ status: 'available', reason: null, rows })
}

function buildSummary(positions) {
  if (positions.status !== 'available') {
    return Object.freeze({ holdingCount: null, currencyCount: null, currencies: Object.freeze([]) })
  }
  const currencies = Object.freeze([...new Set(positions.rows.map((row) => row.currency))].sort())
  return Object.freeze({
    // Counts of canonical rows and of distinct canonical currency codes.
    // Neither is a financial metric, and neither says anything about how
    // current a valuation is.
    holdingCount: positions.rows.length,
    currencyCount: currencies.length,
    currencies,
  })
}

function totalSlot(value, error, field) {
  if (error) return errorSlot(error)
  if (value === null || value === undefined) {
    return incompleteSlot(`canonical_investment_metrics withholds ${field} while required position inputs are incomplete.`)
  }
  return availableSlot(value, { source: `canonical_investment_metrics.${field}` })
}

/**
 * The published portfolio figures.
 *
 * Every one is read from `canonical_investment_metrics`, which aggregates over
 * exactly the position set listed above and counts a shared holding once. None
 * is a sum of the rows in the table, and the unrealized profit is the
 * contract's own published figure — not the difference between the two totals
 * beside it, even though both happen to be present.
 */
function buildTotals(metrics, error) {
  return Object.freeze({
    value: totalSlot(metrics?.investment_value_aed, error, 'investment_value_aed'),
    costBasis: totalSlot(metrics?.cost_basis_aed, error, 'cost_basis_aed'),
    unrealizedPnl: totalSlot(metrics?.unrealized_pnl_aed, error, 'unrealized_pnl_aed'),
    scope: metrics?.scope ?? null,
    quality: metrics?.quality_status ?? null,
    incompleteValueCount: metrics?.incomplete_value_count ?? null,
    incompletePnlCount: metrics?.incomplete_pnl_count ?? null,
    provisionalCount: metrics?.provisional_count ?? null,
    manualValueCount: metrics?.manual_value_count ?? null,
    missingFxCount: metrics?.missing_fx_count ?? null,
    // Published as a count of rows older than a staleness boundary the caller
    // supplies. This consumer supplies none, so the contract's own answer is
    // zero and it is reported as "no staleness policy applied" rather than as
    // "nothing is stale".
    staleValueCount: metrics?.stale_value_count ?? null,
    fxBasis: metrics?.quality_metadata?.fx_basis ?? null,
    fxUpdatedAt: metrics?.quality_metadata?.fx_updated_at ?? null,
    oldestValuationAt: metrics?.quality_metadata?.oldest_valuation_at ?? null,
    newestValuationAt: metrics?.quality_metadata?.newest_valuation_at ?? null,
    missingFxCurrencies: Object.freeze(metrics?.quality_metadata?.missing_fx_currencies ?? []),
  })
}

// Every write the prototype exposes on this screen. Each is a named
// unsupported capability rather than a wired mutation: the screen is read-only
// and mounting it performs two selects and nothing else.
const CAPABILITIES = Object.freeze({
  addHolding: investmentsGapSlot('maintenance'),
  editHolding: investmentsGapSlot('maintenance'),
  refreshPrices: investmentsGapSlot('maintenance'),
  recordTrade: investmentsGapSlot('maintenance'),
})

const GAPS = Object.freeze({
  allocation: investmentsGapSlot('allocation'),
  assetClass: investmentsGapSlot('assetClass'),
  pnlPercent: investmentsGapSlot('pnlPercent'),
  dayChange: investmentsGapSlot('dayChange'),
  performanceHistory: investmentsGapSlot('performanceHistory'),
  returnMetrics: investmentsGapSlot('returnMetrics'),
  scope: investmentsGapSlot('scope'),
  ownership: investmentsGapSlot('ownership'),
  container: investmentsGapSlot('container'),
  brokerageCash: investmentsGapSlot('brokerageCash'),
  priceProvenance: investmentsGapSlot('priceProvenance'),
  freshness: investmentsGapSlot('freshness'),
})

export function buildInvestmentsModel({ metrics = null, positions = null, errors = {} }) {
  const built = buildPositions(positions, errors.positions ?? null)
  return Object.freeze({
    positions: built,
    summary: buildSummary(built),
    totals: buildTotals(metrics, errors.metrics ?? null),
    capabilities: CAPABILITIES,
    gaps: GAPS,
  })
}

/**
 * Resolves a `/wealth/investments/:id` deep link against the loaded canonical
 * set.
 *
 * Fails closed: an identifier that is not in the set the household could read
 * returns `unavailable` with the access gap, never a partially populated
 * record and never a claim that the holding exists elsewhere.
 */
export function resolveHoldingDetail(model, id) {
  if (!id) return Object.freeze({ status: 'none', row: null, slot: null })
  const row = model?.positions?.rows?.find((candidate) => candidate.id === id) ?? null
  if (row) return Object.freeze({ status: 'found', row, slot: null })
  return Object.freeze({ status: 'unavailable', row: null, slot: investmentsGapSlot('access') })
}

export { VALUATION_METHOD_LABELS, FRESHNESS_EVIDENCE_LABELS }
