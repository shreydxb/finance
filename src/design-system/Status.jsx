import { classes } from './classes'

const TONES = {
  neutral: 'border-border bg-surface-subtle text-text-secondary',
  info: 'border-info/30 bg-info-soft text-info',
  success: 'border-success/30 bg-success-soft text-success',
  warning: 'border-warning/30 bg-warning-soft text-warning',
  danger: 'border-danger/30 bg-danger-soft text-danger',
  positive: 'border-financial-positive/30 bg-financial-positive-soft text-financial-positive',
  negative: 'border-financial-negative/30 bg-financial-negative-soft text-financial-negative',
}

export function Badge({ children, className, tone = 'neutral' }) {
  return (
    <span className={classes('inline-flex min-h-6 items-center rounded-full border px-2 py-0.5 text-label font-semibold', TONES[tone] ?? TONES.neutral, className)}>
      {children}
    </span>
  )
}

export function Status({ children, className, label, tone = 'neutral' }) {
  return (
    <span className={classes('inline-flex items-center gap-2 text-body-sm font-medium', className)}>
      <span className={classes('size-2 rounded-full', TONES[tone] ?? TONES.neutral)} aria-hidden="true" />
      <span>{label ?? children}</span>
    </span>
  )
}
