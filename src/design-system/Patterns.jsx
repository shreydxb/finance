import { classes } from './classes'

export function SectionHeader({ action, children, className, description, kicker, title }) {
  return (
    <header className={classes('v6-section-header', className)}>
      <div>
        {kicker ? <p className="v6-kicker">{kicker}</p> : null}
        <h2 className="v6-section-title">{title ?? children}</h2>
        {description ? <p className="v6-section-description">{description}</p> : null}
      </div>
      {action ? <div className="v6-section-action">{action}</div> : null}
    </header>
  )
}

export function SegmentedControl({ label, onChange, options, value }) {
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

export function KpiGroup({ children, className, label }) {
  return <section aria-label={label} className={classes('v6-kpi-group', className)}>{children}</section>
}

export function Kpi({ hint, label, tone = 'neutral', value }) {
  return (
    <div className="v6-kpi">
      <p>{label}</p>
      <strong className={classes('v6-kpi-value', tone === 'positive' && 'text-financial-positive', tone === 'negative' && 'text-financial-negative')}>{value}</strong>
      {hint ? <span>{hint}</span> : null}
    </div>
  )
}

export function DataTable({ caption, children, className, minWidth = 660 }) {
  return (
    <div className={classes('v6-table-scroll', className)} role="region" aria-label={caption} tabIndex="0">
      <div style={{ minWidth }}>
        {children}
      </div>
    </div>
  )
}
