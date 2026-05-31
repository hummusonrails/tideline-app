import { db } from './db';
import { enqueue } from './sync';
import { uid } from './uuid';
import { textToBase64 } from './github';
import { pointEventPath } from './paths';
import { DEFAULT_CONFIG, countEventsOnDate } from './points';
import { todayYMD } from './time';
import { tripStartDate } from './trip';
import type { PointEvent, PointReason, MemberId } from '../types';

/**
 * Mint a point event: persist locally and enqueue the remote write.
 * Returns the created event, or null if blocked (daily cap, or the
 * competition hasn't started yet — points only accrue from the trip's
 * first day, though actions like check-ins are still recorded).
 */
export async function awardPoints(opts: {
  to: MemberId;
  by: MemberId;
  amount: number;
  reason: PointReason;
  refId?: string;
  note?: string;
  /** When set, enforce this per-day cap for (to, reason). */
  dailyCap?: number;
}): Promise<PointEvent | null> {
  const now = new Date();
  const date = todayYMD(now);

  // The competition starts on day one of the trip. Before then, nothing
  // accrues. (If trip-meta isn't synced yet we fail open and allow it.)
  const start = await tripStartDate();
  if (start && date < start) return null;

  if (opts.dailyCap !== undefined) {
    const all = await db.pointEvents.where('to').equals(opts.to).toArray();
    if (countEventsOnDate(all, opts.to, opts.reason, date) >= opts.dailyCap) {
      return null; // capped — silently skip
    }
  }

  const id = uid();
  const event: PointEvent = {
    id,
    to: opts.to,
    by: opts.by,
    at: now.toISOString(),
    amount: opts.amount,
    reason: opts.reason,
    refId: opts.refId,
    note: opts.note,
  };
  await db.pointEvents.put(event);
  await enqueue({
    id: `pe-${id}`,
    enqueuedAt: now.toISOString(),
    op: {
      kind: 'put-file',
      path: pointEventPath(event),
      contentBase64: textToBase64(JSON.stringify(event)),
      commitMessage: `points: ${opts.reason}`,
    },
  });
  return event;
}

export const EARN = DEFAULT_CONFIG.earn;
export const CAPS = DEFAULT_CONFIG.caps;
