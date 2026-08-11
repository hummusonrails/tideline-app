import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft } from 'lucide-react';
import { GlassCard } from '../ui/GlassCard';
import { db } from '../lib/db';
import { useSession } from '../state/session';
import { useEggs } from '../lib/eggRuntime';
import { buildDeck, deckSummary, foundEggIds } from '../lib/eggs';

/**
 * The Crew Deck: a room you can only reach by finding the way in.
 *
 * Nothing links here. It's reached by the corner code, which means arriving is
 * itself the first discovery. Unfound secrets show as engraved blanks — the
 * count is the only clue, and that's the point.
 */
export function CrewDeck() {
  const navigate = useNavigate();
  const myId = useSession((s) => s.identity);
  const { eggs } = useEggs();
  const completions = useLiveQuery(() => db.completions.toArray(), []) ?? [];

  const found = useMemo(
    () => (myId ? foundEggIds(completions, myId) : new Set<string>()),
    [completions, myId],
  );
  const deck = useMemo(() => buildDeck(eggs, found), [eggs, found]);
  const { found: nFound, total } = deckSummary(deck);

  return (
    <div className="min-h-dvh pb-28">
      <div className="pt-[max(env(safe-area-inset-top),1rem)] px-4">
        <header className="flex items-center gap-3 mb-5">
          <button
            type="button"
            onClick={() => navigate('/today')}
            className="grid h-10 w-10 place-items-center rounded-full glass shrink-0"
            aria-label="Back"
          >
            <ChevronLeft size={20} strokeWidth={1.75} />
          </button>
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-600 font-medium">
              You weren't supposed to find this
            </div>
            <h1 className="font-display text-2xl font-semibold leading-tight">The Crew Deck</h1>
          </div>
        </header>

        <main className="space-y-5">
          <GlassCard className="text-center bg-gradient-to-br from-ink-900/90 to-ocean/80 text-white">
            <div className="font-display text-4xl font-semibold tabular">
              {nFound}
              <span className="text-white/60 text-2xl"> / {total}</span>
            </div>
            <div className="text-sm text-white/80 mt-1">
              {total === 0
                ? 'Nothing hidden yet. Check back.'
                : nFound === total
                  ? 'Every single one. Show-off. 🏆'
                  : 'secrets found'}
            </div>
          </GlassCard>

          {deck.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {deck.map((entry) => (
                <GlassCard
                  key={entry.id}
                  className={`!p-4 min-h-[120px] flex flex-col ${
                    entry.found ? '' : 'opacity-60 border-dashed'
                  }`}
                >
                  <div className="text-2xl mb-1">{entry.found ? '🏅' : '🔒'}</div>
                  <div className="font-medium text-sm leading-snug">{entry.title}</div>
                  {entry.copy && (
                    <div className="text-[11px] text-ink-600 mt-1 leading-snug line-clamp-3">
                      {entry.copy}
                    </div>
                  )}
                  {entry.found && entry.points > 0 && (
                    <div className="mt-auto pt-2 text-[11px] text-sage-700 font-semibold">
                      +{entry.points}
                    </div>
                  )}
                </GlassCard>
              ))}
            </div>
          )}

          <div className="text-center text-xs text-ink-500 px-6 leading-relaxed">
            Tapping the corners got you in here. There are other ways into other
            places.
          </div>
        </main>
      </div>
    </div>
  );
}
