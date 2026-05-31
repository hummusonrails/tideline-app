/**
 * Bridge between the p2p data channel and our local store.
 *
 * Responsibilities:
 *
 *  1. Reading from Dexie — produce HAVE sets (lists of UUIDs we already
 *     have) and DATA payloads (full records by id).
 *  2. Writing into Dexie — persist DATA records the peer sent us.
 *  3. Forwarding to GitHub — every accepted P2P write also gets queued
 *     in the existing outbox, using the same canonical paths that the
 *     screens use. When internet returns, the existing sync loop drains
 *     the outbox; GitHub's "file already exists" path handles the case
 *     where two devices both upload the same UUID (rare but possible).
 *
 * Dedup is by record id (UUID). If we already have an id, we ignore
 * the incoming copy. This means two peers can independently receive
 * the same event from a third peer without duplicating anything.
 */

import type {
  ChallengeCompletion,
  HabitCheckIn,
  Message,
  Photo,
  PointEvent,
} from '../../types';
import { db } from '../db';
import { enqueue } from '../sync';
import { textToBase64, bytesToBase64 } from '../github';
import {
  completionPath,
  habitPath,
  messagePath,
  photoBinaryPath,
  photoSidecarPath,
  pointEventPath,
} from '../paths';
import type {
  Collection,
  CollectionRecord,
} from './protocol';

// --- HAVE production --------------------------------------------------

export async function collectHave(collection: Collection): Promise<string[]> {
  switch (collection) {
    case 'messages':    return (await db.messages.toArray()).map((r) => r.id);
    case 'photos':      return (await db.photos.toArray()).map((r) => r.id);
    case 'pointEvents': return (await db.pointEvents.toArray()).map((r) => r.id);
    case 'completions': return (await db.completions.toArray()).map((r) => r.id);
    case 'habits':      return (await db.habits.toArray()).map((r) => r.id);
  }
}

// --- WANT resolution → DATA payload -----------------------------------

export async function fetchRecords(
  collection: Collection,
  ids: string[],
): Promise<CollectionRecord[]> {
  if (ids.length === 0) return [];
  switch (collection) {
    case 'messages':    return (await db.messages.bulkGet(ids)).filter(nonNull);
    case 'photos':      return (await db.photos.bulkGet(ids)).filter(nonNull);
    case 'pointEvents': return (await db.pointEvents.bulkGet(ids)).filter(nonNull);
    case 'completions': return (await db.completions.bulkGet(ids)).filter(nonNull);
    case 'habits':      return (await db.habits.bulkGet(ids)).filter(nonNull);
  }
}

function nonNull<T>(x: T | undefined): x is T { return x != null; }

// --- DATA absorption --------------------------------------------------

export interface AbsorbResult {
  newIds: string[];
  /** Photo ids that arrived in metadata form but have no local blob yet —
   *  the caller should request the binary stream for these. */
  needPhotoBinary: string[];
}

export async function absorbData(
  collection: Collection,
  records: CollectionRecord[],
): Promise<AbsorbResult> {
  if (records.length === 0) return { newIds: [], needPhotoBinary: [] };
  const newIds: string[] = [];
  const needPhotoBinary: string[] = [];

  switch (collection) {
    case 'messages': {
      const typed = records as Message[];
      const existing = new Set((await db.messages.bulkGet(typed.map((r) => r.id))).filter(nonNull).map((r) => r.id));
      for (const r of typed) {
        if (existing.has(r.id)) continue;
        await db.messages.put(r);
        await enqueueP2pWrite('messages', r);
        newIds.push(r.id);
      }
      break;
    }
    case 'photos': {
      const typed = records as Photo[];
      const existingBlobs = new Set(
        (await db.photoBlobs.bulkGet(typed.map((r) => r.id))).filter(nonNull).map((r) => r.photoId),
      );
      const existingMeta = new Set(
        (await db.photos.bulkGet(typed.map((r) => r.id))).filter(nonNull).map((r) => r.id),
      );
      for (const r of typed) {
        if (!existingMeta.has(r.id)) {
          await db.photos.put(r);
          await enqueueP2pWrite('photos', r);
          newIds.push(r.id);
        }
        if (!existingBlobs.has(r.id)) {
          needPhotoBinary.push(r.id);
        }
      }
      break;
    }
    case 'pointEvents': {
      const typed = records as PointEvent[];
      const existing = new Set((await db.pointEvents.bulkGet(typed.map((r) => r.id))).filter(nonNull).map((r) => r.id));
      for (const r of typed) {
        if (existing.has(r.id)) continue;
        await db.pointEvents.put(r);
        await enqueueP2pWrite('pointEvents', r);
        newIds.push(r.id);
      }
      break;
    }
    case 'completions': {
      const typed = records as ChallengeCompletion[];
      const existing = new Set((await db.completions.bulkGet(typed.map((r) => r.id))).filter(nonNull).map((r) => r.id));
      for (const r of typed) {
        if (existing.has(r.id)) continue;
        await db.completions.put(r);
        await enqueueP2pWrite('completions', r);
        newIds.push(r.id);
      }
      break;
    }
    case 'habits': {
      const typed = records as HabitCheckIn[];
      const existing = new Set((await db.habits.bulkGet(typed.map((r) => r.id))).filter(nonNull).map((r) => r.id));
      for (const r of typed) {
        if (existing.has(r.id)) continue;
        await db.habits.put(r);
        await enqueueP2pWrite('habits', r);
        newIds.push(r.id);
      }
      break;
    }
  }
  return { newIds, needPhotoBinary };
}

async function enqueueP2pWrite(collection: Collection, record: CollectionRecord): Promise<void> {
  let path: string;
  let commit: string;
  switch (collection) {
    case 'messages':
      path = messagePath(record as Message);
      commit = 'p2p: message';
      break;
    case 'photos':
      path = photoSidecarPath(record as Photo);
      commit = 'p2p: photo metadata';
      break;
    case 'pointEvents':
      path = pointEventPath(record as PointEvent);
      commit = 'p2p: points';
      break;
    case 'completions':
      path = completionPath(record as ChallengeCompletion);
      commit = 'p2p: challenge complete';
      break;
    case 'habits':
      path = habitPath(record as HabitCheckIn);
      commit = 'p2p: habit';
      break;
  }
  // Use record.id as the outbox key so a forwarded write doesn't collide
  // with anything else, and prefix to keep it distinct from author-side
  // entries (they use `id`, `pe-${id}`, etc).
  await enqueue({
    id: `p2p-${collection}-${record.id}`,
    enqueuedAt: new Date().toISOString(),
    op: {
      kind: 'put-file',
      path,
      contentBase64: textToBase64(JSON.stringify(record)),
      commitMessage: commit,
    },
  });
}

// --- Photo binary absorption ------------------------------------------

export async function absorbPhotoBinary(
  photoId: string,
  bytes: Uint8Array,
  mime: string,
): Promise<void> {
  // Wrap into a single ArrayBuffer-backed Blob — same approach as the
  // protocol's PhotoReassembler, which keeps cross-environment behavior
  // identical. We may already have the metadata row, in which case we
  // just enqueue the binary upload; if not, the binary still gets cached
  // and the meta row will follow.
  const sliced = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([sliced], { type: mime });
  await db.photoBlobs.put({ photoId, bytes: blob });
  const meta = await db.photos.get(photoId);
  if (meta) {
    await enqueue({
      id: `p2p-photo-bin-${photoId}`,
      enqueuedAt: new Date().toISOString(),
      op: {
        kind: 'put-file',
        path: photoBinaryPath(meta),
        contentBase64: bytesToBase64(bytes),
        commitMessage: 'p2p: photo bytes',
      },
    });
  }
}

/** All collections plus their HAVE sets — convenience for the manager. */
export async function collectAllHaves(): Promise<Record<Collection, string[]>> {
  const [messages, photos, pointEvents, completions, habits] = await Promise.all([
    collectHave('messages'),
    collectHave('photos'),
    collectHave('pointEvents'),
    collectHave('completions'),
    collectHave('habits'),
  ]);
  return { messages, photos, pointEvents, completions, habits };
}
