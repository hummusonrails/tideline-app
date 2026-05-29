/**
 * Passphrase-protected secret bundle via Web Crypto.
 *
 * The encrypted payload (UTF-8 JSON) carries everything the app needs to
 * talk to its private storage backend — including the backend coordinates
 * themselves. Nothing about that backend is recoverable without the
 * per-person passphrase.
 *
 * Wire format (JSON, stored under public/users/<name>.enc):
 *   {
 *     v: 1,
 *     kdf: "PBKDF2-SHA256",
 *     iterations: 310000,
 *     salt: <base64>,
 *     iv: <base64>,
 *     ct: <base64>   // AES-GCM ciphertext of a SecretPayload JSON
 *   }
 *
 * Decrypted plaintext shape (kept in-process only):
 *   { pat: string, owner: string, repo: string }
 *
 * Bundles are produced by scripts/setup-keys.mjs and committed to the
 * public app repo. Without the right passphrase they're opaque ciphertext.
 */

const ITERATIONS = 310_000;
const KEY_LEN_BITS = 256;
const IV_LEN_BYTES = 12;
const SALT_LEN_BYTES = 16;

export interface EncryptedBundle {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  ct: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64encode(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.byteLength; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: KEY_LEN_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface SecretPayload {
  /** Personal access token, fine-grained to the private data backend. */
  pat: string;
  /** Owner login of the private data backend. */
  owner: string;
  /** Name of the private data backend repo. */
  repo: string;
  /** Display name surfaced in the UI after unlock. Authored at setup time. */
  displayName: string;
  /** 'parent' unlocks moderation features (bonus award, corrections). */
  role: 'parent' | 'kid';
}

export async function encryptSecret(
  payload: SecretPayload,
  passphrase: string,
): Promise<EncryptedBundle> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN_BYTES));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const plaintext = enc.encode(JSON.stringify(payload));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  );
  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: b64encode(salt),
    iv: b64encode(iv),
    ct: b64encode(ct),
  };
}

export async function decryptSecret(
  bundle: EncryptedBundle,
  passphrase: string,
): Promise<SecretPayload> {
  if (bundle.v !== 1 || bundle.kdf !== 'PBKDF2-SHA256') {
    throw new Error('unsupported bundle version');
  }
  const salt = b64decode(bundle.salt);
  const iv = b64decode(bundle.iv);
  const key = await deriveKey(passphrase, salt, bundle.iterations);
  let pt: ArrayBuffer;
  try {
    pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      b64decode(bundle.ct) as BufferSource,
    );
  } catch {
    throw new Error('wrong passphrase');
  }
  const parsed = JSON.parse(dec.decode(pt)) as Partial<SecretPayload>;
  if (
    typeof parsed.pat !== 'string' ||
    typeof parsed.owner !== 'string' ||
    typeof parsed.repo !== 'string'
  ) {
    throw new Error('malformed secret payload');
  }
  return parsed as SecretPayload;
}
