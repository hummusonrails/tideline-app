/**
 * Hangman — or rather, the anchor drops.
 *
 * The gallows is replaced by an anchor on a rope, which is both on-theme and
 * a deliberate choice: this is a cabinet a family plays together on a
 * holiday, and drawing a hanging person for the kids is a strange thing to
 * ship.
 *
 * Words come from the trip — place names, things to look for, itinerary
 * entries — with a generic seaside bank behind them. The hint tells you which
 * kind of word you're looking at, which is what makes a proper noun fair.
 */

import { useMemo, useRef, useState } from 'react';
import { hueColor } from '../../../lib/arcade/catalog';
import { sfx } from '../../../lib/arcade/sound';
import { rngFromString, shuffle } from '../../../lib/arcade/rng';
import {
  LETTERS,
  MAX_MISSES,
  guess,
  isLost,
  isSolved,
  masked,
  newRound,
  solveScore,
  type HangmanRound,
} from '../../../lib/arcade/engines/hangman';
import { Board, StatusRow } from '../shared';
import type { GameProps } from '../shared';

export default function Hangman({ run, content }: GameProps) {
  const color = hueColor(run.game.hue);
  const words = useMemo(
    () => shuffle(content.words, rngFromString(`hang-${run.nonce}`)),
    [content.words, run.nonce],
  );
  const indexRef = useRef(0);
  const [solved, setSolved] = useState(0);
  const [round, setRound] = useState<HangmanRound>(() =>
    newRound(words[0]?.word ?? 'ANCHOR', words[0]?.hint ?? 'A word'),
  );
  const [reveal, setReveal] = useState(false);

  const letters = masked(round, reveal);

  const play = (letter: string) => {
    if (run.phase !== 'playing' || reveal || round.guessed.has(letter)) return;
    const next = guess(round, letter);
    setRound(next);

    if (round.word.includes(letter)) sfx.blip();
    else sfx.wrong();

    if (isSolved(next)) {
      const gained = solveScore(next);
      run.addScore(gained);
      sfx.right();
      setSolved((s) => s + 1);
      setReveal(true);
      window.setTimeout(() => {
        indexRef.current += 1;
        const nextWord = words[indexRef.current % Math.max(1, words.length)];
        // Misses carry over between words: the rope is the run, not the word,
        // so a clean solve is worth playing for rather than a free reset.
        setRound({
          ...newRound(nextWord?.word ?? 'ANCHOR', nextWord?.hint ?? 'A word'),
          misses: next.misses,
        });
        setReveal(false);
        run.setStatus(`Word ${indexRef.current + 1} · ${solved + 1} solved`);
      }, 1400);
    } else if (isLost(next)) {
      setReveal(true);
      sfx.boom();
      window.setTimeout(() => run.end(), 1600);
    }
  };

  const ropeLeft = MAX_MISSES - round.misses;

  return (
    <Board>
      <StatusRow
        left={`${solved} solved`}
        right={`${ropeLeft} rope left`}
      />

      <AnchorRope misses={round.misses} color={color} />

      <p className="mt-2 text-center text-[10px] italic" style={{ color: 'var(--cab-dim)' }}>
        {round.hint}
      </p>

      <div className="mt-3 flex flex-wrap justify-center gap-1.5">
        {letters.map((ch, i) => (
          <span
            key={i}
            className="grid h-9 w-7 place-items-center border-b-2 text-lg font-bold"
            style={{
              borderColor: ch === '_' ? 'var(--cab-line)' : color,
              color: ch === '_' ? 'transparent' : color,
            }}
          >
            {ch === '_' ? '·' : ch}
          </span>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1">
        {LETTERS.map((letter) => {
          const used = round.guessed.has(letter);
          const hit = used && round.word.includes(letter);
          return (
            <button
              key={letter}
              type="button"
              disabled={used || reveal}
              onClick={() => play(letter)}
              className="grid h-8 place-items-center rounded border text-[11px] font-bold disabled:opacity-45"
              style={{
                borderColor: used ? (hit ? 'var(--neon-lime)' : 'var(--neon-red)') : 'var(--cab-line)',
                color: used ? (hit ? 'var(--neon-lime)' : 'var(--neon-red)') : 'var(--cab-text)',
              }}
            >
              {letter}
            </button>
          );
        })}
      </div>
    </Board>
  );
}

/**
 * The rope, drawn in six stages.
 *
 * Each miss releases another coil; on the sixth the anchor is in the water.
 */
function AnchorRope({ misses, color }: { misses: number; color: string }) {
  const drop = (misses / MAX_MISSES) * 52;
  return (
    <svg viewBox="0 0 120 90" className="mx-auto block h-24 w-full" role="img" aria-label={`${misses} of ${MAX_MISSES} misses`}>
      <line x1="10" y1="14" x2="110" y2="14" stroke="var(--cab-line)" strokeWidth="3" />
      <line
        x1="60"
        y1="14"
        x2="60"
        y2={20 + drop}
        stroke={misses >= MAX_MISSES ? 'var(--neon-red)' : color}
        strokeWidth="2"
        strokeDasharray="4 3"
      />
      <g transform={`translate(60, ${26 + drop})`} fill="none" stroke={misses >= MAX_MISSES ? 'var(--neon-red)' : color} strokeWidth="2.4" strokeLinecap="round">
        <circle cx="0" cy="-6" r="3.4" />
        <line x1="0" y1="-2" x2="0" y2="14" />
        <line x1="-7" y1="2" x2="7" y2="2" />
        <path d="M-10 8 q0 10 10 10 q10 0 10 -10" />
      </g>
      <line x1="0" y1="82" x2="120" y2="82" stroke="#123049" strokeWidth="8" />
      {misses >= MAX_MISSES && (
        <text x="60" y="76" textAnchor="middle" fontSize="9" fill="var(--neon-red)">
          SPLASH
        </text>
      )}
    </svg>
  );
}
