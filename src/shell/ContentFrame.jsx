import { classes } from '../design-system/classes'

const WIDTHS = {
  copy: 'max-w-copy',
  form: 'max-w-form',
  detail: 'max-w-detail',
  content: 'max-w-content',
  dense: 'max-w-dense',
}

export default function ContentFrame({ as: Component = 'div', children, className, width = 'content', ...props }) {
  return (
    <Component className={classes('shell-content-frame', WIDTHS[width] ?? WIDTHS.content, className)} {...props}>
      {children}
    </Component>
  )
}
