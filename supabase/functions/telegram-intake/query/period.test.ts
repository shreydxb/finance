import assert from 'node:assert/strict'
import test from 'node:test'

import { resolvePeriod } from './period.ts'

// A comfortably mid-month Monday in Dubai time, used as the default "now"
// for tests that don't care about a specific boundary.
const MID_MONTH = new Date('2026-08-17T09:00:00Z') // Mon 17 Aug 2026, 13:00 Asia/Dubai

test('this_month runs from the 1st to today, not the end of the calendar month', () => {
  const r = resolvePeriod({ kind: 'this_month' }, MID_MONTH)
  assert.deepEqual(r, { from: '2026-08-01', to: '2026-08-17', label: '1–17 Aug' })
})

test('last_month is the full previous calendar month', () => {
  const r = resolvePeriod({ kind: 'last_month' }, MID_MONTH)
  assert.deepEqual(r, { from: '2026-07-01', to: '2026-07-31', label: 'Jul' })
})

test('last_month crosses a year boundary correctly', () => {
  const r = resolvePeriod({ kind: 'last_month' }, new Date('2027-01-05T09:00:00Z'))
  assert.deepEqual(r, { from: '2026-12-01', to: '2026-12-31', label: 'Dec 2026' })
})

test('this_week starts Monday, ends today', () => {
  // 17 Aug 2026 is itself a Monday, so this_week should be a single day.
  const r = resolvePeriod({ kind: 'this_week' }, MID_MONTH)
  assert.deepEqual(r, { from: '2026-08-17', to: '2026-08-17', label: '17–17 Aug' })
})

test('this_week from a Thursday runs Monday through today', () => {
  const thursday = new Date('2026-08-20T09:00:00Z') // Thu 20 Aug 2026
  const r = resolvePeriod({ kind: 'this_week' }, thursday)
  assert.deepEqual(r, { from: '2026-08-17', to: '2026-08-20', label: '17–20 Aug' })
})

test('last_week is the full Monday-to-Sunday week before this one', () => {
  const r = resolvePeriod({ kind: 'last_week' }, MID_MONTH) // this_week starts 17 Aug (Mon)
  assert.deepEqual(r, { from: '2026-08-10', to: '2026-08-16', label: '10–16 Aug' })
})

test('last_week spans a month boundary in its label', () => {
  const earlySept = new Date('2026-09-02T09:00:00Z') // Wed 2 Sep 2026 — this week starts Mon 31 Aug
  const r = resolvePeriod({ kind: 'last_week' }, earlySept)
  assert.deepEqual(r, { from: '2026-08-24', to: '2026-08-30', label: '24–30 Aug' })
})

test('ytd runs from 1 Jan to today', () => {
  const r = resolvePeriod({ kind: 'ytd' }, MID_MONTH)
  assert.deepEqual(r, { from: '2026-01-01', to: '2026-08-17', label: '1 Jan – 17 Aug' })
})

test('last_n_days counts back n-1 days from today inclusive', () => {
  const r = resolvePeriod({ kind: 'last_n_days', n: 7 }, MID_MONTH)
  assert.deepEqual(r, { from: '2026-08-11', to: '2026-08-17', label: 'last 7 days' })
})

test('last_n_days clamps below 1 up to 1', () => {
  const r = resolvePeriod({ kind: 'last_n_days', n: 0 }, MID_MONTH)
  assert.deepEqual(r, { from: '2026-08-17', to: '2026-08-17', label: 'last 1 day' })
})

test('last_n_days clamps above 730 down to 730', () => {
  const r = resolvePeriod({ kind: 'last_n_days', n: 99999 }, MID_MONTH)
  assert.equal(r.label, 'last 730 days')
  assert.equal(r.from, '2024-08-18')
})

test('explicit passes through valid dates and labels them', () => {
  const r = resolvePeriod({ kind: 'explicit', from: '2026-08-01', to: '2026-08-10' }, MID_MONTH)
  assert.deepEqual(r, { from: '2026-08-01', to: '2026-08-10', label: '1–10 Aug' })
})

test('explicit rejects a backwards range', () => {
  assert.throws(() => resolvePeriod({ kind: 'explicit', from: '2026-08-10', to: '2026-08-01' }, MID_MONTH), RangeError)
})

test('explicit rejects a malformed date', () => {
  assert.throws(() => resolvePeriod({ kind: 'explicit', from: '2026-13-40', to: '2026-08-10' }, MID_MONTH), RangeError)
})

test('a 01:00 Gulf-time timestamp resolves to the next UTC calendar day, not the previous one', () => {
  // 2026-08-17T21:30:00Z is 01:30 on 18 Aug in Asia/Dubai (UTC+4).
  const lateUtc = new Date('2026-08-17T21:30:00Z')
  const r = resolvePeriod({ kind: 'this_month' }, lateUtc)
  assert.equal(r.to, '2026-08-18', 'must use the Dubai calendar day, not a bare toISOString() slice')
})

test('a year boundary at 01:00 Gulf time rolls this_month into the new year, not the old one', () => {
  // 2026-12-31T21:30:00Z is 01:30 on 1 Jan 2027 in Asia/Dubai.
  const newYearEve = new Date('2026-12-31T21:30:00Z')
  const r = resolvePeriod({ kind: 'this_month' }, newYearEve)
  assert.deepEqual(r, { from: '2027-01-01', to: '2027-01-01', label: '1–1 Jan' })
})
