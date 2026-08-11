/**
 * Tide 2048.
 *
 * Rules live in `lib/arcade/engines/g2048.ts`; this is the board, the swipe
 * handling and one flourish — the 2048 tile is your crew avatar, so the
 * moment you finally make it, the tile that appears is you.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { CrewAvatar } from '../../../ui/CrewAvatar';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../lib/db';
import { useSession } from '../../../state/session';
import { hueColor } from '../../../lib/arcade/catalog';
import { sfx } from '../../../lib/arcade/sound';
import { rngFromString } from '../../../lib/arcade/rng';
import { swipeHandlers, useDirectionKeys, type Dir } from '../../../lib/arcade/input';
import {
  SIZE,
  applyMove,
  hasMoves,
  highestTile,
  newBoard,
  spawnTile,
  tileStyle,
  type Board as GameBoard,
  type Move,
} from '../../../lib/arcade/engines/g2048';
import { Board, StatusRow } from '../shared';
import { DPad } from '../../../ui/arcade/DPad';
import type { GameProps } from '../shared';

const DIR_TO_MOVE: Record<Dir, Move> = {
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
};

export default function Tide2048({ run }: GameProps) {
  const color = hueColor(run.game.hue);
  const memberId = useSession((s) => s.identity);
  const spec = useLiveQuery(
    async () => (memberId ? ((await db.avatarSpecs.get(memberId)) ?? null) : null),
    [memberId],
  );
  const rng = useMemo(() => rngFromString(`2048-${run.nonce}`), [run.nonce]);
  const [board, setBoard] = useState<GameBoard>(() => newBoard(rng));
  const bestRef = useRef(0);

  const move = (dir: Dir) => {
    if (run.phase !== 'playing') return;
    setBoard((prev) => {
      const result = applyMove(prev, DIR_TO_MOVE[dir]);
      if (!result.moved) return prev;

      if (result.gained > 0) {
        run.addScore(result.gained);
        sfx.blip();
      }
      const next = spawnTile(result.board, rng);
      const high = highestTile(next);
      if (high > bestRef.current) {
        bestRef.current = high;
        run.setStatus(`Best swell ${high}`);
        if (high >= 512) sfx.levelUp();
      }
      if (!hasMoves(next)) {
        sfx.gameOver();
        // Let the final board paint before the overlay covers it.
        window.setTimeout(() => run.end(), 380);
      }
      return next;
    });
  };

  useDirectionKeys(move, undefined, run.phase === 'playing');
  const swipe = swipeHandlers(move, 22);

  useEffect(() => {
    run.setStatus('Swipe to slide');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Board>
      <StatusRow left="Merge matching swells" right={`Best ${bestRef.current || 2}`} />

      <div
        className="grid touch-none gap-1.5 rounded-xl p-1.5"
        style={{
          gridTemplateColumns: `repeat(${SIZE}, minmax(0, 1fr))`,
          background: 'rgba(255,255,255,0.05)',
        }}
        {...swipe}
      >
        {board.flat().map((value, i) => {
          const style = tileStyle(value);
          return (
            <div
              key={i}
              className="grid aspect-square place-items-center rounded-lg"
              style={{
                background: value === 0 ? 'rgba(255,255,255,0.04)' : style.bg,
                color: style.fg,
                boxShadow: value >= 128 ? `0 0 14px ${style.bg}` : undefined,
              }}
            >
              {value === 2048 && spec ? (
                <CrewAvatar spec={spec} size={40} alt="2048" />
              ) : value > 0 ? (
                <span
                  className={`pop-in font-bold ${
                    value >= 1024 ? 'text-[13px]' : value >= 128 ? 'text-base' : 'text-lg'
                  }`}
                >
                  {value}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--cab-dim)' }}>
          Swipe or use the pad
        </span>
        <DPad color={color} onPress={move} />
      </div>
    </Board>
  );
}
