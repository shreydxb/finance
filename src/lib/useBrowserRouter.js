import { useCallback, useEffect, useRef, useState } from 'react'
import {
  detailHref,
  hrefWithQuery,
  parentHrefForDetail,
  resolveAppHref,
} from './routes'
import { useNavigationSafety } from './navigationSafetyContext'

function currentBrowserHref() {
  return `${window.location.pathname}${window.location.search}`
}

function readBrowserRoute() {
  let route = resolveAppHref(currentBrowserHref())
  if (route.kind === 'redirect') {
    window.history.replaceState(window.history.state, '', route.to)
    route = resolveAppHref(route.to)
  }
  return route
}

export default function useBrowserRouter() {
  const safety = useNavigationSafety()
  const [route, setRoute] = useState(readBrowserRoute)
  const hrefRef = useRef(route.href)
  const routeRef = useRef(route)
  const stateRef = useRef(window.history.state)
  const acceptNextPopRef = useRef(false)
  const detailInvokerRef = useRef(null)
  const pendingFocusRef = useRef(null)

  const commitCurrentLocation = useCallback((historyState = window.history.state) => {
    const nextRoute = readBrowserRoute()
    hrefRef.current = nextRoute.href
    routeRef.current = nextRoute
    stateRef.current = historyState
    setRoute(nextRoute)
  }, [])

  useEffect(() => {
    function handlePopState(event) {
      if (acceptNextPopRef.current) {
        acceptNextPopRef.current = false
        commitCurrentLocation(event.state)
        return
      }
      if (!safety.confirmLeave()) {
        window.history.pushState(stateRef.current, '', hrefRef.current)
        return
      }
      safety.clearAll()
      if (routeRef.current.detail) pendingFocusRef.current = detailInvokerRef.current
      commitCurrentLocation(event.state)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [commitCurrentLocation, safety])

  const navigate = useCallback((target, options = {}) => {
    let destination = resolveAppHref(target)
    if (destination.kind === 'redirect') destination = resolveAppHref(destination.to)
    if (destination.kind !== 'screen' && destination.kind !== 'login') return false
    if (destination.href === hrefRef.current) return true
    if (!options.force && !safety.confirmLeave()) return false

    safety.clearAll()
    if (!options.detail) {
      detailInvokerRef.current = null
      pendingFocusRef.current = null
    }
    const historyState = options.detail ? { routeParent: hrefRef.current } : {}
    const method = options.replace ? 'replaceState' : 'pushState'
    window.history[method](historyState, '', destination.href)
    commitCurrentLocation(historyState)
    return true
  }, [commitCurrentLocation, safety])

  const updateQuery = useCallback((values) => {
    const nextHref = hrefWithQuery(route, values)
    const nextRoute = resolveAppHref(nextHref)
    window.history.replaceState(window.history.state, '', nextRoute.href)
    commitCurrentLocation(window.history.state)
  }, [commitCurrentLocation, route])

  const openDetail = useCallback((kind, id) => {
    const href = detailHref(kind, id, route.searchParams)
    if (!href) return false
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const opened = navigate(href, { detail: true })
    if (opened) detailInvokerRef.current = invoker
    return opened
  }, [navigate, route.searchParams])

  const closeDetail = useCallback((options = {}) => {
    const destination = parentHrefForDetail(route, window.history.state)
    if (!destination) return false
    if (!options.force && !safety.confirmLeave()) return false
    safety.clearAll()
    pendingFocusRef.current = detailInvokerRef.current
    if (destination.method === 'back') {
      acceptNextPopRef.current = true
      window.history.back()
      return true
    }
    window.history.replaceState({}, '', destination.href)
    commitCurrentLocation({})
    return true
  }, [commitCurrentLocation, route, safety])

  const takePendingFocusTarget = useCallback(() => {
    const target = pendingFocusRef.current
    pendingFocusRef.current = null
    return target
  }, [])

  return { route, navigate, updateQuery, openDetail, closeDetail, takePendingFocusTarget }
}
