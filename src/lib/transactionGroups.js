// How a flat list of transaction rows becomes display entries.
//
// Pure logic, deliberately kept out of TransactionList.jsx: Node cannot load
// `.jsx`, so anything living there is untestable without a build step — the
// same trap that left `toAED` untested inside settings.js. This is the piece
// most worth testing, because getting it wrong misrepresents money.

/**
 * Group rows into display entries, branching on what each group actually is.
 *
 * `split_group_id` (006) originally meant one thing: the lines of a single
 * purchase divided across categories. Transfers (020) and bulk batches
 * (round2 §2) later reused the column for entirely different relationships
 * without recording which was which, and this function guessed "category
 * split" every time. A transfer therefore rendered with a doubled total, and a
 * bulk batch collapsed unrelated spends into one row showing only the first
 * row's date, account and note.
 *
 * The rule now: never infer a relationship from a shared id. `group_kind` says
 * what it is. Anything unrecognised — including a legacy row carrying an id but
 * no kind — falls back to independent rows, which is the safe direction: it
 * shows each row as it really is rather than merging rows that may not belong
 * together.
 */
export function groupEntries(items) {
  const entries = []
  const seen = new Set()

  for (const t of items) {
    const groupId = t.transaction_group_id
    if (!groupId) {
      entries.push({ kind: 'single', transaction: t })
      continue
    }
    if (seen.has(groupId)) continue

    const lines = items.filter((x) => x.transaction_group_id === groupId)

    if (t.group_kind === 'category_split') {
      seen.add(groupId)
      entries.push({ kind: 'split', groupId, lines })
    } else if (t.group_kind === 'transfer') {
      seen.add(groupId)
      // One movement shown once. The pair is two rows of the same value, so
      // summing them — which the shared split renderer did — doubles it.
      const out = lines.find((x) => x.transfer_direction === 'out') ?? lines[0]
      const into = lines.find((x) => x.transfer_direction === 'in')
      entries.push({ kind: 'transfer', groupId, lines, out, into })
    } else {
      entries.push({ kind: 'single', transaction: t })
    }
  }
  return entries
}

export function groupByDate(transactions) {
  const byDate = new Map()
  for (const t of transactions) {
    if (!byDate.has(t.date)) byDate.set(t.date, [])
    byDate.get(t.date).push(t)
  }
  return Array.from(byDate.entries()).map(([date, items]) => ({ date, entries: groupEntries(items) }))
}

/**
 * Stable identity for an entry.
 *
 * A grouped entry keys on its group; independent rows key on themselves. Bulk
 * rows must key individually — sharing the group id would make selecting one
 * select the whole batch.
 */
export function entryKey(entry) {
  return entry.kind === 'single' ? entry.transaction.id : entry.groupId
}
