import type {
  MemberId,
  PointEvent,
  PointsConfig,
  Tier,
  ChallengeCompletion,
  HabitCheckIn,
} from '../types';

export const DEFAULT_CONFIG: PointsConfig = {
  tiers: [
    { tier: 'bronze',   threshold: 100,  rewardLabel: 'A little treat' },
    { tier: 'silver',   threshold: 300,  rewardLabel: 'Something fun' },
    { tier: 'gold',     threshold: 600,  rewardLabel: 'Something special' },
    { tier: 'platinum', threshold: 1000, rewardLabel: 'The grand surprise' },
  ],
  earn: { photo: 5, journal: 10, reaction: 1, streakBonus: 20 },
  caps: { photoPerDay: 10, journalPerDay: 3, reactionPerDay: 20, parentBonusMax: 100 },
};

export function totalPoints(events: PointEvent[], member: MemberId): number {
  return events
    .filter((e) => e.to === member)
    .reduce((sum, e) => sum + e.amount, 0);
}

export function currentTier(points: number, cfg: PointsConfig): Tier {
  let t: Tier = 'none';
  for (const { tier, threshold } of cfg.tiers) {
    if (points >= threshold) t = tier;
  }
  return t;
}

export function nextTier(points: number, cfg: PointsConfig): { tier: Tier; remaining: number } | null {
  for (const { tier, threshold } of cfg.tiers) {
    if (points < threshold) return { tier, remaining: threshold - points };
  }
  return null;
}

/**
 * Streak in consecutive days ending today (inclusive) for the given member.
 * Resets on miss. Uses local YYYY-MM-DD per check-in record.
 */
/**
 * How many days in a row this member has checked in, ending today.
 *
 * `freeDates` are days the chain may skip without breaking. Shabbat is the
 * reason this exists: a family that observes it correctly won't touch a phone
 * on Saturday, and a streak that punishes them for that is the app taking a
 * side it has no business taking. Free days don't *add* to the streak either —
 * they're neutral, not credit.
 */
export function streakLength(
  checkIns: HabitCheckIn[],
  member: MemberId,
  today: string,
  freeDates?: ReadonlySet<string>,
): number {
  const dates = new Set(checkIns.filter((c) => c.by === member).map((c) => c.date));
  const isFree = (d: string) => freeDates?.has(d) ?? false;

  let streak = 0;
  let cursor = today;
  // A free day today shouldn't read as a broken streak, so walk back past any
  // trailing free days before deciding whether the chain has ended.
  while (isFree(cursor) && !dates.has(cursor)) cursor = addDays(cursor, -1);

  while (dates.has(cursor) || isFree(cursor)) {
    if (dates.has(cursor)) streak += 1;
    cursor = addDays(cursor, -1);
    // Don't let a run of free days extend forever into the past looking for
    // a check-in that isn't there.
    if (!dates.has(cursor) && !isFree(cursor)) break;
  }
  return streak;
}

function addDays(yyyymmdd: string, n: number): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/**
 * Per-day cap enforcement. Returns the # of events of `reason` for `member`
 * on `date` (local YYYY-MM-DD).
 */
export function countEventsOnDate(
  events: PointEvent[],
  member: MemberId,
  reason: PointEvent['reason'],
  date: string,
): number {
  return events.filter(
    (e) => e.to === member && e.reason === reason && e.at.slice(0, 10) === date,
  ).length;
}

export function isCapExceeded(
  events: PointEvent[],
  member: MemberId,
  reason: 'photo' | 'journal' | 'reaction',
  date: string,
  cfg: PointsConfig,
): boolean {
  const cap =
    reason === 'photo' ? cfg.caps.photoPerDay
    : reason === 'journal' ? cfg.caps.journalPerDay
    : cfg.caps.reactionPerDay;
  return countEventsOnDate(events, member, reason, date) >= cap;
}

export function leaderboard(
  events: PointEvent[],
  members: MemberId[],
): { member: MemberId; points: number; tier: Tier }[] {
  return members
    .map((member) => {
      const points = totalPoints(events, member);
      return { member, points, tier: currentTier(points, DEFAULT_CONFIG) };
    })
    .sort((a, b) => b.points - a.points);
}

/**
 * Did a member already complete a given challenge?
 * (Trivia challenges are one-shot; place-specific most are one-time.)
 */
export function hasCompletedChallenge(
  completions: ChallengeCompletion[],
  member: MemberId,
  challengeId: string,
): boolean {
  return completions.some((c) => c.by === member && c.challengeId === challengeId);
}
