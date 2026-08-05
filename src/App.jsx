const SCREENS = [
  'Home',
  'Accounts',
  'Transactions',
  'Cash Flow',
  'Budget',
  'Recurring',
  'Goals',
  'Settings',
]

function App() {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white px-6 py-4">
        <h1 className="text-xl font-semibold">Our Money v4</h1>
        <p className="text-sm text-stone-500">Phase 1 scaffold</p>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="mb-4 text-stone-600">
          Project scaffolded. Screens will be built epic by epic.
        </p>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SCREENS.map((screen) => (
            <li
              key={screen}
              className="rounded-lg border border-stone-200 bg-white px-4 py-3 text-center text-sm font-medium text-stone-700"
            >
              {screen}
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}

export default App
