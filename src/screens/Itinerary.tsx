import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Page } from '../ui/Page';
import { GlassCard } from '../ui/GlassCard';
import { db } from '../lib/db';
import { prettyDate, todayYMD, timeOfDay } from '../lib/time';
import { useSession } from '../state/session';
import { useMyProfile, useAvatarSrc } from '../lib/profile';
import { useShabbatTimes, fmtTime } from '../lib/shabbat';
import { Plane, Car, BedDouble, MapPin, Footprints, Anchor, Coffee, ChevronRight, Flame } from 'lucide-react';
import type { ItineraryItem, ItineraryItemKind } from '../types';

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

  return (
    <Page
      eyebrow="Plan"
      title="Itinerary"
      avatarSeed={session.identity ?? ''}
      avatarDisplayName={myProfile?.displayName}
      avatarSrc={myAvatar}
    >
      {dates.length === 0 && (
        <GlassCard className="text-ink-600 text-sm text-center">
          Your itinerary will appear here once it's loaded.
        </GlassCard>
      )}

      {dates.map((date) => {
        const isToday = date === today;
        return (
          <section key={date} className={isToday ? 'scroll-mt-6' : ''} id={`d-${date}`}>
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
      {linkable && <ChevronRight size={16} className="text-ink-400 shrink-0" />}
    </>
  );

  if (linkable) {
    return (
      <button
        type="button"
        onClick={() => navigate(`/place/${item.placeSlug}`)}
        className="glass rounded-[28px] p-4 flex gap-3 items-center w-full text-left active:scale-[0.98] transition"
      >
        {inner}
      </button>
    );
  }
  return <GlassCard className="!p-4 flex gap-3 items-center">{inner}</GlassCard>;
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
