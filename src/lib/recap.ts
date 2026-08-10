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
  HabitCheckIn,
  MemberId,
  Message,
  Photo,
  PointEvent,
} from '../types';

export type RecapSlide =
  | { kind: 'photo'; photo: Photo; author: string }
  | { kind: 'journal'; body: string; author: string }
  | { kind: 'stat'; headline: string; detail: string }
  | { kind: 'end'; headline: string };

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
