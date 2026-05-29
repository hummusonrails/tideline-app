import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft } from 'lucide-react';
import { db } from '../lib/db';
import { GlassCard } from '../ui/GlassCard';

export function About() {
  const navigate = useNavigate();
  const places = useLiveQuery(() => db.places.toArray());

  const credited = (places ?? [])
    .filter((p) => p.heroCredit && p.heroCredit !== 'TBD')
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="min-h-dvh pb-28 px-4 pt-[max(env(safe-area-inset-top),1rem)]">
      <header className="flex items-center gap-3 mb-5">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="grid h-10 w-10 place-items-center rounded-full glass"
          aria-label="Back"
        >
          <ChevronLeft size={20} />
        </button>
        <h1 className="font-display text-2xl font-semibold">About & credits</h1>
      </header>

      <GlassCard className="mb-5">
        <p className="text-sm text-ink-700 leading-relaxed">
          Tideline is a private, offline-first companion app. Your data lives in your own
          private storage and never leaves it. Destination photos are used under
          Creative Commons licenses — credits below, as the licenses require.
        </p>
      </GlassCard>

      <div className="text-xs uppercase tracking-wider text-ink-400 px-1 mb-2">Photo credits</div>
      <div className="space-y-2">
        {places === undefined && (
          <GlassCard className="text-ink-600 text-sm text-center">Loading…</GlassCard>
        )}
        {credited.map((p) => (
          <GlassCard key={p.slug} className="!py-3">
            <div className="font-medium">{p.name}</div>
            <div className="text-xs text-ink-600">{p.heroCredit}</div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
