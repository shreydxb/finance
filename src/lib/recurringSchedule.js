// Recurring-obligation scheduling rules.
//
// Pure date logic, kept apart from the CRUD helpers in recurring.js because
// those import the Supabase client and so cannot load outside Vite — which
// made these rules untestable. That is the third time this shape has hidden a
// bug in this codebase (see money.js and transactionGroups.js); the rule of
// thumb is now that anything worth testing must not sit in a module that
// reaches for the network.

export const RECURRING_KINDS = ['income', 'expense', 'emi']

export const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function clampDay(year, month, day) {
  const lastDay = new Date(year, month, 0).getDate()
  return Math.min(day, lastDay)
}

// Next occurrence on/after `from` (Date). Returns a Date, or null if the
// entry has no day_of_month set, or if it's a finite series that has ended.
export function nextDueDate(entry, from = new Date()) {
  if (!entry.day_of_month) return null
  const endDate = entry.end_date ? new Date(`${entry.end_date}T23:59:59`) : null
  const months = entry.months && entry.months.length > 0 ? entry.months : null

  let year = from.getFullYear()
  let month = from.getMonth() + 1

  for (let i = 0; i < 24; i++) {
    if (!months || months.includes(month)) {
      const day = clampDay(year, month, entry.day_of_month)
      const candidate = new Date(year, month - 1, day)
      if (candidate >= new Date(from.getFullYear(), from.getMonth(), from.getDate())) {
        if (endDate && candidate > endDate) return null
        return candidate
      }
    }
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return null
}

export function daysUntil(date, from = new Date()) {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const b = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.round((b - a) / 86400000)
}

/**
 * Does this obligation fall due in the given calendar month?
 *
 * `nextDueDate` has always honoured `end_date`; the calendar grid did not, so a
 * car EMI that finished in May kept appearing in every future month (UI-02).
 * Both now go through the same rules.
 */
export function occursInMonth(entry, year, month) {
  if (!entry.day_of_month) return false
  if (entry.months?.length > 0 && !entry.months.includes(month)) return false

  // Compare against the actual occurrence, not the first of the month: an
  // obligation ending on the 20th still falls due on the 15th of that month.
  if (entry.end_date) {
    const day = clampDay(year, month, entry.day_of_month)
    const occurrence = new Date(year, month - 1, day)
    if (occurrence > new Date(`${entry.end_date}T23:59:59`)) return false
  }

  return true
}

/** Bills and EMIs — the things you pay. Recurring income is not a bill (UI-02). */
export function isBill(entry) {
  return entry.kind !== 'income'
}
