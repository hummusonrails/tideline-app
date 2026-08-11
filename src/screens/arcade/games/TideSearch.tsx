/**
 * Tide Search — the word grid.
 *
 * Words are hidden in all eight directions, including backwards. Selection is
 * a drag from the first letter to the last: the engine expands the two
 * endpoints into a line and checks it against the placements, which means a
 * sloppy diagonal simply doesn't register rather than selecting something
 * unintended.
 */

import { useMemo, useRef, useState } from 'react';
import { hueColor } from '../../../lib/arcade/catalog';
import { sfx } from '../../../lib/arcade/sound';
import { rngFromString } from '../../../lib/arcade/rng';
import { useCountdown } from '../../../lib/arcade/loop';
import {
  buildGrid,
  lineBetween,
  matches,
  wordScore,
} from '../../../lib/arcade/engines/wordsearch';
import { Board, FitBox, StatusRow } from '../shared';
import type { GameProps } from '../shared';

const SIZE = 9;
const WANT = 7;
const ROUND_SECONDS = 150;

export default function TideSearch({ run, content }: GameProps) {
  const color = hueColor(run.game.hue);
  const grid = useMemo(
    () => buildGrid(content.words, SIZE, WANT, rngFromString(`search-${run.nonce}`)),
    [content.words, run.nonce],
  );
  const [found, setFound] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<number[]>([]);
  const [remaining, setRemaining] = useState(ROUND_SECONDS);
  const remainingRef = useRef(ROUND_SECONDS);
  const anchorRef = useRef<number | null>(null);

  useCountdown(
    ROUND_SECONDS,
    run.phase === 'playing',
    (r) => {
      setRemaining(r);
      remainingRef.current = r;
      run.setStatus(`${r}s · ${found.size}/${grid.placements.length}`);
    },
    () => run.end(),
  );

  const foundCells = useMemo(() => {
    const cells = new Set<number>();
    for (const p of grid.placements) {
      if (found.has(p.word)) p.cells.forEach((c) => cells.add(c));
    }
    return cells;
  }, [found, grid.placements]);

  /** Which cell is under a pointer? Read from the DOM so drags work. */
  const cellFrom = (e: React.PointerEvent): number | null => {
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const attr = el?.dataset?.cell;
    return attr === undefined ? null : Number(attr);
  };

  const extend = (to: number) => {
    const from = anchorRef.current;
    if (from === null) return;
    const line = lineBetween(SIZE, from, to);
    setSelection(line ?? [from]);
  };

  const commit = () => {
    const line = selection;
    anchorRef.current = null;
    setSelection([]);
    if (line.length < 3) return;

    const hit = grid.placements.find((p) => !found.has(p.word) && matches(p, line));
    if (!hit) {
      sfx.wrong();
      return;
    }
    const next = new Set(found);
    next.add(hit.word);
    setFound(next);
    run.addScore(wordScore(hit.word));
    sfx.right();

    if (next.size === grid.placements.length) {
      run.addScore(150 + remainingRef.current * 3);
      sfx.levelUp();
      window.setTimeout(() => run.end(), 500);
    }
  };

  return (
    <Board>
      <StatusRow
        left={`${found.size}/${grid.placements.length} found`}
        right={`${remaining}s`}
      />

      <FitBox ratio={1}>
      <div
        className="grid h-full w-full touch-none select-none gap-0.5"
        style={{
          gridTemplateColumns: `repeat(${SIZE}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${SIZE}, minmax(0, 1fr))`,
        }}
        onPointerDown={(e) => {
          const cell = cellFrom(e);
          if (cell === null) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          anchorRef.current = cell;
          setSelection([cell]);
        }}
        onPointerMove={(e) => {
          if (anchorRef.current === null) return;
          const cell = cellFrom(e);
          if (cell !== null) extend(cell);
        }}
        onPointerUp={commit}
        onPointerCancel={() => {
          anchorRef.current = null;
          setSelection([]);
        }}
      >
        {grid.letters.map((letter, i) => {
          const isFound = foundCells.has(i);
          const isSelected = selection.includes(i);
          return (
            <div
              key={i}
              data-cell={i}
              className="grid min-h-0 place-items-center rounded text-[13px] font-bold"
              style={{
                background: isSelected
                  ? color
                  : isFound
                  ? 'rgba(124,255,77,0.22)'
                  : 'rgba(255,255,255,0.05)',
                color: isSelected ? '#04010b' : isFound ? 'var(--neon-lime)' : 'var(--cab-text)',
              }}
            >
              {letter}
            </div>
          );
        })}
      </div>
      </FitBox>

      <ul className="mt-2 flex shrink-0 flex-wrap justify-center gap-1.5">
        {grid.placements.map((p) => (
          <li
            key={p.word}
            className="rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wider"
            style={{
              borderColor: found.has(p.word) ? 'var(--neon-lime)' : 'var(--cab-line)',
              color: found.has(p.word) ? 'var(--neon-lime)' : 'var(--cab-dim)',
              textDecoration: found.has(p.word) ? 'line-through' : 'none',
            }}
          >
            {p.word}
          </li>
        ))}
      </ul>

      <p className="mt-1.5 shrink-0 text-center text-[9px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
        Drag from the first letter to the last. Any direction, backwards included.
      </p>
    </Board>
  );
}
