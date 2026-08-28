import { shouldHandleInApp } from './appLinkEvents'

export default function AppLink({ href, navigate, onNavigated, children, ...props }) {
  function handleClick(event) {
    props.onClick?.(event)
    if (!shouldHandleInApp(event, href)) return
    event.preventDefault()
    const navigated = navigate(href)
    if (navigated) onNavigated?.()
  }

  return <a {...props} href={href} onClick={handleClick}>{children}</a>
}
