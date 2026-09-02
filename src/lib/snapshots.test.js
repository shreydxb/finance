import assert from 'node:assert/strict'
import test from 'node:test'

import { buildNetWorthHistory } from './snapshotHistory.js'
import { normalizeAuthoritativeNetWorthHistory } from './authoritativeNetWorthHistory.js'

test('history labels old rows legacy and leaves missing dates as gaps', () => {
  const points = buildNetWorthHistory([
    { day: '2026-08-09', total_aed: '100', run_id: null },
    { day: '2026-08-11', total_aed: '110', run_id: 'run-11', quality_status: 'complete' },
  ], [])
  assert.deepEqual(points.map((point) => [point.day, point.history_status, point.total_aed]), [
    ['2026-08-09', 'legacy', '100'],
    ['2026-08-10', 'gap', null],
    ['2026-08-11', 'complete', '110'],
  ])
})

test('skipped incomplete run is a labelled gap, never a zero or interpolated value', () => {
  const points = buildNetWorthHistory(
    [{ day: '2026-08-09', total_aed: '100', run_id: null }],
    [{ id: 'run', target_day: '2026-08-10', status: 'skipped_incomplete', final_evidence: { reason: 'missing FX' } }]
  )
  assert.equal(points[1].history_status, 'skipped')
  assert.equal(points[1].total_aed, null)
  assert.deepEqual(points[1].quality_evidence, { reason: 'missing FX' })
})

test('fresh V6 history returns exact authoritative boundaries without manufacturing dates', () => {
  const points = normalizeAuthoritativeNetWorthHistory([
    {
      day: '2026-08-09', assets_aed: '150', liabilities_aed: '50', total_aed: '100',
      run_id: null, snapshot_at: null, published_at: null, quality_status: null,
      source_version: null, quality_evidence: null, input_digest: null,
    },
    {
      day: '2026-08-11', assets_aed: '170', liabilities_aed: '60', total_aed: '110',
      run_id: 'run-11', snapshot_at: '2026-08-12T02:00:00Z', published_at: '2026-08-12T02:01:00Z',
      quality_status: 'provisional', source_version: 'shr-113-phase-a-v1',
      quality_evidence: { policy_version: 'shr-113-snapshot-policy-v1' }, input_digest: 'digest',
    },
  ], [])

  assert.deepEqual(points.map((point) => [point.day, point.history_status, point.total_aed]), [
    ['2026-08-09', 'legacy', 100],
    ['2026-08-11', 'provisional', 110],
  ])
})

test('fresh V6 history preserves an actual skipped run as null and prefers a published row on the same date', () => {
  const baseRun = {
    id: 'skipped-10', target_day: '2026-08-10', status: 'skipped_incomplete',
    snapshot_at: '2026-08-11T02:00:00Z', final_evidence: { missing: 'FX' },
  }
  const published = {
    day: '2026-08-11', assets_aed: 170, liabilities_aed: 60, total_aed: 110,
    run_id: 'published-11', snapshot_at: '2026-08-12T02:00:00Z', published_at: '2026-08-12T02:01:00Z',
    quality_status: 'complete', source_version: 'shr-113-phase-a-v1', quality_evidence: {}, input_digest: 'digest',
  }
  const points = normalizeAuthoritativeNetWorthHistory([published], [
    baseRun,
    { ...baseRun, id: 'old-skipped-11', target_day: '2026-08-11' },
  ])

  assert.equal(points.length, 2)
  assert.deepEqual(points[0], {
    day: '2026-08-10', total_aed: null, assets_aed: null, liabilities_aed: null,
    run_id: 'skipped-10', snapshot_at: '2026-08-11T02:00:00Z', published_at: null,
    quality_status: 'skipped', history_status: 'skipped', source_version: null,
    quality_evidence: { missing: 'FX' }, input_digest: null, is_gap: true,
  })
  assert.equal(points[1].history_status, 'complete')
})

test('fresh V6 history fails closed on non-reconciling published values', () => {
  assert.throws(() => normalizeAuthoritativeNetWorthHistory([{
    day: '2026-08-11', assets_aed: 170, liabilities_aed: 60, total_aed: 999,
    run_id: 'run', snapshot_at: '2026-08-12T02:00:00Z', published_at: '2026-08-12T02:01:00Z',
    quality_status: 'complete', source_version: 'shr-113-phase-a-v1', quality_evidence: {}, input_digest: 'digest',
  }], []), /does not reconcile/)
})
