/**
 * Reef Sweeper — minesweeper, charted.
 *
 * Rules in `lib/arcade/engines/minesweeper.ts`, including the two that make
 * it fair: the first tap is never a reef, and revealing an empty square
 * floods outwards.
 *
 * Long-press to flag rather than a mode toggle. A toggle means every flag is
 * three taps and every forgotten toggle is a lost game; a press-and-hold is
 * one gesture that can't be in the wrong mode.
 */

import { useMemo, useRef, useState } from 'react';
import { hueColor } from '../../../lib/arcade/catalog';
import { sfx } from '../../../lib/arcade/sound';
import { rngFromString } from '../../../lib/arcade/rng';
import { useCountdown } from '../../../lib/arcade/loop';
import {
  DIFFICULTY,
  NEAR_COLORS,
  flagsUsed,
  idx,
  isWon,
  newBoard,
  reveal,
  revealAll,
  scoreFor,
  toggleFlag,
  type Board as MineBoard,
} from '../../../lib/arcade/engines/minesweeper';
import { Board, FitBox, StatusRow } from '../shared';
import type { GameProps } from '../shared';

const ROUND_SECONDS = 240;
const HOLD_MS = 350;

export default function ReefSweeper({ run }: GameProps) {
  const color = hueColor(run.game.hue);
  const rng = useMemo(() => rngFromString(`reef-${run.nonce}`), [run.nonce]);
  const [board, setBoard] = useState<MineBoard>(() => newBoard());
  const [remaining, setRemaining] = useState(ROUND_SECONDS);
  const remainingRef = useRef(ROUND_SECONDS);
  const openedRef = useRef(0);
  const holdRef = useRef<{ timer: number; flagged: boolean } | null>(null);

  useCountdown(
    ROUND_SECONDS,
    run.phase === 'playing',
    (r) => {
      setRemaining(r);
      remainingRef.current = r;
      run.setStatus(`${r}s · ${board.mines - flagsUsed(board)} left`);
    },
    () => {
      setBoard((b) => revealAll(b));
      run.end();
    },
  );

  const open = (x: number, y: number) => {
    if (run.phase !== 'playing') return;
    const result = reveal(board, x, y, rng);
    setBoard(result.board);
    if (result.hitReef) {
      sfx.boom();
      setBoard(revealAll(result.board));
      window.setTimeout(() => run.end(), 900);
      return;
    }
    if (result.revealed > 0) {
      openedRef.current += result.revealed;
      run.setScore(scoreFor(openedRef.current, 0, false));
      sfx.blip();
    }
    if (isWon(result.board)) {
      sfx.levelUp();
      run.setScore(scoreFor(openedRef.current, remainingRef.current, true));
      window.setTimeout(() => run.end(), 500);
    }
  };

  const flag = (x: number, y: number) => {
    if (run.phase !== 'playing') return;
    setBoard((b) => toggleFlag(b, x, y));
    sfx.select();
  };

  const startHold = (x: number, y: number) => {
    holdRef.current = {
      flagged: false,
      timer: window.setTimeout(() => {
        if (holdRef.current) holdRef.current.flagged = true;
        flag(x, y);
      }, HOLD_MS),
    };
  };

  const endHold = (x: number, y: number) => {
    const hold = holdRef.current;
    holdRef.current = null;
    if (!hold) return;
    window.clearTimeout(hold.timer);
    // A press that already fired the flag must not also open the square.
    if (!hold.flagged) open(x, y);
  };

  return (
    <Board>
      <StatusRow
        left={`${board.mines - flagsUsed(board)} reefs unflagged`}
        right={`${remaining}s`}
      />

      <FitBox ratio={DIFFICULTY.w / DIFFICULTY.h}>
        <div
          className="grid h-full w-full touch-none gap-0.5"
          style={{
            gridTemplateColumns: `repeat(${DIFFICULTY.w}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${DIFFICULTY.h}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: DIFFICULTY.w * DIFFICULTY.h }, (_, i) => {
          const x = i % DIFFICULTY.w;
          const y = Math.floor(i / DIFFICULTY.w);
          const cell = board.cells[idx(board, x, y)];
          return (
            <button
              key={i}
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                startHold(x, y);
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                endHold(x, y);
              }}
              onPointerLeave={() => {
                if (holdRef.current) window.clearTimeout(holdRef.current.timer);
                holdRef.current = null;
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                flag(x, y);
              }}
              aria-label={
                cell.revealed
                  ? cell.reef
                    ? 'Reef'
                    : `${cell.near} nearby`
                  : cell.flagged
                  ? 'Flagged'
                  : 'Unknown water'
              }
              className="grid min-h-0 place-items-center rounded-[3px] text-[11px] font-bold"
              style={{
                background: cell.revealed
                  ? cell.reef
                    ? 'var(--neon-red)'
                    : 'rgba(255,255,255,0.05)'
                  : 'rgba(33,230,255,0.14)',
                color: cell.revealed && !cell.reef ? NEAR_COLORS[cell.near] : '#04010b',
                border: cell.revealed ? 'none' : '1px solid rgba(33,230,255,0.28)',
              }}
            >
              {cell.revealed
                ? cell.reef
                  ? '⚓'
                  : cell.near > 0
                  ? cell.near
                  : ''
                : cell.flagged
                ? '🚩'
                : ''}
              </button>
            );
          })}
        </div>
      </FitBox>

      <p className="mt-2 shrink-0 text-center text-[9px] leading-relaxed" style={{ color }}>
        Tap to chart · press and hold to plant a flag
      </p>
    </Board>
  );
}
