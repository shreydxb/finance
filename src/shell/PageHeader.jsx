export default function PageHeader({ title, description }) {
  return (
    <header className="pb-5 pt-6 sm:pb-6 sm:pt-8">
      <h1 id="page-title" tabIndex="-1" className="m-0 text-title-1 font-semibold tracking-tight text-text-primary outline-none">
        {title}
      </h1>
      {description ? <p className="mb-0 mt-1 text-body text-text-secondary">{description}</p> : null}
    </header>
  )
}
