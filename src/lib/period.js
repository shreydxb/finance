import { todayLocal } from './dates.js'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function pad(n) {
  return String(n).padStart(2, '0')
}

export function currentYearMonth(now = new Date()) {
  const [year, month] = todayLocal(now).split('-').map(Number)
  return { year, month }
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

export function currentQuarter(now = new Date()) {
  const { year, month } = currentYearMonth(now)
  return { year, quarter: Math.floor((month - 1) / 3) + 1 }
}

export function currentYear(now = new Date()) {
  return currentYearMonth(now).year
}

export function yearRange(year) {
  return { from: `${year}-01-01`, to: `${year}-12-31` }
}

export function shiftYear(year, delta) {
  return year + delta
}
