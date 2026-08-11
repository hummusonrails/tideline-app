/**
 * The high-score board.
 *
 * Two views because there are two honest answers to "who is winning". The
 * OVERALL table ranks by arcade rating — every cabinet scored against its own
 * par and summed — because raw scores across twenty different games aren't
 * comparable and summing them would just crown whoever likes the game with
 * the biggest numbers. The CABINETS view is the classic per-machine table,
 * which is the one people actually argue about.
 */

import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, Crown } from 'lucide-react';
import { db } from '../lib/db';
import { useSession } from '../state/session';
import { GAMES, hueColor } from '../lib/arcade/catalog';
import { arcadeStandings, highScores, ratingFor } from '../lib/arcade/score';
import { sfx } from '../lib/arcade/sound';
import { useArcadeRoom } from '../lib/arcade/room';
import { CrewAvatar } from '../ui/CrewAvatar';
import type { AvatarSpec } from '../types';

type View = 'overall' | 'cabinets';

export function ArcadeLeaderboard() {
  const navigate = useNavigate();
  const me = useSession((s) => s.identity);
  const completions = useLiveQuery(() => db.completions.toArray(), []) ?? [];
  const profiles = useLiveQuery(() => db.profiles.toArray(), []) ?? [];
  const specs = useLiveQuery(() => db.avatarSpecs.toArray(), []) ?? [];
  const [view, setView] = useState<View>('overall');
  useArcadeRoom();

  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.displayName ?? '???';
  const specOf = (id: string): AvatarSpec | null =>
    specs.find((s) => s.memberId === id) ?? null;

  const standings = useMemo(
    () => arcadeStandings(completions, profiles.map((p) => p.id)),
    [completions, profiles],
  );

  return (
    <div className="arcade arcade-bg arcade-grid relative min-h-dvh overflow-hidden">

      <div className="relative px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-32">
        <header className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/arcade')}
            aria-label="Back to the arcade"
            className="grid h-9 w-9 place-items-center rounded-md border"
            style={{ color: 'var(--neon-cyan)', borderColor: 'var(--cab-line)' }}
          >
            <ChevronLeft size={18} />
          </button>
          <h1
            className="flicker neon text-lg font-bold uppercase tracking-[0.25em]"
            style={{ color: 'var(--neon-gold)' }}
          >
            High scores
          </h1>
        </header>

        <div className="mt-4 flex gap-2">
          {(['overall', 'cabinets'] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                sfx.blip();
                setView(v);
              }}
              className="arcade-btn flex-1 py-1.5 text-[10px] font-bold"
              style={{ color: view === v ? 'var(--neon-pink)' : 'var(--cab-dim)' }}
            >
              {v === 'overall' ? 'Overall' : 'Cabinets'}
            </button>
          ))}
        </div>

        {view === 'overall' ? (
          <section className="mt-4">
            <p className="mb-3 text-[9px] leading-relaxed uppercase tracking-wider" style={{ color: 'var(--cab-dim)' }}>
              Rating scores every cabinet against its own par, so one machine can't
              run away with the board. {GAMES.length * 100} is a perfect card.
            </p>

            {standings.length === 0 && (
              <EmptyNote>No crew profiles have synced yet.</EmptyNote>
            )}

            <ol className="space-y-2">
              {standings.map((s, i) => {
                const spec = specOf(s.member);
                const isMe = s.member === me;
                return (
                  <li
                    key={s.member}
                    className="cab-panel flex items-center gap-3 rounded-xl p-3"
                    style={isMe ? { borderColor: 'var(--neon-cyan)' } : undefined}
                  >
                    <span
                      className="tabular w-5 text-center text-sm font-bold"
                      style={{ color: i === 0 ? 'var(--neon-gold)' : 'var(--cab-dim)' }}
                    >
                      {i + 1}
                    </span>
                    {spec ? (
                      <CrewAvatar spec={spec} size={38} />
                    ) : (
                      <span className="grid h-[38px] w-[38px] place-items-center rounded-full bg-white/15 text-sm">
                        {nameOf(s.member).charAt(0)}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-bold">{nameOf(s.member)}</span>
                        {s.crowns > 0 && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[9px] font-bold"
                            style={{ color: 'var(--neon-gold)' }}
                          >
                            <Crown size={10} />
                            {s.crowns}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[9px] uppercase tracking-wider" style={{ color: 'var(--cab-dim)' }}>
                        {s.played}/{GAMES.length} machines · {s.runs} run{s.runs === 1 ? '' : 's'} ·{' '}
                        {s.points} pts
                      </div>
                    </div>
                    <div className="tabular text-right text-xl font-bold" style={{ color: 'var(--neon-cyan)' }}>
                      {s.rating}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : (
          <section className="mt-4 space-y-3">
            {GAMES.map((game) => {
              const table = highScores(completions, game.id).slice(0, 3);
              const color = hueColor(game.hue);
              return (
                <div key={game.id} className="cab-panel rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      to={`/arcade/${game.id}`}
                      onClick={() => sfx.coin()}
                      className="flex min-w-0 items-center gap-2"
                    >
                      <span aria-hidden>{game.glyph}</span>
                      <span
                        className="neon-soft truncate text-[11px] font-bold uppercase tracking-[0.14em]"
                        style={{ color }}
                      >
                        {game.title}
                      </span>
                    </Link>
                    <span className="shrink-0 text-[9px] uppercase tracking-wider" style={{ color: 'var(--cab-dim)' }}>
                      Par {game.par.toLocaleString()}
                    </span>
                  </div>

                  {table.length === 0 ? (
                    <p className="mt-2 text-[10px]" style={{ color: 'var(--cab-dim)' }}>
                      Nobody has played this one. The record is yours to take.
                    </p>
                  ) : (
                    <ol className="mt-2 space-y-1">
                      {table.map((entry, i) => (
                        <li key={entry.member} className="flex items-center gap-2 text-[11px]">
                          <span className="w-3" style={{ color: 'var(--neon-gold)' }}>
                            {i + 1}
                          </span>
                          <span
                            className="min-w-0 flex-1 truncate"
                            style={{ fontWeight: entry.member === me ? 700 : 400 }}
                          >
                            {nameOf(entry.member)}
                          </span>
                          <span className="tabular text-[9px]" style={{ color: 'var(--cab-dim)' }}>
                            {ratingFor(game, entry.score)}
                          </span>
                          <span className="tabular w-16 text-right font-bold" style={{ color }}>
                            {entry.score.toLocaleString()}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="cab-panel rounded-xl p-4 text-center text-[11px]" style={{ color: 'var(--cab-dim)' }}>
      {children}
    </p>
  );
}
