export default function MobileAppHeader({ onOpenUtility }) {
  return (
    <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border bg-surface px-4 md:hidden">
      <div className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-control bg-text-primary text-label font-bold text-text-inverse">◈</span>
        <span className="truncate text-title-3 font-semibold text-text-primary">Our Money</span>
      </div>
      <button
        type="button"
        onClick={onOpenUtility}
        className="min-h-control rounded-control border border-border px-3 text-body-sm font-semibold text-text-secondary hover:border-border-strong hover:bg-surface-subtle hover:text-text-primary"
      >
        Preferences
      </button>
    </header>
  )
}
