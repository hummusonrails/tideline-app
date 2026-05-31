/**
 * "Plan B" data transport: when WebRTC won't connect at all (true
 * zero-network: airline mode, no in-flight wifi, no nothing), two
 * devices can still trade event records by passing chunked QR code
 * frames in front of each other's cameras.
 *
 * Format on the wire (per call):
 *
 *   {
 *     v: 1,
 *     from: { memberId, fingerprint },
 *     records: {
 *       messages?:    Message[],
 *       photos?:      Photo[],
 *       pointEvents?: PointEvent[],
 *       completions?: ChallengeCompletion[],
 *       habits?:      HabitCheckIn[],
 *     }
 *   }
 *
 * The whole envelope is encoded with {@link encodeFrames} from qr.ts.
 * Photos in this mode carry metadata only — actual JPEG bytes are too
 * large for hand-scanned QR transport. Photos sync over the wire when
 * internet (or WebRTC) returns later.
 */

import type {
  ChallengeCompletion,
  HabitCheckIn,
  Message,
  Photo,
  PointEvent,
} from '../../types';
import { db } from '../db';
import { absorbData } from './sync';
import { encodeFrames } from './qr';
import { enc } from './base';
import type { Collection, CollectionRecord } from './protocol';

export interface BulkEnvelope {
  v: 1;
  from: { memberId: string; fingerprint: string };
  records: Partial<Record<Collection, CollectionRecord[]>>;
}

/**
 * Pull recent local records (last N days) and pack them into QR frames.
 * Photos are included as metadata only — see file-level doc.
 */
export async function exportBulkFrames(opts: {
  memberId: string;
  fingerprint: string;
  /** Inclusive lower bound (ISO date YYYY-MM-DD). Records older than this are skipped. */
  sinceDate?: string;
  /** Limit per collection — protects from a runaway QR stream. */
  perCollectionLimit?: number;
}): Promise<{ frames: string[]; counts: Record<Collection, number> }> {
  const since = opts.sinceDate;
  const cap = opts.perCollectionLimit ?? 200;

  const messages: Message[] = (await db.messages.toArray())
    .filter((m) => !since || m.sentAt >= since)
    .slice(-cap);
  const photos: Photo[] = (await db.photos.toArray())
    .filter((p) => !since || p.uploadedAt >= since)
    .slice(-cap);
  const pointEvents: PointEvent[] = (await db.pointEvents.toArray())
    .filter((e) => !since || e.at >= since)
    .slice(-cap);
  const completions: ChallengeCompletion[] = (await db.completions.toArray())
    .filter((c) => !since || c.completedAt >= since)
    .slice(-cap);
  const habits: HabitCheckIn[] = (await db.habits.toArray())
    .filter((h) => !since || h.at >= since)
    .slice(-cap);

  const envelope: BulkEnvelope = {
    v: 1,
    from: { memberId: opts.memberId, fingerprint: opts.fingerprint },
    records: { messages, photos, pointEvents, completions, habits },
  };
  const bytes = enc.encode(JSON.stringify(envelope));
  const frames = encodeFrames(bytes);
  return {
    frames,
    counts: {
      messages: messages.length,
      photos: photos.length,
      pointEvents: pointEvents.length,
      completions: completions.length,
      habits: habits.length,
    },
  };
}

/** Decode + absorb a bulk envelope. Returns counts per collection. */
export async function importBulkEnvelope(bytes: Uint8Array): Promise<{
  from: BulkEnvelope['from'];
  absorbed: Record<Collection, number>;
}> {
  let envelope: BulkEnvelope;
  try {
    envelope = JSON.parse(new TextDecoder().decode(bytes)) as BulkEnvelope;
  } catch {
    throw new Error('bulk envelope is not valid JSON');
  }
  if (!envelope || envelope.v !== 1 || !envelope.records || !envelope.from) {
    throw new Error('bulk envelope shape is wrong');
  }
  const absorbed: Record<Collection, number> = {
    messages: 0, photos: 0, pointEvents: 0, completions: 0, habits: 0,
  };
  for (const collection of ['messages', 'photos', 'pointEvents', 'completions', 'habits'] as Collection[]) {
    const records = envelope.records[collection] ?? [];
    if (records.length === 0) continue;
    const result = await absorbData(collection, records);
    absorbed[collection] = result.newIds.length;
  }
  return { from: envelope.from, absorbed };
}
