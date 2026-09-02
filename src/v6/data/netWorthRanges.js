import { todayLocal } from '../../lib/dates.js'

export const NET_WORTH_RANGE_OPTIONS = Object.freeze([
  Object.freeze({ value: '6m', label: '6M' }),
  Object.freeze({ value: '1y', label: '1Y' }),
  Object.freeze({ value: 'ytd', label: 'YTD' }),
  Object.freeze({ value: '5y', label: '5Y' }),
  Object.freeze({ value: 'all', label: 'All' }),
])

export function isNetWorthRange(value) {
  return NET_WORTH_RANGE_OPTIONS.some((option) => option.value === value)
}

function firstDayShifted(isoDate, monthOffset) {
  const [year, month] = isoDate.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1 + monthOffset, 1))
  return shifted.toISOString().slice(0, 10)
}

export function netWorthRange(value = '1y', today = todayLocal()) {
  if (!isNetWorthRange(value)) throw new Error(`Unknown Net Worth range: ${String(value)}`)
  const year = Number(today.slice(0, 4))
  const from = {
    '6m': firstDayShifted(today, -5),
    '1y': firstDayShifted(today, -11),
    ytd: `${year}-01-01`,
    '5y': `${year - 4}-01-01`,
    all: null,
  }[value]
  return Object.freeze({
    key: value,
    label: NET_WORTH_RANGE_OPTIONS.find((option) => option.value === value).label,
    from,
    to: today,
  })
}
