/**
 * Easter eggs: hidden things that happen if you poke the app in the right way,
 * on the right day, in the right place.
 *
 * The split here matters and is a privacy rule, not a style choice. This file
 * is *mechanism* — it knows that "a date trigger" and "a place trigger" exist.
 * Every concrete egg (which date, which place, what it says) is authored in
 * the private trip data. The public repo must never learn where this family is
 * going or what the joke is when they get there.
 *
 * A found egg is a {@link ChallengeCompletion} under an `egg-<id>` synthetic
 * id, so discoveries sync, dedup and pay out through machinery that already
 * exists — and each member gets to find each egg exactly once, themselves.
 */

import type {
  ChallengeCompletion,
  EggDef,
  EggMetric,
  EggTrigger,
  HabitCheckIn,
  ItineraryItem,
  MemberId,
  Message,
  Photo,
  PointEvent,
  Reaction,
} from '../types';
import { streakLength, totalPoints } from './points';

export const EGG_PREFIX = 'egg-';

export function eggChallengeId(eggId: string): string {
  return `${EGG_PREFIX}${eggId}`;
}

export function isEggCompletion(challengeId: string): boolean {
  return challengeId.startsWith(EGG_PREFIX);
}

export function hasFoundEgg(
  completions: readonly ChallengeCompletion[],
  member: MemberId,
  eggId: string,
): boolean {
  const id = eggChallengeId(eggId);
  return completions.some((c) => c.by === member && c.challengeId === id);
}

export function foundEggIds(
  completions: readonly ChallengeCompletion[],
  member: MemberId,
): Set<string> {
  const out = new Set<string>();
  for (const c of completions) {
    if (c.by === member && isEggCompletion(c.challengeId)) {
      out.add(c.challengeId.slice(EGG_PREFIX.length));
    }
  }
  return out;
}

// ---------- milestone metrics ----------

export interface EggStats {
  points: number;
  photos: number;
  streak: number;
  reactionsGiven: number;
  journals: number;
  challenges: number;
  eggsFound: number;
}

/**
 * Everything a milestone egg can watch, computed from local records only.
 *
 * Local-only is the whole trick: no coordination, nothing to sync, no way for
 * two devices to disagree, and it all works with the ship's WiFi switched off.
 */
export function computeEggStats(input: {
  member: MemberId;
  today: string;
  pointEvents: readonly PointEvent[];
  photos: readonly Photo[];
  habits: readonly HabitCheckIn[];
  reactions: readonly Reaction[];
  messages: readonly Message[];
  completions: readonly ChallengeCompletion[];
  shabbatFree?: ReadonlySet<string>;
}): EggStats {
  const { member } = input;
  return {
    points: totalPoints(input.pointEvents as PointEvent[], member),
    photos: input.photos.filter((p) => p.from === member).length,
    streak: streakLength(
      input.habits as HabitCheckIn[],
      member,
      input.today,
      input.shabbatFree,
    ),
    // Counts reactions *given*, including ones later retracted: the
    // achievement is for being the person who shows up in the threads, and
    // un-reacting shouldn't quietly claw it back.
    reactionsGiven: new Set(
      input.reactions.filter((r) => r.by === member).map((r) => r.messageId),
    ).size,
    journals: input.messages.filter((m) => m.from === member && m.kind === 'journal').length,
    challenges: input.completions.filter(
      (c) => c.by === member && !isEggCompletion(c.challengeId),
    ).length,
    eggsFound: foundEggIds(input.completions, member).size,
  };
}

export function metricValue(stats: EggStats, metric: EggMetric): number {
  return stats[metric];
}

// ---------- trigger evaluation ----------

export interface EggContext {
  today: string;
  todayItinerary: readonly ItineraryItem[];
  stats: EggStats;
}

/**
 * Does a *passive* trigger currently hold?
 *
 * Passive triggers (date, place-day, milestone) fire on their own when the
 * app notices the condition. Gesture triggers are driven by the UI instead —
 * see {@link matchesGesture} — because only the component that owns the
 * anchor knows it was tapped.
 */
export function isPassiveTriggerSatisfied(trigger: EggTrigger, ctx: EggContext): boolean {
  switch (trigger.kind) {
    case 'date':
      return ctx.today === trigger.date;
    case 'place-day':
      return ctx.todayItinerary.some((i) => i.placeSlug === trigger.placeSlug);
    case 'milestone':
      return metricValue(ctx.stats, trigger.metric) >= trigger.atLeast;
    default:
      return false;
  }
}

export function isGestureTrigger(trigger: EggTrigger): boolean {
  return (
    trigger.kind === 'tap-seq' ||
    trigger.kind === 'long-press' ||
    trigger.kind === 'corner-code'
  );
}

/**
 * Passive eggs this member should be shown right now, in authored order.
 * Already-found eggs drop out — an egg is a discovery, not a recurring popup.
 */
export function pendingPassiveEggs(
  eggs: readonly EggDef[],
  ctx: EggContext,
  found: ReadonlySet<string>,
): EggDef[] {
  return eggs.filter(
    (e) =>
      !found.has(e.id) &&
      !isGestureTrigger(e.trigger) &&
      isPassiveTriggerSatisfied(e.trigger, ctx),
  );
}

/**
 * Gesture eggs bound to a named UI anchor.
 *
 * Anchors are stable string handles ("streak-pill") that the private data
 * refers to and components register. A renamed anchor makes its eggs
 * unfindable rather than crashing anything.
 */
export function eggsForAnchor(
  eggs: readonly EggDef[],
  anchor: string,
  found: ReadonlySet<string>,
): EggDef[] {
  return eggs.filter((e) => {
    if (found.has(e.id)) return false;
    const t = e.trigger;
    return (t.kind === 'tap-seq' || t.kind === 'long-press') && t.anchor === anchor;
  });
}

export function cornerCodeEggs(eggs: readonly EggDef[]): EggDef[] {
  return eggs.filter((e) => e.trigger.kind === 'corner-code');
}

/**
 * Does a recorded corner sequence end with this egg's code?
 *
 * Matching the *tail* rather than the whole buffer means a wrong start
 * doesn't require a reset — you just keep tapping until the last N are right,
 * which is how every Konami code anyone has actually enjoyed works.
 */
export function matchesCornerCode(
  recent: readonly string[],
  sequence: readonly string[],
): boolean {
  if (sequence.length === 0 || recent.length < sequence.length) return false;
  const tail = recent.slice(-sequence.length);
  return tail.every((c, i) => c === sequence[i]);
}

/** Has a tap counter reached what a tap-seq egg asks for? */
export function matchesGesture(trigger: EggTrigger, taps: number): boolean {
  return trigger.kind === 'tap-seq' && taps >= trigger.count;
}

// ---------- crew deck ----------

export interface DeckEntry {
  id: string;
  found: boolean;
  /** Withheld until found for a secret egg. */
  title: string;
  copy: string | null;
  points: number;
}

/**
 * The trophy-room view.
 *
 * Unfound secrets show as "???" with no hint at all — the count is the only
 * information, which is exactly enough to be maddening. Unfound non-secret
 * eggs show their title, so there's something to chase.
 */
export function buildDeck(
  eggs: readonly EggDef[],
  found: ReadonlySet<string>,
): DeckEntry[] {
  return eggs.map((e) => {
    const isFound = found.has(e.id);
    return {
      id: e.id,
      found: isFound,
      title: isFound ? (e.title ?? e.copy) : e.secret ? '???' : (e.title ?? 'Unfound'),
      copy: isFound ? e.copy : null,
      points: e.points,
    };
  });
}

export function deckSummary(entries: readonly DeckEntry[]): { found: number; total: number } {
  return { found: entries.filter((e) => e.found).length, total: entries.length };
}
