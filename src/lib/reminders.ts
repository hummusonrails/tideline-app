/**
 * On-screen nudges, computed locally.
 *
 * These exist because a push notification is a best-effort courier on this
 * trip: it only lands when a phone has data, and for ten days it mostly
 * won't. Anything worth telling someone has to also be findable by opening the
 * app. So the two highest-value nudges are mirrored here as cards that need
 * nothing but the clock and IndexedDB.
 *
 * Both are Shabbat-suppressed by the caller. That isn't polish — a streak
 * warning at 7pm on Friday is the app leaning on someone to break an
 * observance it already claims to respect.
 */

import type { Challenge, ChallengeCompletion, HabitCheckIn, MemberId } from '../types';

/** Hour after which a missing check-in is worth mentioning. */
export const STREAK_NUDGE_HOUR = 18;

export interface Reminder {
  id: string;
  icon: string;
  title: string;
  detail: string;
  /**
   * What tapping it does.
   *
   * `check-in` performs the action inline rather than navigating. The streak
   * card lives on Today and used to link to Today, which meant tapping the
   * thing that said "one tap" did nothing at all. If the copy promises one
   * tap, the card has to be the tap.
   */
  action: { kind: 'navigate'; href: string } | { kind: 'check-in' };
}

/**
 * Challenges that end today and this member hasn't claimed.
 *
 * Only ones already open are counted — a challenge that opens tomorrow and
 * closes tomorrow isn't expiring tonight, and saying so would be a lie that
 * costs trust the second time it happens.
 */
export function expiringToday(opts: {
  challenges: readonly Challenge[];
  completions: readonly ChallengeCompletion[];
  member: MemberId;
  today: string;
}): Challenge[] {
  const { challenges, completions, member, today } = opts;
  const done = new Set(
    completions.filter((c) => c.by === member).map((c) => c.challengeId),
  );
  return challenges.filter(
    (c) => c.activeUntil === today && c.activeFrom <= today && !done.has(c.id),
  );
}

export function isStreakAtRisk(opts: {
  habits: readonly HabitCheckIn[];
  member: MemberId;
  today: string;
  now: Date;
  onShabbat: boolean;
}): boolean {
  if (opts.onShabbat) return false;
  if (opts.now.getHours() < STREAK_NUDGE_HOUR) return false;
  return !opts.habits.some((h) => h.by === opts.member && h.date === opts.today);
}

/**
 * The nudges to show right now, most urgent first.
 *
 * Capped implicitly by there only being two kinds: a list that can grow
 * without bound stops being a nudge and becomes a second inbox.
 */
export function buildReminders(opts: {
  challenges: readonly Challenge[];
  completions: readonly ChallengeCompletion[];
  habits: readonly HabitCheckIn[];
  member: MemberId;
  today: string;
  now?: Date;
  onShabbat: boolean;
}): Reminder[] {
  const now = opts.now ?? new Date();
  const out: Reminder[] = [];

  if (opts.onShabbat) return out;

  const expiring = expiringToday(opts);
  if (expiring.length > 0) {
    out.push({
      id: 'expiring',
      icon: '⏳',
      title:
        expiring.length === 1
          ? '1 challenge expires tonight'
          : `${expiring.length} challenges expire tonight`,
      detail:
        expiring.length === 1
          ? expiring[0].title
          : `${expiring[0].title} and ${expiring.length - 1} more`,
      action: { kind: 'navigate', href: '/quest' },
    });
  }

  if (isStreakAtRisk({ ...opts, now })) {
    out.push({
      id: 'streak',
      icon: '🔥',
      title: 'Your streak needs one tap',
      detail: 'Tap here and the chain holds.',
      action: { kind: 'check-in' },
    });
  }

  return out;
}
