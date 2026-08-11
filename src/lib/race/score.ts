/**
 * Points and records for the kart duel — the anti-farming layer.
 *
 * Results ride {@link ChallengeCompletion} under a `race-` synthetic id,
 * exactly like hunts and moments: no new sync collection, no new gossip
 * type, and an older build relays race results without understanding them.
 * The completion IS the race record — winner and participant each write one
 * from their own device (self-mint only, like everything else), and the
 * recap reads them back later.
 *
 * Id scheme: `race-<raceId>-win` / `race-<raceId>-run`, where raceId is the
 * shared id the host minted for the race and both devices learned in the
 * config handshake. Both devices therefore derive the same ids for the same
 * race, and completeSynthetic's (challengeId, by) guard makes every write
 * idempotent — a double-tap, a re-render, or the same result arriving back
 * over gossip can never double-award.
 *
 * Anti-farming, because two kids WILL discover that rematch is a button:
 *
 *  - Only the winner earns points, and only for the first
 *    {@link RACE_WINS_PER_DAY} wins each local day. Later wins still write a
 *    completion (with 0 points) so the recap knows the race happened.
 *  - After {@link RACE_RECORDS_PER_DAY} recorded races in a day we stop
 *    writing records entirely. Every completion is also a file commit to the
 *    family repo; race #47 of the evening is not history worth syncing.
 *  - The caps are per-member per-day and computed from the completions
 *    themselves, so they can't be reset by reinstalling or juggling devices
 *    — the records that enforce the cap are the same records that sync.
 *
 * Pure functions only; the screen calls completeSynthetic with what these
 * return.
 */

import type { ChallengeCompletion, MemberId } from '../../types';
import { localDay } from '../recap';

export const RACE_PREFIX = 'race-';
export const RACE_WIN_POINTS = 15;
export const RACE_WINS_PER_DAY = 3;
export const RACE_RECORDS_PER_DAY = 10;

export function raceWinId(raceId: string): string {
  return `${RACE_PREFIX}${raceId}-win`;
}

export function raceRunId(raceId: string): string {
  return `${RACE_PREFIX}${raceId}-run`;
}

/** Parse a race completion id. Null for anything that isn't one of ours. */
export function parseRaceId(
  challengeId: string,
): { raceId: string; won: boolean } | null {
  if (!challengeId.startsWith(RACE_PREFIX)) return null;
  const rest = challengeId.slice(RACE_PREFIX.length);
  if (rest.endsWith('-win')) return { raceId: rest.slice(0, -4), won: true };
  if (rest.endsWith('-run')) return { raceId: rest.slice(0, -4), won: false };
  return null;
}

/** All race completions by `member` on local day `today`. */
function raceCompletionsOn(
  completions: readonly ChallengeCompletion[],
  member: MemberId,
  today: string,
): ChallengeCompletion[] {
  return completions.filter(
    (c) =>
      c.by === member &&
      parseRaceId(c.challengeId) !== null &&
      localDay(c.completedAt) === today,
  );
}

/** Point-earning wins so far today (0-point over-cap wins don't count). */
export function paidWinsToday(
  completions: readonly ChallengeCompletion[],
  member: MemberId,
  today: string,
): number {
  return raceCompletionsOn(completions, member, today).filter(
    (c) => parseRaceId(c.challengeId)!.won && c.awardedPoints > 0,
  ).length;
}

/** Should this race be written down at all? (See RACE_RECORDS_PER_DAY.) */
export function shouldRecordRace(
  completions: readonly ChallengeCompletion[],
  member: MemberId,
  today: string,
): boolean {
  return raceCompletionsOn(completions, member, today).length < RACE_RECORDS_PER_DAY;
}

/**
 * Points the winner's own device should mint for this win. Zero once the
 * daily cap is reached — the completion still gets written, the scoreboard
 * just stops moving.
 */
export function winPointsToday(
  completions: readonly ChallengeCompletion[],
  member: MemberId,
  today: string,
): number {
  return paidWinsToday(completions, member, today) < RACE_WINS_PER_DAY
    ? RACE_WIN_POINTS
    : 0;
}

/** Distinct races a set of completions describes for one local day. */
export function racesOnDay(
  completions: readonly ChallengeCompletion[],
  day: string,
): { raceId: string; winner: MemberId | null }[] {
  const byRace = new Map<string, MemberId | null>();
  for (const c of completions) {
    const parsed = parseRaceId(c.challengeId);
    if (!parsed || localDay(c.completedAt) !== day) continue;
    const prev = byRace.get(parsed.raceId);
    // Prefer the -win record's author as the winner; keep null otherwise.
    byRace.set(parsed.raceId, parsed.won ? c.by : (prev ?? null));
  }
  return [...byRace.entries()].map(([raceId, winner]) => ({ raceId, winner }));
}
