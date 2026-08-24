import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { NavigationSafetyProvider } from './lib/NavigationSafety'
import { useNavigationSafety } from './lib/navigationSafetyContext'
import { PrefsProvider, usePrefs } from './lib/PrefsContext'
import { DISPLAY_CURRENCIES } from './lib/money'
import {
  detailHref,
  hrefWithQuery,
  parentHrefForDetail,
  queryObject,
  resolveAppHref,
  routeForScreen,
  safeInternalReturnTo,
} from './lib/routes'
import Login from './screens/Login'
import Home from './screens/Home'
import Accounts from './screens/Accounts'
import Investments from './screens/Investments'
import Transactions from './screens/Transactions'
import Reports from './screens/Reports'
import Budget from './screens/Budget'
import Recurring from './screens/Recurring'
import Goals from './screens/Goals'
import Debts from './screens/Debts'
import Settings from './screens/Settings'

const SCREENS = [
  'Home',
  'Accounts',
  'Investments',
  'Transactions',
  'Reports',
  'Budget',
  'Recurring',
  'Goals',
  'Debts',
  'Settings',
]

const BUILT_SCREENS = {
  Home,
  Accounts,
  Investments,
  Transactions,
  Reports,
  Budget,
  Recurring,
  Goals,
  Debts,
  Settings,
}

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

function useBrowserRouter() {
  const safety = useNavigationSafety()
  const [route, setRoute] = useState(readBrowserRoute)
  const hrefRef = useRef(route.href)
  const stateRef = useRef(window.history.state)
  const acceptNextPopRef = useRef(false)

  const commitCurrentLocation = useCallback((historyState = window.history.state) => {
    const nextRoute = readBrowserRoute()
    hrefRef.current = nextRoute.href
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
    return href ? navigate(href, { detail: true }) : false
  }, [navigate, route.searchParams])

  const closeDetail = useCallback((options = {}) => {
    const destination = parentHrefForDetail(route, window.history.state)
    if (!destination) return false
    if (!options.force && !safety.confirmLeave()) return false
    safety.clearAll()
    if (destination.method === 'back') {
      acceptNextPopRef.current = true
      window.history.back()
      return true
    }
    window.history.replaceState({}, '', destination.href)
    commitCurrentLocation({})
    return true
  }, [commitCurrentLocation, route, safety])

  return { route, navigate, updateQuery, openDetail, closeDetail }
}

/** Currency + light/dark, in the header so they're reachable from any screen. */
function DisplayControls() {
  const { currency, setCurrency, theme, setTheme } = usePrefs()
  const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
  const themeIcon = theme === 'light' ? '☀' : theme === 'dark' ? '☾' : '◐'
  const themeLabel = theme === 'system' ? 'Theme: following system' : `Theme: ${theme}`

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs">
        {DISPLAY_CURRENCIES.map((currencyCode) => (
          <button
            key={currencyCode}
            type="button"
            onClick={() => setCurrency(currencyCode)}
            aria-pressed={currency === currencyCode}
            className={`rounded-md px-2 py-1 font-medium transition-colors ${
              currency === currencyCode ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'
            }`}
          >
            {currencyCode}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setTheme(nextTheme)}
        title={themeLabel}
        aria-label={themeLabel}
        className="rounded-lg px-2 py-1.5 text-sm text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
      >
        {themeIcon}
      </button>
    </div>
  )
}

function NotFound({ navigate }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-ink-400">Not Found</p>
      <h2 className="mt-2 text-xl font-semibold text-ink-900">This page does not exist.</h2>
      <p className="mt-2 text-sm text-ink-500">Choose a known destination to continue.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {[
          ['Overview', '/overview'],
          ['Money', '/money/activity'],
          ['Wealth', '/wealth/net-worth'],
          ['Planning', '/planning'],
        ].map(([label, href]) => (
          <button
            key={href}
            type="button"
            onClick={() => navigate(href)}
            className="rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Dashboard({ router }) {
  const { signOut } = useAuth()
  const safety = useNavigationSafety()
  const { route, navigate, updateQuery, openDetail, closeDetail } = router
  const routeQuery = useMemo(() => queryObject(route.searchParams), [route.searchParams])
  const ActiveScreen = route.kind === 'screen' ? BUILT_SCREENS[route.screen] : null

  function navigateToScreen(target, payload = null) {
    navigate(routeForScreen(target, payload), { detail: Boolean(payload) })
  }

  async function handleSignOut() {
    if (!safety.confirmLeave()) return
    safety.clearAll()
    await signOut()
  }

  const screenProps = {
    onNavigate: navigateToScreen,
    routeQuery,
    onRouteQueryChange: updateQuery,
    detailId: route.kind === 'screen' ? route.detail?.id ?? null : null,
    onOpenDetail: openDetail,
    onCloseDetail: closeDetail,
  }

  return (
    <div className="min-h-screen bg-ink-50 text-ink-900">
      <div className="sticky top-0 z-40 border-b border-ink-200 bg-surface/85 backdrop-blur-md">
        <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-900 text-sm font-bold text-ink-50 shadow-card"
            >
              ◈
            </span>
            <h1 className="text-base font-semibold tracking-tight">Our Money</h1>
          </div>
          <div className="flex items-center gap-1.5">
            <DisplayControls />
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
            >
              Sign out
            </button>
          </div>
        </header>

        <nav className="mx-auto max-w-6xl px-2 pb-2 sm:px-4">
          <ul className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SCREENS.map((screen) => (
              <li key={screen}>
                <button
                  type="button"
                  onClick={() => navigateToScreen(screen)}
                  aria-current={route.kind === 'screen' && route.screen === screen ? 'page' : undefined}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
                    route.kind === 'screen' && route.screen === screen
                      ? 'bg-ink-900 text-ink-50 shadow-card'
                      : 'text-ink-500 hover:bg-ink-100 hover:text-ink-900'
                  }`}
                >
                  {screen}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <main key={route.kind === 'screen' ? route.screen : route.kind} className="animate-fade">
        {ActiveScreen ? <ActiveScreen {...screenProps} /> : <NotFound navigate={navigate} />}
      </main>
    </div>
  )
}

function Gate() {
  const { session, loading } = useAuth()
  const router = useBrowserRouter()
  const { route, navigate } = router

  useEffect(() => {
    if (!session || route.kind !== 'login') return
    const returnTo = safeInternalReturnTo(route.searchParams.get('returnTo')) ?? '/overview'
    navigate(returnTo, { replace: true, force: true })
  }, [navigate, route, session])

  if (loading) return null
  if (!session) return <Login />
  if (route.kind === 'login') return null
  return <Dashboard router={router} />
}

function App() {
  return (
    <AuthProvider>
      <PrefsProvider>
        <NavigationSafetyProvider>
          <Gate />
        </NavigationSafetyProvider>
      </PrefsProvider>
    </AuthProvider>
  )
}

export default App
