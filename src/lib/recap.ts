/**
 * Builds "tonight's recap" — the day played back as a short slideshow.
 *
 * Everything comes from records already on the device, so it works at sea with
 * no network of any kind. That's deliberate: the moment this is for is the
 * family sitting down to dinner on the ship, passing one phone around.
 *
 * Pure and data-only. The player owns presentation.
 */

import type {
  ChallengeCompletion,
  CrewGoal,
  HabitCheckIn,
  Hunt,
  MemberId,
  Message,
  Photo,
  PointEvent,
  Profile,
  Reaction,
  Tier,
} from '../types';
import { DEFAULT_CONFIG, currentTier, leaderboard, totalPoints } from './points';
import { effectiveReactions } from './reactions';
import { parsePoll } from './poll';
import { isReservedEmoji } from './predictions';
import { huntFinaleId } from './hunts';

export type RecapSlide =
  | { kind: 'photo'; photo: Photo; author: string }
  | { kind: 'journal'; body: string; author: string }
  | { kind: 'stat'; headline: string; detail: string }
  | { kind: 'end'; headline: string }
  /** Full-trip only: a day divider in the story. */
  | { kind: 'chapter'; headline: string; detail: string }
  /** Full-trip only: a poll's results, used for the awards ballots. */
  | { kind: 'award'; headline: string; winner: string; detail: string }
  /** Full-trip only: the payoff text from a completed meta-hunt. */
  | { kind: 'reveal'; headline: string; body: string }
  /** Full-trip only: the final standings. */
  | { kind: 'leaderboard'; rows: { name: string; points: number; tier: Tier }[] };

export interface RecapInput {
  date: string;                 // YYYY-MM-DD, local
  photos: readonly Photo[];
  messages: readonly Message[];
  pointEvents: readonly PointEvent[];
  completions: readonly ChallengeCompletion[];
  habits: readonly HabitCheckIn[];
  /** memberId → display name, for attribution. */
  names: Readonly<Record<MemberId, string>>;
}

/** Local calendar day of an ISO timestamp. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

const MAX_PHOTOS = 12;
const MAX_JOURNALS = 3;

/**
 * Order: photos first (the thing people want to see), then a points slide,
 * then journal entries, then a closer.
 *
 * Journal entries are included because they're already posted into the family
 * chat — this surfaces existing shared content, it doesn't expose anything
 * private. Plain chat messages are left out: they're conversational and read
 * badly out of context.
 */
export function buildRecap(input: RecapInput): RecapSlide[] {
  const nameOf = (id: MemberId) => input.names[id] ?? 'Someone';

  const photos = input.photos
    .filter((p) => localDay(p.takenAt) === input.date)
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt))
    .slice(0, MAX_PHOTOS);

  const slides: RecapSlide[] = photos.map((photo) => ({
    kind: 'photo' as const,
    photo,
    author: nameOf(photo.from),
  }));

  const dayPoints = input.pointEvents.filter((e) => localDay(e.at) === input.date);
  const total = dayPoints.reduce((sum, e) => sum + e.amount, 0);
  if (total !== 0) {
    const byMember = new Map<MemberId, number>();
    for (const e of dayPoints) byMember.set(e.to, (byMember.get(e.to) ?? 0) + e.amount);
    const top = [...byMember.entries()].sort((a, b) => b[1] - a[1])[0];
    slides.push({
      kind: 'stat',
      headline: `+${total} points today`,
      detail: top ? `${nameOf(top[0])} led the day with ${top[1]}` : '',
    });
  }

  const completedToday = input.completions.filter(
    (c) => localDay(c.completedAt) === input.date,
  ).length;
  if (completedToday > 0) {
    slides.push({
      kind: 'stat',
      headline: `${completedToday} challenge${completedToday === 1 ? '' : 's'} completed`,
      detail: 'Nicely done.',
    });
  }

  const journals = input.messages
    .filter((m) => m.kind === 'journal' && localDay(m.sentAt) === input.date)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    .slice(0, MAX_JOURNALS);
  for (const j of journals) {
    slides.push({ kind: 'journal', body: j.body, author: nameOf(j.from) });
  }

  const checkedIn = input.habits.filter((h) => h.date === input.date).length;
  if (checkedIn > 0) {
    slides.push({
      kind: 'stat',
      headline: `${checkedIn} habit check-in${checkedIn === 1 ? '' : 's'}`,
      detail: 'Streaks intact.',
    });
  }

  if (slides.length === 0) return [];
  slides.push({ kind: 'end', headline: 'Goodnight' });
  return slides;
}

/** Is there enough of a day to be worth playing back? */
export function hasRecap(slides: readonly RecapSlide[]): boolean {
  // The closer alone isn't a recap.
  return slides.filter((s) => s.kind !== 'end').length > 0;
}

// ---------- the whole trip ----------

export interface TripRecapInput extends Omit<RecapInput, 'date'> {
  /** Trip bounds, inclusive, as local YYYY-MM-DD. */
  startDate: string;
  endDate: string;
  reactions: readonly Reaction[];
  profiles: readonly Profile[];
  hunts: readonly Hunt[];
  goal?: CrewGoal;
  /** Poll messages posted as awards ballots, newest first, already filtered. */
  awardBallots?: readonly Message[];
}

/** Best photos per day, most-reacted first. */
const PHOTOS_PER_DAY = 2;

/**
 * The whole trip, as one sitting.
 *
 * Ordered as a story rather than a report: it opens, walks the days in order,
 * hands out the superlatives, plays back the family's own votes, reveals
 * whatever the meta-hunt was hiding, and lands on the standings.
 *
 * Reactions are the ranking signal for photos. Nobody was asked to rate
 * anything — the hearts people already tapped over two weeks turn out to be a
 * better "best of" than any heuristic about sharpness or recency, and it costs
 * nothing to read them.
 *
 * Everything comes from local records, which is the point: this plays on the
 * last morning, sailing back into port, with no expectation of a signal.
 */
export function buildTripRecap(input: TripRecapInput): RecapSlide[] {
  const nameOf = (id: MemberId) => input.names[id] ?? 'Someone';
  const slides: RecapSlide[] = [];

  const days = datesBetween(input.startDate, input.endDate);
  const crewSize = input.profiles.length;

  slides.push({
    kind: 'stat',
    headline: `${days.length} days. ${crewSize || 'A'} crew. One story.`,
    detail: 'Tap through, or let it play.',
  });

  // How many hearts a photo collected — the only ranking input we need.
  const reactionCount = new Map<string, number>();
  for (const r of input.reactions) {
    if (r.emoji === null || isReservedEmoji(r.emoji)) continue;
    reactionCount.set(r.messageId, (reactionCount.get(r.messageId) ?? 0) + 1);
  }

  for (const date of days) {
    const dayPhotos = input.photos
      .filter((p) => localDay(p.takenAt) === date)
      .sort((a, b) => {
        const d = (reactionCount.get(b.id) ?? 0) - (reactionCount.get(a.id) ?? 0);
        return d !== 0 ? d : a.takenAt.localeCompare(b.takenAt);
      })
      .slice(0, PHOTOS_PER_DAY);

    const dayJournal = input.messages.find(
      (m) => m.kind === 'journal' && localDay(m.sentAt) === date,
    );
    const dayPoints = input.pointEvents
      .filter((e) => localDay(e.at) === date)
      .reduce((sum, e) => sum + e.amount, 0);

    // Skip days that produced nothing — travel days with a flight and no
    // photos shouldn't get a slide that says "0".
    if (dayPhotos.length === 0 && !dayJournal && dayPoints === 0) continue;

    slides.push({
      kind: 'chapter',
      headline: prettyDayLabel(date),
      detail: dayPoints > 0 ? `+${dayPoints} points` : '',
    });
    for (const photo of dayPhotos) {
      slides.push({ kind: 'photo', photo, author: nameOf(photo.from) });
    }
    if (dayJournal) {
      slides.push({ kind: 'journal', body: dayJournal.body, author: nameOf(dayJournal.from) });
    }
  }

  slides.push(...superlativeSlides(input, nameOf));
  slides.push(...awardSlides(input, nameOf));
  slides.push(...revealSlides(input));

  if (input.goal) {
    const total = input.pointEvents.reduce((sum, e) => sum + e.amount, 0);
    slides.push({
      kind: 'stat',
      headline: `${total} points, together`,
      detail:
        total >= input.goal.target
          ? `Crew goal cleared — ${input.goal.rewardLabel}`
          : `${input.goal.target - total} short of the crew goal. Still, look at it.`,
    });
  }

  const rows = leaderboard(
    input.pointEvents as PointEvent[],
    input.profiles.map((p) => p.id),
  ).map((r) => ({ name: nameOf(r.member), points: r.points, tier: r.tier }));
  if (rows.length > 0) slides.push({ kind: 'leaderboard', rows });

  slides.push({ kind: 'end', headline: 'See you on the next one' });
  return slides;
}

/** The "who did what most" round. Each one is skipped if nobody qualifies. */
function superlativeSlides(
  input: TripRecapInput,
  nameOf: (id: MemberId) => string,
): RecapSlide[] {
  const out: RecapSlide[] = [];

  const topBy = (counts: Map<MemberId, number>): [MemberId, number] | null => {
    const best = [...counts.entries()]
      // Sort by count, then member id, so every device names the same winner.
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0];
    return best && best[1] > 0 ? best : null;
  };

  const photoCounts = new Map<MemberId, number>();
  for (const p of input.photos) photoCounts.set(p.from, (photoCounts.get(p.from) ?? 0) + 1);
  const topPhotographer = topBy(photoCounts);
  if (topPhotographer) {
    out.push({
      kind: 'stat',
      headline: 'Official trip photographer',
      detail: `${nameOf(topPhotographer[0])} — ${topPhotographer[1]} photos`,
    });
  }

  const reactionsGiven = new Map<MemberId, number>();
  for (const r of input.reactions) {
    if (r.emoji === null || isReservedEmoji(r.emoji)) continue;
    reactionsGiven.set(r.by, (reactionsGiven.get(r.by) ?? 0) + 1);
  }
  const hypeCaptain = topBy(reactionsGiven);
  if (hypeCaptain) {
    out.push({
      kind: 'stat',
      headline: 'Hype captain',
      detail: `${nameOf(hypeCaptain[0])} reacted ${hypeCaptain[1]} times`,
    });
  }

  const journalCounts = new Map<MemberId, number>();
  for (const m of input.messages) {
    if (m.kind === 'journal') journalCounts.set(m.from, (journalCounts.get(m.from) ?? 0) + 1);
  }
  const chronicler = topBy(journalCounts);
  if (chronicler) {
    out.push({
      kind: 'stat',
      headline: 'The chronicler',
      detail: `${nameOf(chronicler[0])} wrote ${chronicler[1]} journal entries`,
    });
  }

  // Biggest single day, across everyone.
  const byMemberDay = new Map<string, number>();
  for (const e of input.pointEvents) {
    const key = `${e.to}|${localDay(e.at)}`;
    byMemberDay.set(key, (byMemberDay.get(key) ?? 0) + e.amount);
  }
  const biggest = [...byMemberDay.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0];
  if (biggest && biggest[1] > 0) {
    const [key, amount] = biggest;
    const [member, date] = key.split('|');
    out.push({
      kind: 'stat',
      headline: 'Biggest single day',
      detail: `${nameOf(member)}, ${prettyDayLabel(date)} — ${amount} points`,
    });
  }

  const checkIns = new Map<MemberId, number>();
  for (const h of input.habits) checkIns.set(h.by, (checkIns.get(h.by) ?? 0) + 1);
  const mostConsistent = topBy(checkIns);
  if (mostConsistent) {
    out.push({
      kind: 'stat',
      headline: 'Never missed a day',
      detail: `${nameOf(mostConsistent[0])} — ${mostConsistent[1]} check-ins`,
    });
  }

  const gifts = input.pointEvents.filter((e) => e.reason === 'gift');
  if (gifts.length > 0) {
    const given = new Map<MemberId, number>();
    for (const g of gifts) given.set(g.by, (given.get(g.by) ?? 0) + 1);
    const kindest = topBy(given);
    if (kindest) {
      out.push({
        kind: 'stat',
        headline: 'Most generous',
        detail: `${nameOf(kindest[0])} gave ${kindest[1]} points away`,
      });
    }
  }

  return out;
}

/** Awards-night ballots, tallied from the votes already cast. */
function awardSlides(
  input: TripRecapInput,
  nameOf: (id: MemberId) => string,
): RecapSlide[] {
  const out: RecapSlide[] = [];
  for (const ballot of input.awardBallots ?? []) {
    const poll = parsePoll(ballot.body);
    if (!poll) continue;
    const standing = effectiveReactions(ballot, input.reactions);
    const counts = new Array<number>(poll.options.length).fill(0);
    for (const emoji of Object.values(standing)) {
      const m = /^vote:(\d+)$/.exec(emoji);
      if (!m) continue;
      const idx = Number(m[1]);
      if (idx < counts.length) counts[idx] += 1;
    }
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    // Ties resolve to the lowest option index, so every phone agrees.
    let best = 0;
    for (let i = 1; i < counts.length; i++) if (counts[i] > counts[best]) best = i;
    out.push({
      kind: 'award',
      headline: poll.question,
      winner: poll.options[best],
      detail: `${counts[best]} of ${total} votes · posted by ${nameOf(ballot.from)}`,
    });
  }
  return out;
}

/** Reveal text from any meta-hunt the crew actually finished. */
function revealSlides(input: TripRecapInput): RecapSlide[] {
  const out: RecapSlide[] = [];
  for (const hunt of input.hunts) {
    if (hunt.kind !== 'meta' || !hunt.reveal) continue;
    const finished = input.completions.some((c) => c.challengeId === huntFinaleId(hunt.id));
    if (!finished) continue;
    out.push({ kind: 'reveal', headline: `${hunt.icon} ${hunt.title}`, body: hunt.reveal });
  }
  return out;
}

/** Inclusive list of local dates. Guards against a reversed or silly range. */
export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  if (!start || !end || start > end) return out;
  let cursor = start;
  // 400 is comfortably past any trip and stops a malformed date looping.
  for (let i = 0; i < 400 && cursor <= end; i++) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

function addDays(yyyymmdd: string, n: number): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function prettyDayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

/** Is the trip finale worth offering yet? */
export function hasTripRecap(slides: readonly RecapSlide[]): boolean {
  return slides.some((s) => s.kind === 'photo' || s.kind === 'chapter');
}

/** Highest tier anyone reached — used for the finale's headline flourish. */
export function bestTier(
  events: readonly PointEvent[],
  profiles: readonly Profile[],
): Tier {
  let best: Tier = 'none';
  const order: Tier[] = ['none', 'bronze', 'silver', 'gold', 'platinum'];
  for (const p of profiles) {
    const t = currentTier(totalPoints(events as PointEvent[], p.id), DEFAULT_CONFIG);
    if (order.indexOf(t) > order.indexOf(best)) best = t;
  }
  return best;
}
