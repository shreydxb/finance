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
  // SHR-193 durable economic identity substrate. A party UUID is the stable
  // reference every later attribution package points at, and a mapping row is
  // the reviewed record of which access identity represents which party — both
  // are irrecoverable by inspection, so both are household record rather than
  // operational telemetry. Restore order follows the foreign keys: households,
  // then parties, then the mapping decisions that reference both.
  //
  // They restore ahead of `accounts` because SHR-154 gave an account a stable
  // owner_party_id. That reference is a typed logical reference rather than a
  // foreign key, but the ordering is still load-bearing: the ownership guard
  // resolves the party on every write, restores included, and refuses an
  // account whose party does not exist yet.
  { name: 'economic_households', financial: true },
  { name: 'economic_parties', financial: true, dependsOn: ['economic_households'] },
  { name: 'accounts', financial: true, dependsOn: ['economic_parties'] },
  { name: 'income', financial: true },
  { name: 'settings', financial: true },
  // Depend on the above.
  // SHR-197 adds a real FK from both transactions and category rules to the
  // stable category identity. Categories therefore remain ahead of both.
  { name: 'transactions', financial: true, dependsOn: ['accounts', 'categories'] },
  { name: 'category_rules', financial: false, dependsOn: ['categories'] },
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
  // SHR-196 durable category lifecycle evidence. Immutable rename history and
  // registered compatibility aliases are the only record that a category's
  // display label ever changed, and the alias table is what a resolver will
  // later trust — losing either would make restored category identity
  // unverifiable, so both are household record, not operational telemetry.
  { name: 'category_name_history', financial: true, dependsOn: ['categories'] },
  { name: 'category_aliases', financial: true, dependsOn: ['categories', 'category_name_history'] },
  {
    name: 'access_party_mappings',
    financial: true,
    dependsOn: ['economic_households', 'economic_parties'],
  },
  // SHR-194 durable reconciliation evidence. Mapping history is the only
  // record that a decision was ever different — losing it would leave a
  // restored database asserting the current mapping as if it had always been
  // true — and the run records are what make a re-applied manifest a replay
  // rather than a second set of decisions. Restore order follows the foreign
  // keys: history after the mappings it references, runs after the households.
  {
    name: 'access_party_mapping_history',
    financial: true,
    dependsOn: ['economic_households', 'economic_parties', 'access_party_mappings'],
  },
  {
    name: 'access_party_reconciliation_runs',
    financial: true,
    dependsOn: ['economic_households'],
  },
  // SHR-154 durable account ownership evidence. The stable ownership fact
  // itself rides along inside `accounts` (ownership_kind/owner_party_id), but
  // the history is the only record that an account's economic ownership was
  // ever different — a restore that lost it would assert the current owner as
  // though it had always been true — and the run records are what make a
  // re-applied manifest a replay rather than a second reconciliation. The
  // account reference in history is a typed logical reference rather than a
  // foreign key — evidence outlives the account it describes — so only the
  // economic household ordering is load-bearing for a restore.
  {
    name: 'account_ownership_history',
    financial: true,
    dependsOn: ['economic_households'],
  },
  {
    name: 'account_ownership_reconciliation_runs',
    financial: true,
    dependsOn: ['economic_households'],
  },
  // SHR-197's run, exact manifest, system-code assignment and per-row outcomes
  // are one evidence set. The row subject IDs are deliberate logical
  // references, but restoring them after transactions/rules makes the drill
  // reviewable and the category FKs on every evidence row remain load-bearing.
  {
    name: 'category_reconciliation_runs',
    financial: true,
    dependsOn: ['categories', 'transactions', 'category_rules'],
  },
  {
    name: 'category_reconciliation_system_entries',
    financial: true,
    dependsOn: ['category_reconciliation_runs', 'categories'],
  },
  {
    name: 'category_reconciliation_manifest_entries',
    financial: true,
    dependsOn: ['category_reconciliation_runs', 'categories'],
  },
  {
    name: 'category_reconciliation_row_evidence',
    financial: true,
    dependsOn: ['category_reconciliation_runs', 'categories', 'transactions', 'category_rules'],
  },
  {
    name: 'category_reconciliation_replay_evidence',
    financial: true,
    dependsOn: ['category_reconciliation_runs'],
  },
  { name: 'forecast_events', financial: false },
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
