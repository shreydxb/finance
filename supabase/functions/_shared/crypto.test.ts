// The backup encryption has to be right the first time: a bug here is not a
// wrong figure on a screen, it is the household's records being unrecoverable
// at the moment they are needed.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BackupCryptoError,
  decryptBackup,
  encryptBackup,
  FORMAT_VERSION,
  KDF_ITERATIONS,
  MAGIC,
} from './crypto.ts'

const PASSPHRASE = 'correct horse battery staple'
const SAMPLE = JSON.stringify({ transactions: [{ id: 'a', amount: 41.95, currency: 'AED' }] })

test('a backup round-trips back to exactly what went in', async () => {
  const file = await encryptBackup(SAMPLE, PASSPHRASE)
  assert.equal(await decryptBackup(file, PASSPHRASE), SAMPLE)
})

test('unicode and newlines survive the round trip', async () => {
  // Account names carry ₹, ·, — and em dashes; a byte-length assumption here
  // would corrupt them silently.
  const tricky = JSON.stringify({ note: 'Noon · groceries — ₹1,000\nsecond line', emoji: '🏠' })
  const file = await encryptBackup(tricky, PASSPHRASE)
  assert.equal(await decryptBackup(file, PASSPHRASE), tricky)
})

test('an empty document round-trips', async () => {
  const file = await encryptBackup('{}', PASSPHRASE)
  assert.equal(await decryptBackup(file, PASSPHRASE), '{}')
})

test('the wrong passphrase is refused, not silently mis-decrypted', async () => {
  const file = await encryptBackup(SAMPLE, PASSPHRASE)
  await assert.rejects(
    () => decryptBackup(file, 'wrong passphrase'),
    (e: Error) => {
      assert.ok(e instanceof BackupCryptoError)
      assert.match(e.message, /passphrase is wrong|altered or corrupted/)
      return true
    }
  )
})

test('a passphrase differing by one character is refused', async () => {
  const file = await encryptBackup(SAMPLE, PASSPHRASE)
  await assert.rejects(() => decryptBackup(file, `${PASSPHRASE} `), BackupCryptoError)
})

test('tampering with the ciphertext is detected', async () => {
  // This is why AES-GCM rather than CBC: a flipped bit must fail loudly, not
  // produce plausible-looking wrong data.
  const file = await encryptBackup(SAMPLE, PASSPHRASE)
  file[file.length - 1] ^= 0x01
  await assert.rejects(() => decryptBackup(file, PASSPHRASE), BackupCryptoError)
})

test('tampering with the salt is detected', async () => {
  const file = await encryptBackup(SAMPLE, PASSPHRASE)
  file[MAGIC.length + 5] ^= 0xff
  await assert.rejects(() => decryptBackup(file, PASSPHRASE), BackupCryptoError)
})

test('two backups of identical data produce different bytes', async () => {
  // Random salt and IV per backup. Identical output would leak that nothing
  // changed between two days, and reusing a GCM IV is the one mistake that
  // genuinely breaks the cipher.
  const a = await encryptBackup(SAMPLE, PASSPHRASE)
  const b = await encryptBackup(SAMPLE, PASSPHRASE)
  assert.notDeepEqual(a, b)
  assert.equal(await decryptBackup(a, PASSPHRASE), await decryptBackup(b, PASSPHRASE))
})

test('the header is self-describing', async () => {
  const file = await encryptBackup(SAMPLE, PASSPHRASE)
  assert.deepEqual(file.slice(0, MAGIC.length), MAGIC, 'magic bytes')
  assert.equal(file[MAGIC.length], FORMAT_VERSION, 'version')

  const iterations = new DataView(file.buffer, file.byteOffset).getUint32(MAGIC.length + 1, false)
  assert.equal(iterations, KDF_ITERATIONS, 'iteration count travels with the file')
})

test('a file that is not a backup is rejected by name', async () => {
  const notABackup = new TextEncoder().encode('just some text, definitely not a backup file')
  await assert.rejects(
    () => decryptBackup(notABackup, PASSPHRASE),
    (e: Error) => {
      assert.match(e.message, /not an Our Money backup/)
      return true
    }
  )
})

test('a truncated file is reported as truncated, not as a bad passphrase', async () => {
  const file = await encryptBackup(SAMPLE, PASSPHRASE)
  await assert.rejects(
    () => decryptBackup(file.slice(0, 10), PASSPHRASE),
    (e: Error) => {
      assert.match(e.message, /too short|truncated/)
      return true
    }
  )
})

test('an unknown format version is named rather than failing obscurely', async () => {
  const file = await encryptBackup(SAMPLE, PASSPHRASE)
  file[MAGIC.length] = 99
  await assert.rejects(
    () => decryptBackup(file, PASSPHRASE),
    (e: Error) => {
      assert.match(e.message, /unsupported backup format version 99/)
      return true
    }
  )
})

test('encrypting without a passphrase is refused', async () => {
  await assert.rejects(() => encryptBackup(SAMPLE, ''), BackupCryptoError)
})

test('a large backup round-trips', async () => {
  // Guards the offset arithmetic against anything that only works on short
  // inputs. Real backups will grow well past this.
  const big = JSON.stringify({ rows: Array.from({ length: 5000 }, (_, i) => ({ i, note: `row ${i}` })) })
  const file = await encryptBackup(big, PASSPHRASE)
  assert.equal(await decryptBackup(file, PASSPHRASE), big)
})
