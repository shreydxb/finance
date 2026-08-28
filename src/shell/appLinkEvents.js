export function shouldHandleInApp(event, href) {
  if (event.defaultPrevented || event.button !== 0) return false
  if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return false
  if (event.currentTarget.target && event.currentTarget.target !== '_self') return false
  const destination = new URL(href, window.location.href)
  return destination.origin === window.location.origin
}
