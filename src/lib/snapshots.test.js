import assert from 'node:assert/strict'
import test from 'node:test'

import { buildNetWorthHistory } from './snapshotHistory.js'

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
