/**
 * The furniture every party game shares.
 *
 * All of it is built around one fact: there is one phone and it is on a table
 * between four to ten people, several of whom are in the back of a car. So
 * everything here is oversized, high contrast, and readable from across a
 * seat — and anything private is behind a deliberate two-tap handover rather
 * than a swipe somebody could do by accident.
 */

import type { ReactNode } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Volume2, VolumeX } from 'lucide-react';
import { CrewAvatar } from '../CrewAvatar';
import { VipAvatar } from './VipAvatar';
import { isMuted, setMuted, sfx } from '../../lib/arcade/sound';
import { hueColor } from '../../lib/arcade/catalog';
import { useArcadeRoom } from '../../lib/arcade/room';
import type { PartyGameDef } from '../../lib/party/catalog';
import type { PartyPlayer } from '../../lib/party/session';

/**
 * One player's face, wherever it appears.
 *
 * Three cases and one component: a crew member with a composed avatar, a
 * guest of honour with a bespoke portrait, and anybody else as an initial.
 * Centralising it is what stopped the VIP portraits having to be threaded
 * through ten games by hand — every scoreboard, picker and handover screen
 * routes through here.
 */
export function PlayerFace({
  player,
  size = 40,
  className = '',
}: {
  player: PartyPlayer;
  size?: number;
  className?: string;
}) {
  if (player.vip) {
    return <VipAvatar portrait={player.vip} size={size} name={player.name} className={className} />;
  }
  if (player.spec) {
    return <CrewAvatar spec={player.spec} size={size} alt={player.name} className={className} />;
  }
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full bg-white/15 font-bold ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.4) }}
      aria-label={player.name}
    >
      {player.name.charAt(0).toUpperCase()}
    </span>
  );
}

/** The dark room the whole party section lives in. */
export function PartyShell({
  game,
  onExit,
  children,
}: {
  game: PartyGameDef;
  onExit?: () => void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const [muted, setMutedState] = useState(isMuted());
  const color = hueColor(game.hue);
  useArcadeRoom();

  return (
    <div className="arcade arcade-bg min-h-dvh">
      <div className="px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
        <header className="mb-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => (onExit ? onExit() : navigate('/party'))}
            aria-label="Leave the game"
            className="grid h-9 w-9 place-items-center rounded-md border"
            style={{ color, borderColor: 'var(--cab-line)' }}
          >
            <ChevronLeft size={18} />
          </button>
          <h1
            className="neon truncate text-sm font-bold uppercase tracking-[0.2em]"
            style={{ color }}
          >
            {game.title}
          </h1>
          <button
            type="button"
            onClick={() => {
              const next = !muted;
              setMuted(next);
              setMutedState(next);
              if (!next) sfx.blip();
            }}
            aria-label={muted ? 'Unmute' : 'Mute'}
            className="grid h-9 w-9 place-items-center rounded-md border"
            style={{ color: 'var(--cab-dim)', borderColor: 'var(--cab-line)' }}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/**
 * A block the host is meant to read out loud.
 *
 * Visually distinct from everything else on purpose: in a game where the
 * phone shows instructions to one person and prompts to the room, the
 * difference between "read this out" and "this is for you" has to be
 * unmissable at a glance.
 */
export function ReadAloud({
  children,
  color = 'var(--neon-gold)',
  label = 'Read this out',
}: {
  children: ReactNode;
  color?: string;
  label?: string;
}) {
  return (
    <div className="rounded-xl border-2 p-4" style={{ borderColor: color }}>
      <div className="mb-2 text-[9px] uppercase tracking-[0.3em]" style={{ color }}>
        📣 {label}
      </div>
      <div className="text-base font-bold leading-relaxed">{children}</div>
    </div>
  );
}

/** A private screen's warning bar — "this is for your eyes only". */
export function PrivateBanner({ name }: { name: string }) {
  return (
    <div
      className="mb-3 rounded-lg border px-3 py-2 text-center text-[10px] uppercase tracking-[0.2em]"
      style={{ borderColor: 'var(--neon-red)', color: 'var(--neon-red)' }}
    >
      🔒 {name} only — nobody else looks
    </div>
  );
}

/**
 * The handover screen.
 *
 * Two taps by design. The first is "I am the person named here", the second
 * only appears once they've confirmed — which stops the phone being passed
 * while a secret is still on screen, and stops the person next to you seeing
 * a role card as the device travels past them.
 */
export function PassDevice({
  to,
  note,
  onReady,
  color = 'var(--neon-cyan)',
  confirm,
}: {
  to: PartyPlayer;
  note?: string;
  onReady: () => void;
  color?: string;
  /** Receipt for whoever just handed the phone on — "Locked in", etc. */
  confirm?: string;
}) {
  return (
    <div className="grid place-items-center py-8 text-center">
      {confirm && (
        <div
          className="pop-in mb-4 rounded-lg border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em]"
          style={{ borderColor: 'var(--neon-lime)', color: 'var(--neon-lime)' }}
        >
          ✓ {confirm}
        </div>
      )}
      <div className="text-[10px] uppercase tracking-[0.3em]" style={{ color: 'var(--cab-dim)' }}>
        Now pass the phone to
      </div>
      <div className="my-5">
        <PlayerFace player={to} size={96} />
      </div>
      <div className="neon text-2xl font-bold uppercase tracking-[0.12em]" style={{ color }}>
        {to.name}
      </div>
      {note && (
        <p className="mx-auto mt-3 max-w-[18rem] text-[11px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
          {note}
        </p>
      )}
      {/* Naming the person on the button is the whole point: it is a claim
          ("I am this person and I am holding the phone"), not an acknowledgement.
          A bare "I have it" leaves everyone wondering what "it" is. */}
      <button
        type="button"
        onClick={() => {
          sfx.select();
          onReady();
        }}
        className="arcade-btn mt-7 px-6 py-3 text-xs font-bold"
        style={{ color }}
      >
        I'm {to.name} — show me
      </button>
      <p className="mt-3 text-[9px] uppercase tracking-[0.2em]" style={{ color: 'var(--cab-dim)' }}>
        Everyone else, look away
      </p>
    </div>
  );
}

/** The running scoreboard, compact enough to sit above a play area. */
export function Scoreboard({
  standings,
  highlight,
  color = 'var(--neon-cyan)',
}: {
  standings: { player: PartyPlayer; score: number; rank: number }[];
  /** Ring this player — the judge, the psychic, whoever's turn it is. */
  highlight?: string;
  color?: string;
}) {
  return (
    <div className="scroll-clean flex gap-2 overflow-x-auto pb-1">
      {standings.map(({ player, score, rank }) => (
        <div
          key={player.id}
          className="w-14 shrink-0 text-center"
          style={{ opacity: highlight && highlight !== player.id ? 0.6 : 1 }}
        >
          <div
            className="mx-auto grid h-11 w-11 place-items-center rounded-full"
            style={{
              boxShadow: highlight === player.id ? `0 0 0 2px ${color}` : undefined,
            }}
          >
            <PlayerFace player={player} size={40} />
          </div>
          <div className="mt-1 truncate text-[9px]">{player.name}</div>
          <div
            className="tabular text-[11px] font-bold"
            style={{ color: rank === 1 && score > 0 ? 'var(--neon-gold)' : color }}
          >
            {score}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A big, unmissable primary action — the only button on most screens. */
export function BigButton({
  children,
  onClick,
  color = 'var(--neon-cyan)',
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  color?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        sfx.select();
        onClick();
      }}
      className="arcade-btn w-full py-3.5 text-sm font-bold disabled:opacity-40"
      style={{ color }}
    >
      {children}
    </button>
  );
}

/** Tap-a-player, used for votes, judging and "who got it right". */
export function PlayerPicker({
  players,
  onPick,
  exclude,
  color = 'var(--neon-cyan)',
  selected,
}: {
  players: PartyPlayer[];
  onPick: (player: PartyPlayer) => void;
  exclude?: string;
  color?: string;
  selected?: string;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {players
        .filter((p) => p.id !== exclude)
        .map((player) => (
          <button
            key={player.id}
            type="button"
            onClick={() => {
              sfx.blip();
              onPick(player);
            }}
            className="grid place-items-center gap-1 rounded-xl border p-2"
            style={{
              borderColor: selected === player.id ? color : 'var(--cab-line)',
              background: selected === player.id ? `${color}22` : 'transparent',
            }}
          >
            <PlayerFace player={player} size={40} />
            <span className="w-full truncate text-center text-[10px]">{player.name}</span>
          </button>
        ))}
    </div>
  );
}
