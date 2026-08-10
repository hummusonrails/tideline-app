import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import {
  absorbData,
  absorbPhotoBinary,
  collectAllHaves,
  collectHave,
  fetchRecords,
} from './sync';
import type {
  ChallengeCompletion,
  HabitCheckIn,
  Message,
  Photo,
  PointEvent,
  Reaction,
} from '../../types';

beforeEach(async () => {
  await Promise.all([
    db.messages.clear(),
    db.photos.clear(),
    db.photoBlobs.clear(),
    db.pointEvents.clear(),
    db.completions.clear(),
    db.habits.clear(),
    db.reactions.clear(),
    db.outbox.clear(),
  ]);
});

const msg = (id: string, from = 'm-a', at = '2026-05-31T10:00:00.000Z'): Message => ({
  id, from, sentAt: at, body: 'hi', kind: 'message',
});

const photo = (id: string, from = 'm-a'): Photo => ({
  id, from,
  takenAt: '2026-05-31T10:00:00.000Z',
  uploadedAt: '2026-05-31T10:00:00.000Z',
  filePath: `photos/2026-05-31/10-00-00-${from}-${id}.jpg`,
  width: 100, height: 100, bytes: 1234, exifPresent: false,
});

const point = (id: string, by = 'm-a'): PointEvent => ({
  id, to: by, by, at: '2026-05-31T10:00:00.000Z', amount: 5, reason: 'photo',
});

const completion = (id: string, by = 'm-a'): ChallengeCompletion => ({
  id, challengeId: 'c-1', by, completedAt: '2026-05-31T10:00:00.000Z', awardedPoints: 10,
});

const reaction = (id: string, by = 'm-b'): Reaction => ({
  id, messageId: 'm1', by, emoji: '❤️', at: '2026-05-31T10:00:00.000Z',
});

const habit = (id: string, by = 'm-a'): HabitCheckIn => ({
  id, by, date: '2026-05-31', at: '2026-05-31T10:00:00.000Z',
});

describe('p2p sync bridge', () => {
  it('produces an empty HAVE when nothing is local', async () => {
    expect(await collectHave('messages')).toEqual([]);
    expect((await collectAllHaves()).messages).toEqual([]);
  });

  it('lists local ids in HAVE for each collection', async () => {
    await db.messages.put(msg('m1'));
    await db.messages.put(msg('m2'));
    await db.pointEvents.put(point('p1'));
    expect((await collectHave('messages')).sort()).toEqual(['m1', 'm2']);
    expect(await collectHave('pointEvents')).toEqual(['p1']);
  });

  it('fetchRecords returns full records by id', async () => {
    await db.messages.put(msg('m1'));
    await db.messages.put(msg('m2'));
    const out = await fetchRecords('messages', ['m2', 'missing']);
    expect(out).toHaveLength(1);
    expect((out[0] as Message).id).toBe('m2');
  });

  it('absorbs new messages and enqueues them in the outbox', async () => {
    const result = await absorbData('messages', [msg('m1'), msg('m2')]);
    expect(result.newIds.sort()).toEqual(['m1', 'm2']);
    expect(await db.messages.count()).toBe(2);
    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(2);
    for (const o of outbox) {
      expect(o.id.startsWith('p2p-messages-')).toBe(true);
      expect(o.op.kind).toBe('put-file');
      expect((o.op as { path: string }).path.startsWith('messages/2026-05-31/')).toBe(true);
    }
  });

  it('dedupes already-known records on absorb', async () => {
    await db.messages.put(msg('m1'));
    const result = await absorbData('messages', [msg('m1'), msg('m2')]);
    expect(result.newIds).toEqual(['m2']);
    expect(await db.outbox.count()).toBe(1);
  });

  it('flags photos that need a binary stream', async () => {
    const result = await absorbData('photos', [photo('p1'), photo('p2')]);
    expect(result.newIds.sort()).toEqual(['p1', 'p2']);
    expect(result.needPhotoBinary.sort()).toEqual(['p1', 'p2']);
  });

  it('does not re-flag a photo we already have the blob for', async () => {
    await db.photoBlobs.put({ photoId: 'p1', bytes: new Blob([new Uint8Array([1, 2, 3]).buffer], { type: 'image/jpeg' }) });
    const result = await absorbData('photos', [photo('p1')]);
    expect(result.newIds).toEqual(['p1']);
    expect(result.needPhotoBinary).toEqual([]);
  });

  it('absorbs photo binary and enqueues the upload only when metadata exists', async () => {
    const bytes = new Uint8Array([10, 20, 30]);
    await absorbPhotoBinary('p1', bytes, 'image/jpeg');
    expect(await db.photoBlobs.count()).toBe(1);
    // No metadata yet → no enqueued binary upload yet.
    expect(await db.outbox.count()).toBe(0);

    await absorbData('photos', [photo('p1')]);
    await db.outbox.clear();
    await absorbPhotoBinary('p1', bytes, 'image/jpeg');
    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect((outbox[0].op as { path: string }).path).toMatch(/\.jpg$/);
  });

  it('handles every collection end-to-end', async () => {
    await absorbData('messages', [msg('mx')]);
    await absorbData('pointEvents', [point('px')]);
    await absorbData('completions', [completion('cx')]);
    await absorbData('habits', [habit('hx')]);
    await absorbData('reactions', [reaction('rx')]);
    const have = await collectAllHaves();
    expect(have).toEqual({
      messages: ['mx'],
      photos: [],
      pointEvents: ['px'],
      completions: ['cx'],
      habits: ['hx'],
      reactions: ['rx'],
    });
    expect(await db.outbox.count()).toBe(5);
  });

  it('absorbs reactions and queues them at the canonical path', async () => {
    await db.outbox.clear();
    const result = await absorbData('reactions', [reaction('r1')]);
    expect(result.newIds).toEqual(['r1']);
    expect(await db.reactions.get('r1')).toMatchObject({ messageId: 'm1', emoji: '❤️' });
    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect((outbox[0].op as { path: string }).path).toMatch(
      /^reactions\/\d{4}-\d{2}-\d{2}\/.*r1\.json$/,
    );
  });

  it('ignores a reaction id it already has', async () => {
    await absorbData('reactions', [reaction('r2')]);
    await db.outbox.clear();
    const again = await absorbData('reactions', [reaction('r2')]);
    expect(again.newIds).toEqual([]);
    expect(await db.outbox.count()).toBe(0);
  });

  it('absorbs a retraction as its own record', async () => {
    await absorbData('reactions', [reaction('r3')]);
    await absorbData('reactions', [{ ...reaction('r4'), emoji: null }]);
    expect(await db.reactions.get('r4')).toMatchObject({ emoji: null });
    expect((await collectHave('reactions')).sort()).toEqual(['r3', 'r4']);
  });
});
