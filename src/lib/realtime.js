// Coalescing logic for realtime change notifications.
//
// Migration 003 published `transactions`, `income`, `accounts` and
// `goal_contributions` for realtime, and nothing in the app has ever
// subscribed (INT-01). So a spend logged from Telegram, or a change made on the
// other person's phone, does not appear on an already-open screen until it is
// manually reloaded — which for a two-person household is most of the time.
//
// The scheduling rules live here, apart from React and Supabase, because they
// are the part with actual behaviour worth testing: a bulk Telegram message
// writes several rows at once and must cause one refresh, not five.

/**
 * Coalesce a burst of change events into a single refresh.
 *
 * @param onFlush     called when a refresh should happen
 * @param debounceMs  quiet period before flushing
 * @param timers      injectable for tests; defaults to the real ones
 */
export function createChangeScheduler({
  onFlush,
  debounceMs = 300,
  timers = { set: setTimeout, clear: clearTimeout },
} = {}) {
  let handle = null
  let pending = false

  function cancel() {
    if (handle !== null) {
      timers.clear(handle)
      handle = null
    }
    pending = false
  }

  return {
    /**
     * Note that something changed. Repeated calls inside the debounce window
     * produce exactly one flush — a bulk write of five rows arrives as five
     * events and must not trigger five reloads.
     */
    schedule() {
      pending = true
      if (handle !== null) timers.clear(handle)
      handle = timers.set(() => {
        handle = null
        pending = false
        onFlush()
      }, debounceMs)
    },

    /**
     * Flush immediately, discarding any pending timer.
     *
     * Used on (re)subscribe: while the socket was down no events arrived, so
     * the screen may be stale in ways nothing will announce. Refreshing once on
     * reconnect is the only way to close that window.
     */
    flushNow() {
      cancel()
      onFlush()
    },

    /** True when a flush is waiting — for tests and teardown checks. */
    get isPending() {
      return pending
    },

    cancel,
  }
}

/**
 * Tables worth subscribing to, by screen.
 *
 * Deliberately narrow. Subscribing every screen to every table would reload
 * Reports whenever an account balance changed, which is wasted work and makes
 * the UI feel unstable.
 */
export const REALTIME_TABLES = {
  transactions: ['transactions'],
  accounts: ['accounts'],
  home: ['transactions', 'accounts', 'income'],
  goals: ['goal_contributions', 'accounts'],
  reports: ['transactions', 'income'],
  budget: ['transactions', 'income'],
}
