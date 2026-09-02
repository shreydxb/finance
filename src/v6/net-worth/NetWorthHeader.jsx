export default function NetWorthHeader() {
  return (
    <header className="v6-page-header v6-enter">
      <div>
        <p className="v6-kicker-text">Wealth</p>
        <h1 id="page-title" tabIndex={-1} className="v6-page-title">Net worth</h1>
        <p className="v6-section-note v6-wealth-header-note">Current balance sheet and published snapshot history · whole household</p>
      </div>
      <span className="v6-wealth-read-only" aria-label="Read-only screen">Read only</span>
    </header>
  )
}
