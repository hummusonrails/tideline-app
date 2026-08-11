/**
 * One visit to one cabinet: the state every game shares and the write that
 * happens when it ends.
 *
 * Games don't know about Dexie, points, or the leaderboard. They call
 * `addScore` while they play and `end()` when they're done; everything from
 * there — the daily caps, the personal best, the completion record, the point
 * event — happens once, here, in `end`.
 *
 * Score and lives are React state on purpose. They change a few times a
 * second at most and the HUD has to show them, which is exactly the case
 * React state is for; the sixty-times-a-second world of each game stays in
 * refs inside the game itself.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { uid } from '../uuid';
import { todayYMD } from '../time';
import { completeSynthetic } from '../award';
import { useSession } from '../../state/session';
import { sfx } from './sound';
import type { ArcadeGame } from './catalog';
import {
  arcadeRunChallengeId,
  cabinetRecord,
  personalBest,
  pointsEarnedToday,
  settleRun,
  ARCADE_POINTS_PER_DAY,
  type HighScore,
} from './score';

export type RunPhase = 'attract' | 'playing' | 'paused' | 'over';

export interface RunResult {
  score: number;
  points: number;
  record: boolean;
  previousBest: number;
  cappedByDay: boolean;
}

export interface ArcadeRun {
  game: ArcadeGame;
  phase: RunPhase;
  /** Bumped on every start — games key off it to remount clean. */
  nonce: number;
  score: number;
  lives: number;
  /** Free-form line the game can put in the HUD (level, words left, time). */
  status: string;
  addScore: (delta: number) => void;
  setScore: (value: number) => void;
  setLives: (value: number) => void;
  loseLife: () => number;
  setStatus: (text: string) => void;
  start: () => void;
  pause: () => void;
  resume: () => void;
  /** Ends the run. Pass a final score to override what was accumulated. */
  end: (finalScore?: number) => void;
  result: RunResult | null;
  /** This member's best on this cabinet, before the current run. */
  best: number;
  /** The whole family's top score on this cabinet. */
  cabinetTop: HighScore | null;
  /** Arcade points this member has already banked today. */
  earnedToday: number;
  dailyCap: number;
}

export function useArcadeRun(game: ArcadeGame): ArcadeRun {
  const memberId = useSession((s) => s.identity);
  const completions = useLiveQuery(() => db.completions.toArray(), []) ?? [];

  const [phase, setPhase] = useState<RunPhase>('attract');
  const [nonce, setNonce] = useState(0);
  const [score, setScoreState] = useState(0);
  const [lives, setLives] = useState(3);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<RunResult | null>(null);

  // The authoritative score during play. State lags by a render, and `end`
  // gets called from inside a game loop that may have scored on the same
  // frame — reading state there would drop those points.
  const scoreRef = useRef(0);
  const livesRef = useRef(3);
  const endedRef = useRef(false);

  const today = todayYMD();
  const best = useMemo(
    () => (memberId ? personalBest(completions, memberId, game.id) : 0),
    [completions, memberId, game.id],
  );
  const cabinetTop = useMemo(() => cabinetRecord(completions, game.id), [completions, game.id]);
  const earnedToday = useMemo(
    () => (memberId ? pointsEarnedToday(completions, memberId, today) : 0),
    [completions, memberId, today],
  );

  const addScore = useCallback((delta: number) => {
    scoreRef.current = Math.max(0, scoreRef.current + delta);
    setScoreState(scoreRef.current);
  }, []);

  const setScore = useCallback((value: number) => {
    scoreRef.current = Math.max(0, Math.round(value));
    setScoreState(scoreRef.current);
  }, []);

  const setLivesBoth = useCallback((value: number) => {
    livesRef.current = value;
    setLives(value);
  }, []);

  const loseLife = useCallback(() => {
    livesRef.current = Math.max(0, livesRef.current - 1);
    setLives(livesRef.current);
    return livesRef.current;
  }, []);

  const start = useCallback(() => {
    scoreRef.current = 0;
    livesRef.current = 3;
    endedRef.current = false;
    setScoreState(0);
    setLives(3);
    setStatus('');
    setResult(null);
    setNonce((n) => n + 1);
    setPhase('playing');
    sfx.coin();
  }, []);

  const pause = useCallback(() => setPhase((p) => (p === 'playing' ? 'paused' : p)), []);
  const resume = useCallback(() => setPhase((p) => (p === 'paused' ? 'playing' : p)), []);

  const end = useCallback(
    (finalScore?: number) => {
      // A game can hit its lose condition on the same frame it hits a timer.
      // Without this guard both paths write a completion.
      if (endedRef.current) return;
      endedRef.current = true;

      const final = Math.max(0, Math.round(finalScore ?? scoreRef.current));
      scoreRef.current = final;
      setScoreState(final);
      setPhase('over');

      void (async () => {
        // Read completions fresh rather than trusting the live query: two runs
        // finished back to back would otherwise both settle against the same
        // pre-run snapshot and both look like a personal best.
        const current = await db.completions.toArray();
        const settled = memberId
          ? settleRun({ completions: current, member: memberId, game, score: final })
          : { record: false, points: 0, previousBest: 0, shouldRecord: false, cappedByDay: false };

        setResult({
          score: final,
          points: settled.points,
          record: settled.record && final > 0,
          previousBest: settled.previousBest,
          cappedByDay: settled.cappedByDay,
        });

        if (settled.record && final > 0) sfx.record();
        else sfx.gameOver();

        if (memberId && settled.shouldRecord) {
          await completeSynthetic({
            challengeId: arcadeRunChallengeId(game.id, uid()),
            by: memberId,
            points: settled.points,
            commitMessage: `arcade: ${game.id} ${final}`,
            marks: [final],
          });
        }
      })();
    },
    [game, memberId],
  );

  return {
    game,
    phase,
    nonce,
    score,
    lives,
    status,
    addScore,
    setScore,
    setLives: setLivesBoth,
    loseLife,
    setStatus,
    start,
    pause,
    resume,
    end,
    result,
    best,
    cabinetTop,
    earnedToday,
    dailyCap: ARCADE_POINTS_PER_DAY,
  };
}
