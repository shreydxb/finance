import { createContext, forwardRef, useContext, useId } from 'react'
import { classes } from './classes'

const FieldContext = createContext(null)

export function Field({ children, className, error, help, id, label, required = false }) {
  const generatedId = useId()
  const controlId = id ?? `field-${generatedId.replaceAll(':', '')}`
  const helpId = help ? `${controlId}-help` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <FieldContext.Provider value={{ controlId, describedBy, invalid: Boolean(error), required }}>
      <div className={classes('grid gap-1.5', className)}>
        <label htmlFor={controlId} className="text-label font-semibold text-text-primary">
          {label}
          {required ? <span className="ml-1 text-danger" aria-hidden="true">*</span> : null}
        </label>
        {children}
        {help ? <p id={helpId} className="m-0 text-body-sm text-text-secondary">{help}</p> : null}
        {error ? <p id={errorId} role="alert" className="m-0 text-body-sm font-medium text-danger">{error}</p> : null}
      </div>
    </FieldContext.Provider>
  )
}

const CONTROL_BASE =
  'min-h-control w-full rounded-control border border-border bg-surface px-3 text-body text-text-primary shadow-none transition-[border-color,box-shadow,background-color] placeholder:text-text-tertiary hover:border-border-strong disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-text-tertiary disabled:opacity-75 aria-invalid:border-danger'

function useControlProps({ id, 'aria-describedby': describedBy, 'aria-invalid': invalid, required }) {
  const field = useContext(FieldContext)
  return {
    id: id ?? field?.controlId,
    'aria-describedby': describedBy ?? field?.describedBy,
    'aria-invalid': invalid ?? field?.invalid ?? undefined,
    required: required ?? field?.required ?? undefined,
  }
}

export const Input = forwardRef(function Input({ className, ...props }, ref) {
  const fieldProps = useControlProps(props)
  return <input ref={ref} className={classes(CONTROL_BASE, className)} {...props} {...fieldProps} />
})

export const Select = forwardRef(function Select({ children, className, ...props }, ref) {
  const fieldProps = useControlProps(props)
  return (
    <select ref={ref} className={classes(CONTROL_BASE, 'pr-9', className)} {...props} {...fieldProps}>
      {children}
    </select>
  )
})

export const Textarea = forwardRef(function Textarea({ className, rows = 4, ...props }, ref) {
  const fieldProps = useControlProps(props)
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={classes(CONTROL_BASE, 'min-h-24 resize-y py-2.5', className)}
      {...props}
      {...fieldProps}
    />
  )
})

export const Checkbox = forwardRef(function Checkbox(
  { className, description, disabled = false, error, id, label, ...props },
  ref,
) {
  const generatedId = useId()
  const controlId = id ?? `checkbox-${generatedId.replaceAll(':', '')}`
  const descriptionId = description ? `${controlId}-description` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={classes('grid gap-1.5', className)}>
      <label htmlFor={controlId} className={classes('flex min-h-11 items-start gap-3 rounded-control', disabled && 'opacity-60')}>
        <input
          ref={ref}
          id={controlId}
          type="checkbox"
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error) || undefined}
          className="mt-1 size-4 shrink-0 accent-action"
          {...props}
        />
        <span>
          <span className="block text-body font-medium text-text-primary">{label}</span>
        </span>
      </label>
      {description ? <p id={descriptionId} className="m-0 pl-7 text-body-sm text-text-secondary">{description}</p> : null}
      {error ? <p id={errorId} role="alert" className="m-0 pl-7 text-body-sm font-medium text-danger">{error}</p> : null}
    </div>
  )
})
