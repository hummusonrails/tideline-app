import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page } from '../ui/Page';
import { GlassCard } from '../ui/GlassCard';
import { db } from '../lib/db';
import { prettyDate, todayYMD, timeOfDay } from '../lib/time';
import { useSession } from '../state/session';
import { useMyProfile, useAvatarSrc } from '../lib/profile';
import { useShabbatTimes, fmtTime } from '../lib/shabbat';
import { Plane, Car, BedDouble, MapPin, Footprints, Anchor, Coffee, ChevronRight, ChevronDown, Flame } from 'lucide-react';
import { RouteMap } from '../ui/RouteMap';
import type { ItineraryItem, ItineraryItemKind, RoutePoint } from '../types';

const iconFor: Record<ItineraryItemKind, typeof Plane> = {
  'flight': Plane,
  'drive': Car,
  'lodging-checkin': BedDouble,
  'lodging-checkout': BedDouble,
  'activity': Footprints,
  'stop': MapPin,
  'transit-start': Anchor,
  'transit-segment': Anchor,
  'transit-end': Anchor,
  'rest-day': Coffee,
  'note': MapPin,
};

export function Itinerary() {
  const session = useSession();
  const myProfile = useMyProfile();
  const myAvatar = useAvatarSrc(session.identity);
  const shabbatTimes = useShabbatTimes();
  const items = useLiveQuery(() => db.itinerary.orderBy('date').toArray()) ?? [];
  const today = todayYMD();

  const grouped = groupByDate(items);
  const dates = Object.keys(grouped).sort();

  // Optional: only trips whose data includes config/route.json get a map.
  const routeRow = useLiveQuery(() => db.meta.get('route'), []);
  const routePoints = Array.isArray(routeRow?.value) ? (routeRow.value as RoutePoint[]) : [];
  const visitedSlugs = new Set(
    items.filter((i) => i.placeSlug && i.date < today).map((i) => i.placeSlug!),
  );
  const currentSlug = items.find((i) => i.date === today && i.placeSlug)?.placeSlug;

  // Land on today rather than the start of the trip. Instant, not smooth —
  // animating through two weeks of history on every visit is disorienting.
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (scrolledRef.current || dates.length === 0) return;
    const el = document.getElementById(`d-${today}`);
    if (!el) return;
    scrolledRef.current = true;
    el.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [dates.length, today]);

  return (
    <Page
      eyebrow="Plan"
      title="Itinerary"
      avatarSeed={session.identity ?? ''}
      avatarDisplayName={myProfile?.displayName}
      avatarSrc={myAvatar}
    >
      {routePoints.length >= 2 && (
        <RouteMap
          points={routePoints}
          visitedSlugs={visitedSlugs}
          currentSlug={currentSlug}
        />
      )}

      {dates.length === 0 && (
        <GlassCard className="text-ink-600 text-sm text-center">
          Your itinerary will appear here once it's loaded.
        </GlassCard>
      )}

      {dates.map((date) => {
        const isToday = date === today;
        return (
          <section key={date} className="scroll-mt-6" id={`d-${date}`}>
            <div className="flex items-baseline justify-between mb-2 px-1">
              <div className="font-display text-lg font-semibold">{prettyDate(date)}</div>
              {isToday && (
                <span className="text-[11px] uppercase tracking-wider font-semibold text-ocean">
                  Today
                </span>
              )}
            </div>
            <div className="space-y-3">
              {grouped[date].map((item) => (
                <ItineraryItemCard key={item.id} item={item} />
              ))}
              {shabbatTimes[date] && (
                <div className="glass rounded-[28px] p-4 flex gap-3 items-center bg-gradient-to-br from-white/55 to-sage-100/45">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-sage-100 text-sage-700 shrink-0">
                    <Flame size={18} strokeWidth={1.75} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">Shabbat</div>
                    <div className="text-xs text-ink-600">
                      {shabbatTimes[date].candleLighting && `Candle lighting ${fmtTime(shabbatTimes[date].candleLighting!)}`}
                      {shabbatTimes[date].candleLighting && shabbatTimes[date].havdalah && ' · '}
                      {shabbatTimes[date].havdalah && `Havdalah ${fmtTime(shabbatTimes[date].havdalah!)}`}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        );
      })}
    </Page>
  );
}

function ItineraryItemCard({ item }: { item: ItineraryItem }) {
  const navigate = useNavigate();
  const Icon = iconFor[item.kind] ?? MapPin;
  const linkable = !!item.placeSlug;
  // `body` and `confirmation` are authored in the trip data but were never
  // rendered — flight notes and confirmation numbers were invisible in the app
  // exactly when someone standing at a check-in desk would need them.
  const expandable = !!(item.body || item.confirmation);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyConfirmation() {
    if (!item.confirmation) return;
    try {
      await navigator.clipboard.writeText(item.confirmation);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be refused; the number is on screen to read either way.
    }
  }

  const inner = (
    <>
      <div className="grid h-10 w-10 place-items-center rounded-full bg-sage-100 text-sage-700 shrink-0">
        <Icon size={18} strokeWidth={1.75} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="font-medium truncate">{item.title}</div>
          {item.startTime && (
            <div className="tabular text-xs text-ink-600 shrink-0">
              {timeOfDay(item.startTime)}
              {item.endTime ? `–${timeOfDay(item.endTime)}` : ''}
            </div>
          )}
        </div>
        {item.subtitle && (
          <div className="text-xs text-ink-600 mt-0.5 truncate">{item.subtitle}</div>
        )}
      </div>
      {linkable && <ChevronRight size={16} className="text-ink-600 shrink-0" />}
    </>
  );

  const details = open && expandable && (
    <div className="mt-3 pt-3 border-t border-white/60 space-y-2">
      {item.body && (
        <div className="text-xs text-ink-700 whitespace-pre-line leading-relaxed">{item.body}</div>
      )}
      {item.confirmation && (
        <button
          type="button"
          onClick={() => void copyConfirmation()}
          className="w-full flex items-center justify-between gap-2 rounded-2xl bg-white/70 px-3 py-2 text-left"
        >
          <span className="min-w-0">
            <span className="block text-[10px] uppercase tracking-wider text-ink-600">Confirmation</span>
            <span className="block font-mono tabular text-sm truncate">{item.confirmation}</span>
          </span>
          <span className="text-xs font-semibold text-ocean shrink-0">
            {copied ? 'Copied' : 'Copy'}
          </span>
        </button>
      )}
    </div>
  );

  // The main row keeps its navigation; expansion lives on its own control so
  // the two never fight over a tap.
  const chevron = expandable && (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      aria-label={open ? `Hide details for ${item.title}` : `Show details for ${item.title}`}
      className="grid h-9 w-9 place-items-center rounded-full bg-white/60 text-ink-700 shrink-0"
    >
      <ChevronDown size={15} className={`transition ${open ? 'rotate-180' : ''}`} />
    </button>
  );

  if (linkable) {
    return (
      <GlassCard className="!p-4">
        <div className="flex gap-3 items-center">
          <button
            type="button"
            onClick={() => navigate(`/place/${item.placeSlug}`)}
            className="flex gap-3 items-center flex-1 min-w-0 text-left active:scale-[0.98] transition"
          >
            {inner}
          </button>
          {chevron}
        </div>
        {details}
      </GlassCard>
    );
  }

  return (
    <GlassCard className="!p-4">
      <div className="flex gap-3 items-center">
        <div className="flex gap-3 items-center flex-1 min-w-0">{inner}</div>
        {chevron}
      </div>
      {details}
    </GlassCard>
  );
}

function groupByDate(items: ItineraryItem[]): Record<string, ItineraryItem[]> {
  const out: Record<string, ItineraryItem[]> = {};
  for (const it of items) {
    if (!out[it.date]) out[it.date] = [];
    out[it.date].push(it);
  }
  for (const d of Object.keys(out)) {
    out[d].sort((a, b) => (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99'));
  }
  return out;
}
