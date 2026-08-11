/**
 * Kudos — handing someone else a point, with a note.
 *
 * This is the one deliberate exception to "a device only ever mints points for
 * its own member". It's safe because of how small and how signed it is: one
 * point, authored by the giver's device, capped at a few per giver per day.
 * There is nothing to gain by gaming it and nothing to lose if someone does.
 *
 * It exists for a specific failure mode of a points competition: the kid who
 * is behind has no lever except grinding, and the kid who is ahead has no
 * reason to be generous. A gift-only currency gives both of them something
 * better to do.
 *
 * Note the cap is counted by **giver**, not recipient — the opposite of every
 * other cap in the app. Capping the recipient would let one sibling silently
 * use up the other's ability to receive kindness.
 */

import type { MemberId, PointEvent } from '../types';

export const KUDOS_POINTS = 1;
export const KUDOS_PER_DAY = 3;
export const MAX_NOTE_LENGTH = 140;

/** How many kudos this member has given on a local date. */
export function kudosGivenOn(
  events: readonly PointEvent[],
  giver: MemberId,
  date: string,
): number {
  return events.filter(
    (e) => e.reason === 'gift' && e.by === giver && e.at.slice(0, 10) === date,
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
    .filter((e) => e.reason === 'gift' && e.to === member)
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
