/**
 * Whack-a-Crab.
 *
 * Crabs pop out of the holes and want hitting. Crewmates also pop out of the
 * holes and very much do not — that's the whole game, and it's the reason
 * this cabinet needs the avatars: a generic "don't hit the blue one" is a
 * reflex test, whereas "don't hit your sister" is a family game.
 *
 * Timed, ninety seconds, with pop-ups getting faster and briefer throughout.
 */

import { useEffect, useRef, useState } from 'react';
import { useCountdown } from '../../../lib/arcade/loop';
import { CrewAvatar } from '../../../ui/CrewAvatar';
import { sfx } from '../../../lib/arcade/sound';
import { hueColor } from '../../../lib/arcade/catalog';
import { rngFromString, randInt } from '../../../lib/arcade/rng';
import { Board, StatusRow } from '../shared';
import type { GameProps } from '../shared';

const HOLES = 9;
const ROUND_SECONDS = 60;

type Occupant =
  | { kind: 'none' }
  | { kind: 'crab'; golden: boolean; until: number }
  | { kind: 'crew'; memberId: string; until: number };

export default function WhackACrab({ run, content }: GameProps) {
  const color = hueColor(run.game.hue);
  const [holes, setHoles] = useState<Occupant[]>(() => Array(HOLES).fill({ kind: 'none' }));
  const [struck, setStruck] = useState<{ hole: number; good: boolean } | null>(null);
  const [remaining, setRemaining] = useState(ROUND_SECONDS);
  const crew = content.crew;
  const rngRef = useRef(rngFromString(`whack-${run.nonce}`));
  const hitsRef = useRef(0);
  const missesRef = useRef(0);
  const elapsedRef = useRef(0);

  useCountdown(
    ROUND_SECONDS,
    run.phase === 'playing',
    (r) => {
      setRemaining(r);
      elapsedRef.current = ROUND_SECONDS - r;
      run.setStatus(`${r}s · ${hitsRef.current} hits`);
    },
    () => run.end(),
  );

  // The spawner. An interval rather than a frame loop: nothing here moves,
  // things simply appear and disappear, and 120ms of granularity is plenty.
  useEffect(() => {
    if (run.phase !== 'playing') return;
    const id = window.setInterval(() => {
      const rng = rngRef.current;
      const now = Date.now();
      setHoles((prev) => {
        const next = prev.slice();
        for (let i = 0; i < next.length; i++) {
          const cell = next[i];
          if (cell.kind !== 'none' && cell.until <= now) next[i] = { kind: 'none' };
        }
        // Difficulty: more simultaneous pop-ups and shorter windows as the
        // round runs down.
        const progress = elapsedRef.current / ROUND_SECONDS;
        const wanted = 1 + Math.floor(progress * 2.6);
        const showing = next.filter((h) => h.kind !== 'none').length;
        if (showing < wanted) {
          const free = next
            .map((h, i) => (h.kind === 'none' ? i : -1))
            .filter((i) => i >= 0);
          if (free.length) {
            const slot = free[randInt(rng, 0, free.length - 1)];
            const lifetime = Math.max(520, 1250 - progress * 700);
            // A crewmate appears about a third of the time — often enough to
            // punish spraying, rarely enough that the game is still a game.
            const asCrew = crew.length > 0 && rng() < 0.32;
            next[slot] = asCrew
              ? {
                  kind: 'crew',
                  memberId: crew[randInt(rng, 0, crew.length - 1)].id,
                  until: now + lifetime,
                }
              : { kind: 'crab', golden: rng() < 0.12, until: now + lifetime };
          }
        }
        return next;
      });
    }, 130);
    return () => window.clearInterval(id);
  }, [run.phase, crew]);

  const whack = (index: number) => {
    if (run.phase !== 'playing') return;
    const cell = holes[index];
    if (cell.kind === 'none') return;

    setHoles((prev) => {
      const next = prev.slice();
      next[index] = { kind: 'none' };
      return next;
    });

    if (cell.kind === 'crab') {
      hitsRef.current += 1;
      run.addScore(cell.golden ? 5 : 1);
      setStruck({ hole: index, good: true });
      if (cell.golden) sfx.coin();
      else sfx.hit();
    } else {
      missesRef.current += 1;
      // A crewmate costs points but never ends the run: this is a party
      // cabinet, and a hard fail on a mis-tap would just make people stop.
      run.addScore(-3);
      setStruck({ hole: index, good: false });
      sfx.wrong();
    }
    window.setTimeout(() => setStruck(null), 220);
  };

  return (
    <Board>
      <StatusRow
        left={`${hitsRef.current} crabs · ${missesRef.current} oops`}
        right={`${remaining}s`}
      />
      <div className="grid grid-cols-3 gap-2">
        {holes.map((cell, i) => {
          const flash = struck?.hole === i;
          const member = cell.kind === 'crew' ? crew.find((c) => c.id === cell.memberId) : null;
          return (
            <button
              key={i}
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                whack(i);
              }}
              aria-label={
                cell.kind === 'crab'
                  ? 'A crab'
                  : cell.kind === 'crew'
                  ? `${member?.name ?? 'A crewmate'} — do not whack`
                  : 'Empty hole'
              }
              className={`relative grid aspect-square touch-none place-items-center overflow-hidden rounded-full border ${
                flash ? 'shake' : ''
              }`}
              style={{
                borderColor: flash
                  ? struck?.good
                    ? 'var(--neon-lime)'
                    : 'var(--neon-red)'
                  : 'var(--cab-line)',
                background:
                  'radial-gradient(circle at 50% 30%, rgba(255,255,255,0.06), rgba(4,1,11,0.9))',
              }}
            >
              {cell.kind === 'crab' && (
                <span
                  className="pop-in text-3xl"
                  style={{ filter: cell.golden ? 'drop-shadow(0 0 8px #ffd21e)' : undefined }}
                >
                  {cell.golden ? '🦞' : '🦀'}
                </span>
              )}
              {cell.kind === 'crew' && member && (
                <span className="pop-in grid place-items-center">
                  {member.spec ? (
                    <CrewAvatar spec={member.spec} size={48} alt={member.name} />
                  ) : (
                    <span className="grid h-12 w-12 place-items-center rounded-full bg-white/20 text-sm font-bold">
                      {member.name.charAt(0)}
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-center text-[9px] uppercase tracking-widest" style={{ color }}>
        🦞 golden crab = 5 · 🦀 crab = 1 · crewmate = −3
      </p>
    </Board>
  );
}
