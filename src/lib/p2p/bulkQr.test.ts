import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import {
  absorbBulkEnvelope,
  decodeBulkEnvelope,
  exportBulkFrames,
  importBulkEnvelope,
} from './bulkQr';
import { FrameReassembler } from './qr';
import { _resetIdentityCacheForTests, getOrCreateIdentity } from './identity';
import type { PeerIdentity } from './identity';
import type { Message, PointEvent, Reaction } from '../../types';

let identity: PeerIdentity;

async function clearRecords(): Promise<void> {
  await Promise.all([
    db.messages.clear(),
    db.pointEvents.clear(),
    db.outbox.clear(),
    db.photos.clear(),
    db.completions.clear(),
    db.habits.clear(),
    db.reactions.clear(),
  ]);
}

beforeEach(async () => {
  await clearRecords();
  _resetIdentityCacheForTests();
  await db.meta.clear();
  identity = await getOrCreateIdentity();
  await clearRecords();
});

/** Re-assemble frames the way a scanner would. */
function scan(frames: string[]): Uint8Array {
  const r = new FrameReassembler();
  for (const f of frames) r.ingest(f);
  const bytes = r.complete();
  if (!bytes) throw new Error('frames did not reassemble');
  return bytes;
}

const msg = (id: string, body = 'hi', at = '2026-05-31T10:00:00Z'): Message => ({
  id, from: 'me', sentAt: at, body, kind: 'message',
});

describe('bulk QR transport', () => {
  it('exports and re-imports a payload round-trip', async () => {
    const pt: PointEvent = { id: 'p-x', to: 'me', by: 'me', at: '2026-05-31T10:00:00Z', amount: 5, reason: 'photo' };
    await db.messages.put(msg('m-x'));
    await db.pointEvents.put(pt);

    const { frames, counts } = await exportBulkFrames({ identity, memberId: 'me' });
    expect(counts.messages).toBe(1);
    expect(counts.pointEvents).toBe(1);

    const bytes = scan(frames);
    await clearRecords();

    const result = await importBulkEnvelope(bytes);
    expect(result.from).toEqual({ memberId: 'me', fingerprint: identity.fingerprint });
    expect(result.absorbed.messages).toBe(1);
    expect(result.absorbed.pointEvents).toBe(1);
    expect(await db.messages.get('m-x')).toMatchObject({ body: 'hi' });
    expect(await db.pointEvents.get('p-x')).toMatchObject({ amount: 5 });
    // Sync bridge should have queued the corresponding put-file ops.
    expect(await db.outbox.count()).toBe(2);
  });

  it('carries reaction events', async () => {
    await db.reactions.put({
      id: 'r-x', messageId: 'm-x', by: 'me', emoji: '🔥', at: '2026-05-31T10:00:00Z',
    } satisfies Reaction);
    const { frames } = await exportBulkFrames({ identity, memberId: 'me' });
    const bytes = scan(frames);
    await clearRecords();

    const result = await importBulkEnvelope(bytes);
    expect(result.absorbed.reactions).toBe(1);
    expect(await db.reactions.get('r-x')).toMatchObject({ emoji: '🔥' });
  });

  it('skips records older than sinceDate', async () => {
    await db.messages.bulkPut([msg('old', 'old', '2025-12-31T00:00:00Z'), msg('new', 'new')]);
    const { counts } = await exportBulkFrames({ identity, memberId: 'me', sinceDate: '2026-01-01' });
    expect(counts.messages).toBe(1);
  });

  it('caps how many records go into one stream', async () => {
    await db.messages.bulkPut(
      Array.from({ length: 20 }, (_, i) => msg(`m${i}`, 'x', `2026-05-31T10:00:${String(i).padStart(2, '0')}Z`)),
    );
    const { counts } = await exportBulkFrames({ identity, memberId: 'me', perCollectionLimit: 5 });
    expect(counts.messages).toBe(5);
  });

  it('dedupes when the same code is scanned twice', async () => {
    await db.messages.put(msg('m-x'));
    const bytes = scan((await exportBulkFrames({ identity, memberId: 'me' })).frames);
    await clearRecords();

    await importBulkEnvelope(bytes);
    const again = await importBulkEnvelope(bytes);
    expect(again.absorbed.messages).toBe(0);
    expect(await db.messages.count()).toBe(1);
  });
});

describe('compression', () => {
  it('compresses when the platform supports it', async () => {
    await db.messages.put(msg('m-x'));
    const { compressed, frames } = await exportBulkFrames({ identity, memberId: 'me' });
    expect(compressed).toBe(typeof CompressionStream === 'function');
    // Whichever path was taken, the result must still decode.
    await expect(decodeBulkEnvelope(scan(frames))).resolves.toMatchObject({ authentic: true });
  });

  it('needs far fewer frames than uncompressed for repetitive data', async () => {
    // Many similar records is the realistic case — and what deflate eats.
    await db.messages.bulkPut(
      Array.from({ length: 40 }, (_, i) =>
        msg(`m${i}`, 'we saw a whale today', `2026-05-31T10:00:${String(i % 60).padStart(2, '0')}Z`),
      ),
    );
    const { frames, compressed } = await exportBulkFrames({ identity, memberId: 'me' });
    if (!compressed) return; // platform without CompressionStream; nothing to assert
    const rawSize = JSON.stringify(await db.messages.toArray()).length;
    // 600-byte chunks: the uncompressed body alone would need this many.
    const framesIfRaw = Math.ceil(rawSize / 600);
    expect(frames.length).toBeLessThan(framesIfRaw);
  });

  it('rejects a payload with an unknown magic prefix', async () => {
    const bogus = new TextEncoder().encode('XXXX{}');
    await expect(decodeBulkEnvelope(bogus)).rejects.toThrow(/not a Tideline sync code/);
  });

  it('rejects something far too short to be a payload', async () => {
    await expect(decodeBulkEnvelope(new Uint8Array([1, 2]))).rejects.toThrow(/too short/);
  });
});

describe('authenticity', () => {
  it('rejects an envelope whose records were altered', async () => {
    await db.messages.put(msg('m-x', 'original'));
    const { frames } = await exportBulkFrames({ identity, memberId: 'me' });
    const { envelope } = await decodeBulkEnvelope(scan(frames));

    // Tamper post-decode, then re-check the signature the way decode does.
    (envelope.records.messages![0] as Message).body = 'tampered';
    const { verifyPayload } = await import('./identity');
    const body = new TextEncoder().encode(
      JSON.stringify({ from: envelope.from, records: envelope.records }),
    );
    expect(await verifyPayload(envelope.signed, body)).toBe(false);
  });

  it('rejects a fingerprint that disagrees with the signing key', async () => {
    await db.messages.put(msg('m-x'));
    const { frames } = await exportBulkFrames({ identity, memberId: 'me' });
    const { envelope } = await decodeBulkEnvelope(scan(frames));
    envelope.from.fingerprint = 'ZZZZZZZZZZ';

    const { verifyPayload } = await import('./identity');
    const body = new TextEncoder().encode(
      JSON.stringify({ from: envelope.from, records: envelope.records }),
    );
    expect(await verifyPayload(envelope.signed, body)).toBe(false);
  });

  it('refuses to absorb an unsigned envelope', async () => {
    const unsigned = new TextEncoder().encode(
      'TLJ1' + JSON.stringify({ v: 1, from: { memberId: 'x', fingerprint: 'y' }, records: {} }),
    );
    await expect(importBulkEnvelope(unsigned)).rejects.toThrow(/shape is wrong/);
  });

  it('rejects a malformed envelope', async () => {
    const garbage = new TextEncoder().encode('TLJ1{}');
    await expect(importBulkEnvelope(garbage)).rejects.toThrow(/shape is wrong/);
  });

  it('lets a caller absorb after inspecting the sender', async () => {
    await db.messages.put(msg('m-x'));
    const { frames } = await exportBulkFrames({ identity, memberId: 'me' });
    const bytes = scan(frames);
    await clearRecords();

    const { envelope, authentic } = await decodeBulkEnvelope(bytes);
    expect(authentic).toBe(true);
    expect(envelope.from.fingerprint).toBe(identity.fingerprint);

    const result = await absorbBulkEnvelope(envelope);
    expect(result.absorbed.messages).toBe(1);
  });
});
