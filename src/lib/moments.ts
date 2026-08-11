/**
 * Live moments — the times the whole family is meant to be in the same place
 * at the same time, phone in hand for ten seconds and then away again.
 *
 * The countdown is pure clock arithmetic over data already on the device. That
 * is the entire design constraint: the best moment of this trip happens in a
 * bay with no cellular coverage at all, so anything that needed a server, a
 * push, or a fresh sync to work would simply not happen.
 *
 * Check-ins are {@link ChallengeCompletion} records under a `moment-<id>`
 * synthetic id, which means they gossip device-to-device — four people
 * standing on the same deck are exactly the situation the P2P layer was built
 * for, and it's how the all-crew bonus can land with the ship offline.
 */

import type { ChallengeCompletion, MemberId, Moment, Profile } from '../types';

export const MOMENT_PREFIX = 'moment-';

export function momentJoinId(momentId: string): string {
  return `${MOMENT_PREFIX}${momentId}`;
}

export function momentAllId(momentId: string): string {
  return `${MOMENT_PREFIX}${momentId}-all`;
}

export type MomentPhase =
  /** Far enough out that showing it would be noise. */
  | { phase: 'idle' }
  /** Counting down; `msRemaining` drives the clock. */
  | { phase: 'soon'; msRemaining: number }
  /** Happening now — the check-in button is live. */
  | { phase: 'live'; msRemaining: number }
  | { phase: 'over' };

/** How early the countdown card appears. Twelve hours: same-day, not nagging. */
export const LEAD_MS = 12 * 60 * 60 * 1000;

export function momentPhase(moment: Moment, now: Date = new Date()): MomentPhase {
  const start = Date.parse(moment.startISO);
  const end = Date.parse(moment.endISO);
  const t = now.getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return { phase: 'idle' };
  if (t >= end) return { phase: 'over' };
  if (t >= start) return { phase: 'live', msRemaining: end - t };
  if (start - t <= LEAD_MS) return { phase: 'soon', msRemaining: start - t };
  return { phase: 'idle' };
}

/** The one moment worth showing on Today: live first, else the nearest ahead. */
export function activeMoment(
  moments: readonly Moment[],
  now: Date = new Date(),
): { moment: Moment; state: MomentPhase } | null {
  const candidates = moments
    .map((moment) => ({ moment, state: momentPhase(moment, now) }))
    .filter(({ state }) => state.phase === 'live' || state.phase === 'soon');
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const rank = (s: MomentPhase) => (s.phase === 'live' ? 0 : 1);
    const d = rank(a.state) - rank(b.state);
    if (d !== 0) return d;
    return Date.parse(a.moment.startISO) - Date.parse(b.moment.startISO);
  });
  return candidates[0];
}

export function hasJoined(
  completions: readonly ChallengeCompletion[],
  member: MemberId,
  momentId: string,
): boolean {
  const id = momentJoinId(momentId);
  return completions.some((c) => c.by === member && c.challengeId === id);
}

/** Everyone this device can see having checked in. */
export function joinedMembers(
  completions: readonly ChallengeCompletion[],
  momentId: string,
): MemberId[] {
  const id = momentJoinId(momentId);
  return [...new Set(completions.filter((c) => c.challengeId === id).map((c) => c.by))];
}

export function hasAllCrewBonus(
  completions: readonly ChallengeCompletion[],
  member: MemberId,
  momentId: string,
): boolean {
  const id = momentAllId(momentId);
  return completions.some((c) => c.by === member && c.challengeId === id);
}

/**
 * Should this device mint the all-crew bonus for its own member?
 *
 * Three conditions, and each one is doing work:
 *
 * - **Everybody is in.** Every profile the device knows about has a check-in.
 * - **I'm one of them.** No minting on behalf of someone whose device hasn't
 *   observed the same thing.
 * - **Not already paid.** The write itself dedups too, but checking here keeps
 *   the effect that calls this from firing celebration confetti on a loop.
 *
 * Deliberately *not* gated on the moment still being live: gossip can deliver
 * the fourth check-in minutes after everyone has put their phones away, and
 * the bonus should still land.
 */
export function shouldMintAllCrew(opts: {
  moment: Moment;
  profiles: readonly Profile[];
  completions: readonly ChallengeCompletion[];
  member: MemberId;
}): boolean {
  const { moment, profiles, completions, member } = opts;
  if (moment.allBonus <= 0) return false;
  if (profiles.length === 0) return false;
  if (hasAllCrewBonus(completions, member, moment.id)) return false;
  const joined = new Set(joinedMembers(completions, moment.id));
  if (!joined.has(member)) return false;
  return profiles.every((p) => joined.has(p.id));
}

/** "0:42:10" — hours only when there are some. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
