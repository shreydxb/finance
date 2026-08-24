import { classes } from './classes'

export function Panel({ as: Component = 'section', children, className, elevated = false, ...props }) {
  return (
    <Component
      className={classes(
        'rounded-panel border border-border bg-surface p-4 sm:p-6',
        elevated && 'bg-surface-raised shadow-elevation-1',
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
        'rounded-panel border border-border bg-surface p-4',
        interactive && 'transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-elevation-1',
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  )
}
