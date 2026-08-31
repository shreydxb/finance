# Encrypted database backups

Supabase's free plan has no backups. This function fills that gap: it dumps
every table nightly, encrypts the result under a passphrase, and sends it to a
Telegram chat as a file you can download from any device.

The `[TEST]` cleanup on 12 Aug 2026 deleted 53 rows with no way back. That is
the situation this exists to prevent.

## How it works

1. Reads every table in `dump.ts`'s `BACKUP_TABLES`, in foreign-key-safe order.
2. Wraps them in a document with a manifest: timestamp, schema version, per-table row counts.
3. Encrypts with **AES-256-GCM**, key derived from `BACKUP_PASSPHRASE` via **PBKDF2-SHA256** (210,000 iterations, random salt and IV per backup).
4. Sends it to `BACKUP_CHAT_ID` as `our-money-YYYY-MM-DD-Nrows.ombk`.

Two rules it will not break:

- **A partial backup is worse than none**, because it gets trusted. If any table fails to read, the run aborts — no file is produced.
- **A silent failure is worse still.** Every failure path posts a message into the chat saying the backup is missing. A backup that quietly stopped weeks ago is the one you discover at the worst possible moment.

## Setup

### 1. Secrets

Set in Supabase → Edge Functions → Secrets:

| Secret | What it is |
|---|---|
| `BACKUP_PASSPHRASE` | Your passphrase. **Keep your own copy somewhere safe.** |
| `BACKUP_CHAT_ID` | A chat *separate from* the intake chat (see below). |
| `TELEGRAM_BOT_TOKEN` | Already set if the intake bot is configured. |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by the platform.

> **On the passphrase.** Nobody can recover your data without it — not
> Supabase, not Telegram, not this repository. That is the point, and it is
> also the risk. Store it where you would store a house key, not only in your
> head. If you lose it, every backup file becomes permanently unreadable.

### 2. Use a separate chat

Send backups somewhere other than the receipt-intake chat. A daily file in the
intake chat is noise, and CLAUDE.md's rule applies directly: **a muted bot is a
broken intake pipeline.** Create a second group (or use a saved-messages chat)
and put its ID in `BACKUP_CHAT_ID`.

### 3. Deploy

```bash
supabase functions deploy backup
```

### 4. Schedule it

`pg_cron` and `pg_net` are available but not installed. One statement each:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 22:00 UTC = 02:00 Dubai, after the household's day is over.
select cron.schedule(
  'nightly-backup',
  '0 22 * * *',
  $$
  select net.http_post(
    url     := 'https://<project-ref>.supabase.co/functions/v1/backup',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <service-role-key>'
    )
  );
  $$
);
```

Check it is scheduled with `select * from cron.job;`, and see runs with
`select * from cron.job_run_details order by start_time desc limit 10;`.

## Restoring

`scripts/restore-backup.mjs` decrypts a file. It is deliberately
dependency-free and duplicates the format constants rather than importing the
app's code — on the day you need it, the repo may not install and the app may
not build, and you should still be able to open your data with nothing but
Node and that one file.

```bash
# Inspect (prints the manifest, decrypts nothing to disk)
node scripts/restore-backup.mjs ~/Downloads/our-money-2026-08-12-195rows.ombk

# Write the decrypted JSON out
node scripts/restore-backup.mjs ~/Downloads/our-money-2026-08-12-195rows.ombk --out data.json
```

The passphrase comes from the `BACKUP_PASSPHRASE` environment variable, or is
prompted for. It is never accepted as a command-line argument, because those
land in shell history.

On inspection the script cross-checks the manifest's row counts against what is
actually in the file, so a damaged-but-decryptable backup cannot pass unnoticed.

### Getting rows back into the database

The decrypted JSON has one array per table under `tables`, in an order that
satisfies the foreign keys. Restore by inserting them in that order — for a
partial recovery (a table, or a handful of rows), paste the relevant rows into
the SQL editor or PostgREST.

**Test this before you need it.** A restore path nobody has walked is a guess.
The honest state today: the decrypt path is tested end to end, including
tampering and truncation; a full re-import into a live database has not been
rehearsed.

## Format

```
OMBK | version (1 byte) | PBKDF2 iterations (uint32 BE) | salt (16) | iv (12) | ciphertext+GCM tag
```

Self-describing on purpose: the iteration count travels with the file, so
raising it later does not orphan older backups.

## What is and is not covered

Backed up by current repository source: every allowlisted table, including
`settings`, immutable `audit_events`, the SHR-196 durable category lifecycle
evidence (`category_name_history`, `category_aliases`), nullable SHR-197 stable
references, and the SHR-197 reconciliation evidence ledger. The deployed
backup function must be checked separately; repository coverage does not prove
a production deployment.

SHR-191 adds an automated representative audit restore: one exported raw audit
row is inserted into a clean table with the production constraints, compared
exactly, and then proven immutable under UPDATE/DELETE. This is evidence for the
new table's export/restore shape, not a claim that a full production re-import
of every table has been rehearsed.

SHR-196 extends the same drill to category identity. A category carrying a
system code, a historically archived category, a renamed category, its
immutable rename history and a retired alias are exported through the manifest,
restored into clean tables with the production constraints, and compared
exactly — ids, names, system codes, archive state, history and alias lifecycle
all survive, and the archived row comes back archived.

That archived row is why the lifecycle guard treats `INSERT` and `UPDATE`
differently. Archive and reactivation are refused for every role as lifecycle
transitions, but a re-import has to be able to write a row that was already
archived when the backup was taken, so an `INSERT` on the operator path may
carry an archive timestamp. It cannot be turned into an archive capability:
archiving a live category that way would mean deleting it first, and `DELETE`
is refused for every role.

The restored copy is then re-checked: an unapproved system code and a duplicate system anchor are
still rejected, an archived system category is still impossible, history is
still immutable, and — once the lifecycle guard is re-attached — `history_only`
is still terminal and alias evidence is still undeletable. Both new tables are
classified `financial`: losing them would leave restored category identity
unverifiable.

Restore order matters for these two. `category_name_history` references
`categories`, and `category_aliases` references both, so the manifest lists
them after `categories` and the dependency test enforces it.

SHR-194 extends the drill again, to reconciliation evidence. A mapping decision
that was created, changed and then deactivated is exported through the manifest,
restored into a clean table with the production constraints, and compared
exactly — every decision version, its before and after party, and its
database-authored decision timestamp all survive in order. That ordering is the
point: a restore that lost the middle decision would produce a plausible but
false history, in which the current mapping looks as though it had always been
true. The restored copy is then re-checked and is still append-only, and its
shape constraints still refuse a creation that claims a previous state or a
deactivation that means anything other than mapped → access_only.

Both new tables are `financial`. `access_party_mapping_history` is the only
record that a decision was ever different, and `access_party_reconciliation_runs`
is what makes a re-applied manifest a replay rather than a second set of
decisions — losing it would turn a retry into a duplicate reconciliation.

Restore order matters for these two as well. `access_party_mapping_history`
holds composite foreign keys into `access_party_mappings` and
`economic_parties`, and the run records reference `economic_households`, so the
manifest lists both after those tables and the dependency test enforces it.

SHR-197 adds stable category references and five append-only reconciliation
tables. The export includes active and soft-deleted transactions, category
rules, NULL reference values, category system codes, archived category state,
the reviewed manifest, per-row resolution evidence, and accepted exact-content
replay evidence. Restore ordering is
explicit: categories precede transactions and rules; those source rows precede
the run, system-entry, label-manifest and row-evidence tables in foreign-key
order. The manifest dependency test enforces this graph. This makes a restored
exact-content replay distinguishable from a new or conflicting reconciliation
without turning legacy category text into a restore-time lookup key.

**Not** backed up: Edge Function secrets, the Supabase project configuration,
Auth users, and the database schema itself (migrations live in
`supabase/schema/`, which is in git). A backup restores your *data* into an
existing project — it is not a one-click rebuild of the whole system.
