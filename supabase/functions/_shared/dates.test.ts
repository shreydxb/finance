import { test } from 'node:test'
import assert from 'node:assert/strict'
import { todayInTz } from './dates.ts'

test('todayInTz resolves the Gulf calendar date, not UTC', () => {
  // 21:30 UTC = 01:30 next day in Asia/Dubai (UTC+4) — the boundary case that
  // broke the old toISOString() implementation.
  assert.equal(todayInTz(new Date('2026-08-10T21:30:00Z')), '2026-08-11')

  // 19:59 UTC = 23:59 same day in Dubai — still the same calendar date.
  assert.equal(todayInTz(new Date('2026-08-10T19:59:00Z')), '2026-08-10')

  // 20:00 UTC = 00:00 exactly in Dubai — the exact midnight boundary.
  assert.equal(todayInTz(new Date('2026-08-10T20:00:00Z')), '2026-08-11')

  // A midday case, well clear of any boundary.
  assert.equal(todayInTz(new Date('2026-08-10T10:00:00Z')), '2026-08-10')
})
