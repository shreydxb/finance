#!/usr/bin/env node
//
// Decrypt an Our Money backup file.
//
//   node scripts/restore-backup.mjs <file.ombk>                  # inspect
//   node scripts/restore-backup.mjs <file.ombk> --out data.json  # write JSON
//
// The passphrase is read from the BACKUP_PASSPHRASE environment variable, or
// prompted for. It is never taken as a command-line argument, because those end
// up in shell history.
//
// Deliberately dependency-free and standalone: it uses only Node's built-ins
// and duplicates the file-format constants rather than importing the app's
// TypeScript. On the day you need this, the repo may not install, the app may
// not build, and you should still be able to open your data with nothing but
// Node and this one file.

import { readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import process from 'node:process'
import { webcrypto as crypto } from 'node:crypto'

const MAGIC = [0x4f, 0x4d, 0x42, 0x4b] // "OMBK"
const FORMAT_VERSION = 1
const SALT_BYTES = 16
const IV_BYTES = 12
const HEADER_BYTES = MAGIC.length + 1 + 4 + SALT_BYTES + IV_BYTES

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

async function readPassphrase() {
  if (process.env.BACKUP_PASSPHRASE) return process.env.BACKUP_PASSPHRASE
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  const answer = await rl.question('Passphrase: ')
  rl.close()
  return answer
}

async function decrypt(file, passphrase) {
  if (file.length < HEADER_BYTES + 1) {
    fail('This file is too short to be a backup — the download may have been truncated.')
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (file[i] !== MAGIC[i]) fail('This is not an Our Money backup file.')
  }

  let offset = MAGIC.length
  const version = file[offset++]
  if (version !== FORMAT_VERSION) {
    fail(`This backup is format version ${version}; this script understands ${FORMAT_VERSION}.`)
  }

  const view = new DataView(file.buffer, file.byteOffset)
  const iterations = view.getUint32(offset, false)
  offset += 4
  const salt = file.subarray(offset, offset + SALT_BYTES)
  offset += SALT_BYTES
  const iv = file.subarray(offset, offset + IV_BYTES)
  offset += IV_BYTES
  const ciphertext = file.subarray(offset)

  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )

  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext))
  } catch {
    fail('Could not decrypt. Either the passphrase is wrong, or the file was altered or corrupted in transit.')
  }
}

const [, , path, ...rest] = process.argv
if (!path) {
  console.error('Usage: node scripts/restore-backup.mjs <file.ombk> [--out data.json]')
  process.exit(2)
}

const outIndex = rest.indexOf('--out')
const outPath = outIndex >= 0 ? rest[outIndex + 1] : null

const file = new Uint8Array(await readFile(path))
const plaintext = await decrypt(file, await readPassphrase())

let document
try {
  document = JSON.parse(plaintext)
} catch {
  fail('The file decrypted, but its contents are not valid JSON. The backup may be damaged.')
}

const { meta, tables } = document
console.error('') // keep stdout clean for piping
console.error(`Backup taken:    ${meta?.created_at ?? 'unknown'}`)
console.error(`Schema version:  ${meta?.schema_version ?? 'not recorded'}`)
console.error(`Rows:            ${meta?.total_rows ?? '?'} (${meta?.financial_rows ?? '?'} financial)`)
console.error('')
for (const [table, rows] of Object.entries(tables ?? {})) {
  if (rows.length > 0) console.error(`  ${table.padEnd(20)} ${rows.length}`)
}
console.error('')

// Cross-check the recorded counts against what is actually in the file, so a
// damaged-but-decryptable backup cannot pass inspection unnoticed.
const actual = Object.fromEntries(Object.entries(tables ?? {}).map(([t, rows]) => [t, rows.length]))
const mismatches = Object.entries(meta?.row_counts ?? {}).filter(([t, n]) => actual[t] !== n)
if (mismatches.length > 0) {
  console.error('⚠ Row counts in the file do not match its own manifest:')
  for (const [t, n] of mismatches) console.error(`   ${t}: manifest says ${n}, file holds ${actual[t] ?? 0}`)
  console.error('')
} else {
  console.error('✔ Row counts match the manifest.')
  console.error('')
}

if (outPath) {
  await writeFile(outPath, JSON.stringify(document, null, 2))
  console.error(`Written to ${outPath}`)
  console.error('This file is UNENCRYPTED — delete it once you are done.\n')
} else {
  console.error('Re-run with --out <file.json> to write the decrypted data out.\n')
}
