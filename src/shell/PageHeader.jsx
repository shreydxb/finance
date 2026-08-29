export default function PageHeader({ title, description, eyebrow }) {
  return (
    <header className="page-header pb-5 pt-6 sm:pb-7 sm:pt-9">
      {eyebrow ? <p className="mb-2 mt-0 text-micro font-semibold uppercase tracking-[0.16em] text-action">{eyebrow}</p> : null}
      <h1 id="page-title" tabIndex="-1" className="m-0 text-title-1 font-semibold tracking-[-0.025em] text-text-primary outline-none">
        {title}
      </h1>
      {description ? <p className="mb-0 mt-2 max-w-copy text-body text-text-secondary">{description}</p> : null}
    </header>
  )
}
