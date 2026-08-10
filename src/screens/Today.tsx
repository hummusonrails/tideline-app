import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page } from '../ui/Page';
import { GlassCard } from '../ui/GlassCard';
import { useSession } from '../state/session';
import { db } from '../lib/db';
import { todayYMD, diffHuman } from '../lib/time';
import { DEFAULT_CONFIG, currentTier, nextTier, totalPoints, streakLength } from '../lib/points';
import { TierBadge } from '../ui/TierBadge';
import { Flame, Trophy, ArrowUpRight, ChevronRight, CalendarDays, Ship, X, Play } from 'lucide-react';
import { enqueue } from '../lib/sync';
import { awardPoints } from '../lib/award';
import { uid } from '../lib/uuid';
import { habitPath } from '../lib/paths';
import { textToBase64 } from '../lib/github';
import { useMyProfile, useAvatarSrc } from '../lib/profile';
import { usePlaceImage } from '../lib/places';
import { useShabbatTimes, fmtTime, shabbatDates } from '../lib/shabbat';
import { useTripMeta, isBeforeTrip } from '../lib/trip';
import { isShabbatNow, prettyDate } from '../lib/time';
import { useNetState } from '../lib/net';
import { tierAckKey, tierToCelebrate } from '../lib/celebrate';
import { Celebration } from '../ui/Celebration';
import { localDay } from '../lib/recap';
import type { ItineraryItem, Place, HabitCheckIn, PointEvent, PointsConfig, Tier } from '../types';

export function Today() {
  const session = useSession();
  const id = session.identity!;
  const today = todayYMD();
  const navigate = useNavigate();

  const myProfile = useMyProfile();
  const myAvatar = useAvatarSrc(id);
  const shabbatTimes = useShabbatTimes();
  const tripMeta = useTripMeta();
  const beforeTrip = isBeforeTrip(tripMeta?.startDate, today);
  const items = useLiveQuery(() => db.itinerary.orderBy('date').toArray()) ?? [];
  const places = useLiveQuery(() => db.places.toArray()) ?? [];
  const events = useLiveQuery(() => db.pointEvents.toArray()) ?? [];
  const habits = useLiveQuery(() => db.habits.toArray()) ?? [];

  const onShabbat = isShabbatNow(shabbatTimes);
  const todayShabbat = shabbatTimes[today];

  const placeBySlug = new Map(places.map((p) => [p.slug, p]));

  // Current place = a place item dated today, if any.
  const todayPlaceSlug = items.find((i) => i.date === today && i.placeSlug)?.placeSlug;
  const currentPlace = todayPlaceSlug ? placeBySlug.get(todayPlaceSlug) : undefined;

  // Ordered, de-duplicated destinations (chronological) for the carousel.
  const destinations = orderedDestinations(items, placeBySlug);

  // Next event (any future item).
  const nextEvent = nextFutureItem(items);

  // Trip countdown.
  const firstDate = items[0]?.date;
  const daysToTrip = firstDate ? daysUntil(firstDate, today) : null;

  const myPoints = totalPoints(events, id);
  const tier = currentTier(myPoints, DEFAULT_CONFIG);
  const next = nextTier(myPoints, DEFAULT_CONFIG);
  // Shabbat days don't break the chain — see streakLength.
  const shabbatFree = useMemo(() => shabbatDates(shabbatTimes), [shabbatTimes]);
  const streak = streakLength(habits, id, today, shabbatFree);
  const checkedInToday = habits.some((h) => h.by === id && h.date === today);
  const [checkingIn, setCheckingIn] = useState(false);

  const firstName = myProfile?.displayName ?? '';

  async function onCheckIn() {
    if (checkedInToday || checkingIn) return;
    setCheckingIn(true);
    try {
      await checkInHabit(id, today, habits, shabbatFree);
    } finally {
      setCheckingIn(false);
    }
  }

  return (
    <Page
      eyebrow={currentPlace ? 'You are in' : 'Today'}
      // The hero card below already greets by name; repeating it in the header
      // wastes the most prominent line on the screen.
      title={currentPlace ? currentPlace.name : (tripMeta?.name ?? 'Today')}
      avatarSeed={id}
      avatarDisplayName={myProfile?.displayName}
      avatarSrc={myAvatar}
    >
      <SeaBanner />
      <TierCelebration events={events} member={id} />
      <RecapPrompt today={today} />
      {(onShabbat || todayShabbat) && (
        <div className="glass rounded-[28px] px-5 py-4 bg-gradient-to-br from-white/60 to-sage-100/50">
          <div className="font-display text-lg font-semibold">🕯️ Shabbat shalom</div>
          <div className="text-sm text-ink-600 mt-0.5">
            {todayShabbat?.candleLighting && `Candle lighting ${fmtTime(todayShabbat.candleLighting)}`}
            {todayShabbat?.candleLighting && todayShabbat?.havdalah && ' · '}
            {todayShabbat?.havdalah && `Havdalah ${fmtTime(todayShabbat.havdalah)}`}
            {todayShabbat?.location && ` · ${todayShabbat.location}`}
          </div>
        </div>
      )}
      {/* Greeting / status card — the mockup's hero panel */}
      <GlassCard className="!rounded-[28px] text-center !py-6 bg-gradient-to-b from-sage-100/70 to-white/50">
        <div className="font-display text-2xl font-semibold">
          {firstName ? `Hi, ${firstName}` : 'Welcome'}
        </div>
        <div className="text-ink-600 text-sm mt-1">
          {currentPlace
            ? currentPlace.subtitle
            : daysToTrip !== null && daysToTrip > 0
              ? `Your family adventure begins in ${daysToTrip} ${daysToTrip === 1 ? 'day' : 'days'}`
              : 'Your family adventure'}
        </div>

        {/* Stat pills */}
        <div className="mt-4 flex items-center justify-center gap-2">
          <StatPill icon={<Trophy size={14} />} label="Points" value={String(myPoints)} />
          <StatPill icon={<Flame size={14} />} label="Streak" value={`${streak}d`} />
          {daysToTrip !== null && daysToTrip > 0 && (
            <StatPill icon={<CalendarDays size={14} />} label="To go" value={`${daysToTrip}d`} />
          )}
        </div>
      </GlassCard>

      {beforeTrip && tripMeta && (
        <div className="glass rounded-[28px] px-5 py-4 bg-gradient-to-br from-white/60 to-sage-100/50 text-center">
          <div className="font-display text-lg font-semibold">The games begin {prettyDate(tripMeta.startDate)}</div>
          <div className="text-sm text-ink-600 mt-1">
            Check in daily now to build your streak — points start counting on day one.
          </div>
        </div>
      )}

      {/* Tier + habit row */}
      <div className="grid grid-cols-2 gap-3">
        <GlassCard className="!p-4">
          <div className="text-xs uppercase tracking-wider text-ink-600">Your tier</div>
          <div className="mt-2"><TierBadge tier={tier} /></div>
          {next && (
            <div className="mt-2 text-xs text-ink-600">{next.remaining} pts to {next.tier}</div>
          )}
        </GlassCard>
        <GlassCard className="!p-4">
          <div className="text-xs uppercase tracking-wider text-ink-600">
            {myProfile?.habit?.emoji ?? '🔥'} Daily habit
          </div>
          {onShabbat ? (
            // No check-in prompt during Shabbat — and say plainly that the
            // streak is safe, so nobody feels pulled to break it.
            <div className="mt-2 w-full text-xs rounded-full px-3 py-2 bg-sage-200 text-sage-700 text-center">
              🕯️ Your streak is safe
            </div>
          ) : (
            <button
              type="button"
              disabled={checkedInToday || checkingIn}
              onClick={() => void onCheckIn()}
              className={`mt-2 w-full text-xs rounded-full px-3 py-2 transition ${
                checkedInToday ? 'bg-sage-200 text-sage-700' : 'bg-ink-900 text-white active:scale-[0.97]'
              } disabled:opacity-60`}
            >
              {checkedInToday ? '✓ done today' : `+ ${myProfile?.habit?.label ?? 'check in'}`}
            </button>
          )}
        </GlassCard>
      </div>

      {/* Up next */}
      {nextEvent && (
        <GlassCard className="flex items-center justify-between !py-4">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-ink-600 mb-0.5">Up next</div>
            <div className="font-medium truncate">{nextEvent.title}</div>
            {nextEvent.subtitle && (
              <div className="text-xs text-ink-600 truncate">{nextEvent.subtitle}</div>
            )}
          </div>
          <div className="tabular text-ocean font-medium shrink-0 ml-3">
            {diffHuman(`${nextEvent.date}T${nextEvent.startTime ?? '00:00'}:00`)}
          </div>
        </GlassCard>
      )}

      {/* Where we're going — the photo-forward carousel */}
      {destinations.length > 0 && (
        <section>
          <div className="flex items-center justify-between px-1 mb-3">
            <h2 className="font-display text-xl font-semibold">Where we're going</h2>
            <button
              type="button"
              onClick={() => navigate('/itinerary')}
              className="text-sm text-ink-600 flex items-center gap-0.5"
            >
              See all <ChevronRight size={14} />
            </button>
          </div>
          <div className="flex gap-4 overflow-x-auto scroll-clean -mx-4 px-4 pb-2 snap-x snap-mandatory">
            {destinations.map(({ place, date }) => (
              <DestinationCard
                key={place.slug}
                place={place}
                whenLabel={date ? dayLabel(date, today) : ''}
                onClick={() => navigate(`/place/${place.slug}`)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Today's challenges */}
      <TodayChallenges date={today} />
    </Page>
  );
}

function StatPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-white/70 ring-1 ring-white/80 px-3.5 py-2">
      <span className="text-ink-600">{icon}</span>
      <span className="text-sm">
        <span className="font-semibold tabular">{value}</span>{' '}
        <span className="text-ink-500">{label}</span>
      </span>
    </div>
  );
}

function DestinationCard({
  place,
  whenLabel,
  onClick,
}: {
  place: Place;
  whenLabel: string;
  onClick: () => void;
}) {
  const img = usePlaceImage(place.slug);
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative shrink-0 w-[280px] h-[360px] rounded-[28px] overflow-hidden text-left snap-start active:scale-[0.98] transition"
    >
      {img ? (
        <img src={img} alt={place.name} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-sage-300 to-sage-700" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/20" />
      {whenLabel && (
        <div className="absolute top-4 left-4 glass rounded-full px-3 py-1 text-xs font-medium text-ink-900">
          {whenLabel}
        </div>
      )}
      <div className="absolute top-4 right-4 grid h-9 w-9 place-items-center rounded-full glass text-ink-900">
        <ArrowUpRight size={16} />
      </div>
      <div className="absolute left-5 right-5 bottom-5">
        <div className="flex items-center gap-1 text-white/90 text-xs mb-1">📍 {place.name}</div>
        <div className="font-display text-2xl font-semibold leading-tight text-white drop-shadow-lg">
          {place.name}
        </div>
        <div className="text-white/85 text-xs mt-1 line-clamp-2">{place.subtitle}</div>
      </div>
    </button>
  );
}

function TodayChallenges({ date }: { date: string }) {
  const navigate = useNavigate();
  const challenges = useLiveQuery(
    () => db.challenges.filter((c) => c.activeFrom <= date && c.activeUntil >= date).toArray(),
    [date],
  ) ?? [];

  if (challenges.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between px-1 mb-3">
        <h2 className="font-display text-xl font-semibold">Today's challenges</h2>
        <button
          type="button"
          onClick={() => navigate('/quest')}
          className="text-sm text-ink-600 flex items-center gap-0.5"
        >
          All <ChevronRight size={14} />
        </button>
      </div>
      <div className="space-y-3">
        {challenges.map((c) => (
          <GlassCard key={c.id} className="flex items-center gap-3 !py-4">
            <div className="text-2xl">{c.icon}</div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{c.title}</div>
              <div className="text-xs text-ink-600 line-clamp-1">{c.description}</div>
            </div>
            <div className="tabular text-sage-700 font-semibold shrink-0">+{c.points}</div>
          </GlassCard>
        ))}
      </div>
    </section>
  );
}

// ---- helpers ----

function orderedDestinations(
  items: ItineraryItem[],
  placeBySlug: Map<string, Place>,
): { place: Place; date: string | null }[] {
  const seen = new Set<string>();
  const out: { place: Place; date: string | null }[] = [];
  for (const it of items) {
    if (!it.placeSlug || seen.has(it.placeSlug)) continue;
    const place = placeBySlug.get(it.placeSlug);
    if (!place) continue;
    seen.add(it.placeSlug);
    out.push({ place, date: it.date });
  }
  return out;
}

function nextFutureItem(items: ItineraryItem[]): ItineraryItem | undefined {
  const now = Date.now();
  return items
    .filter((i) => Date.parse(`${i.date}T${i.startTime ?? '00:00'}:00`) > now)
    .sort(
      (a, b) =>
        Date.parse(`${a.date}T${a.startTime ?? '00:00'}:00`) -
        Date.parse(`${b.date}T${b.startTime ?? '00:00'}:00`),
    )[0];
}

function daysUntil(target: string, from: string): number {
  const t = Date.parse(`${target}T00:00:00`);
  const f = Date.parse(`${from}T00:00:00`);
  return Math.round((t - f) / 86_400_000);
}

/**
 * Explains sea mode once, then stays out of the way.
 *
 * The point is reassurance, not alarm: at sea the app is working exactly as
 * intended, and the only thing worth telling someone is that nothing is being
 * lost and how to share it with the family. Dismissal sticks for 12 hours so
 * it can reappear the next day without becoming wallpaper.
 */
function SeaBanner() {
  const navigate = useNavigate();
  const atSea = useNetState((s) => s.state) === 'no-internet';
  const pending = useLiveQuery(() => db.outbox.count()) ?? 0;
  const dismissedRow = useLiveQuery(() => db.meta.get('sea-banner-dismissed'));

  const dismissedAt = typeof dismissedRow?.value === 'number' ? dismissedRow.value : 0;
  const recentlyDismissed = Date.now() - dismissedAt < 12 * 60 * 60 * 1000;

  if (!atSea || recentlyDismissed) return null;

  return (
    <div className="glass rounded-[28px] px-5 py-4 flex items-start gap-3">
      <Ship size={18} className="text-ocean shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">Sea mode</div>
        <div className="text-xs text-ink-600 mt-0.5">
          {pending > 0
            ? `${pending} thing${pending === 1 ? '' : 's'} saved on this phone. Nothing is lost — it uploads by itself when there's internet.`
            : "No internet right now. Everything you post is saved on this phone and uploads by itself later."}
        </div>
        <button
          type="button"
          onClick={() => navigate('/devices')}
          className="mt-2 text-xs font-semibold text-ocean"
        >
          Sync with the family →
        </button>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => void db.meta.put({ key: 'sea-banner-dismissed', value: Date.now() })}
        className="text-ink-600 p-1 shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/**
 * Offers the day's playback, but only in the evening and only if the day
 * actually produced something. Showing it at 9am, or on a day with no photos,
 * would train people to ignore it.
 */
function RecapPrompt({ today }: { today: string }) {
  const navigate = useNavigate();
  const photos = useLiveQuery(() => db.photos.toArray(), []) ?? [];
  const hour = new Date().getHours();

  const todayPhotos = photos.filter((p) => localDay(p.takenAt) === today).length;
  if (hour < 17 || todayPhotos === 0) return null;

  return (
    <button
      type="button"
      onClick={() => navigate('/recap')}
      className="w-full glass rounded-[28px] px-5 py-4 flex items-center gap-3 text-left active:scale-[0.99] transition"
    >
      <span className="grid h-10 w-10 place-items-center rounded-full bg-ink-900 text-white shrink-0">
        <Play size={16} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-medium">Tonight's recap</span>
        <span className="block text-xs text-ink-600">
          {todayPhotos} photo{todayPhotos === 1 ? '' : 's'} from today, plus the scores
        </span>
      </span>
      <ChevronRight size={16} className="text-ink-600 shrink-0" />
    </button>
  );
}

/**
 * Fires once per upward tier crossing, per member, per device.
 *
 * The acknowledgement lives in `db.meta` rather than component state so a
 * reload — or the points arriving via a background sync while the app is
 * closed — still produces exactly one celebration.
 */
function TierCelebration({ events, member }: { events: PointEvent[]; member: string }) {
  const ackRow = useLiveQuery(() => db.meta.get(tierAckKey(member)), [member]);
  const configRow = useLiveQuery(() => db.pointsConfig.get('config'), []);
  const [dismissed, setDismissed] = useState(false);

  // Undefined means the query hasn't resolved; treating that as "never
  // acknowledged" would celebrate on every single mount.
  if (ackRow === undefined) return null;

  const config = (configRow?.value as PointsConfig | undefined) ?? DEFAULT_CONFIG;
  const acknowledged = (ackRow?.value as Tier | undefined) ?? null;
  const tier = tierToCelebrate(events, member, config, acknowledged);
  if (!tier || dismissed) return null;

  const rewardLabel = config.tiers.find((t) => t.tier === tier)?.rewardLabel;

  return (
    <Celebration
      tier={tier}
      rewardLabel={rewardLabel}
      onDismiss={() => {
        setDismissed(true);
        void db.meta.put({ key: tierAckKey(member), value: tier });
      }}
    />
  );
}

function dayLabel(date: string, today: string): string {
  const d = daysUntil(date, today);
  if (d === 0) return 'Today';
  if (d < 0) return 'Visited';
  if (d < 30) return `in ${d}d`;
  const [, m, dd] = date.split('-').map(Number);
  const monthName = new Date(2026, m - 1, dd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return monthName;
}

async function checkInHabit(
  by: string,
  date: string,
  priorHabits: HabitCheckIn[],
  freeDates?: ReadonlySet<string>,
) {
  // Re-check at write time, not just in the UI: two fast taps can both pass
  // the disabled check before the live query reports the first one, and each
  // would mint its own points.
  if (priorHabits.some((h) => h.by === by && h.date === date)) return;

  const now = new Date();
  const id = uid();
  const record: HabitCheckIn = { id, by, date, at: now.toISOString() };
  await db.habits.put(record);
  await enqueue({
    id,
    enqueuedAt: now.toISOString(),
    op: {
      kind: 'put-file',
      path: habitPath(record),
      contentBase64: textToBase64(JSON.stringify(record)),
      commitMessage: 'habit check-in',
    },
  });

  // Base habit point.
  await awardPoints({ to: by, by, amount: 5, reason: 'streak', refId: `habit-${date}` });

  // Streak bonus once the streak (including today) reaches 3+ consecutive days.
  const streakNow = streakLength([...priorHabits, record], by, date, freeDates);
  if (streakNow >= 3) {
    await awardPoints({ to: by, by, amount: DEFAULT_CONFIG.earn.streakBonus, reason: 'streak', refId: `streak-${date}` });
  }
}
