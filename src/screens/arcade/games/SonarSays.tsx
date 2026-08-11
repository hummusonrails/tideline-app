/**
 * Sonar Says — the memory game with four pads.
 *
 * Each pad belongs to a crewmate, so the sequence you're memorising is a
 * sequence of people. That turns an abstract colour test into something the
 * table can shout about, which is the only reason this cabinet earns a slot.
 *
 * The sequence grows by one every round and is always replayed from the
 * start, which is what makes round twelve hard rather than just long.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { CrewAvatar } from '../../../ui/CrewAvatar';
import { tone, sfx } from '../../../lib/arcade/sound';
import { hueColor } from '../../../lib/arcade/catalog';
import { Board, StatusRow } from '../shared';
import type { GameProps } from '../shared';

/** One note per pad, a pentatonic-ish set so any sequence sounds deliberate. */
const PAD_TONES = [329.6, 392.0, 493.9, 587.3];
const PAD_COLORS = ['#ff2f5e', '#ffd21e', '#21e6ff', '#7cff4d'];
const PAD_NAMES = ['Red', 'Gold', 'Cyan', 'Lime'];

type Mode = 'watch' | 'repeat' | 'wrong';

export default function SonarSays({ run, content }: GameProps) {
  const color = hueColor(run.game.hue);
  const [sequence, setSequence] = useState<number[]>([]);
  const [lit, setLit] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('watch');
  const inputRef = useRef(0);
  const timersRef = useRef<number[]>([]);

  // Four pads, each fronted by a crewmate when the roster allows.
  const pads = useMemo(
    () =>
      Array.from({ length: 4 }, (_, i) => ({
        index: i,
        member: content.crew[i % Math.max(1, content.crew.length)] ?? null,
      })),
    [content.crew],
  );

  const clearTimers = () => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  };

  // Kick off the first round, and every round after, by extending the
  // sequence — the playback effect below reacts to the change.
  useEffect(() => {
    if (run.phase !== 'playing') return;
    if (sequence.length === 0) setSequence([Math.floor(Math.random() * 4)]);
  }, [run.phase, sequence.length]);

  useEffect(() => {
    if (run.phase !== 'playing' || sequence.length === 0 || mode !== 'watch') return;
    clearTimers();
    inputRef.current = 0;
    run.setStatus(`Round ${sequence.length} · watch`);

    // Playback speeds up as the sequence grows, but never past readable.
    const step = Math.max(320, 620 - sequence.length * 22);
    sequence.forEach((pad, i) => {
      timersRef.current.push(
        window.setTimeout(() => {
          setLit(pad);
          tone(PAD_TONES[pad], step * 0.55, 'sine', 0.7);
        }, 500 + i * step),
      );
      timersRef.current.push(
        window.setTimeout(() => setLit(null), 500 + i * step + step * 0.6),
      );
    });
    timersRef.current.push(
      window.setTimeout(() => {
        setMode('repeat');
        run.setStatus(`Round ${sequence.length} · your turn`);
      }, 500 + sequence.length * step),
    );

    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequence, mode, run.phase]);

  useEffect(() => clearTimers, []);

  const tap = (pad: number) => {
    if (run.phase !== 'playing' || mode !== 'repeat') return;
    setLit(pad);
    tone(PAD_TONES[pad], 200, 'sine', 0.7);
    window.setTimeout(() => setLit(null), 170);

    if (sequence[inputRef.current] !== pad) {
      setMode('wrong');
      sfx.wrong();
      // A beat before the game-over card, so the mistake registers as yours.
      window.setTimeout(() => run.end(sequence.length - 1), 700);
      return;
    }

    inputRef.current += 1;
    if (inputRef.current === sequence.length) {
      run.setScore(sequence.length);
      sfx.right();
      window.setTimeout(() => {
        setSequence((prev) => [...prev, Math.floor(Math.random() * 4)]);
        setMode('watch');
      }, 620);
    }
  };

  return (
    <Board>
      <StatusRow
        left={mode === 'watch' ? 'Watch the sequence' : mode === 'repeat' ? 'Your turn' : 'Wrong pad'}
        right={`Round ${Math.max(1, sequence.length)}`}
      />

      <div className="grid grid-cols-2 gap-2.5">
        {pads.map(({ index, member }) => {
          const isLit = lit === index;
          return (
            <button
              key={index}
              type="button"
              disabled={mode !== 'repeat'}
              onPointerDown={(e) => {
                e.preventDefault();
                tap(index);
              }}
              aria-label={member ? `${member.name}'s pad` : `${PAD_NAMES[index]} pad`}
              className="relative grid aspect-square touch-none place-items-center rounded-2xl border-2 transition-all duration-100 disabled:opacity-90"
              style={{
                borderColor: PAD_COLORS[index],
                background: isLit
                  ? PAD_COLORS[index]
                  : `color-mix(in srgb, ${PAD_COLORS[index]} 14%, transparent)`,
                boxShadow: isLit ? `0 0 26px ${PAD_COLORS[index]}` : 'none',
                transform: isLit ? 'scale(0.97)' : 'scale(1)',
              }}
            >
              {member?.spec ? (
                <CrewAvatar spec={member.spec} size={54} alt={member.name} />
              ) : (
                <span
                  className="text-2xl font-bold"
                  style={{ color: isLit ? '#04010b' : PAD_COLORS[index] }}
                >
                  {member?.name.charAt(0) ?? PAD_NAMES[index].charAt(0)}
                </span>
              )}
              {member && (
                <span
                  className="absolute bottom-1.5 text-[9px] uppercase tracking-wider"
                  style={{ color: isLit ? '#04010b' : 'var(--cab-dim)' }}
                >
                  {member.name}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-center text-[9px] uppercase tracking-widest" style={{ color }}>
        {mode === 'watch' ? 'Sonar transmitting…' : 'Repeat it back'}
      </p>
    </Board>
  );
}
