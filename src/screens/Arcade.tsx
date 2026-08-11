/**
 * The arcade floor.
 *
 * Deliberately not a `Page`: this screen is the moment the app stops being a
 * pale sage travel companion and becomes a dark room with twenty machines in
 * it, and half the effect is that the transition is total. The tab bar stays
 * (you have to be able to leave), everything else is neon.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Trophy, Volume2, VolumeX } from 'lucide-react';
import { db } from '../lib/db';
import { useSession } from '../state/session';
import { GAMES, CATEGORY_LABEL, type ArcadeCategory } from '../lib/arcade/catalog';
import {
  arcadeStandings,
  cabinetRecord,
  personalBest,
  pointsEarnedToday,
  totalRuns,
  ARCADE_POINTS_PER_DAY,
} from '../lib/arcade/score';
import { isMuted, setMuted, sfx } from '../lib/arcade/sound';
import { todayYMD } from '../lib/time';
import { useArcadeContent } from '../lib/arcade/content';
import { useArcadeRoom } from '../lib/arcade/room';
import { Cabinet } from '../ui/arcade/Cabinet';
import { CrewAvatar } from '../ui/CrewAvatar';

type Filter = 'all' | ArcadeCategory;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'action', label: CATEGORY_LABEL.action },
  { id: 'puzzle', label: CATEGORY_LABEL.puzzle },
  { id: 'word', label: CATEGORY_LABEL.word },
  { id: 'crew', label: CATEGORY_LABEL.crew },
];

export function Arcade() {
  const memberId = useSession((s) => s.identity);
  const completions = useLiveQuery(() => db.completions.toArray(), []) ?? [];
  const profiles = useLiveQuery(() => db.profiles.toArray(), []) ?? [];
  const content = useArcadeContent();
  const [filter, setFilter] = useState<Filter>('all');
  const [muted, setMutedState] = useState(isMuted());
  const today = todayYMD();
  useArcadeRoom();

  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.displayName ?? null;

  const standings = useMemo(
    () => arcadeStandings(completions, profiles.map((p) => p.id)),
    [completions, profiles],
  );
  const mine = standings.find((s) => s.member === memberId);
  const earnedToday = memberId ? pointsEarnedToday(completions, memberId, today) : 0;

  const games = filter === 'all' ? GAMES : GAMES.filter((g) => g.category === filter);

  return (
    <div className="arcade arcade-bg arcade-grid relative min-h-dvh overflow-hidden">

      <div className="relative px-4 pt-[max(env(safe-area-inset-top),1rem)]">
        {/* ---- marquee ---- */}
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-[0.42em]" style={{ color: 'var(--neon-cyan)' }}>
              Now playing
            </div>
            <h1
              className="flicker neon mt-1 text-[26px] font-bold uppercase leading-none tracking-[0.12em]"
              style={{ color: 'var(--neon-pink)' }}
            >
              Tideline
            </h1>
            <h2
              className="neon text-[26px] font-bold uppercase leading-none tracking-[0.28em]"
              style={{ color: 'var(--neon-gold)' }}
            >
              Arcade
            </h2>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !muted;
              setMuted(next);
              setMutedState(next);
              if (!next) sfx.coin();
            }}
            aria-label={muted ? 'Unmute the arcade' : 'Mute the arcade'}
            className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-md border"
            style={{ color: 'var(--cab-dim)', borderColor: 'var(--cab-line)' }}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </header>

        <div className="mt-3 overflow-hidden">
          <p
            className="attract-scroll text-[10px] uppercase tracking-[0.25em]"
            style={{ color: 'var(--neon-lime)' }}
          >
            ★ {GAMES.length} machines ★ {totalRuns(completions).toLocaleString()} credits played ★{' '}
            {content.personalised
              ? 'now featuring your trip, your crew and your avatars'
              : 'sync the trip to load the family cabinets'}{' '}
            ★ beat the house record ★
          </p>
        </div>

        {/* ---- your card ---- */}
        <div className="cab-panel mt-4 rounded-xl p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[9px] uppercase tracking-[0.3em]" style={{ color: 'var(--cab-dim)' }}>
                Your rating
              </div>
              <div className="tabular text-2xl font-bold leading-none" style={{ color: 'var(--neon-cyan)' }}>
                {(mine?.rating ?? 0).toLocaleString()}
                <span className="text-[10px] font-normal" style={{ color: 'var(--cab-dim)' }}>
                  {' '}
                  / {GAMES.length * 100}
                </span>
              </div>
              <div className="mt-1.5 text-[9px] uppercase tracking-wider" style={{ color: 'var(--cab-dim)' }}>
                {mine?.played ?? 0}/{GAMES.length} played · {mine?.crowns ?? 0} record
                {(mine?.crowns ?? 0) === 1 ? '' : 's'} held
              </div>
            </div>
            <Link
              to="/arcade/leaderboard"
              onClick={() => sfx.select()}
              className="arcade-btn shrink-0 text-[10px] font-bold"
              style={{ color: 'var(--neon-gold)' }}
            >
              <Trophy size={13} className="mr-1.5 inline" />
              Scores
            </Link>
          </div>

          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-[9px] uppercase tracking-wider" style={{ color: 'var(--cab-dim)' }}>
              <span>Arcade points today</span>
              <span className="tabular">
                {earnedToday} / {ARCADE_POINTS_PER_DAY}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, (earnedToday / ARCADE_POINTS_PER_DAY) * 100)}%`,
                  background: 'var(--neon-lime)',
                  boxShadow: '0 0 10px var(--neon-lime)',
                }}
              />
            </div>
          </div>
        </div>

        {/* ---- crew strip ---- */}
        {content.crew.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-[9px] uppercase tracking-[0.3em]" style={{ color: 'var(--cab-dim)' }}>
              On the floor
            </div>
            <div className="scroll-clean flex gap-3 overflow-x-auto pb-1">
              {standings.map((s) => {
                const member = content.crew.find((c) => c.id === s.member);
                if (!member) return null;
                return (
                  <div key={s.member} className="w-14 shrink-0 text-center">
                    {member.spec ? (
                      <CrewAvatar spec={member.spec} size={44} />
                    ) : (
                      <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-white/15 text-xs">
                        {member.name.charAt(0)}
                      </div>
                    )}
                    <div className="mt-1 truncate text-[9px]" style={{ color: 'var(--cab-text)' }}>
                      {member.name}
                    </div>
                    <div className="tabular text-[9px] font-bold" style={{ color: 'var(--neon-cyan)' }}>
                      {s.rating}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ---- filters ---- */}
        <div className="scroll-clean mt-4 flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                sfx.blip();
                setFilter(f.id);
              }}
              className="arcade-btn shrink-0 px-3 py-1.5 text-[10px] font-bold"
              style={{
                color: filter === f.id ? 'var(--neon-pink)' : 'var(--cab-dim)',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* ---- the floor ---- */}
        <ul className="mt-3 grid grid-cols-2 gap-2.5 pb-32">
          {games.map((game) => {
            const top = cabinetRecord(completions, game.id);
            return (
              <li key={game.id}>
                <Cabinet
                  game={game}
                  yourBest={memberId ? personalBest(completions, memberId, game.id) : 0}
                  topScore={top?.score ?? 0}
                  topName={top ? nameOf(top.member) : null}
                  youHoldIt={!!top && top.member === memberId}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
