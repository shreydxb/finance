export default function BreakdownBars({ title, groups, tabs, activeTab, onTabChange, formatValue, emptyMessage }) {
  const maxAbs = Math.max(1, ...groups.map((g) => Math.abs(g.value)))

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
        {tabs && (
          <div className="flex rounded-lg border border-stone-300 p-0.5 text-xs">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => onTabChange(tab.key)}
                className={`rounded-md px-2.5 py-1 font-medium ${
                  activeTab === tab.key ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-stone-500">{emptyMessage ?? 'Nothing to show yet.'}</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const widthPct = (Math.abs(g.value) / maxAbs) * 100
            return (
              <div key={g.key}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-medium text-stone-700">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: g.color }} />
                    {g.label}
                  </span>
                  <span className="font-medium text-stone-900">{formatValue(g.value)}</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full rounded-full" style={{ width: `${widthPct}%`, backgroundColor: g.color }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
