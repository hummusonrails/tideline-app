/**
 * Scramble — unjumble the word before the clock runs out.
 *
 * Two minutes, as many words as you can get. A wrong word costs nothing but
 * the seconds it took, which keeps guessing viable and the game moving; the
 * real pressure is the ticking clock and the streak bonus.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { hueColor } from '../../../lib/arcade/catalog';
import { sfx } from '../../../lib/arcade/sound';
import { rngFromString, shuffle } from '../../../lib/arcade/rng';
import { useCountdown } from '../../../lib/arcade/loop';
import { Board, StatusRow } from '../shared';
import type { WordEntry } from '../../../lib/arcade/content';
import type { GameProps } from '../shared';

const ROUND_SECONDS = 120;

interface Tile {
  id: number;
  letter: string;
  used: boolean;
}

export default function Scramble({ run, content }: GameProps) {
  const color = hueColor(run.game.hue);
  const words = useMemo(
    () =>
      shuffle(content.words, rngFromString(`scram-${run.nonce}`)).filter(
        (w) => w.word.length >= 4 && w.word.length <= 9,
      ),
    [content.words, run.nonce],
  );
  const indexRef = useRef(0);
  const streakRef = useRef(0);
  const [entry, setEntry] = useState<WordEntry>(() => words[0] ?? { word: 'ANCHOR', hint: 'A word' });
  const [tiles, setTiles] = useState<Tile[]>(() => scrambleTiles(entry.word, run.nonce));
  const [built, setBuilt] = useState<Tile[]>([]);
  const [flash, setFlash] = useState<'right' | 'wrong' | null>(null);
  const [solved, setSolved] = useState(0);
  const [remaining, setRemaining] = useState(ROUND_SECONDS);

  useCountdown(
    ROUND_SECONDS,
    run.phase === 'playing',
    (r) => {
      setRemaining(r);
      run.setStatus(`${r}s · ${solved} solved`);
    },
    () => run.end(),
  );

  const attempt = built.map((t) => t.letter).join('');

  // Checking on every tap rather than behind a submit button: the word is
  // either right or it isn't, and making people confirm a finished word adds
  // a press without adding a decision.
  useEffect(() => {
    if (attempt.length !== entry.word.length || run.phase !== 'playing') return;
    if (attempt === entry.word) {
      streakRef.current += 1;
      const gained = 30 + entry.word.length * 12 + Math.min(60, streakRef.current * 10);
      run.addScore(gained);
      setSolved((s) => s + 1);
      setFlash('right');
      sfx.right();
      window.setTimeout(() => {
        indexRef.current += 1;
        const next = words[indexRef.current % Math.max(1, words.length)] ?? entry;
        setEntry(next);
        setTiles(scrambleTiles(next.word, run.nonce + indexRef.current));
        setBuilt([]);
        setFlash(null);
      }, 620);
    } else {
      streakRef.current = 0;
      setFlash('wrong');
      sfx.wrong();
      window.setTimeout(() => {
        setTiles((prev) => prev.map((t) => ({ ...t, used: false })));
        setBuilt([]);
        setFlash(null);
      }, 520);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const take = (tile: Tile) => {
    if (run.phase !== 'playing' || tile.used || flash) return;
    setTiles((prev) => prev.map((t) => (t.id === tile.id ? { ...t, used: true } : t)));
    setBuilt((prev) => [...prev, tile]);
    sfx.blip();
  };

  const undo = () => {
    const last = built[built.length - 1];
    if (!last) return;
    setTiles((prev) => prev.map((t) => (t.id === last.id ? { ...t, used: false } : t)));
    setBuilt((prev) => prev.slice(0, -1));
    sfx.blip();
  };

  const skip = () => {
    if (run.phase !== 'playing') return;
    streakRef.current = 0;
    run.addScore(-15);
    indexRef.current += 1;
    const next = words[indexRef.current % Math.max(1, words.length)] ?? entry;
    setEntry(next);
    setTiles(scrambleTiles(next.word, run.nonce + indexRef.current));
    setBuilt([]);
    sfx.wrong();
  };

  return (
    <Board>
      <StatusRow
        left={`${solved} solved · streak ${streakRef.current}`}
        right={`${remaining}s`}
      />

      <p className="mb-3 text-center text-[10px] italic" style={{ color: 'var(--cab-dim)' }}>
        {entry.hint}
      </p>

      {/* The answer slots. */}
      <div className={`flex flex-wrap justify-center gap-1.5 ${flash === 'wrong' ? 'shake' : ''}`}>
        {Array.from({ length: entry.word.length }, (_, i) => {
          const tile = built[i];
          return (
            <span
              key={i}
              className="grid h-10 w-8 place-items-center rounded border-2 text-lg font-bold"
              style={{
                borderColor: flash === 'right' ? 'var(--neon-lime)' : tile ? color : 'var(--cab-line)',
                color: flash === 'right' ? 'var(--neon-lime)' : color,
              }}
            >
              {tile?.letter ?? ''}
            </span>
          );
        })}
      </div>

      {/* The jumble. */}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            disabled={tile.used}
            onClick={() => take(tile)}
            className="grid h-11 w-9 place-items-center rounded-lg border text-lg font-bold transition disabled:opacity-20"
            style={{ borderColor: 'var(--cab-line)', background: 'rgba(255,255,255,0.05)' }}
          >
            {tile.letter}
          </button>
        ))}
      </div>

      <div className="mt-5 flex justify-center gap-2">
        <button
          type="button"
          onClick={undo}
          disabled={!built.length}
          className="arcade-btn text-[10px] font-bold disabled:opacity-40"
          style={{ color: 'var(--neon-gold)' }}
        >
          Undo
        </button>
        <button
          type="button"
          onClick={skip}
          className="arcade-btn text-[10px] font-bold"
          style={{ color: 'var(--neon-red)' }}
        >
          Skip −15
        </button>
      </div>
    </Board>
  );
}

/**
 * Scramble the letters, guaranteeing the jumble isn't the answer.
 *
 * Handing somebody the solved word and calling it a puzzle is the one
 * outcome this has to rule out; a couple of retries is enough for anything
 * but a single-letter word.
 */
function scrambleTiles(word: string, seed: number): Tile[] {
  const letters = [...word];
  for (let attempt = 0; attempt < 6; attempt++) {
    const shuffled = shuffle(letters, rngFromString(`${word}-${seed}-${attempt}`));
    if (shuffled.join('') !== word) {
      return shuffled.map((letter, id) => ({ id, letter, used: false }));
    }
  }
  return letters.reverse().map((letter, id) => ({ id, letter, used: false }));
}
