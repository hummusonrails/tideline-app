/**
 * The Dial — one person can see the target on the spectrum, everyone else has
 * to read their mind through a single clue.
 *
 * The target is generated once per round and stays hidden behind the pass —
 * and critically, the dial resets to the middle for the guessers, so the
 * Psychic's own hand position can't leak the answer. Scoring is a band around
 * the target rather than an exact hit, which is what makes "close" feel like
 * an achievement instead of a miss.
 */

import { useMemo, useState } from 'react';
import { BigButton, PassDevice, PrivateBanner, ReadAloud, Scoreboard } from '../../../ui/party/PartyUI';
import { hueColor } from '../../../lib/arcade/catalog';
import { sfx } from '../../../lib/arcade/sound';
import { rngFromString, pick, randInt } from '../../../lib/arcade/rng';
import { SPECTRA } from '../../../lib/party/decks';
import type { PartyGameProps } from '../shared';

type Stage = { s: 'pass' } | { s: 'psychic' } | { s: 'guess' } | { s: 'reveal' };

/** Half-widths of the scoring bands, in dial units. 4 / 3 / 2 points. */
const BANDS = [4, 9, 16];
const BAND_POINTS = [4, 3, 2];

export default function TheDial({ game, session, onFinish }: PartyGameProps) {
  const color = hueColor(game.hue);
  const psychic = session.roleHolder;

  const { spectrum, target } = useMemo(() => {
    const rng = rngFromString(`dial-${session.round}-${session.players.length}`);
    return { spectrum: pick(SPECTRA, rng), target: randInt(rng, 8, 92) };
  }, [session.round, session.players.length]);

  const [stage, setStage] = useState<Stage>({ s: 'pass' });
  const [dial, setDial] = useState(50);

  const distance = Math.abs(dial - target);
  const bandIndex = BANDS.findIndex((b) => distance <= b);
  const points = bandIndex === -1 ? 0 : BAND_POINTS[bandIndex];

  const lockIn = () => {
    // The Psychic scores with the team: the clue is half the work, and a
    // Psychic who scores nothing has no reason to try hard.
    for (const player of session.players) session.addScore(player.id, points);
    if (points === 4) sfx.record();
    else if (points > 0) sfx.right();
    else sfx.wrong();
    setStage({ s: 'reveal' });
  };

  const nextRound = () => {
    setDial(50);
    session.nextRound();
    setStage({ s: 'pass' });
  };

  return (
    <div className="space-y-4">
      <Scoreboard standings={session.standings} highlight={psychic.id} color={color} />

      {stage.s === 'pass' && (
        <PassDevice
          to={psychic}
          color={color}
          note="You are the Psychic. Nobody else looks at this screen."
          onReady={() => setStage({ s: 'psychic' })}
        />
      )}

      {stage.s === 'psychic' && (
        <>
          <PrivateBanner name={psychic.name} />
          <Dial spectrum={spectrum} value={target} target={target} showTarget color={color} readOnly />
          <ReadAloud color={color} label="Say one clue out loud">
            Something that sits exactly there on this scale. No numbers, no “left”
            or “right”, no pointing.
          </ReadAloud>
          <BigButton color={color} onClick={() => setStage({ s: 'guess' })}>
            Clue given — hide the target
          </BigButton>
        </>
      )}

      {stage.s === 'guess' && (
        <>
          <div className="text-center text-[11px] uppercase tracking-[0.2em]" style={{ color }}>
            Everyone else: argue, then set the dial
          </div>
          <Dial
            spectrum={spectrum}
            value={dial}
            target={target}
            showTarget={false}
            color={color}
            onChange={setDial}
          />
          <BigButton color={color} onClick={lockIn}>
            Lock it in
          </BigButton>
        </>
      )}

      {stage.s === 'reveal' && (
        <>
          <Dial spectrum={spectrum} value={dial} target={target} showTarget color={color} readOnly />
          <div className="text-center">
            <div
              className="neon text-3xl font-bold"
              style={{ color: points > 0 ? 'var(--neon-lime)' : 'var(--neon-red)' }}
            >
              {points > 0 ? `+${points}` : 'Miss'}
            </div>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--cab-dim)' }}>
              {distance === 0
                ? 'Dead centre. Genuinely uncanny.'
                : `${distance} off the middle of the target.`}
            </p>
          </div>
          <BigButton color={color} onClick={nextRound}>
            Next Psychic
          </BigButton>
          <BigButton color="var(--cab-dim)" onClick={onFinish}>
            End the game
          </BigButton>
        </>
      )}
    </div>
  );
}

function Dial({
  spectrum,
  value,
  target,
  showTarget,
  color,
  onChange,
  readOnly = false,
}: {
  spectrum: { left: string; right: string };
  value: number;
  target: number;
  showTarget: boolean;
  color: string;
  onChange?: (v: number) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--cab-line)' }}>
      <div className="mb-3 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider">
        <span style={{ color: 'var(--neon-cyan)' }}>{spectrum.left}</span>
        <span style={{ color: 'var(--neon-pink)' }}>{spectrum.right}</span>
      </div>

      <div className="relative h-11 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.07)' }}>
        {/* The scoring bands, widest first so the bullseye paints on top. */}
        {showTarget &&
          [2, 1, 0].map((i) => (
            <div
              key={i}
              className="absolute inset-y-0"
              style={{
                left: `${Math.max(0, target - BANDS[i])}%`,
                width: `${Math.min(100, BANDS[i] * 2)}%`,
                background: `color-mix(in srgb, ${color} ${18 + i * 0}%, transparent)`,
                opacity: 0.25 + (2 - i) * 0.25,
              }}
            />
          ))}
        {showTarget && (
          <div
            className="absolute inset-y-0 w-0.5"
            style={{ left: `${target}%`, background: color, boxShadow: `0 0 12px ${color}` }}
          />
        )}
        <div
          className="absolute inset-y-1 w-1.5 rounded-full"
          style={{ left: `calc(${value}% - 3px)`, background: '#ffffff' }}
        />
      </div>

      {!readOnly && onChange && (
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={`Dial between ${spectrum.left} and ${spectrum.right}`}
          className="mt-3 w-full"
          style={{ accentColor: color }}
        />
      )}
      {readOnly && showTarget && (
        <p className="mt-2 text-center text-[9px] uppercase tracking-[0.25em]" style={{ color: 'var(--cab-dim)' }}>
          Target at {target}
        </p>
      )}
    </div>
  );
}
