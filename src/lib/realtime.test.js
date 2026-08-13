// INT-01: realtime was published in migration 003 and never subscribed to.
//
// These cover the part with real behaviour — turning a burst of change events
// into the right number of refreshes — using an injected clock, so the tests
// are deterministic rather than sleeping.

import assert from 'node:assert/strict'
import test from 'node:test'

import { createChangeScheduler, REALTIME_TABLES } from './realtime.js'

/** A controllable stand-in for setTimeout/clearTimeout. */
function fakeTimers() {
  let seq = 0
  const scheduled = new Map()
  return {
    api: {
      set: (fn, ms) => {
        const id = ++seq
        scheduled.set(id, { fn, ms })
        return id
      },
      clear: (id) => scheduled.delete(id),
    },
    /** Run everything currently scheduled. */
    run() {
      const due = [...scheduled.values()]
      scheduled.clear()
      due.forEach(({ fn }) => fn())
    },
    get pendingCount() {
      return scheduled.size
    },
    get lastDelay() {
      return [...scheduled.values()].at(-1)?.ms
    },
  }
}

function setup(debounceMs = 300) {
  const timers = fakeTimers()
  let flushes = 0
  const scheduler = createChangeScheduler({
    onFlush: () => flushes++,
    debounceMs,
    timers: timers.api,
  })
  return { timers, scheduler, flushes: () => flushes }
}

test('a single change causes exactly one refresh', () => {
  const { timers, scheduler, flushes } = setup()

  scheduler.schedule()
  assert.equal(flushes(), 0, 'not until the quiet period elapses')

  timers.run()
  assert.equal(flushes(), 1)
})

test('a burst of changes causes one refresh, not one each', () => {
  // The case that matters: a bulk Telegram message writes several rows, which
  // arrive as several events. Reloading five times would be visible jitter.
  const { timers, scheduler, flushes } = setup()

  for (let i = 0; i < 5; i++) scheduler.schedule()
  timers.run()

  assert.equal(flushes(), 1)
})

test('changes after a flush schedule another refresh', () => {
  const { timers, scheduler, flushes } = setup()

  scheduler.schedule()
  timers.run()
  scheduler.schedule()
  timers.run()

  assert.equal(flushes(), 2)
})

test('flushNow refreshes immediately and cancels the pending timer', () => {
  // Reconnect: while the socket was down no events arrived, so nothing will
  // ever announce what was missed.
  const { timers, scheduler, flushes } = setup()

  scheduler.schedule()
  scheduler.flushNow()

  assert.equal(flushes(), 1, 'refreshed at once')
  assert.equal(timers.pendingCount, 0, 'no timer left behind')

  timers.run()
  assert.equal(flushes(), 1, 'and the cancelled timer does not fire a second one')
})

test('cancel stops a pending refresh — a screen that unmounted must not reload', () => {
  const { timers, scheduler, flushes } = setup()

  scheduler.schedule()
  scheduler.cancel()
  timers.run()

  assert.equal(flushes(), 0)
})

test('isPending reflects whether a refresh is waiting', () => {
  const { timers, scheduler } = setup()

  assert.equal(scheduler.isPending, false)
  scheduler.schedule()
  assert.equal(scheduler.isPending, true)
  timers.run()
  assert.equal(scheduler.isPending, false)
})

test('the debounce window is honoured', () => {
  const { timers, scheduler } = setup(750)
  scheduler.schedule()
  assert.equal(timers.lastDelay, 750)
})

// ── subscription scope ───────────────────────────────────────────────────────

test('each screen subscribes only to tables it actually shows', () => {
  // Subscribing everything to everything would reload Reports whenever a
  // balance changed — wasted work, and it makes the UI feel unstable.
  assert.deepEqual(REALTIME_TABLES.transactions, ['transactions'])
  assert.ok(REALTIME_TABLES.reports.includes('income'))
  assert.ok(!REALTIME_TABLES.reports.includes('accounts'), 'Reports does not show balances')
  assert.ok(REALTIME_TABLES.goals.includes('goal_contributions'))
})

test('every subscribed table is one the database actually publishes', () => {
  // Migration 003 publishes exactly these four. Subscribing to anything else
  // would be silent dead weight — the events would never arrive.
  const published = new Set(['transactions', 'income', 'accounts', 'goal_contributions'])
  for (const [screen, tables] of Object.entries(REALTIME_TABLES)) {
    for (const table of tables) {
      assert.ok(published.has(table), `${screen} subscribes to ${table}, which is not published`)
    }
  }
})
