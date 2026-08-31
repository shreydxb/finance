export default function PageHeader({ kicker, title, description }) {
  return (
    <header className="shell-page-header">
      {kicker ? <p className="shell-page-kicker">{kicker}</p> : null}
      <h1 id="page-title" tabIndex="-1" className="shell-page-title">
        {title}
      </h1>
      {description ? <p className="shell-page-description">{description}</p> : null}
    </header>
  )
}
