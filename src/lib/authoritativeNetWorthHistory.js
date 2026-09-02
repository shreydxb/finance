import { normalizeCanonicalMoney, normalizeCanonicalQuality } from './canonicalContracts.js'

function validDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Authoritative snapshot contract error: ${label} must be YYYY-MM-DD`)
  }
  return value
}

function validTimestamp(value, label) {
  if (value === null) return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Authoritative snapshot contract error: ${label} must be a timestamp or null`)
  }
  return value
}

function normalizePublishedSnapshot(row, index) {
  const day = validDate(row?.day, `published row ${index}.day`)
  const assets = normalizeCanonicalMoney(row.assets_aed, `published row ${index}.assets_aed`, { nullable: false })
  const liabilities = normalizeCanonicalMoney(row.liabilities_aed, `published row ${index}.liabilities_aed`, { nullable: false })
  const total = normalizeCanonicalMoney(row.total_aed, `published row ${index}.total_aed`, { nullable: false })
  if (Math.round((assets - liabilities) * 100) !== Math.round(total * 100)) {
    throw new Error(`Authoritative snapshot contract error: published row ${index} does not reconcile`)
  }
  const legacy = row.run_id === null
  const quality = legacy ? 'legacy' : normalizeCanonicalQuality(row.quality_status, `published row ${index}.quality_status`)
  return Object.freeze({
    day,
    total_aed: total,
    assets_aed: assets,
    liabilities_aed: liabilities,
    run_id: row.run_id,
    snapshot_at: validTimestamp(row.snapshot_at, `published row ${index}.snapshot_at`),
    published_at: validTimestamp(row.published_at, `published row ${index}.published_at`),
    quality_status: quality,
    history_status: quality,
    source_version: typeof row.source_version === 'string' ? row.source_version : null,
    quality_evidence: row.quality_evidence && typeof row.quality_evidence === 'object' ? row.quality_evidence : null,
    input_digest: typeof row.input_digest === 'string' ? row.input_digest : null,
    is_gap: false,
  })
}

function normalizeSkippedRun(row, index) {
  if (row?.status !== 'skipped_incomplete') {
    throw new Error(`Authoritative snapshot contract error: run row ${index} is not skipped_incomplete`)
  }
  return Object.freeze({
    day: validDate(row.target_day, `run row ${index}.target_day`),
    total_aed: null,
    assets_aed: null,
    liabilities_aed: null,
    run_id: row.id,
    snapshot_at: validTimestamp(row.snapshot_at, `run row ${index}.snapshot_at`),
    published_at: null,
    quality_status: 'skipped',
    history_status: 'skipped',
    source_version: null,
    quality_evidence: row.final_evidence && typeof row.final_evidence === 'object' ? row.final_evidence : null,
    input_digest: null,
    is_gap: true,
  })
}

export function normalizeAuthoritativeNetWorthHistory(publishedRows, skippedRows) {
  if (!Array.isArray(publishedRows) || !Array.isArray(skippedRows)) {
    throw new Error('Authoritative snapshot contract error: history responses must be arrays')
  }
  const published = publishedRows.map(normalizePublishedSnapshot)
  const publishedDays = new Set(published.map((row) => row.day))
  const skipped = skippedRows
    .map(normalizeSkippedRun)
    .filter((row) => !publishedDays.has(row.day))
  return Object.freeze([...published, ...skipped].sort((left, right) => left.day.localeCompare(right.day)))
}
