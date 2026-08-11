/**
 * Arcade scoring, high scores and the leaderboard — plus the anti-grind layer.
 *
 * Runs ride {@link ChallengeCompletion} under an `arcade-<gameId>-<runId>`
 * synthetic id, exactly like hunts, eggs and kart duels. That's the whole
 * reason this feature adds no sync surface: no new collection, no new gossip
 * message, no schema migration. A phone on an older build relays a run
 * faithfully and simply doesn't render it.
 *
 * The raw game score is carried in `triviaAnswers[0]`. That field is already
 * "small ints kept alongside the completion" (see `completeSynthetic`), it
 * already syncs, and reusing it beats widening the record shape for one
 * number.
 *
 * Three rules keep twenty games from turning into a points printer:
 *
 *  - **Points per run are capped** by the cabinet (`maxPointsPerRun`) and
 *    earned on a curve (`scorePerPoint`), so a great run pays and a mediocre
 *    one mostly doesn't.
 *  - **Points per day are capped** across the whole arcade
 *    ({@link ARCADE_POINTS_PER_DAY}). Grinding one cabinet all afternoon
 *    stops moving the trip scoreboard long before it stops being fun.
 *  - **Runs stop being *written* after {@link ARCADE_RUNS_PER_DAY}** — every
 *    completion is a commit to the family repo, and game #40 of the evening
 *    is not history. A personal best is always written regardless, because
 *    the high-score table is the point of an arcade and losing a record to a
 *    file-writing budget would be indefensible.
 *
 * All caps are computed from the completions themselves, so they survive a
 * reinstall and can't be reset by juggling devices — the records that enforce
 * the cap are the same records that sync.
 */

import type { ChallengeCompletion, MemberId } from '../../types';
import { todayYMD } from '../time';
import { GAMES, gameById, type ArcadeGame } from './catalog';

export const ARCADE_PREFIX = 'arcade-';
export const ARCADE_POINTS_PER_DAY = 60;
export const ARCADE_RUNS_PER_DAY = 25;
/** Rating ceiling per cabinet — twenty cabinets, so 2000 is a perfect card. */
export const MAX_RATING_PER_GAME = 100;

export function arcadeRunChallengeId(gameId: string, runId: string): string {
  return `${ARCADE_PREFIX}${gameId}-${runId}`;
}

/**
 * Parse an arcade completion id back into its parts.
 *
 * Game ids contain dashes (`crew-invaders`) and run ids never do (`uid()` is
 * hex), so the run id is the last dash-separated segment and the game id is
 * everything before it — the same shape `eventIdFromPath` relies on. Ids
 * naming a cabinet that no longer exists return null, so a retired game's old
 * records can't skew a rating that's divided by today's lineup.
 */
export function parseArcadeId(
  challengeId: string,
): { gameId: string; runId: string } | null {
  if (!challengeId.startsWith(ARCADE_PREFIX)) return null;
  const rest = challengeId.slice(ARCADE_PREFIX.length);
  const cut = rest.lastIndexOf('-');
  if (cut <= 0 || cut === rest.length - 1) return null;
  const gameId = rest.slice(0, cut);
  if (!gameById(gameId)) return null;
  return { gameId, runId: rest.slice(cut + 1) };
}

export function isArcadeCompletion(challengeId: string): boolean {
  return parseArcadeId(challengeId) !== null;
}

/** The raw game score a completion recorded. */
export function scoreOf(c: ChallengeCompletion): number {
  const raw = c.triviaAnswers?.[0];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

/** Every arcade completion, optionally narrowed to one member and/or cabinet. */
export function arcadeRuns(
  completions: readonly ChallengeCompletion[],
  opts: { member?: MemberId; gameId?: string; day?: string } = {},
): ChallengeCompletion[] {
  return completions.filter((c) => {
    const parsed = parseArcadeId(c.challengeId);
    if (!parsed) return false;
    if (opts.member && c.by !== opts.member) return false;
    if (opts.gameId && parsed.gameId !== opts.gameId) return false;
    if (opts.day && localDay(c.completedAt) !== opts.day) return false;
    return true;
  });
}

/** Local calendar day of an ISO timestamp. */
function localDay(iso: string): string {
  return todayYMD(new Date(iso));
}

// ---------- points ----------

/** Trip points a raw score is worth on this cabinet, before the daily cap. */
export function pointsForScore(game: ArcadeGame, score: number): number {
  if (score <= 0) return 0;
  return Math.min(game.maxPointsPerRun, Math.floor(score / game.scorePerPoint));
}

/** Arcade points already minted by this member today. */
export function pointsEarnedToday(
  completions: readonly ChallengeCompletion[],
  member: MemberId,
  today: string,
): number {
  return arcadeRuns(completions, { member, day: today }).reduce(
    (sum, c) => sum + c.awardedPoints,
    0,
  );
}

/** Runs this member has had written down today, across every cabinet. */
export function runsRecordedToday(
  completions: readonly ChallengeCompletion[],
  member: MemberId,
  today: string,
): number {
  return arcadeRuns(completions, { member, day: today }).length;
}

/**
 * What a finished run is actually worth, and whether to write it down at all.
 *
 * Returns everything the screen needs to explain itself to the player: the
 * points, the reason they're zero when they are, and whether this beat their
 * own record.
 */
export function settleRun(input: {
  completions: readonly ChallengeCompletion[];
  member: MemberId;
  game: ArcadeGame;
  score: number;
  today?: string;
}): {
  record: boolean;
  points: number;
  previousBest: number;
  /** False when the run is over the daily write budget and isn't a record. */
  shouldRecord: boolean;
  cappedByDay: boolean;
} {
  const today = input.today ?? todayYMD();
  const previousBest = personalBest(input.completions, input.member, input.game.id);
  const record = input.score > previousBest;

  const earnedToday = pointsEarnedToday(input.completions, input.member, today);
  const allowance = Math.max(0, ARCADE_POINTS_PER_DAY - earnedToday);
  const raw = pointsForScore(input.game, input.score);
  const points = Math.min(raw, allowance);

  const underRunBudget =
    runsRecordedToday(input.completions, input.member, today) < ARCADE_RUNS_PER_DAY;

  return {
    record,
    points,
    previousBest,
    // A record always gets written. Otherwise the daily write budget applies,
    // and a run worth nothing that isn't a record isn't worth a commit.
    shouldRecord: record || (underRunBudget && (points > 0 || input.score > 0)),
    cappedByDay: raw > points,
  };
}

// ---------- high scores ----------

/** Best raw score this member has posted on one cabinet. */
export function personalBest(
  completions: readonly ChallengeCompletion[],
  member: MemberId,
  gameId: string,
): number {
  return arcadeRuns(completions, { member, gameId }).reduce(
    (best, c) => Math.max(best, scoreOf(c)),
    0,
  );
}

export interface HighScore {
  member: MemberId;
  score: number;
  at: string;
}

/**
 * The high-score table for one cabinet: each member's best, ranked.
 *
 * Ties break on the *earlier* timestamp — whoever got there first keeps the
 * higher slot, which is how an arcade has always worked — and then on member
 * id so every phone renders the same order from the same records.
 */
export function highScores(
  completions: readonly ChallengeCompletion[],
  gameId: string,
): HighScore[] {
  const best = new Map<MemberId, HighScore>();
  for (const c of arcadeRuns(completions, { gameId })) {
    const score = scoreOf(c);
    const prev = best.get(c.by);
    if (!prev || score > prev.score) {
      best.set(c.by, { member: c.by, score, at: c.completedAt });
    }
  }
  return [...best.values()].sort(
    (a, b) =>
      b.score - a.score ||
      Date.parse(a.at) - Date.parse(b.at) ||
      a.member.localeCompare(b.member),
  );
}

/** Best score anyone has posted on a cabinet — the number to beat. */
export function cabinetRecord(
  completions: readonly ChallengeCompletion[],
  gameId: string,
): HighScore | null {
  return highScores(completions, gameId)[0] ?? null;
}

// ---------- leaderboard ----------

/**
 * A cabinet's contribution to a member's rating: their best against par,
 * clamped to {@link MAX_RATING_PER_GAME}.
 */
export function ratingFor(game: ArcadeGame, best: number): number {
  if (best <= 0) return 0;
  return Math.min(MAX_RATING_PER_GAME, Math.round((best / game.par) * MAX_RATING_PER_GAME));
}

export interface ArcadeStanding {
  member: MemberId;
  /** 0–2000. The headline number: comparable across all twenty cabinets. */
  rating: number;
  /** Trip points this member has earned from the arcade, all time. */
  points: number;
  /** Cabinets they've posted a score on. */
  played: number;
  /** Cabinets where they currently hold the top score. */
  crowns: number;
  /** Total runs recorded. */
  runs: number;
  bestByGame: Record<string, number>;
}

/**
 * Standings across every cabinet.
 *
 * `members` is passed in rather than derived from the completions so that
 * somebody who hasn't played yet still appears — an empty row on the board is
 * an invitation, and a leaderboard that hides you until you score is a
 * leaderboard nobody joins.
 */
export function arcadeStandings(
  completions: readonly ChallengeCompletion[],
  members: readonly MemberId[],
): ArcadeStanding[] {
  const crownHolder = new Map<string, MemberId | null>();
  for (const game of GAMES) {
    crownHolder.set(game.id, cabinetRecord(completions, game.id)?.member ?? null);
  }

  return members
    .map((member) => {
      const bestByGame: Record<string, number> = {};
      let rating = 0;
      let played = 0;
      let crowns = 0;
      for (const game of GAMES) {
        const best = personalBest(completions, member, game.id);
        bestByGame[game.id] = best;
        if (best > 0) {
          played += 1;
          rating += ratingFor(game, best);
          if (crownHolder.get(game.id) === member) crowns += 1;
        }
      }
      const runs = arcadeRuns(completions, { member });
      return {
        member,
        rating,
        points: runs.reduce((sum, c) => sum + c.awardedPoints, 0),
        played,
        crowns,
        runs: runs.length,
        bestByGame,
      };
    })
    .sort(
      (a, b) =>
        b.rating - a.rating ||
        b.crowns - a.crowns ||
        b.points - a.points ||
        a.member.localeCompare(b.member),
    );
}

/** Total runs across the whole family — the "credits played" counter. */
export function totalRuns(completions: readonly ChallengeCompletion[]): number {
  return arcadeRuns(completions).length;
}
