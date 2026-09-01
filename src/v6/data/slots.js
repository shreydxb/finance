/**
 * The V6 value-slot vocabulary, shared by every screen.
 *
 * Three statuses are kept deliberately distinct rather than collapsed into one
 * dash, because they tell the household different things:
 *
 *  - `available`   — a canonical contract returned the value.
 *  - `incomplete`  — a canonical contract returned `null` **on purpose**,
 *                    because its required inputs are incomplete. The contract
 *                    exists and answered; the answer is "not computable".
 *  - `unavailable` — no approved contract can supply the slot at all, or the
 *                    read failed. A named gap says which contract would.
 */

export function availableSlot(value, extra = {}) {
  return Object.freeze({ status: 'available', value, ...extra })
}

export function incompleteSlot(reason) {
  return Object.freeze({ status: 'incomplete', reason })
}

export function errorSlot(reason) {
  return Object.freeze({ status: 'unavailable', gap: null, reason })
}

/**
 * Builds a `gapSlot(id)` for a screen's own registry of named contract gaps.
 * Every registry entry must carry `id`, `contract`, `reason` and `detail`.
 */
export function gapSlotFactory(registry, label) {
  return function gapSlot(gapId) {
    const gap = registry[gapId]
    if (!gap) throw new Error(`Unknown ${label} gap: ${String(gapId)}`)
    return Object.freeze({ status: 'unavailable', gap })
  }
}
