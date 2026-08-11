/**
 * The cabinet a game is bolted into.
 *
 * Owns everything that isn't the game itself: the marquee, the score/hi/lives
 * strip, the attract screen, pause, and the game-over card with whatever the
 * run was worth. Twenty games therefore contain zero chrome, zero scoring UI
 * and zero navigation — they render a play field and call `run.end()`.
 *
 * Children are only *mounted* while a run is live, keyed on `run.nonce`, so
 * every game gets a genuinely fresh mount on PLAY AGAIN. That single line is
 * what saves twenty separate reset functions from having to be correct.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Pause, Play, Volume2, VolumeX, Trophy } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../lib/db';
import { useSession } from '../../state/session';
import { hueColor } from '../../lib/arcade/catalog';
import { highScores } from '../../lib/arcade/score';
import { isMuted, setMuted, sfx } from '../../lib/arcade/sound';
import { useArcadeRoom } from '../../lib/arcade/room';
import type { ArcadeRun } from '../../lib/arcade/run';
import { ArcadeButton } from './ArcadeButton';
import { CrewAvatar } from '../CrewAvatar';

export function GameShell({ run, children }: { run: ArcadeRun; children: ReactNode }) {
  const navigate = useNavigate();
  const { game } = run;
  const color = hueColor(game.hue);
  const active = run.phase === 'playing' || run.phase === 'paused';
  useArcadeRoom();

  // Pause rather than keep simulating when the phone locks or the player
  // switches apps: an unattended game quietly losing all three lives in a
  // pocket is the worst possible surprise on return.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') run.pause();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [run]);

  return (
    // A cabinet is exactly as tall as the screen it's standing in. `h-dvh`
    // and a flex column, rather than `min-h-dvh` and stacked blocks: the play
    // field has to be told how much room is left over after the marquee, the
    // score strip and the controls, or a tall board simply runs off the
    // bottom of the phone with no way to scroll to it.
    <div className="arcade arcade-bg flex h-dvh flex-col overflow-hidden">
      <div className="shrink-0 px-3 pt-[max(env(safe-area-inset-top),0.5rem)]">
        <TopBar
          title={game.title}
          color={color}
          onBack={() => navigate('/arcade')}
          run={run}
        />
        <ScoreStrip run={run} color={color} />
      </div>

      <div className="crt cab-panel relative mx-3 mb-[max(env(safe-area-inset-bottom),0.75rem)] mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl">
        {active ? (
          <div key={run.nonce} className="flex min-h-0 flex-1 flex-col">
            {children}
          </div>
        ) : (
          <div className="flex-1" />
        )}

        {run.phase === 'attract' && <AttractScreen run={run} color={color} />}
        {run.phase === 'paused' && <PauseScreen run={run} color={color} />}
        {run.phase === 'over' && <GameOverScreen run={run} color={color} />}
      </div>
    </div>
  );
}

function TopBar({
  title,
  color,
  onBack,
  run,
}: {
  title: string;
  color: string;
  onBack: () => void;
  run: ArcadeRun;
}) {
  const [muted, setMutedState] = useState(isMuted());
  return (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to the arcade"
        className="grid h-9 w-9 place-items-center rounded-md border"
        style={{ color, borderColor: 'var(--cab-line)' }}
      >
        <ChevronLeft size={18} />
      </button>

      <h1
        className="flicker neon truncate text-center text-sm font-bold uppercase tracking-[0.2em]"
        style={{ color }}
      >
        {title}
      </h1>

      <div className="flex items-center gap-1.5">
        {(run.phase === 'playing' || run.phase === 'paused') && (
          <button
            type="button"
            onClick={() => (run.phase === 'playing' ? run.pause() : run.resume())}
            aria-label={run.phase === 'playing' ? 'Pause' : 'Resume'}
            className="grid h-9 w-9 place-items-center rounded-md border"
            style={{ color: 'var(--neon-gold)', borderColor: 'var(--cab-line)' }}
          >
            {run.phase === 'playing' ? <Pause size={16} /> : <Play size={16} />}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            const next = !muted;
            setMuted(next);
            setMutedState(next);
            if (!next) sfx.blip();
          }}
          aria-label={muted ? 'Unmute the cabinet' : 'Mute the cabinet'}
          className="grid h-9 w-9 place-items-center rounded-md border"
          style={{ color: 'var(--cab-dim)', borderColor: 'var(--cab-line)' }}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      </div>
    </div>
  );
}

function ScoreStrip({ run, color }: { run: ArcadeRun; color: string }) {
  return (
    <div className="mt-2 flex items-end justify-between gap-2 px-1 text-[10px] uppercase tracking-[0.18em]">
      <div>
        <div style={{ color: 'var(--cab-dim)' }}>Score</div>
        <div className="tabular text-lg font-bold leading-none" style={{ color }}>
          {run.score.toLocaleString()}
        </div>
      </div>
      <div className="min-w-0 flex-1 text-center" style={{ color: 'var(--neon-gold)' }}>
        {run.status && <span className="truncate">{run.status}</span>}
      </div>
      <div className="text-right">
        <div style={{ color: 'var(--cab-dim)' }}>Your best</div>
        <div className="tabular text-lg font-bold leading-none" style={{ color: 'var(--neon-gold)' }}>
          {Math.max(run.best, run.score).toLocaleString()}
        </div>
      </div>
    </div>
  );
}

/**
 * Lives, drawn as pips. Games that don't use lives simply never call
 * `setLives`, and this stays out of their way at three.
 */
export function LivesRow({ lives, color }: { lives: number; color: string }) {
  return (
    <div className="flex items-center gap-1" aria-label={`${lives} lives left`}>
      {Array.from({ length: Math.max(0, lives) }, (_, i) => (
        <span
          key={i}
          className="inline-block h-2.5 w-2.5 rounded-sm"
          style={{ background: color, boxShadow: `0 0 8px ${color}` }}
        />
      ))}
    </div>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto bg-[rgba(6,1,15,0.88)] px-5 py-4 text-center">
      <div className="pop-in my-auto w-full">{children}</div>
    </div>
  );
}

function AttractScreen({ run, color }: { run: ArcadeRun; color: string }) {
  const { game } = run;
  return (
    <Overlay>
      <div className="mb-1 text-4xl">{game.glyph}</div>
      <h2 className="neon text-xl font-bold uppercase tracking-[0.18em]" style={{ color }}>
        {game.title}
      </h2>
      <p className="mx-auto mt-2 max-w-[16rem] text-[11px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
        {game.tagline}
      </p>

      <CabinetTop gameId={game.id} />

      <p className="mx-auto mt-4 max-w-[17rem] text-[10px] leading-relaxed uppercase tracking-wider" style={{ color: 'var(--neon-cyan)' }}>
        {game.controls}
      </p>

      <div className="mt-5">
        <ArcadeButton color={color} onClick={run.start} silent>
          Press start
        </ArcadeButton>
      </div>
      <div className="blink mt-3 text-[10px] uppercase tracking-[0.3em]" style={{ color: 'var(--neon-gold)' }}>
        Insert coin
      </div>
      <p className="mt-4 text-[9px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
        {run.earnedToday >= run.dailyCap
          ? 'Daily points maxed — play on for the high score'
          : `${run.dailyCap - run.earnedToday} arcade points still available today`}
      </p>
    </Overlay>
  );
}

/** The three names to beat on this cabinet. */
function CabinetTop({ gameId }: { gameId: string }) {
  const completions = useLiveQuery(() => db.completions.toArray(), []) ?? [];
  const profiles = useLiveQuery(() => db.profiles.toArray(), []) ?? [];
  const specs = useLiveQuery(() => db.avatarSpecs.toArray(), []) ?? [];
  const top = highScores(completions, gameId).slice(0, 3);
  if (!top.length) return null;

  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.displayName ?? '???';
  const specOf = (id: string) => specs.find((s) => s.memberId === id) ?? null;

  return (
    <div className="mx-auto mt-4 w-full max-w-[15rem]">
      <div className="mb-1.5 text-[9px] uppercase tracking-[0.3em]" style={{ color: 'var(--cab-dim)' }}>
        High scores
      </div>
      <ol className="space-y-1">
        {top.map((entry, i) => {
          const spec = specOf(entry.member);
          return (
            <li key={entry.member} className="flex items-center gap-2 text-[11px]">
              <span className="w-4 text-left" style={{ color: 'var(--neon-gold)' }}>
                {i + 1}
              </span>
              {spec ? (
                <CrewAvatar spec={spec} size={18} />
              ) : (
                <span className="inline-block h-[18px] w-[18px] rounded-full bg-white/20" />
              )}
              <span className="min-w-0 flex-1 truncate text-left">{nameOf(entry.member)}</span>
              <span className="tabular font-bold" style={{ color: 'var(--neon-cyan)' }}>
                {entry.score.toLocaleString()}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PauseScreen({ run, color }: { run: ArcadeRun; color: string }) {
  return (
    <Overlay>
      <div className="neon text-lg font-bold uppercase tracking-[0.3em]" style={{ color }}>
        Paused
      </div>
      <div className="mt-5 flex flex-col items-center gap-2">
        <ArcadeButton color={color} onClick={run.resume}>
          Resume
        </ArcadeButton>
        <ArcadeButton color="var(--neon-red)" onClick={() => run.end()}>
          End run
        </ArcadeButton>
      </div>
    </Overlay>
  );
}

function GameOverScreen({ run, color }: { run: ArcadeRun; color: string }) {
  const navigate = useNavigate();
  const memberId = useSession((s) => s.identity);
  const result = run.result;

  return (
    <Overlay>
      <div className="text-lg font-bold uppercase tracking-[0.3em]" style={{ color: 'var(--neon-red)' }}>
        Game over
      </div>

      <div className="tabular mt-4 text-4xl font-bold" style={{ color }}>
        {run.score.toLocaleString()}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.2em]" style={{ color: 'var(--cab-dim)' }}>
        Final score
      </div>

      {result?.record && (
        <div
          className="neon mt-4 text-sm font-bold uppercase tracking-[0.2em]"
          style={{ color: 'var(--neon-gold)' }}
        >
          ★ New personal best ★
        </div>
      )}

      {result && !result.record && result.previousBest > 0 && (
        <div className="mt-3 text-[10px] uppercase tracking-wider" style={{ color: 'var(--cab-dim)' }}>
          Your best is {result.previousBest.toLocaleString()}
        </div>
      )}

      {result && result.points > 0 && (
        <div className="mt-3 text-xs font-bold" style={{ color: 'var(--neon-lime)' }}>
          +{result.points} trip points
        </div>
      )}
      {result && result.points === 0 && result.cappedByDay && (
        <div className="mt-3 text-[10px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
          Daily arcade points are maxed out — the high score still counts.
        </div>
      )}
      {!memberId && (
        <div className="mt-3 text-[10px]" style={{ color: 'var(--cab-dim)' }}>
          Not signed in — this run was not recorded.
        </div>
      )}

      <div className="mt-6 flex flex-col items-center gap-2">
        <ArcadeButton color={color} onClick={run.start} silent>
          Play again
        </ArcadeButton>
        <div className="flex gap-2">
          <ArcadeButton color="var(--neon-violet)" onClick={() => navigate('/arcade/leaderboard')} icon={<Trophy size={13} />}>
            Scores
          </ArcadeButton>
          <ArcadeButton color="var(--cab-dim)" onClick={() => navigate('/arcade')}>
            Exit
          </ArcadeButton>
        </div>
      </div>
    </Overlay>
  );
}
