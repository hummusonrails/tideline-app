import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { exportBulkFrames, importBulkEnvelope } from './bulkQr';
import { FrameReassembler } from './qr';
import type { Message, PointEvent } from '../../types';

beforeEach(async () => {
  await Promise.all([
    db.messages.clear(),
    db.pointEvents.clear(),
    db.outbox.clear(),
    db.photos.clear(),
    db.completions.clear(),
    db.habits.clear(),
  ]);
});

describe('bulk QR transport', () => {
  it('exports and re-imports a payload round-trip', async () => {
    const msg: Message = { id: 'm-x', from: 'me', sentAt: '2026-05-31T10:00:00Z', body: 'hi', kind: 'message' };
    const pt: PointEvent = { id: 'p-x', to: 'me', by: 'me', at: '2026-05-31T10:00:00Z', amount: 5, reason: 'photo' };
    await db.messages.put(msg);
    await db.pointEvents.put(pt);

    const { frames, counts } = await exportBulkFrames({ memberId: 'me', fingerprint: 'FFFFFFFFFF' });
    expect(counts.messages).toBe(1);
    expect(counts.pointEvents).toBe(1);

    // Re-assemble like a scanner would.
    const r = new FrameReassembler();
    for (const f of frames) r.ingest(f);
    const bytes = r.complete();
    expect(bytes).not.toBeNull();

    // Wipe local state to simulate the receiving device.
    await Promise.all([db.messages.clear(), db.pointEvents.clear(), db.outbox.clear()]);

    const result = await importBulkEnvelope(bytes!);
    expect(result.from).toEqual({ memberId: 'me', fingerprint: 'FFFFFFFFFF' });
    expect(result.absorbed.messages).toBe(1);
    expect(result.absorbed.pointEvents).toBe(1);
    expect(await db.messages.get('m-x')).toMatchObject({ body: 'hi' });
    expect(await db.pointEvents.get('p-x')).toMatchObject({ amount: 5 });
    // Sync bridge should have queued the corresponding put-file ops.
    expect(await db.outbox.count()).toBe(2);
  });

  it('skips records older than sinceDate', async () => {
    await db.messages.bulkPut([
      { id: 'old', from: 'me', sentAt: '2025-12-31T00:00:00Z', body: 'old', kind: 'message' },
      { id: 'new', from: 'me', sentAt: '2026-05-31T10:00:00Z', body: 'new', kind: 'message' },
    ]);
    const { counts } = await exportBulkFrames({ memberId: 'me', fingerprint: 'FFFFFFFFFF', sinceDate: '2026-01-01' });
    expect(counts.messages).toBe(1);
  });

  it('rejects a malformed envelope', async () => {
    const garbage = new TextEncoder().encode('{}');
    await expect(importBulkEnvelope(garbage)).rejects.toThrow(/bulk envelope/);
  });
});
