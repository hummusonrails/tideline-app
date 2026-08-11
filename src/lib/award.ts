import { db } from './db';
import { enqueue } from './sync';
import { uid } from './uuid';
import { textToBase64 } from './github';
import { completionPath, pointEventPath } from './paths';
import { DEFAULT_CONFIG, countEventsOnDate } from './points';
import { todayYMD } from './time';
import { tripStartDate } from './trip';
import type { ChallengeCompletion, PointEvent, PointReason, MemberId } from '../types';

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

/**
 * Move one point from the giver to someone else, with a note.
 *
 * Two events, both authored by the giver's device: a debit against themselves
 * and a credit to the recipient. Writing both is what makes this a transfer
 * rather than a mint — the family's combined score doesn't move, and nobody
 * can give away more than they hold.
 *
 * The caller is responsible for the balance and daily-cap checks
 * (`canSendKudos`); this is the write.
 */
export async function giftPoint(opts: {
  to: MemberId;
  by: MemberId;
  amount: number;
  note: string;
}): Promise<boolean> {
  if (opts.to === opts.by || opts.amount <= 0) return false;

  // Debit first. If the app dies between the two writes, the giver is briefly
  // down a point they didn't give — which is recoverable and honest. The other
  // order would mint a point out of nothing, which is the bug being fixed.
  const debit = await awardPoints({
    to: opts.by,
    by: opts.by,
    amount: -opts.amount,
    reason: 'gift',
    refId: opts.to,
    note: opts.note,
  });
  if (!debit) return false;

  const credit = await awardPoints({
    to: opts.to,
    by: opts.by,
    amount: opts.amount,
    reason: 'gift',
    refId: debit.id,
    note: opts.note,
  });
  return credit !== null;
}

/**
 * Record a completion whose challenge id is *derived*, not authored.
 *
 * Hunt-for rows already did this by hand; hunt stages, easter eggs, live
 * moments and prediction payouts all need the same thing, so it lives here
 * once. The shape is the trick that keeps this whole feature set free of new
 * sync surface: a synthesised id rides the existing completions collection,
 * which already syncs over Git, gossips over P2P, and dedups by record id.
 *
 * Two properties matter and are both load-bearing:
 *
 * - **Deterministic id.** Every device derives the same `challengeId` from the
 *   same content, so the write-time guard below sees a peer's completion as
 *   the same act rather than a second one.
 * - **Self-mint only.** Points go to `by`, never to someone else. A device
 *   that minted on a peer's behalf would double-award the moment both devices
 *   observed the same trigger.
 *
 * Returns the completion, or null if this member already had one.
 */
export async function completeSynthetic(opts: {
  challengeId: string;
  by: MemberId;
  points: number;
  commitMessage: string;
  proofPhotoId?: string;
  /** Free-form small ints kept alongside the completion (e.g. hint usage). */
  marks?: number[];
  reason?: PointReason;
}): Promise<ChallengeCompletion | null> {
  // Guard at the write, not just in the UI: a double tap can outrun the live
  // query that disabled the button, and each pass would mint its own award.
  const already = await db.completions
    .where('challengeId').equals(opts.challengeId)
    .filter((c) => c.by === opts.by)
    .count();
  if (already > 0) return null;

  const now = new Date();
  const completion: ChallengeCompletion = {
    id: uid(),
    challengeId: opts.challengeId,
    by: opts.by,
    completedAt: now.toISOString(),
    proofPhotoId: opts.proofPhotoId,
    triviaAnswers: opts.marks,
    awardedPoints: opts.points,
  };
  await db.completions.put(completion);
  await enqueue({
    id: `comp-${completion.id}`,
    enqueuedAt: now.toISOString(),
    op: {
      kind: 'put-file',
      path: completionPath(completion),
      contentBase64: textToBase64(JSON.stringify(completion)),
      commitMessage: opts.commitMessage.slice(0, 60),
    },
  });
  if (opts.points > 0) {
    await awardPoints({
      to: opts.by,
      by: opts.by,
      amount: opts.points,
      reason: opts.reason ?? 'challenge',
      refId: opts.challengeId,
    });
  }
  return completion;
}

export const EARN = DEFAULT_CONFIG.earn;
export const CAPS = DEFAULT_CONFIG.caps;
