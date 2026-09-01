import {
  INSIGHTS_PERIOD_OPTIONS,
  INSIGHTS_VIEW_OPTIONS,
} from '../data/insightsPeriods'

function Segments({ label, options, value, onChange }) {
  return (
    <div className="v6-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export default function InsightsControls({ model, onPeriodChange, onViewChange }) {
  return (
    <section className="v6-controls" aria-label="Insights period and view">
      <Segments
        label="Insights period type"
        options={INSIGHTS_PERIOD_OPTIONS}
        value={model.period.kind}
        onChange={onPeriodChange}
      />
      <div className="v6-controls-trailing">
        <Segments
          label="Insights view"
          options={INSIGHTS_VIEW_OPTIONS}
          value={model.view}
          onChange={onViewChange}
        />
      </div>
    </section>
  )
}
