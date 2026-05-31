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

/** Forget the cached identity (used by tests). Does NOT wipe persistent storage. */
export function _resetIdentityCacheForTests(): void {
  cached = null;
}
