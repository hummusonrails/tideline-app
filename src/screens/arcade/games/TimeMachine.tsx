/**
 * Time Machine — put the trip back in order.
 *
 * Six itinerary moments, shuffled, and you drag them back into sequence
 * against a clock. It's the only cabinet that's *purely* the trip: with
 * nothing synced it falls back to a generic travel-day sequence, which works
 * but is plainly the understudy.
 *
 * Swap-by-tapping rather than drag-and-drop: dragging list items on a phone
 * inside a scrolling page is a fight, and two taps is unambiguous.
 */

import { useMemo, useRef, useState } from 'react';
import { hueColor } from '../../../lib/arcade/catalog';
import { sfx } from '../../../lib/arcade/sound';
import { rngFromString, shuffle, sample } from '../../../lib/arcade/rng';
import { useCountdown } from '../../../lib/arcade/loop';
import { prettyDate } from '../../../lib/time';
import { Board, StatusRow } from '../shared';
import type { Highlight } from '../../../lib/arcade/content';
import type { GameProps } from '../shared';

const CARDS = 6;
const ROUND_SECONDS = 120;

const FALLBACK: Highlight[] = [
  { id: 'f1', title: 'Pack the bags', date: '', glyph: '🧳', sortKey: '1' },
  { id: 'f2', title: 'Leave for the airport', date: '', glyph: '🚗', sortKey: '2' },
  { id: 'f3', title: 'Board the plane', date: '', glyph: '✈️', sortKey: '3' },
  { id: 'f4', title: 'Land somewhere new', date: '', glyph: '📍', sortKey: '4' },
  { id: 'f5', title: 'Find the hotel', date: '', glyph: '🛏️', sortKey: '5' },
  { id: 'f6', title: 'First proper meal', date: '', glyph: '🍽️', sortKey: '6' },
];

export default function TimeMachine({ run, content }: GameProps) {
  const color = hueColor(run.game.hue);
  const rng = useMemo(() => rngFromString(`time-${run.nonce}`), [run.nonce]);

  /** The correct order, and the shuffled order the player starts from. */
  const { solution, start } = useMemo(() => {
    const pool = content.highlights.length >= CARDS ? content.highlights : FALLBACK;
    // A contiguous window rather than a random spread: consecutive events are
    // genuinely harder to order than six days drawn from across a fortnight.
    const windowStart =
      pool.length > CARDS ? Math.floor(rng() * (pool.length - CARDS)) : 0;
    const chosen =
      pool.length > CARDS ? pool.slice(windowStart, windowStart + CARDS) : sample(pool, CARDS, rng);
    const ordered = [...chosen].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    let jumbled = shuffle(ordered, rng);
    // A shuffle that happens to be the answer would hand out a free round.
    if (jumbled.every((c, i) => c.id === ordered[i].id)) jumbled = [...jumbled].reverse();
    return { solution: ordered, start: jumbled };
  }, [content.highlights, rng]);

  const [order, setOrder] = useState<Highlight[]>(start);
  const [selected, setSelected] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [rounds, setRounds] = useState(0);
  const [remaining, setRemaining] = useState(ROUND_SECONDS);
  const remainingRef = useRef(ROUND_SECONDS);

  useCountdown(
    ROUND_SECONDS,
    run.phase === 'playing',
    (r) => {
      setRemaining(r);
      remainingRef.current = r;
      run.setStatus(`${r}s`);
    },
    () => run.end(),
  );

  const tap = (index: number) => {
    if (run.phase !== 'playing' || locked) return;
    if (selected === null) {
      setSelected(index);
      sfx.blip();
      return;
    }
    if (selected === index) {
      setSelected(null);
      return;
    }
    setOrder((prev) => {
      const next = prev.slice();
      [next[selected], next[index]] = [next[index], next[selected]];
      return next;
    });
    setSelected(null);
    sfx.select();
  };

  const lockIn = () => {
    if (run.phase !== 'playing' || locked) return;
    setLocked(true);
    const rightCount = order.filter((card, i) => card.id === solution[i].id).length;
    const perfect = rightCount === solution.length;
    run.addScore(rightCount * 40 + (perfect ? 200 + remainingRef.current * 2 : 0));
    if (perfect) sfx.levelUp();
    else sfx.wrong();

    window.setTimeout(() => {
      if (!perfect) {
        // Getting it wrong ends the run — otherwise the optimal strategy is to
        // brute-force the permutations, which is not a game.
        run.end();
        return;
      }
      setRounds((r) => r + 1);
      setLocked(false);
      setOrder(shuffle(solution, rngFromString(`time-${run.nonce}-${rounds + 1}`)));
    }, 1900);
  };

  return (
    <Board>
      <StatusRow left={`Round ${rounds + 1} · earliest at the top`} right={`${remaining}s`} />

      <ol className="space-y-1.5">
        {order.map((card, i) => {
          const isRight = locked && card.id === solution[i].id;
          const isWrong = locked && card.id !== solution[i].id;
          return (
            <li key={card.id}>
              <button
                type="button"
                onClick={() => tap(i)}
                disabled={locked}
                className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition ${
                  selected === i ? 'scale-[0.98]' : ''
                }`}
                style={{
                  borderColor: isRight
                    ? 'var(--neon-lime)'
                    : isWrong
                    ? 'var(--neon-red)'
                    : selected === i
                    ? color
                    : 'var(--cab-line)',
                  background: selected === i ? `${color}22` : 'rgba(255,255,255,0.04)',
                }}
              >
                <span className="tabular w-4 text-[10px]" style={{ color: 'var(--cab-dim)' }}>
                  {i + 1}
                </span>
                <span className="text-lg" aria-hidden>
                  {card.glyph}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-bold leading-tight">
                    {card.title}
                  </span>
                  {locked && card.date && (
                    <span className="block text-[9px]" style={{ color: 'var(--cab-dim)' }}>
                      {prettyDate(card.date)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        onClick={lockIn}
        disabled={locked}
        className="arcade-btn mt-4 w-full py-2.5 text-[11px] font-bold disabled:opacity-40"
        style={{ color }}
      >
        {locked ? 'Checking…' : 'Lock it in'}
      </button>

      <p className="mt-2 text-center text-[9px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
        Tap two cards to swap them. Every card in the right place pays; a perfect
        order banks the clock and deals another round.
      </p>
    </Board>
  );
}
