import { PERIOD_OPTIONS } from '../data/periods'

/**
 * MTD / QTD / YTD.
 *
 * Real buttons with `aria-pressed`, not the prototype's clickable divs, and
 * the active segment carries an accent rule as well as a fill so selection is
 * never colour-only.
 */
export default function PeriodControl({ value, onChange, busy = false }) {
  return (
    <div className="v6-segmented" role="group" aria-label="Overview period">
      {PERIOD_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          aria-label={option.title}
          disabled={busy && option.value !== value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
