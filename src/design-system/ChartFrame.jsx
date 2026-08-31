import { useId } from 'react'
import { Panel } from './Surface'

export function ChartDataAlternative({ caption = 'Chart data', columns, rows }) {
  return (
    <details className="mt-4 rounded-control border border-border bg-surface-subtle">
      <summary className="min-h-control cursor-pointer px-3 py-2.5 text-body-sm font-semibold text-text-primary">
        View data table
      </summary>
      <div className="v6-table-scroll overflow-x-auto border-t border-border" tabIndex="0" role="region" aria-label={caption}>
        <table className="w-full min-w-[660px] border-collapse text-left text-body-sm">
          <caption className="ds-visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className="border-b border-border px-3 py-2 font-semibold text-text-secondary">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id ?? index}>
                {columns.map((column, columnIndex) => {
                  const Cell = columnIndex === 0 ? 'th' : 'td'
                  return (
                    <Cell
                      key={column.key}
                      scope={columnIndex === 0 ? 'row' : undefined}
                      className="border-b border-border px-3 py-2 text-text-primary last:border-b-0"
                    >
                      {row[column.key]}
                    </Cell>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

export function ChartFrame({ children, columns, dataCaption, description, rows, summary, title, trailing }) {
  const generatedId = useId().replaceAll(':', '')
  const titleId = `chart-title-${generatedId}`
  const descriptionId = description ? `chart-description-${generatedId}` : undefined

  return (
    <Panel aria-labelledby={titleId} aria-describedby={descriptionId} className="border-x-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id={titleId} className="m-0 font-serif text-title-3 font-normal text-text-primary">{title}</h3>
          {description ? <p id={descriptionId} className="mb-0 mt-1 text-body-sm text-text-secondary">{description}</p> : null}
        </div>
        {trailing ? <div>{trailing}</div> : null}
      </div>
      {summary ? <p className="mb-0 mt-4 text-body font-medium text-text-primary">{summary}</p> : null}
      <div className="mt-4" aria-hidden="true">{children}</div>
      <ChartDataAlternative caption={dataCaption ?? `${title} data`} columns={columns} rows={rows} />
    </Panel>
  )
}
