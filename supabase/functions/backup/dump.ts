// Building the backup document.
//
// A backup is only worth having if it can be restored, so the shape here is
// driven by what a restore needs: every table, in an order that satisfies the
// foreign keys, with enough metadata to tell whether the file is complete and
// which schema it came from.

/**
 * Every table, ordered so that inserting them in sequence never violates a
 * foreign key. Restoring in a different order fails on the references.
 *
 * `financial` marks the rows that are the household's actual records — the
 * ones whose loss would be unrecoverable. The rest are operational and could
 * be rebuilt or lived without; they are included because they are small and
 * because `intake_logs` is the only record of what the bot was asked to do.
 */
export const BACKUP_TABLES = [
  // No dependencies.
  { name: 'categories', financial: true },
  { name: 'accounts', financial: true },
  { name: 'income', financial: true },
  { name: 'settings', financial: true },
  // Depend on the above.
  { name: 'transactions', financial: true, dependsOn: ['accounts'] },
  { name: 'budgets', financial: true, dependsOn: ['categories'] },
  { name: 'recurring', financial: true, dependsOn: ['accounts'] },
  { name: 'goals', financial: true, dependsOn: ['accounts'] },
  { name: 'goal_contributions', financial: true, dependsOn: ['goals'] },
  // History and operational tables.
  { name: 'nw_snapshots', financial: true },
  { name: 'nw_snapshot_runs', financial: true },
  { name: 'nw_snapshot_attempt_events', financial: true },
  { name: 'nw_snapshot_items', financial: true },
  { name: 'nw_daily', financial: true },
  // Immutable action evidence has logical typed references rather than FKs,
  // so it is restore-order independent. It is irrecoverable household record,
  // not disposable operational telemetry.
  { name: 'audit_events', financial: true },
  { name: 'forecast_events', financial: false },
  { name: 'category_rules', financial: false },
  { name: 'notifications', financial: false },
  { name: 'media_groups', financial: false },
  { name: 'pending_income', financial: false },
  { name: 'intake_logs', financial: false, dependsOn: ['transactions'] },
] as const

export interface BackupMeta {
  format: string
  created_at: string
  /** Highest applied migration, so a restore can refuse a mismatched schema. */
  schema_version: string | null
  row_counts: Record<string, number>
  total_rows: number
  financial_rows: number
}

export interface BackupDocument {
  meta: BackupMeta
  tables: Record<string, unknown[]>
}

export type TableFetcher = (table: string) => Promise<unknown[]>

/**
 * Assemble the backup document.
 *
 * A table that fails to read aborts the whole backup rather than producing a
 * file that is quietly missing a table — a partial backup that looks complete
 * is worse than no backup, because it is trusted.
 */
export async function buildBackup(
  fetchTable: TableFetcher,
  schemaVersion: string | null,
  now: () => string = () => new Date().toISOString()
): Promise<BackupDocument> {
  const tables: Record<string, unknown[]> = {}
  const rowCounts: Record<string, number> = {}
  let financialRows = 0

  for (const table of BACKUP_TABLES) {
    let rows: unknown[]
    try {
      rows = await fetchTable(table.name)
    } catch (error) {
      throw new Error(`backup aborted: could not read "${table.name}" (${String(error)})`)
    }
    tables[table.name] = rows
    rowCounts[table.name] = rows.length
    if (table.financial) financialRows += rows.length
  }

  const totalRows = Object.values(rowCounts).reduce((sum, n) => sum + n, 0)

  return {
    meta: {
      format: 'our-money-v4-backup',
      created_at: now(),
      schema_version: schemaVersion,
      row_counts: rowCounts,
      total_rows: totalRows,
      financial_rows: financialRows,
    },
    tables,
  }
}

/**
 * The filename carries the date and the row count on purpose: it makes an
 * empty or truncated backup obvious in the Telegram file list, without opening
 * or decrypting anything.
 */
export function backupFilename(meta: BackupMeta): string {
  const date = meta.created_at.slice(0, 10)
  return `our-money-${date}-${meta.total_rows}rows.ombk`
}

/**
 * A one-line summary for the accompanying Telegram message. Deliberately says
 * how many rows are the household's real financial records, so a sudden drop
 * is visible day to day.
 */
export function backupSummary(meta: BackupMeta): string {
  const notable = BACKUP_TABLES.filter((t) => t.financial && meta.row_counts[t.name] > 0)
    .map((t) => `${t.name} ${meta.row_counts[t.name]}`)
    .join(', ')
  return `${meta.total_rows} rows (${meta.financial_rows} financial) — ${notable}`
}
