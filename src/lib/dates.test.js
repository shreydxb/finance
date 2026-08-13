// MONEY-03: the Dubai-midnight boundary.
//
// Between 00:00 and 03:59 Gulf time, the UTC date is still yesterday. Every
// date default in the frontend used UTC, so a spend logged at 00:30 was filed
// against the previous day and a net-worth snapshot overwrote the previous
// day's row.

import assert from 'node:assert/strict'
import test from 'node:test'

import { todayLocal } from './dates.js'

test('00:30 in Dubai on 13 Aug is 13 Aug, though UTC still says 12 Aug', () => {
  // 2026-08-12T20:30:00Z is 2026-08-13T00:30 in Asia/Dubai (UTC+4).
  const instant = new Date('2026-08-12T20:30:00Z')

  assert.equal(instant.toISOString().slice(0, 10), '2026-08-12', 'the old UTC behaviour')
  assert.equal(todayLocal(instant), '2026-08-13', 'the household calendar date')
})

test('the whole 20:00-23:59 UTC window belongs to the next Dubai day', () => {
  for (const hour of ['20', '21', '22', '23']) {
    assert.equal(
      todayLocal(new Date(`2026-08-12T${hour}:00:00Z`)),
      '2026-08-13',
      `${hour}:00Z should be 13 Aug in Dubai`
    )
  }
})

test('19:59 UTC is still the same Dubai day', () => {
  assert.equal(todayLocal(new Date('2026-08-12T19:59:00Z')), '2026-08-12')
})

test('midday agrees with UTC', () => {
  assert.equal(todayLocal(new Date('2026-08-12T09:00:00Z')), '2026-08-12')
})

test('the boundary holds across a month end', () => {
  assert.equal(todayLocal(new Date('2026-08-31T20:30:00Z')), '2026-09-01')
})

test('the boundary holds across a year end', () => {
  assert.equal(todayLocal(new Date('2026-12-31T20:30:00Z')), '2027-01-01')
})

test('the output is always a zero-padded YYYY-MM-DD', () => {
  assert.match(todayLocal(new Date('2026-01-05T08:00:00Z')), /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(todayLocal(new Date('2026-01-05T08:00:00Z')), '2026-01-05')
})

test('Dubai has no DST, so January and July behave identically', () => {
  assert.equal(todayLocal(new Date('2026-01-15T20:30:00Z')), '2026-01-16')
  assert.equal(todayLocal(new Date('2026-07-15T20:30:00Z')), '2026-07-16')
})
