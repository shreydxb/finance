export default function MobileAppHeader({ onOpenUtility }) {
  return (
    <header className="shell-mobile-header">
      <div className="min-w-0">
        <span className="shell-brand-name">Our Money</span>
        <span className="shell-brand-subtitle">Whole household</span>
      </div>
      <button
        type="button"
        onClick={onOpenUtility}
        className="shell-preferences-button"
      >
        Theme &amp; preferences
      </button>
    </header>
  )
}
