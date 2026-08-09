// Single source of truth for categorical chart colour.
//
// Previously this array was copy-pasted into CashFlow.jsx, NetWorthBreakdown.jsx
// and Accounts.jsx, which meant a palette change had to be made in three places
// and the same category could read as a different colour on different screens.
//
// Fixed order, never cycled: slot N is always the same hue, so the largest
// category keeps its colour as values shift month to month. Hues are spaced
// around the wheel and held at similar lightness/saturation so no single slice
// shouts louder than the rest purely because of its colour.
export const CHART_PALETTE = [
  '#2563eb', // brand blue
  '#f97316', // orange
  '#0ea472', // green
  '#a855f7', // violet
  '#e11d8f', // magenta
  '#eab308', // amber
  '#06b6d4', // cyan
  '#6366f1', // indigo
]

/** Everything past the palette's length folds into one neutral "Other" slot. */
export const OTHER_COLOR = '#8b95a7'

/**
 * Sorts entries by magnitude, folds the tail into "Other" when there are more
 * distinct keys than palette slots, and assigns a stable colour to each.
 *
 * @param entries {{ key: string, label: string, value: number }[]}
 */
export function colorizeGroups(entries) {
  let sorted = entries
    .filter((e) => e.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))

  const overflowed = sorted.length > CHART_PALETTE.length
  if (overflowed) {
    const head = sorted.slice(0, CHART_PALETTE.length - 1)
    const rest = sorted.slice(CHART_PALETTE.length - 1)
    sorted = [...head, { key: '__other', label: 'Other', value: rest.reduce((s, e) => s + e.value, 0) }]
  }

  return sorted.map((e, i) => ({
    ...e,
    color: overflowed && i === sorted.length - 1 ? OTHER_COLOR : CHART_PALETTE[i],
  }))
}
