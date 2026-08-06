import { useState } from 'react'
import { AuthProvider, useAuth } from './lib/AuthContext'
import Login from './screens/Login'
import Home from './screens/Home'
import Accounts from './screens/Accounts'
import Transactions from './screens/Transactions'
import CashFlow from './screens/CashFlow'
import Budget from './screens/Budget'
import Recurring from './screens/Recurring'
import Goals from './screens/Goals'
import Settings from './screens/Settings'

const SCREENS = ['Home', 'Accounts', 'Transactions', 'Cash Flow', 'Budget', 'Recurring', 'Goals', 'Settings']

const BUILT_SCREENS = {
  Home,
  Accounts,
  Transactions,
  'Cash Flow': CashFlow,
  Budget,
  Recurring,
  Goals,
  Settings,
}

function Dashboard() {
  const { signOut } = useAuth()
  const [screen, setScreen] = useState('Home')

  const ActiveScreen = BUILT_SCREENS[screen]

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="flex items-center justify-between border-b border-stone-200 bg-white px-6 py-4">
        <h1 className="text-xl font-semibold">Our Money v4</h1>
        <button
          type="button"
          onClick={() => signOut()}
          className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
        >
          Sign out
        </button>
      </header>

      <nav className="border-b border-stone-200 bg-white px-4 sm:px-6">
        <ul className="flex gap-1 overflow-x-auto">
          {SCREENS.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => setScreen(s)}
                className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium ${
                  screen === s
                    ? 'border-stone-900 text-stone-900'
                    : 'border-transparent text-stone-500 hover:text-stone-700'
                }`}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main>
        {ActiveScreen ? (
          <ActiveScreen />
        ) : (
          <p className="mx-auto max-w-3xl px-6 py-10 text-center text-sm text-stone-500">
            {screen} is coming in a later epic.
          </p>
        )}
      </main>
    </div>
  )
}

function Gate() {
  const { session, loading } = useAuth()

  if (loading) return null
  return session ? <Dashboard /> : <Login />
}

function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}

export default App
