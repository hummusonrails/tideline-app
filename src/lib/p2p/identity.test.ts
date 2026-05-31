import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetIdentityCacheForTests,
  fingerprintFromPublicKey,
  getOrCreateIdentity,
  importPublicKey,
  importPublicKeyB64,
  sign,
  verify,
} from './identity';
import { b64ToBytes } from './base';
import { db } from '../db';

beforeEach(async () => {
  _resetIdentityCacheForTests();
  await db.meta.clear();
});

describe('identity', () => {
  it('generates a stable identity that persists across reloads', async () => {
    const a = await getOrCreateIdentity();
    _resetIdentityCacheForTests();
    const b = await getOrCreateIdentity();
    expect(b.publicKeyB64).toEqual(a.publicKeyB64);
    expect(b.fingerprint).toEqual(a.fingerprint);
    expect(b.createdAt).toEqual(a.createdAt);
  });

  it('produces a 10-char Crockford-base32 fingerprint', async () => {
    const id = await getOrCreateIdentity();
    expect(id.fingerprint).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
  });

  it('round-trips sign / verify with the live key', async () => {
    const id = await getOrCreateIdentity();
    const msg = new TextEncoder().encode('hello plane');
    const sig = await sign(id, msg);
    expect(await verify(id.publicKey, sig, msg)).toBe(true);
  });

  it('rejects a tampered payload', async () => {
    const id = await getOrCreateIdentity();
    const sig = await sign(id, 'original');
    expect(await verify(id.publicKey, sig, 'tampered')).toBe(false);
  });

  it('imports a public key from raw bytes and verifies a signature made by the owner', async () => {
    const id = await getOrCreateIdentity();
    const sig = await sign(id, 'cross-device');
    const imported = await importPublicKey(id.publicKeyRaw);
    expect(await verify(imported, sig, 'cross-device')).toBe(true);
  });

  it('imports a public key from base64', async () => {
    const id = await getOrCreateIdentity();
    const sig = await sign(id, 'b64-import');
    const imported = await importPublicKeyB64(id.publicKeyB64);
    expect(await verify(imported, sig, 'b64-import')).toBe(true);
  });

  it('fingerprint is a deterministic function of the public key', async () => {
    const id = await getOrCreateIdentity();
    const again = await fingerprintFromPublicKey(b64ToBytes(id.publicKeyB64));
    expect(again).toEqual(id.fingerprint);
  });
});
