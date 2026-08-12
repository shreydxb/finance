// Passphrase encryption for database backups.
//
// This is the one module where a subtle bug costs the household its data
// rather than a wrong number on a screen, so the choices are deliberately
// conservative and the file format is self-describing.
//
//   AES-256-GCM     — authenticated encryption. A corrupted or tampered file
//                     fails to decrypt loudly instead of yielding garbage.
//   PBKDF2-SHA256   — key derivation from the passphrase, with a random salt
//                     per backup so two backups never share a key.
//   Random IV       — 12 bytes, per backup. Never reused, which is the one
//                     thing that genuinely breaks GCM.
//
// Everything needed to decrypt except the passphrase is written into the file
// header, so a file made today still opens after the parameters change.
//
// Uses Web Crypto only (`crypto.subtle`), which is present in Deno, Node 18+
// and browsers alike — the restore script therefore needs no dependencies.

/** File magic: "OMBK" — Our Money BacKup. */
export const MAGIC = new Uint8Array([0x4f, 0x4d, 0x42, 0x4b])
export const FORMAT_VERSION = 1

/**
 * PBKDF2 iterations. OWASP's 2023 floor for PBKDF2-HMAC-SHA256 is 210,000.
 * Written into the header, so raising it later does not orphan old backups.
 */
export const KDF_ITERATIONS = 210_000

const SALT_BYTES = 16
const IV_BYTES = 12
const HEADER_BYTES = MAGIC.length + 1 + 4 + SALT_BYTES + IV_BYTES

export class BackupCryptoError extends Error {}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * Encrypt UTF-8 text under a passphrase.
 *
 * Layout: MAGIC | version | iterations (uint32 BE) | salt | iv | ciphertext+tag
 */
export async function encryptBackup(plaintext: string, passphrase: string): Promise<Uint8Array> {
  if (!passphrase) throw new BackupCryptoError('a passphrase is required')

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS)

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      new TextEncoder().encode(plaintext)
    )
  )

  const out = new Uint8Array(HEADER_BYTES + ciphertext.length)
  let offset = 0
  out.set(MAGIC, offset)
  offset += MAGIC.length
  out[offset++] = FORMAT_VERSION
  new DataView(out.buffer).setUint32(offset, KDF_ITERATIONS, false)
  offset += 4
  out.set(salt, offset)
  offset += SALT_BYTES
  out.set(iv, offset)
  offset += IV_BYTES
  out.set(ciphertext, offset)
  return out
}

/**
 * Decrypt a backup produced by `encryptBackup`.
 *
 * Throws a named error for each distinct failure, because "it didn't work" is
 * useless when you are trying to recover data: a wrong passphrase and a
 * truncated download need different responses.
 */
export async function decryptBackup(file: Uint8Array, passphrase: string): Promise<string> {
  if (file.length < HEADER_BYTES + 1) {
    throw new BackupCryptoError('file is too short to be a backup — it may have been truncated')
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (file[i] !== MAGIC[i]) {
      throw new BackupCryptoError('not an Our Money backup file (bad magic bytes)')
    }
  }

  let offset = MAGIC.length
  const version = file[offset++]
  if (version !== FORMAT_VERSION) {
    throw new BackupCryptoError(`unsupported backup format version ${version}; this tool understands ${FORMAT_VERSION}`)
  }

  const iterations = new DataView(file.buffer, file.byteOffset).getUint32(offset, false)
  offset += 4
  const salt = file.slice(offset, offset + SALT_BYTES)
  offset += SALT_BYTES
  const iv = file.slice(offset, offset + IV_BYTES)
  offset += IV_BYTES
  const ciphertext = file.slice(offset)

  const key = await deriveKey(passphrase, salt, iterations)
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext as BufferSource
    )
    return new TextDecoder().decode(plaintext)
  } catch {
    // GCM cannot tell "wrong key" from "modified ciphertext" — both fail the
    // authentication tag. Say so honestly rather than guessing.
    throw new BackupCryptoError(
      'could not decrypt: the passphrase is wrong, or the file was altered or corrupted in transit'
    )
  }
}
