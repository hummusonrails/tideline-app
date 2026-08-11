/**
 * Kudos — handing someone else one of your own points, with a note.
 *
 * It is a **transfer**, not a mint: the giver is debited and the recipient is
 * credited by the same amount, so you can never give away more than you have.
 * The first version credited the recipient without touching the giver, which
 * meant a member sitting on zero could still hand out points — "sending" that
 * costs nothing has no balance to exceed, and it read as a bug because it was
 * one. It also quietly inflated the crew total every time anyone was nice.
 *
 * A transfer keeps the family's combined score constant, which matters because
 * the crew goal is measured against it.
 *
 * It exists for a specific failure mode of a points competition: the kid who
 * is behind has no lever except grinding, and the kid who is ahead has no
 * reason to be generous. Making generosity cost something real is what gives
 * it weight.
 *
 * Both halves are written by the giver's own device — a debit against
 * themselves and a credit to someone else. That's the one sanctioned deviation
 * from "self-mint only", and it's safe because it's signed by the giver, capped
 * per giver per day, and can only ever move value away from the author.
 *
 * Note the daily cap counts by **giver**, not recipient — the opposite of every
 * other cap in the app. Capping the recipient would let one sibling silently
 * use up the other's ability to receive kindness.
 */

import type { MemberId, PointEvent } from '../types';
import { totalPoints } from './points';

export const KUDOS_POINTS = 1;
export const KUDOS_PER_DAY = 3;
export const MAX_NOTE_LENGTH = 140;

/**
 * Is this the credit half of a transfer?
 *
 * The debit shares the `gift` reason and the same author, so anything counting
 * "gifts given" has to exclude it or every transfer is counted twice.
 */
export function isKudosCredit(e: PointEvent): boolean {
  return e.reason === 'gift' && e.amount > 0 && e.to !== e.by;
}

/** How many kudos this member has given on a local date. */
export function kudosGivenOn(
  events: readonly PointEvent[],
  giver: MemberId,
  date: string,
): number {
  return events.filter(
    (e) => isKudosCredit(e) && e.by === giver && e.at.slice(0, 10) === date,
  ).length;
}

export function kudosRemaining(
  events: readonly PointEvent[],
  giver: MemberId,
  date: string,
): number {
  return Math.max(0, KUDOS_PER_DAY - kudosGivenOn(events, giver, date));
}

export interface KudosCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Is this gift allowed?
 *
 * The note is required. A bare point is a number; a point with "for sharing
 * your snacks on the bus" is the actual thing being given, and the whole
 * feature is worthless without it.
 */
export function canSendKudos(opts: {
  events: readonly PointEvent[];
  giver: MemberId;
  to: MemberId;
  note: string;
  date: string;
}): KudosCheck {
  if (opts.to === opts.giver) {
    return { ok: false, reason: "You can't send yourself a point." };
  }
  if (!opts.note.trim()) {
    return { ok: false, reason: 'Say what it’s for — that’s the good bit.' };
  }
  if (opts.note.trim().length > MAX_NOTE_LENGTH) {
    return { ok: false, reason: 'Keep it short and sweet.' };
  }
  // You can only give what you actually have. This is the check that was
  // missing: without it a member on zero could hand out points all day.
  if (totalPoints(opts.events as PointEvent[], opts.giver) < KUDOS_POINTS) {
    return { ok: false, reason: 'You need a point before you can give one away.' };
  }
  if (kudosRemaining(opts.events, opts.giver, opts.date) <= 0) {
    return { ok: false, reason: `That’s all ${KUDOS_PER_DAY} for today. More tomorrow.` };
  }
  return { ok: true };
}

/** Kudos received by a member, newest first — for the profile and the recap. */
export function kudosReceived(
  events: readonly PointEvent[],
  member: MemberId,
): PointEvent[] {
  return events
    .filter((e) => isKudosCredit(e) && e.to === member)
    .sort((a, b) => b.at.localeCompare(a.at));
}

// ---------- crew goal ----------

/**
 * The co-op counterweight to the leaderboard: one bar, everyone's points, one
 * shared reward at the end. Purely derived — nothing to write, nothing to
 * conflict, nothing to sync beyond the config itself.
 */
export function crewTotal(events: readonly PointEvent[]): number {
  return events.reduce((sum, e) => sum + e.amount, 0);
}

export function goalProgress(
  events: readonly PointEvent[],
  target: number,
): { total: number; pct: number; reached: boolean } {
  const total = crewTotal(events);
  if (target <= 0) return { total, pct: 100, reached: true };
  return {
    total,
    pct: Math.min(100, Math.round((total / target) * 100)),
    reached: total >= target,
  };
}
