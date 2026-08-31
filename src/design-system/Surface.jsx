import { classes } from './classes'

export function Panel({ as: Component = 'section', children, className, elevated = false, ...props }) {
  return (
    <Component
      className={classes(
        'rounded-panel border border-border bg-transparent p-4 sm:p-5',
        elevated && 'bg-surface-raised',
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  )
}

export function Card({ as: Component = 'article', children, className, interactive = false, ...props }) {
  return (
    <Component
      className={classes(
        'rounded-panel border border-border bg-transparent p-4',
        interactive && 'transition-colors hover:border-border-strong hover:bg-surface-subtle',
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  )
}
