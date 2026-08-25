import { classes } from './classes'

const VALUE_TONES = {
  neutral: 'text-text-primary',
  positive: 'text-financial-positive',
  negative: 'text-financial-negative',
}

function Value({ as: Component = 'span', children, className, label, tone = 'neutral' }) {
  return (
    <Component
      aria-label={label}
      className={classes('tnum font-semibold tracking-[-0.015em]', VALUE_TONES[tone] ?? VALUE_TONES.neutral, className)}
    >
      {children}
    </Component>
  )
}

export function Amount(props) {
  return <Value {...props} />
}

export function Percentage(props) {
  return <Value {...props} />
}

export function MissingValue({ className, reason = 'Unavailable' }) {
  return (
    <span className={classes('inline-flex items-center text-text-tertiary', className)} title={reason}>
      <span aria-hidden="true">—</span>
      <span className="ds-visually-hidden">{reason}</span>
    </span>
  )
}
