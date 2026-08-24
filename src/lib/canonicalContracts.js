export const CANONICAL_QUALITY = Object.freeze({
  complete: 0,
  provisional: 1,
  incomplete: 2,
})

export const CANONICAL_QUALITY_VALUES = Object.freeze(Object.keys(CANONICAL_QUALITY))
export const SAVINGS_RATE_REASONS = Object.freeze(['incomplete_inputs', 'nonpositive_income'])
export const ECONOMIC_CLASSIFICATIONS = Object.freeze([
  'consumption_spend',
  'savings_movement',
  'internal_transfer',
])
const CLASSIFICATION_REASONS = Object.freeze([
  'typed_transfer',
  'legacy_exact_transfer_category',
  'legacy_exact_savings_category',
  'uncategorised_consumption',
  'categorised_consumption',
])

function contractError(message) {
  return new Error(`Canonical contract error: ${message}`)
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw contractError(`${label} must be an object`)
  return value
}

function normalizeText(value, label, { nullable = false, empty = false } = {}) {
  if (value === null && nullable) return null
  if (typeof value !== 'string' || (!empty && value.trim() === '')) throw contractError(`${label} must be text`)
  return value
}

function normalizeDate(value, label) {
  const text = normalizeText(value, label)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw contractError(`${label} must be YYYY-MM-DD`)
  return text
}

export function normalizeCanonicalMoney(value, label, { nullable = true } = {}) {
  if (value === null && nullable) return null
  if (typeof value !== 'number' && typeof value !== 'string') throw contractError(`${label} must be numeric`)
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) {
    throw contractError(`${label} must be numeric`)
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) throw contractError(`${label} must be finite`)
  return numeric
}

function normalizeCount(value, label) {
  const numeric = normalizeCanonicalMoney(value, label, { nullable: false })
  if (!Number.isSafeInteger(numeric) || numeric < 0) throw contractError(`${label} must be a non-negative integer`)
  return numeric
}

function normalizeBoolean(value, label) {
  if (typeof value !== 'boolean') throw contractError(`${label} must be boolean`)
  return value
}

function normalizeTimestamp(value, label, { nullable = true } = {}) {
  if (value === null && nullable) return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw contractError(`${label} must be a timestamp${nullable ? ' or null' : ''}`)
  }
  return value
}

function normalizeTextArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
    throw contractError(`${label} must be text[]`)
  }
  return [...value]
}

function sameMoney(left, right) {
  if (left === null || right === null) return left === right
  return Math.round(left * 100) === Math.round(right * 100)
}

function roundToCents(value) {
  const roundedMagnitude = Math.round(Math.abs(value) * 100 + 1e-9) / 100
  return value < 0 ? -roundedMagnitude : roundedMagnitude
}

export function normalizeCanonicalQuality(value, label = 'quality_status') {
  if (!Object.hasOwn(CANONICAL_QUALITY, value)) throw contractError(`${label} has unknown value ${String(value)}`)
  return value
}

export function mergeCanonicalQuality(...values) {
  if (values.length === 0) return 'complete'
  return values.map((value) => normalizeCanonicalQuality(value)).reduce((worst, value) =>
    CANONICAL_QUALITY[value] > CANONICAL_QUALITY[worst] ? value : worst
  , 'complete')
}

function normalizeQualityMetadata(value) {
  const metadata = assertObject(value, 'quality_metadata')
  if (metadata.fx_basis !== 'current_rate_aed') throw contractError('quality_metadata.fx_basis is unknown')
  if (metadata.classification_version !== 'shr-111-phase-a-v1') {
    throw contractError('quality_metadata.classification_version is unknown')
  }
  if (metadata.fx_updated_at !== null
    && (typeof metadata.fx_updated_at !== 'string' || !Number.isFinite(Date.parse(metadata.fx_updated_at)))) {
    throw contractError('quality_metadata.fx_updated_at must be a timestamp or null')
  }
  return {
    ...metadata,
    missing_fx_currencies: normalizeTextArray(metadata.missing_fx_currencies, 'quality_metadata.missing_fx_currencies'),
    income_incomplete_count: normalizeCount(metadata.income_incomplete_count, 'income_incomplete_count'),
    consumption_incomplete_count: normalizeCount(metadata.consumption_incomplete_count, 'consumption_incomplete_count'),
    savings_movement_incomplete_count: normalizeCount(
      metadata.savings_movement_incomplete_count,
      'savings_movement_incomplete_count'
    ),
    provisional_transaction_count: normalizeCount(metadata.provisional_transaction_count, 'provisional_transaction_count'),
    zero_placeholder_count: normalizeCount(metadata.zero_placeholder_count, 'quality_metadata.zero_placeholder_count'),
  }
}

function sameNullableText(actual, expected) {
  return actual === expected
}

export function normalizeCanonicalPeriodResponse(data, expected) {
  if (!Array.isArray(data)) throw contractError('canonical_period_metrics response must be an array')
  if (data.length !== 1) throw contractError(`canonical_period_metrics returned ${data.length} rows; expected exactly one`)
  const row = assertObject(data[0], 'canonical_period_metrics row')
  const periodStart = normalizeDate(row.period_start, 'period_start')
  const periodEnd = normalizeDate(row.period_end, 'period_end')
  const scope = normalizeText(row.scope, 'scope')
  if (!['household', 'person'].includes(scope)) throw contractError(`scope has unknown value ${scope}`)
  const person = normalizeText(row.person, 'person', { nullable: true, empty: true })

  if (periodStart !== expected.from || periodEnd !== expected.to) throw contractError('period does not match request')
  if (scope !== expected.scope || !sameNullableText(person, expected.person)) throw contractError('scope does not match request')

  const normalized = {
    period_start: periodStart,
    period_end: periodEnd,
    scope,
    person,
    posted_income_aed: normalizeCanonicalMoney(row.posted_income_aed, 'posted_income_aed'),
    consumption_spend_aed: normalizeCanonicalMoney(row.consumption_spend_aed, 'consumption_spend_aed'),
    savings_movement_aed: normalizeCanonicalMoney(row.savings_movement_aed, 'savings_movement_aed'),
    cash_retained_aed: normalizeCanonicalMoney(row.cash_retained_aed, 'cash_retained_aed'),
    savings_aed: normalizeCanonicalMoney(row.savings_aed, 'savings_aed'),
    cash_flow_aed: normalizeCanonicalMoney(row.cash_flow_aed, 'cash_flow_aed'),
    savings_rate_percent: normalizeCanonicalMoney(row.savings_rate_percent, 'savings_rate_percent'),
    savings_rate_reason: row.savings_rate_reason === null
      ? null
      : normalizeText(row.savings_rate_reason, 'savings_rate_reason'),
    quality_status: normalizeCanonicalQuality(row.quality_status),
    missing_fx_count: normalizeCount(row.missing_fx_count, 'missing_fx_count'),
    needs_review_count: normalizeCount(row.needs_review_count, 'needs_review_count'),
    zero_placeholder_count: normalizeCount(row.zero_placeholder_count, 'zero_placeholder_count'),
    quality_metadata: normalizeQualityMetadata(row.quality_metadata),
  }

  if (normalized.savings_rate_reason !== null && !SAVINGS_RATE_REASONS.includes(normalized.savings_rate_reason)) {
    throw contractError(`savings_rate_reason has unknown value ${normalized.savings_rate_reason}`)
  }
  if (normalized.savings_rate_reason === null && normalized.savings_rate_percent === null) {
    throw contractError('savings rate requires a value or a canonical reason')
  }
  if (normalized.savings_rate_reason !== null && normalized.savings_rate_percent !== null) {
    throw contractError('savings rate cannot have both a value and a reason')
  }
  if (normalized.savings_rate_reason === 'nonpositive_income' && !(normalized.posted_income_aed <= 0)) {
    throw contractError('nonpositive_income reason requires nonpositive posted income')
  }
  if (normalized.savings_rate_reason === 'incomplete_inputs'
    && normalized.posted_income_aed !== null
    && normalized.consumption_spend_aed !== null) {
    throw contractError('incomplete_inputs reason requires a missing canonical input')
  }

  const metadata = normalized.quality_metadata
  const incompleteCount = metadata.income_incomplete_count
    + metadata.consumption_incomplete_count
    + metadata.savings_movement_incomplete_count
  const hasMissingFx = normalized.missing_fx_count > 0
  const hasMissingFxCurrencies = metadata.missing_fx_currencies.length > 0
  const hasIncompleteEvidence = incompleteCount > 0
    || normalized.zero_placeholder_count > 0
    || hasMissingFx
  const hasProvisionalEvidence = metadata.provisional_transaction_count > 0

  if (normalized.zero_placeholder_count !== metadata.zero_placeholder_count) {
    throw contractError('top-level and metadata zero placeholder counts disagree')
  }
  if (hasMissingFx !== hasMissingFxCurrencies) {
    throw contractError('top-level missing FX count and metadata currencies disagree')
  }
  if (metadata.missing_fx_currencies.length > normalized.missing_fx_count) {
    throw contractError('metadata missing FX currencies exceed the top-level missing FX count')
  }
  if (metadata.provisional_transaction_count > normalized.needs_review_count) {
    throw contractError('provisional transaction count exceeds review count')
  }
  if (normalized.zero_placeholder_count > normalized.needs_review_count) {
    throw contractError('zero placeholder count exceeds review count')
  }
  if (metadata.provisional_transaction_count + normalized.zero_placeholder_count > normalized.needs_review_count) {
    throw contractError('provisional and zero-placeholder evidence exceeds review count')
  }

  if (normalized.quality_status === 'complete'
    && (normalized.needs_review_count > 0 || hasProvisionalEvidence || hasIncompleteEvidence)) {
    throw contractError('complete quality contradicts review, provisional, or incomplete evidence')
  }
  if (normalized.quality_status === 'provisional') {
    if (!hasProvisionalEvidence || normalized.needs_review_count === 0) {
      throw contractError('provisional quality requires matching review and provisional evidence')
    }
    if (hasIncompleteEvidence || incompleteCount > 0) {
      throw contractError('provisional quality contradicts incomplete evidence')
    }
  }
  if (normalized.quality_status === 'incomplete' && !hasIncompleteEvidence) {
    throw contractError('incomplete quality requires matching incomplete evidence')
  }

  const expectedNullability = [
    ['posted_income_aed', metadata.income_incomplete_count > 0],
    ['consumption_spend_aed', metadata.consumption_incomplete_count > 0],
    ['savings_movement_aed', metadata.savings_movement_incomplete_count > 0],
  ]
  for (const [field, mustBeNull] of expectedNullability) {
    if ((normalized[field] === null) !== mustBeNull) {
      throw contractError(`${field} and its incomplete count disagree`)
    }
  }

  const canCalculateSavings = normalized.posted_income_aed !== null && normalized.consumption_spend_aed !== null
  const canCalculateCash = canCalculateSavings && normalized.savings_movement_aed !== null
  if ((normalized.savings_aed !== null) !== canCalculateSavings) {
    throw contractError('savings_aed nullability disagrees with its canonical inputs')
  }
  if ((normalized.cash_retained_aed !== null) !== canCalculateCash
    || (normalized.cash_flow_aed !== null) !== canCalculateCash) {
    throw contractError('cash fields nullability disagrees with their canonical inputs')
  }
  if (canCalculateSavings
    && !sameMoney(normalized.savings_aed, roundToCents(normalized.posted_income_aed - normalized.consumption_spend_aed))) {
    throw contractError('savings_aed disagrees with canonical inputs')
  }
  if (canCalculateCash) {
    const expectedCash = roundToCents(
      normalized.posted_income_aed - normalized.consumption_spend_aed - normalized.savings_movement_aed
    )
    if (!sameMoney(normalized.cash_retained_aed, expectedCash) || !sameMoney(normalized.cash_flow_aed, expectedCash)) {
      throw contractError('cash fields disagree with canonical inputs')
    }
  }
  if (canCalculateSavings && normalized.posted_income_aed > 0) {
    const expectedRate = roundToCents(100 * normalized.savings_aed / normalized.posted_income_aed)
    if (normalized.savings_rate_reason !== null || !sameMoney(normalized.savings_rate_percent, expectedRate)) {
      throw contractError('savings rate disagrees with positive-income canonical inputs')
    }
  } else if (canCalculateSavings) {
    if (normalized.savings_rate_percent !== null || normalized.savings_rate_reason !== 'nonpositive_income') {
      throw contractError('nonpositive posted income requires the canonical savings-rate reason')
    }
  } else if (normalized.savings_rate_percent !== null || normalized.savings_rate_reason !== 'incomplete_inputs') {
    throw contractError('incomplete savings-rate inputs require the canonical reason')
  }

  if (normalized.quality_status !== 'incomplete') {
    for (const field of [
      'posted_income_aed',
      'consumption_spend_aed',
      'savings_movement_aed',
      'cash_retained_aed',
      'savings_aed',
      'cash_flow_aed',
    ]) {
      if (normalized[field] === null) throw contractError(`${field} cannot be null for ${normalized.quality_status} quality`)
    }
  }
  if (!sameMoney(normalized.cash_retained_aed, normalized.cash_flow_aed)) {
    throw contractError('cash_retained_aed and cash_flow_aed disagree')
  }
  return Object.freeze(normalized)
}

function normalizeCanonicalLedgerRow(value, index) {
  const row = assertObject(value, `ledger row ${index}`)
  const economic = normalizeText(row.economic_classification, `ledger row ${index} economic_classification`)
  if (!ECONOMIC_CLASSIFICATIONS.includes(economic)) {
    throw contractError(`ledger row ${index} has unknown economic classification ${economic}`)
  }
  const reason = normalizeText(row.classification_reason, `ledger row ${index} classification_reason`)
  if (!CLASSIFICATION_REASONS.includes(reason)) {
    throw contractError(`ledger row ${index} has unknown classification reason ${reason}`)
  }
  const normalized = {
    ...row,
    id: normalizeText(row.id, `ledger row ${index} id`),
    date: normalizeDate(row.date, `ledger row ${index} date`),
    amount: normalizeCanonicalMoney(row.amount, `ledger row ${index} amount`, { nullable: false }),
    currency: normalizeText(row.currency, `ledger row ${index} currency`),
    category: normalizeText(row.category, `ledger row ${index} category`, { nullable: true }),
    owner: normalizeText(row.owner, `ledger row ${index} owner`, { nullable: true }),
    note: normalizeText(row.note, `ledger row ${index} note`, { nullable: true, empty: true }),
    tags: normalizeTextArray(row.tags, `ledger row ${index} tags`),
    account_id: normalizeText(row.account_id, `ledger row ${index} account_id`, { nullable: true }),
    needs_review: normalizeBoolean(row.needs_review, `ledger row ${index} needs_review`),
    transaction_group_id: normalizeText(row.transaction_group_id, `ledger row ${index} transaction_group_id`, { nullable: true }),
    group_kind: normalizeText(row.group_kind, `ledger row ${index} group_kind`, { nullable: true }),
    transfer_direction: normalizeText(row.transfer_direction, `ledger row ${index} transfer_direction`, { nullable: true }),
    amount_aed: normalizeCanonicalMoney(row.amount_aed, `ledger row ${index} amount_aed`),
    consumption_spend_aed: normalizeCanonicalMoney(
      row.consumption_spend_aed,
      `ledger row ${index} consumption_spend_aed`
    ),
    savings_movement_aed: normalizeCanonicalMoney(
      row.savings_movement_aed,
      `ledger row ${index} savings_movement_aed`
    ),
    economic_classification: economic,
    classification_reason: reason,
    quality_status: normalizeCanonicalQuality(row.quality_status, `ledger row ${index} quality_status`),
  }
  if (normalized.group_kind !== null && !['category_split', 'transfer', 'bulk_batch'].includes(normalized.group_kind)) {
    throw contractError(`ledger row ${index} has unknown group_kind ${normalized.group_kind}`)
  }
  if (normalized.transfer_direction !== null && !['in', 'out'].includes(normalized.transfer_direction)) {
    throw contractError(`ledger row ${index} has unknown transfer_direction ${normalized.transfer_direction}`)
  }
  if ((normalized.transaction_group_id === null) !== (normalized.group_kind === null)) {
    throw contractError(`ledger row ${index} transaction group id and kind disagree`)
  }
  if ((normalized.group_kind === 'transfer') !== (normalized.transfer_direction !== null)) {
    throw contractError(`ledger row ${index} transfer group and direction disagree`)
  }

  const classificationByReason = {
    typed_transfer: 'internal_transfer',
    legacy_exact_transfer_category: 'internal_transfer',
    legacy_exact_savings_category: 'savings_movement',
    uncategorised_consumption: 'consumption_spend',
    categorised_consumption: 'consumption_spend',
  }
  if (classificationByReason[reason] !== economic) {
    throw contractError(`ledger row ${index} classification reason and economic classification disagree`)
  }
  if (reason === 'typed_transfer' && normalized.group_kind !== 'transfer') {
    throw contractError(`ledger row ${index} typed transfer requires a transfer group`)
  }
  if (reason !== 'typed_transfer' && normalized.group_kind === 'transfer') {
    throw contractError(`ledger row ${index} transfer group requires typed-transfer classification`)
  }
  if (reason === 'legacy_exact_transfer_category'
    && (normalized.group_kind === 'transfer' || normalized.category !== 'Transfer')) {
    throw contractError(`ledger row ${index} legacy transfer reason requires the exact Transfer category`)
  }
  if (reason === 'legacy_exact_savings_category'
    && (normalized.group_kind === 'transfer' || normalized.category !== 'Savings & Investments')) {
    throw contractError(`ledger row ${index} legacy savings reason requires the exact Savings & Investments category`)
  }
  if (reason === 'uncategorised_consumption'
    && (normalized.group_kind === 'transfer' || normalized.category !== null)) {
    throw contractError(`ledger row ${index} uncategorised reason requires a null category`)
  }
  if (reason === 'categorised_consumption'
    && (normalized.group_kind === 'transfer'
      || normalized.category === null
      || normalized.category === 'Transfer'
      || normalized.category === 'Savings & Investments')) {
    throw contractError(`ledger row ${index} categorised reason contradicts category precedence`)
  }

  if (normalized.quality_status === 'complete'
    && (normalized.needs_review || normalized.amount_aed === null)) {
    throw contractError(`ledger row ${index} complete quality contradicts review or incomplete evidence`)
  }
  if (normalized.quality_status === 'provisional'
    && (!normalized.needs_review || normalized.amount === 0 || normalized.amount_aed === null)) {
    throw contractError(`ledger row ${index} provisional quality requires nonzero review evidence and AED money`)
  }
  if (normalized.quality_status === 'incomplete'
    && normalized.amount_aed !== null
    && !(normalized.needs_review && normalized.amount === 0)
    && normalized.group_kind !== 'category_split') {
    throw contractError(`ledger row ${index} incomplete quality lacks matching incomplete evidence`)
  }
  if (economic === 'consumption_spend') {
    if (normalized.savings_movement_aed !== null || normalized.consumption_spend_aed !== normalized.amount_aed) {
      throw contractError(`ledger row ${index} has malformed consumption fields`)
    }
  } else if (economic === 'savings_movement') {
    if (normalized.consumption_spend_aed !== null || normalized.savings_movement_aed !== normalized.amount_aed) {
      throw contractError(`ledger row ${index} has malformed savings movement fields`)
    }
  } else if (normalized.consumption_spend_aed !== null || normalized.savings_movement_aed !== null) {
    throw contractError(`ledger row ${index} has monetary values on an internal transfer`)
  }
  return Object.freeze(normalized)
}

export function normalizeCanonicalLedgerRows(data) {
  if (!Array.isArray(data)) throw contractError('canonical ledger response must be an array')
  const rows = data.map(normalizeCanonicalLedgerRow)
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw contractError('canonical ledger response contains duplicate ids')
  return Object.freeze(rows)
}

function normalizeCanonicalIncomeRow(value, index) {
  const row = assertObject(value, `income row ${index}`)
  const quality = normalizeCanonicalQuality(row.quality_status, `income row ${index} quality_status`)
  if (quality === 'provisional') throw contractError(`income row ${index} has unsupported provisional quality`)
  const normalized = {
    ...row,
    id: normalizeText(row.id, `income row ${index} id`),
    date: normalizeDate(row.date, `income row ${index} date`),
    amount: normalizeCanonicalMoney(row.amount, `income row ${index} amount`, { nullable: false }),
    currency: normalizeText(row.currency, `income row ${index} currency`),
    person: normalizeText(row.person, `income row ${index} person`),
    source: normalizeText(row.source, `income row ${index} source`, { nullable: true, empty: true }),
    kind: normalizeText(row.kind, `income row ${index} kind`),
    amount_aed: normalizeCanonicalMoney(row.amount_aed, `income row ${index} amount_aed`),
    quality_status: quality,
  }
  if (!['salary', 'bonus', 'dividend', 'interest', 'trading_pnl', 'other'].includes(normalized.kind)) {
    throw contractError(`income row ${index} has unknown kind ${normalized.kind}`)
  }
  if ((quality === 'complete') !== (normalized.amount_aed !== null)) {
    throw contractError(`income row ${index} quality and AED amount disagree`)
  }
  return Object.freeze(normalized)
}

export function normalizeCanonicalIncomeRows(data) {
  if (!Array.isArray(data)) throw contractError('canonical income response must be an array')
  const rows = data.map(normalizeCanonicalIncomeRow)
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw contractError('canonical income response contains duplicate ids')
  return Object.freeze(rows)
}

function normalizeCanonicalBudgetRow(value, index) {
  const row = assertObject(value, `budget actual row ${index}`)
  const normalized = {
    category: normalizeText(row.category, `budget actual row ${index} category`),
    actual_aed: normalizeCanonicalMoney(row.actual_aed, `budget actual row ${index} actual_aed`),
    quality_status: normalizeCanonicalQuality(row.quality_status, `budget actual row ${index} quality_status`),
    transaction_count: normalizeCount(row.transaction_count, `budget actual row ${index} transaction_count`),
    needs_review_count: normalizeCount(row.needs_review_count, `budget actual row ${index} needs_review_count`),
    zero_placeholder_count: normalizeCount(row.zero_placeholder_count, `budget actual row ${index} zero_placeholder_count`),
    missing_fx_count: normalizeCount(row.missing_fx_count, `budget actual row ${index} missing_fx_count`),
  }
  if (normalized.quality_status !== 'incomplete' && normalized.actual_aed === null) {
    throw contractError(`budget actual row ${index} has null actual for ${normalized.quality_status} quality`)
  }
  if (normalized.quality_status === 'incomplete' && normalized.actual_aed !== null) {
    throw contractError(`budget actual row ${index} has a monetary actual for incomplete quality`)
  }
  if (normalized.needs_review_count > normalized.transaction_count
    || normalized.zero_placeholder_count > normalized.needs_review_count
    || normalized.missing_fx_count > normalized.transaction_count) {
    throw contractError(`budget actual row ${index} counts exceed their canonical population`)
  }
  if (normalized.quality_status === 'complete'
    && (normalized.needs_review_count > 0 || normalized.zero_placeholder_count > 0 || normalized.missing_fx_count > 0)) {
    throw contractError(`budget actual row ${index} complete quality contradicts review or incomplete evidence`)
  }
  if (normalized.quality_status === 'provisional'
    && (normalized.needs_review_count === 0 || normalized.zero_placeholder_count > 0 || normalized.missing_fx_count > 0)) {
    throw contractError(`budget actual row ${index} provisional quality lacks matching review evidence or has incomplete evidence`)
  }
  if (normalized.quality_status !== 'incomplete'
    && (normalized.zero_placeholder_count > 0 || normalized.missing_fx_count > 0)) {
    throw contractError(`budget actual row ${index} incomplete evidence contradicts quality`)
  }
  return Object.freeze(normalized)
}

export function normalizeCanonicalBudgetRows(data) {
  if (!Array.isArray(data)) throw contractError('canonical budget response must be an array')
  const rows = data.map(normalizeCanonicalBudgetRow)
  if (new Set(rows.map((row) => row.category)).size !== rows.length) {
    throw contractError('canonical budget response contains duplicate categories')
  }
  return Object.freeze(rows)
}

function normalizeWealthMetadata(value, label) {
  const metadata = assertObject(value, label)
  if (metadata.fx_basis !== 'current_rate_aed') throw contractError(`${label}.fx_basis is unknown`)
  if (metadata.classification_version !== 'shr-111-phase-a-v1') {
    throw contractError(`${label}.classification_version is unknown`)
  }
  return Object.freeze({ ...metadata })
}

function exactlyOne(data, label) {
  if (!Array.isArray(data)) throw contractError(`${label} response must be an array`)
  if (data.length !== 1) throw contractError(`${label} returned ${data.length} rows; expected exactly one`)
  return assertObject(data[0], `${label} row`)
}

export function normalizeCanonicalBalanceSheet(data) {
  const row = exactlyOne(data, 'canonical_balance_sheet')
  const quality = normalizeCanonicalQuality(row.quality_status)
  const normalized = {
    scope: normalizeText(row.scope, 'scope'),
    person: normalizeText(row.person, 'person', { nullable: true, empty: true }),
    assets_aed: normalizeCanonicalMoney(row.assets_aed, 'assets_aed'),
    liabilities_aed: normalizeCanonicalMoney(row.liabilities_aed, 'liabilities_aed'),
    net_worth_aed: normalizeCanonicalMoney(row.net_worth_aed, 'net_worth_aed'),
    quality_status: quality,
    incomplete_account_count: normalizeCount(row.incomplete_account_count, 'incomplete_account_count'),
    provisional_account_count: normalizeCount(row.provisional_account_count, 'provisional_account_count'),
    missing_fx_count: normalizeCount(row.missing_fx_count, 'missing_fx_count'),
    quality_metadata: normalizeWealthMetadata(row.quality_metadata, 'quality_metadata'),
  }
  const amounts = [normalized.assets_aed, normalized.liabilities_aed, normalized.net_worth_aed]
  if (quality === 'incomplete' && amounts.some((value) => value !== null)) {
    throw contractError('incomplete balance sheet must not expose monetary totals')
  }
  if (quality !== 'incomplete' && amounts.some((value) => value === null)) {
    throw contractError('qualified balance sheet requires every monetary total')
  }
  if (normalized.net_worth_aed !== null
    && !sameMoney(normalized.net_worth_aed, normalized.assets_aed - normalized.liabilities_aed)) {
    throw contractError('balance sheet does not reconcile')
  }
  return Object.freeze(normalized)
}

export function normalizeCanonicalInvestmentMetrics(data) {
  const row = exactlyOne(data, 'canonical_investment_metrics')
  const quality = normalizeCanonicalQuality(row.quality_status)
  const normalized = {
    scope: normalizeText(row.scope, 'scope'),
    person: normalizeText(row.person, 'person', { nullable: true, empty: true }),
    investment_value_aed: normalizeCanonicalMoney(row.investment_value_aed, 'investment_value_aed'),
    cost_basis_aed: normalizeCanonicalMoney(row.cost_basis_aed, 'cost_basis_aed'),
    unrealized_pnl_aed: normalizeCanonicalMoney(row.unrealized_pnl_aed, 'unrealized_pnl_aed'),
    quality_status: quality,
    incomplete_value_count: normalizeCount(row.incomplete_value_count, 'incomplete_value_count'),
    incomplete_pnl_count: normalizeCount(row.incomplete_pnl_count, 'incomplete_pnl_count'),
    provisional_count: normalizeCount(row.provisional_count, 'provisional_count'),
    manual_value_count: normalizeCount(row.manual_value_count, 'manual_value_count'),
    stale_value_count: normalizeCount(row.stale_value_count, 'stale_value_count'),
    missing_fx_count: normalizeCount(row.missing_fx_count, 'missing_fx_count'),
    quality_metadata: normalizeWealthMetadata(row.quality_metadata, 'quality_metadata'),
  }
  if (normalized.incomplete_value_count > 0 && normalized.investment_value_aed !== null) {
    throw contractError('incomplete investment value must be unavailable')
  }
  if (normalized.incomplete_value_count === 0 && normalized.investment_value_aed === null) {
    throw contractError('complete/provisional investment value is missing')
  }
  return Object.freeze(normalized)
}

export function normalizeCanonicalAccountRows(data) {
  if (!Array.isArray(data)) throw contractError('canonical account response must be an array')
  const rows = data.map((value, index) => {
    const row = assertObject(value, `canonical account row ${index}`)
    return Object.freeze({
      id: normalizeText(row.id, `account ${index}.id`),
      owner: normalizeText(row.owner, `account ${index}.owner`, { nullable: true, empty: true }),
      type: normalizeText(row.type, `account ${index}.type`),
      is_liability: normalizeBoolean(row.is_liability, `account ${index}.is_liability`),
      currency: normalizeText(row.currency, `account ${index}.currency`),
      canonical_value_aed: normalizeCanonicalMoney(row.canonical_value_aed, `account ${index}.canonical_value_aed`),
      quality_status: normalizeCanonicalQuality(row.quality_status, `account ${index}.quality_status`),
      valuation_method: normalizeText(row.valuation_method, `account ${index}.valuation_method`),
      valuation_as_of: normalizeTimestamp(row.valuation_as_of, `account ${index}.valuation_as_of`),
      fx_rate_to_aed: normalizeCanonicalMoney(row.fx_rate_to_aed, `account ${index}.fx_rate_to_aed`),
      fx_updated_at: normalizeTimestamp(row.fx_updated_at, `account ${index}.fx_updated_at`),
    })
  })
  if (new Set(rows.map((row) => row.id)).size !== rows.length) {
    throw contractError('canonical account response contains duplicate IDs')
  }
  for (const row of rows) {
    if (row.quality_status === 'incomplete' && row.canonical_value_aed !== null) {
      throw contractError(`incomplete account ${row.id} must not expose an AED value`)
    }
    if (row.quality_status !== 'incomplete' && row.canonical_value_aed === null) {
      throw contractError(`qualified account ${row.id} is missing AED value`)
    }
  }
  return Object.freeze(rows)
}
