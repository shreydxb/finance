import { useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import { createChangeScheduler } from './realtime'

/**
 * Re-run `onChange` when another client writes to any of `tables`.
 *
 * The other client is usually the Telegram bot or the partner's phone, which
 * is exactly the case the app could not handle before (INT-01): a spend logged
 * from chat did not appear on an open Transactions screen until it was
 * reloaded by hand.
 *
 * Three things this gets right that a naive subscription would not:
 *
 *   - **One refresh per burst.** A bulk Telegram message writes several rows,
 *     which arrive as several events. Debounced into a single reload.
 *   - **Catch-up on reconnect.** While the socket is down no events arrive, so
 *     nothing will ever announce what was missed. Re-subscribing triggers one
 *     immediate refresh to close that window.
 *   - **A stable callback.** `onChange` is held in a ref, so a screen passing
 *     an inline function does not tear down and rebuild the subscription on
 *     every render.
 */
export function useRealtimeRefresh(tables, onChange, { debounceMs = 300, enabled = true } = {}) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Stable across renders so the effect below does not re-subscribe whenever
  // the caller passes a fresh array literal.
  const key = tables.join(',')

  useEffect(() => {
    if (!enabled || !key) return undefined

    const scheduler = createChangeScheduler({
      onFlush: () => onChangeRef.current?.(),
      debounceMs,
    })

    // A channel name unique per table set: two screens listening to different
    // tables must not share, and Supabase silently ignores a duplicate join.
    const channel = supabase.channel(`realtime:${key}:${Math.random().toString(36).slice(2)}`)

    for (const table of key.split(',')) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => scheduler.schedule())
    }

    let hasSubscribed = false
    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return
      // Skip the first: the screen has just loaded its own data. Every
      // subsequent SUBSCRIBED is a reconnect, and the gap may hide changes.
      if (hasSubscribed) scheduler.flushNow()
      hasSubscribed = true
    })

    return () => {
      scheduler.cancel()
      supabase.removeChannel(channel)
    }
  }, [key, debounceMs, enabled])
}
