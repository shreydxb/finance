// Supabase Edge Function: backup
//
// Dumps every table, encrypts the result under BACKUP_PASSPHRASE, and sends it
// to a Telegram chat as a document. Intended to run nightly on pg_cron; also
// triggerable by hand.
//
// Why Telegram: the household's Supabase project has no backups on the free
// plan, and receipts and spend amounts already flow through this bot, so a
// nightly encrypted file adds little the channel does not already carry. The
// file is useless without the passphrase either way.
//
// Two rules this function follows, both learned the hard way elsewhere in this
// project:
//
//   1. A partial backup is worse than none, because it is trusted. If any
//      table fails to read, the whole run aborts and reports.
//   2. A silent failure is worse still. Every failure path sends a message to
//      the chat — a backup that quietly stopped three weeks ago is exactly the
//      backup you discover at the worst moment.
//
// Deploy: supabase functions deploy backup
// Secrets: BACKUP_PASSPHRASE, BACKUP_CHAT_ID, TELEGRAM_BOT_TOKEN
//          (SUPABASE_URL is provided by the platform; the service-role key
//          comes from _shared/serviceKey.ts's precedence, not directly)

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { encryptBackup } from '../_shared/crypto.ts'
import { resolveServiceKey } from '../_shared/serviceKey.ts'
import { backupFilename, backupSummary, buildBackup, type BackupDocument } from './dump.ts'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

interface Config {
  supabaseUrl: string
  serviceKey: string
  passphrase: string
  botToken: string
  chatId: string
}

function loadConfig(env: Record<string, string | undefined>): Config {
  const missing: string[] = []
  const need = (key: string) => {
    const value = env[key]
    if (!value) missing.push(key)
    return value ?? ''
  }

  let serviceKey = ''
  try {
    serviceKey = resolveServiceKey(env)
  } catch {
    missing.push('SUPABASE_SECRET_KEYS/SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE_KEY')
  }

  const config = {
    supabaseUrl: need('SUPABASE_URL'),
    serviceKey,
    passphrase: need('BACKUP_PASSPHRASE'),
    botToken: need('TELEGRAM_BOT_TOKEN'),
    chatId: need('BACKUP_CHAT_ID'),
  }
  if (missing.length > 0) {
    // Named explicitly: "backup failed" without saying which secret is absent
    // is the kind of error that goes unfixed for weeks.
    throw new Error(`missing required secret(s): ${missing.join(', ')}`)
  }
  return config
}

/** Sends a plain message — used for reporting failures into the same chat. */
async function notify(config: Config, text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chatId, text }),
    })
  } catch (error) {
    console.error('could not report failure to Telegram', error)
  }
}

async function sendDocument(config: Config, bytes: Uint8Array, filename: string, caption: string): Promise<void> {
  const form = new FormData()
  form.append('chat_id', config.chatId)
  form.append('caption', caption)
  form.append('document', new Blob([bytes as BlobPart], { type: 'application/octet-stream' }), filename)

  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendDocument`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    throw new Error(`Telegram sendDocument failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  }
}

/** Highest applied migration, recorded so a restore can spot a schema mismatch. */
async function readSchemaVersion(config: Config): Promise<string | null> {
  try {
    const res = await fetch(
      `${config.supabaseUrl}/rest/v1/schema_migrations?select=version&order=version.desc&limit=1`,
      { headers: { apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}` } }
    )
    if (!res.ok) return null
    const rows = (await res.json()) as { version?: string }[]
    return rows[0]?.version ?? null
  } catch {
    // Not fatal: a backup without a schema stamp is still a backup.
    return null
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'POST only' }, 405)
  }

  // Authentication is the platform's: this function is deployed with
  // verify_jwt = true (see supabase/config.toml), so the caller must present a
  // valid key. pg_cron passes the service-role key in the Authorization header.
  let config: Config
  try {
    config = loadConfig(Deno.env.toObject())
  } catch (error) {
    console.error('config error', error)
    return json({ ok: false, error: String(error instanceof Error ? error.message : error) }, 500)
  }

  const startedAt = Date.now()
  try {
    const fetchTable = async (table: string): Promise<unknown[]> => {
      const res = await fetch(`${config.supabaseUrl}/rest/v1/${table}?select=*`, {
        headers: { apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}` },
      })
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`)
      return (await res.json()) as unknown[]
    }

    const document: BackupDocument = await buildBackup(fetchTable, await readSchemaVersion(config))
    const encrypted = await encryptBackup(JSON.stringify(document), config.passphrase)
    const filename = backupFilename(document.meta)

    await sendDocument(
      config,
      encrypted,
      filename,
      `🔒 Encrypted backup · ${backupSummary(document.meta)}`
    )

    return json({
      ok: true,
      filename,
      bytes: encrypted.length,
      rows: document.meta.total_rows,
      duration_ms: Date.now() - startedAt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('backup failed', message)
    // Rule 2: never fail quietly.
    await notify(config, `⚠️ Backup FAILED — ${message}\n\nNo file was produced. Today's backup is missing.`)
    return json({ ok: false, error: message }, 500)
  }
})
