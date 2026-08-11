import { describe, it, expect } from 'vitest';
import {
  ARCADE_POINTS_PER_DAY,
  ARCADE_RUNS_PER_DAY,
  arcadeRunChallengeId,
  arcadeStandings,
  cabinetRecord,
  highScores,
  isArcadeCompletion,
  parseArcadeId,
  personalBest,
  pointsForScore,
  ratingFor,
  scoreOf,
  settleRun,
} from './score';
import { GAMES, gameById } from './catalog';
import type { ChallengeCompletion } from '../../types';

const GAME = gameById('crew-invaders')!;

function run(
  member: string,
  gameId: string,
  score: number,
  opts: { at?: string; points?: number; runId?: string } = {},
): ChallengeCompletion {
  const runId = opts.runId ?? `r${Math.random().toString(16).slice(2, 8)}`;
  return {
    id: `c${runId}`,
    challengeId: arcadeRunChallengeId(gameId, runId),
    by: member,
    completedAt: opts.at ?? new Date().toISOString(),
    triviaAnswers: [score],
    awardedPoints: opts.points ?? 0,
  };
}

describe('arcade id parsing', () => {
  it('round-trips a game id that contains dashes', () => {
    const id = arcadeRunChallengeId('crew-invaders', 'abc123');
    expect(parseArcadeId(id)).toEqual({ gameId: 'crew-invaders', runId: 'abc123' });
  });

  it('parses every cabinet in the catalog', () => {
    for (const game of GAMES) {
      const parsed = parseArcadeId(arcadeRunChallengeId(game.id, 'deadbeef'));
      expect(parsed?.gameId).toBe(game.id);
    }
  });

  it('rejects ids belonging to other synthetic collections', () => {
    expect(parseArcadeId('egg-sunrise')).toBeNull();
    expect(parseArcadeId('race-abc-win')).toBeNull();
    expect(parseArcadeId('hunt-1-stage-2')).toBeNull();
    expect(isArcadeCompletion('party-herd-abc')).toBe(false);
  });

  it('rejects an arcade id naming a cabinet that no longer exists', () => {
    // Retired games must not contribute to a rating divided by today's lineup.
    expect(parseArcadeId('arcade-pinball-wizard-abc')).toBeNull();
  });

  it('treats a missing score as zero rather than NaN', () => {
    const bare = { ...run('m', 'sea-snake', 0), triviaAnswers: undefined };
    expect(scoreOf(bare)).toBe(0);
  });
});

describe('points for a run', () => {
  it('pays on the curve and caps per run', () => {
    expect(pointsForScore(GAME, 0)).toBe(0);
    expect(pointsForScore(GAME, GAME.scorePerPoint - 1)).toBe(0);
    expect(pointsForScore(GAME, GAME.scorePerPoint * 3)).toBe(3);
    expect(pointsForScore(GAME, GAME.scorePerPoint * 500)).toBe(GAME.maxPointsPerRun);
  });
});

describe('settleRun', () => {
  const today = '2026-08-11';
  const at = `${today}T12:00:00.000Z`;

  it('flags a personal best and records it', () => {
    const settled = settleRun({
      completions: [run('me', GAME.id, 500, { at })],
      member: 'me',
      game: GAME,
      score: 900,
      today,
    });
    expect(settled.record).toBe(true);
    expect(settled.previousBest).toBe(500);
    expect(settled.shouldRecord).toBe(true);
  });

  it('does not treat another member’s better score as your record', () => {
    const settled = settleRun({
      completions: [run('them', GAME.id, 9000, { at })],
      member: 'me',
      game: GAME,
      score: 10,
      today,
    });
    expect(settled.previousBest).toBe(0);
    expect(settled.record).toBe(true);
  });

  it('stops paying once the daily allowance is spent', () => {
    const spent = [
      run('me', GAME.id, 100, { at, points: ARCADE_POINTS_PER_DAY }),
    ];
    const settled = settleRun({
      completions: spent,
      member: 'me',
      game: GAME,
      score: GAME.scorePerPoint * 5,
      today,
    });
    expect(settled.points).toBe(0);
    expect(settled.cappedByDay).toBe(true);
  });

  it('pays only the remainder when the allowance is partly spent', () => {
    const spent = [run('me', GAME.id, 100, { at, points: ARCADE_POINTS_PER_DAY - 2 })];
    const settled = settleRun({
      completions: spent,
      member: 'me',
      game: GAME,
      score: GAME.scorePerPoint * 6,
      today,
    });
    expect(settled.points).toBe(2);
  });

  it('ignores points earned on a different day', () => {
    const yesterday = [
      run('me', GAME.id, 100, { at: '2026-08-10T12:00:00.000Z', points: ARCADE_POINTS_PER_DAY }),
    ];
    const settled = settleRun({
      completions: yesterday,
      member: 'me',
      game: GAME,
      score: GAME.scorePerPoint * 2,
      today,
    });
    expect(settled.points).toBe(2);
  });

  it('stops writing ordinary runs past the daily budget', () => {
    const many = Array.from({ length: ARCADE_RUNS_PER_DAY }, (_, i) =>
      run('me', GAME.id, 5000, { at, runId: `x${i}` }),
    );
    const settled = settleRun({
      completions: many,
      member: 'me',
      game: GAME,
      score: 10,
      today,
    });
    expect(settled.shouldRecord).toBe(false);
  });

  it('always writes a personal best, even past the daily budget', () => {
    const many = Array.from({ length: ARCADE_RUNS_PER_DAY + 5 }, (_, i) =>
      run('me', GAME.id, 100, { at, runId: `x${i}` }),
    );
    const settled = settleRun({
      completions: many,
      member: 'me',
      game: GAME,
      score: 99999,
      today,
    });
    expect(settled.record).toBe(true);
    expect(settled.shouldRecord).toBe(true);
  });
});

describe('high scores', () => {
  it('keeps one row per member, at their best', () => {
    const completions = [
      run('a', GAME.id, 100, { at: '2026-08-01T10:00:00.000Z' }),
      run('a', GAME.id, 400, { at: '2026-08-02T10:00:00.000Z' }),
      run('b', GAME.id, 250, { at: '2026-08-01T10:00:00.000Z' }),
    ];
    const table = highScores(completions, GAME.id);
    expect(table.map((h) => [h.member, h.score])).toEqual([
      ['a', 400],
      ['b', 250],
    ]);
    expect(personalBest(completions, 'a', GAME.id)).toBe(400);
    expect(cabinetRecord(completions, GAME.id)?.member).toBe('a');
  });

  it('breaks a tie in favour of whoever got there first', () => {
    const completions = [
      run('late', GAME.id, 300, { at: '2026-08-05T10:00:00.000Z' }),
      run('early', GAME.id, 300, { at: '2026-08-01T10:00:00.000Z' }),
    ];
    expect(highScores(completions, GAME.id)[0].member).toBe('early');
  });

  it('does not mix cabinets', () => {
    const completions = [run('a', 'sea-snake', 900)];
    expect(personalBest(completions, 'a', GAME.id)).toBe(0);
    expect(personalBest(completions, 'a', 'sea-snake')).toBe(900);
  });
});

describe('rating and standings', () => {
  it('caps a single cabinet at 100 no matter how big the score', () => {
    expect(ratingFor(GAME, GAME.par)).toBe(100);
    expect(ratingFor(GAME, GAME.par * 50)).toBe(100);
    expect(ratingFor(GAME, 0)).toBe(0);
  });

  it('stops one big-number cabinet from burying a small-number one', () => {
    const tetris = gameById('block-tide')!;
    const simon = gameById('sonar-says')!;
    // A par run on each is worth exactly the same to the leaderboard.
    expect(ratingFor(tetris, tetris.par)).toBe(ratingFor(simon, simon.par));
  });

  it('ranks members and counts the records they hold', () => {
    const completions = [
      run('a', 'crew-invaders', 2000, { points: 10 }),
      run('a', 'sea-snake', 300),
      run('b', 'crew-invaders', 1000),
    ];
    const standings = arcadeStandings(completions, ['a', 'b', 'c']);
    expect(standings.map((s) => s.member)).toEqual(['a', 'b', 'c']);
    expect(standings[0].rating).toBe(200);
    expect(standings[0].crowns).toBe(2);
    expect(standings[0].points).toBe(10);
    expect(standings[0].played).toBe(2);
    // Somebody who hasn't played still appears — an empty row is an invitation.
    expect(standings[2]).toMatchObject({ member: 'c', rating: 0, played: 0 });
  });
});
