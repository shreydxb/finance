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
import ActivityScreen from './v6/ActivityScreen'
import BudgetScreen from './v6/BudgetScreen'
import RecurringScreen from './v6/RecurringScreen'
import InsightsScreen from './v6/InsightsScreen'
import NetWorthScreen from './v6/NetWorthScreen'
import AccountsScreen from './v6/AccountsScreen'
import LegacyForecastsPlaceholder from './screens/Accounts'
import Investments from './screens/Investments'
import Goals from './screens/Goals'
import Debts from './screens/Debts'
import Settings from './screens/Settings'

// V6 screens replace legacy presentation progressively. `/overview` renders
// the fresh V6 Overview (SHR-155), `/money/activity` the fresh V6 Activity
// (SHR-164), `/money/budget` the fresh V6 Budget (SHR-199) and
// `/money/recurring` the fresh V6 Recurring (SHR-200), and
// `/money/insights` the fresh V6 Insights (SHR-201), and
// `/wealth/net-worth` the fresh V6 Net Worth (SHR-177), and
// `/wealth/accounts` the fresh V6 Accounts (SHR-180). The legacy
// `src/screens/Home.jsx`, `src/screens/Transactions.jsx`,
// `src/screens/Budget.jsx`, `src/screens/Recurring.jsx` and
// `src/screens/Reports.jsx` are retained in the repository but are no longer
// mounted, and are no longer imported here.
//
// `src/screens/Accounts.jsx` is no longer the Accounts screen. It stays bound
// only to Planning's `/planning/forecasts` placeholder, which has always
// rendered it because that module hosts the forecast card — keeping that
// binding is what stops SHR-180 from quietly removing a Planning surface it
// was not asked to touch. It reaches no Wealth route.
const BUILT_SCREENS = {
  Overview: OverviewScreen,
  Activity: ActivityScreen,
  Budget: BudgetScreen,
  Recurring: RecurringScreen,
  Insights: InsightsScreen,
  NetWorth: NetWorthScreen,
  Accounts: AccountsScreen,
  Forecasts: LegacyForecastsPlaceholder,
  Investments,
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

  const screensOwningHeader = new Set(['Overview', 'Activity', 'Budget', 'Recurring', 'Insights', 'NetWorth', 'Accounts'])

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
