import { forwardRef } from 'react'
import { classes } from './classes'

const INTENTS = {
  primary: 'border-action bg-action-soft text-text-primary hover:bg-action-soft hover:text-action',
  secondary: 'border-border bg-surface text-text-primary hover:border-border-strong hover:bg-surface-subtle',
  quiet: 'border-transparent bg-transparent text-text-secondary hover:bg-surface-subtle hover:text-text-primary',
  danger: 'border-danger/50 bg-danger-soft text-danger hover:border-danger hover:bg-danger-soft',
}

const SIZES = {
  sm: 'min-h-control-sm px-3 text-body-sm',
  default: 'min-h-control px-4 text-body',
  lg: 'min-h-control-lg px-5 text-body',
}

export const Button = forwardRef(function Button(
  {
    children,
    className,
    disabled = false,
    intent = 'primary',
    loading = false,
    size = 'default',
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes(
        'inline-flex items-center justify-center gap-2 rounded-control border font-medium transition-[background-color,border-color,color] duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        INTENTS[intent] ?? INTENTS.primary,
        SIZES[size] ?? SIZES.default,
        className,
      )}
      {...props}
    >
      {loading ? <span className="ds-spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  )
})

export const IconButton = forwardRef(function IconButton(
  { children, className, label, intent = 'quiet', size = 'default', ...props },
  ref,
) {
  const sizeClass = size === 'sm' ? 'size-control-sm' : size === 'lg' ? 'size-control-lg' : 'size-control'
  return (
    <Button
      ref={ref}
      intent={intent}
      size={size}
      aria-label={label}
      title={label}
      className={classes('shrink-0 !px-0', sizeClass, className)}
      {...props}
    >
      <span aria-hidden="true" className="flex size-5 items-center justify-center text-xl leading-none">
        {children}
      </span>
    </Button>
  )
})
