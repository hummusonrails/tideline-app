/**
 * Long-lived per-device signing identity for the p2p layer.
 *
 * Each device generates one ECDSA P-256 keypair on first use. The private
 * key is non-extractable and stored as a CryptoKey directly in IndexedDB;
 * the public key is exportable so we can ship it to peers (in QR codes
 * and over the data channel) and persist it in our trust store.
 *
 * Fingerprint is a short Crockford-base32 of SHA-256(publicKey) — enough
 * to compare visually at a glance during pairing.
 */

import { b64ToBytes, bytesToB64, bytesToBase32, enc, sha256 } from './base';
import { db } from '../db';

const STORE_KEY = 'p2p-identity';
const FP_LEN = 10; // Crockford-base32 chars (~50 bits — fine for a small family trust set)

export interface PeerIdentity {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyRaw: Uint8Array;
  publicKeyB64: string;
  fingerprint: string;
  createdAt: string;
}

interface StoredIdentity {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  createdAt: string;
}

let cached: PeerIdentity | null = null;

export async function getOrCreateIdentity(): Promise<PeerIdentity> {
  if (cached) return cached;
  const stored = (await db.meta.get(STORE_KEY))?.value as StoredIdentity | undefined;
  if (stored && stored.publicKey instanceof CryptoKey && stored.privateKey instanceof CryptoKey) {
    cached = await hydrate(stored.publicKey, stored.privateKey, stored.createdAt);
    return cached;
  }
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, // non-extractable private key
    ['sign', 'verify'],
  );
  // Public key needs to be re-imported as extractable so we can export it.
  const pubRaw = await crypto.subtle.exportKey(
    'raw',
    await reimportPublicExtractable(kp.publicKey),
  );
  const createdAt = new Date().toISOString();
  // Persist the CryptoKey objects directly — IndexedDB structured-clones them
  // and re-hydrates as the same key type next session.
  await db.meta.put({
    key: STORE_KEY,
    value: {
      publicKey: await reimportPublicExtractable(kp.publicKey),
      privateKey: kp.privateKey,
      createdAt,
    } satisfies StoredIdentity,
  });
  cached = await hydrate(
    await reimportPublicExtractable(kp.publicKey),
    kp.privateKey,
    createdAt,
  );
  void pubRaw; // (already captured inside hydrate)
  return cached;
}

/**
 * The CryptoKey produced by generateKey isn't extractable by default for the
 * public half — re-import as JWK so it is. (We need extractable=true to call
 * exportKey('raw') for fingerprinting and over-the-wire transport.)
 */
async function reimportPublicExtractable(pub: CryptoKey): Promise<CryptoKey> {
  if (pub.extractable) return pub;
  const jwk = await crypto.subtle.exportKey('jwk', pub).catch(() => null);
  if (!jwk) return pub;
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify'],
  );
}

async function hydrate(
  publicKey: CryptoKey,
  privateKey: CryptoKey,
  createdAt: string,
): Promise<PeerIdentity> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
  const fp = await fingerprintFromPublicKey(raw);
  return {
    publicKey,
    privateKey,
    publicKeyRaw: raw,
    publicKeyB64: bytesToB64(raw),
    fingerprint: fp,
    createdAt,
  };
}

export async function fingerprintFromPublicKey(pubRaw: Uint8Array): Promise<string> {
  const h = await sha256(pubRaw);
  return bytesToBase32(h.slice(0, 8)).slice(0, FP_LEN);
}

export async function importPublicKey(pubRaw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    pubRaw as BufferSource,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify'],
  );
}

export async function importPublicKeyB64(b64: string): Promise<CryptoKey> {
  return importPublicKey(b64ToBytes(b64));
}

const SIG_PARAMS: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' };

export async function sign(id: PeerIdentity, data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  const sig = await crypto.subtle.sign(SIG_PARAMS, id.privateKey, bytes as BufferSource);
  return new Uint8Array(sig);
}

export async function verify(
  publicKey: CryptoKey,
  signature: Uint8Array,
  data: Uint8Array | string,
): Promise<boolean> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return crypto.subtle.verify(
    SIG_PARAMS,
    publicKey,
    signature as BufferSource,
    bytes as BufferSource,
  );
}

/**
 * Signed-payload envelope for transports that carry data without a live,
 * mutually-authenticated connection — the QR bulk stream and AirDrop file
 * bundles. Over WebRTC the handshake already proves who's talking; those
 * offline paths have no handshake, so the bytes have to carry their own proof.
 *
 * Domain-separated from the pairing signature so a payload can never be
 * replayed as a handshake, or the reverse.
 */
const PAYLOAD_SIG_PREFIX = 'tideline-payload:';

export interface SignedPayload {
  publicKey: string;   // base64 raw P-256
  fingerprint: string;
  sig: string;         // base64
}

async function payloadDigest(body: Uint8Array): Promise<Uint8Array> {
  const digest = await sha256(body);
  const prefix = enc.encode(PAYLOAD_SIG_PREFIX);
  const buf = new Uint8Array(prefix.byteLength + digest.byteLength);
  buf.set(prefix, 0);
  buf.set(digest, prefix.byteLength);
  return buf;
}

export async function signPayload(id: PeerIdentity, body: Uint8Array): Promise<SignedPayload> {
  const sig = await sign(id, await payloadDigest(body));
  return {
    publicKey: id.publicKeyB64,
    fingerprint: id.fingerprint,
    sig: bytesToB64(sig),
  };
}

/**
 * Check a payload signature and that the claimed fingerprint really derives
 * from the enclosed key.
 *
 * Verifying the fingerprint matters as much as the signature: without it,
 * anyone could sign a payload with their own key while claiming a trusted
 * peer's fingerprint, and the importer's trust lookup would wave it through.
 */
export async function verifyPayload(
  signed: SignedPayload,
  body: Uint8Array,
): Promise<boolean> {
  try {
    const pubRaw = b64ToBytes(signed.publicKey);
    if ((await fingerprintFromPublicKey(pubRaw)) !== signed.fingerprint) return false;
    const key = await importPublicKey(pubRaw);
    return await verify(key, b64ToBytes(signed.sig), await payloadDigest(body));
  } catch {
    return false;
  }
}

/** Forget the cached identity (used by tests). Does NOT wipe persistent storage. */
export function _resetIdentityCacheForTests(): void {
  cached = null;
}
