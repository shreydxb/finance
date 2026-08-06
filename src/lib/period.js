const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function pad(n) {
  return String(n).padStart(2, '0')
}

export function currentYearMonth() {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

export function monthRange(year, month) {
  const from = `${year}-${pad(month)}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const to = `${year}-${pad(month)}-${pad(lastDay)}`
  return { from, to }
}

export function monthLabel(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

export function shiftMonth(year, month, delta) {
  const d = new Date(year, month - 1 + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

export function quarterRange(year, quarter) {
  const startMonth = (quarter - 1) * 3 + 1
  const from = `${year}-${pad(startMonth)}-01`
  const endMonth = startMonth + 2
  const lastDay = new Date(year, endMonth, 0).getDate()
  const to = `${year}-${pad(endMonth)}-${pad(lastDay)}`
  return { from, to }
}

export function quarterLabel(year, quarter) {
  return `Q${quarter} ${year}`
}

export function shiftQuarter(year, quarter, delta) {
  const total = (year * 4 + (quarter - 1)) + delta
  return { year: Math.floor(total / 4), quarter: (total % 4) + 1 }
}

export function currentQuarter() {
  const now = new Date()
  return { year: now.getFullYear(), quarter: Math.floor(now.getMonth() / 3) + 1 }
}

export function yearRange(year) {
  return { from: `${year}-01-01`, to: `${year}-12-31` }
}

export function shiftYear(year, delta) {
  return year + delta
}
