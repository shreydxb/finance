import { useEffect, useMemo } from 'react'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { NavigationSafetyProvider } from './lib/NavigationSafety'
import { useNavigationSafety } from './lib/navigationSafetyContext'
import { PrefsProvider } from './lib/PrefsContext'
import {
  queryObject,
  routeForScreen,
  safeInternalReturnTo,
  presentationForRoute,
} from './lib/routes'
import useBrowserRouter from './lib/useBrowserRouter'
import AppShell from './shell/AppShell'
import AppLink from './shell/AppLink'
import Login from './screens/Login'
import OverviewScreen from './v6/OverviewScreen'
import Accounts from './screens/Accounts'
import Investments from './screens/Investments'
import Transactions from './screens/Transactions'
import Reports from './screens/Reports'
import Budget from './screens/Budget'
import Recurring from './screens/Recurring'
import Goals from './screens/Goals'
import Debts from './screens/Debts'
import Settings from './screens/Settings'

// `/overview` renders the fresh V6 Overview (SHR-155). The legacy
// `src/screens/Home.jsx` composition is retained in the repository but is no
// longer mounted; V6 screens replace legacy presentation progressively.
const BUILT_SCREENS = {
  Overview: OverviewScreen,
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

function NotFound({ navigate }) {
  return (
    <div className="py-10 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-ink-400">Not Found</p>
      <p className="mt-2 text-sm text-ink-500">Choose a known destination to continue.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {[
          ['Overview', '/overview'],
          ['Money', '/money/activity'],
          ['Wealth', '/wealth/net-worth'],
          ['Planning', '/planning'],
        ].map(([label, href]) => (
          <AppLink
            key={href}
            href={href}
            navigate={navigate}
            className="rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            {label}
          </AppLink>
        ))}
      </div>
    </div>
  )
}

function Dashboard({ router }) {
  const { session, signOut } = useAuth()
  const safety = useNavigationSafety()
  const { route, navigate, updateQuery, openDetail, closeDetail } = router
  const routeQuery = useMemo(() => queryObject(route.searchParams), [route.searchParams])
  const ActiveScreen = route.kind === 'screen' ? BUILT_SCREENS[route.screen] : null

  function navigateToScreen(target, payload = null) {
    navigate(routeForScreen(target, payload), { detail: Boolean(payload) })
  }

  async function handleSignOut() {
    if (!safety.confirmLeave()) return false
    safety.clearAll()
    await signOut()
    return true
  }

  const screensOwningHeader = new Set(['Overview'])

  const screenProps = {
    navigate,
    onNavigate: navigateToScreen,
    routeQuery,
    onRouteQueryChange: updateQuery,
    detailId: route.kind === 'screen' ? route.detail?.id ?? null : null,
    onOpenDetail: openDetail,
    onCloseDetail: closeDetail,
  }

  const presentation = presentationForRoute(route)

  return (
    <AppShell
      identity={session?.user?.email ?? null}
      navigate={navigate}
      onSignOut={handleSignOut}
      presentation={presentation}
      route={route}
      screenOwnsHeader={route.kind === 'screen' && screensOwningHeader.has(route.screen)}
      takePendingFocusTarget={router.takePendingFocusTarget}
    >
      <div key={route.kind === 'screen' ? route.screen : route.kind}>
        {ActiveScreen ? <ActiveScreen {...screenProps} /> : <NotFound navigate={navigate} />}
      </div>
    </AppShell>
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
