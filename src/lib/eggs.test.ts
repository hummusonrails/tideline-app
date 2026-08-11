import { describe, it, expect } from 'vitest';
import {
  eggChallengeId,
  isEggCompletion,
  hasFoundEgg,
  foundEggIds,
  computeEggStats,
  metricValue,
  isPassiveTriggerSatisfied,
  isGestureTrigger,
  pendingPassiveEggs,
  eggsForAnchor,
  cornerCodeEggs,
  matchesCornerCode,
  matchesGesture,
  buildDeck,
  deckSummary,
  type EggContext,
  type EggStats,
} from './eggs';
import type {
  ChallengeCompletion,
  EggDef,
  HabitCheckIn,
  ItineraryItem,
  Message,
  Photo,
  PointEvent,
  Reaction,
} from '../types';

const ME = 'aaa111';
const THEM = 'bbb222';

function completion(challengeId: string, by: string): ChallengeCompletion {
  return { id: `c-${challengeId}-${by}`, challengeId, by, completedAt: '2026-08-18T10:00:00Z', awardedPoints: 5 };
}

const zeroStats: EggStats = {
  points: 0, photos: 0, streak: 0, reactionsGiven: 0, journals: 0, challenges: 0, eggsFound: 0,
};

function ctx(over: Partial<EggContext> = {}): EggContext {
  return { today: '2026-08-18', todayItinerary: [], stats: zeroStats, ...over };
}

const item = (placeSlug: string): ItineraryItem => ({
  id: `i-${placeSlug}`, date: '2026-08-18', kind: 'stop', title: placeSlug, placeSlug,
});

function egg(over: Partial<EggDef> = {}): EggDef {
  return { id: 'e1', trigger: { kind: 'date', date: '2026-08-18' }, effect: 'confetti', points: 10, copy: 'Surprise', ...over };
}

describe('egg completion ids', () => {
  it('namespaces eggs away from hunts and challenges', () => {
    expect(eggChallengeId('flame-7')).toBe('egg-flame-7');
    expect(isEggCompletion('egg-flame-7')).toBe(true);
    expect(isEggCompletion('hunt2-trail-s0')).toBe(false);
    expect(isEggCompletion('ph-trivia')).toBe(false);
  });

  it('tracks finds per member', () => {
    const found = [completion('egg-flame-7', ME)];
    expect(hasFoundEgg(found, ME, 'flame-7')).toBe(true);
    expect(hasFoundEgg(found, THEM, 'flame-7')).toBe(false);
  });

  it('collects a member’s found ids', () => {
    const rows = [
      completion('egg-a', ME),
      completion('egg-b', ME),
      completion('egg-c', THEM),
      completion('hunt2-x-s0', ME),
    ];
    expect([...foundEggIds(rows, ME)].sort()).toEqual(['a', 'b']);
  });
});

describe('stats', () => {
  const photos: Photo[] = [
    { id: 'p1', from: ME, takenAt: '2026-08-18T09:00:00Z', uploadedAt: '2026-08-18T09:00:00Z', filePath: '', width: 1, height: 1, bytes: 1, exifPresent: true },
    { id: 'p2', from: THEM, takenAt: '2026-08-18T09:00:00Z', uploadedAt: '2026-08-18T09:00:00Z', filePath: '', width: 1, height: 1, bytes: 1, exifPresent: true },
  ];
  const pointEvents: PointEvent[] = [
    { id: 'e1', to: ME, by: ME, at: '2026-08-18T09:00:00Z', amount: 40, reason: 'challenge' },
    { id: 'e2', to: THEM, by: THEM, at: '2026-08-18T09:00:00Z', amount: 999, reason: 'challenge' },
  ];
  const habits: HabitCheckIn[] = [
    { id: 'h1', by: ME, date: '2026-08-17', at: '2026-08-17T09:00:00Z' },
    { id: 'h2', by: ME, date: '2026-08-18', at: '2026-08-18T09:00:00Z' },
  ];
  const messages: Message[] = [
    { id: 'm1', from: ME, sentAt: '2026-08-18T09:00:00Z', body: 'dear diary', kind: 'journal' },
    { id: 'm2', from: ME, sentAt: '2026-08-18T09:05:00Z', body: 'hi', kind: 'message' },
  ];
  const reactions: Reaction[] = [
    { id: 'r1', messageId: 'm1', by: ME, emoji: '❤️', at: '2026-08-18T09:01:00Z' },
    { id: 'r2', messageId: 'm1', by: ME, emoji: null, at: '2026-08-18T09:02:00Z' },
    { id: 'r3', messageId: 'm2', by: ME, emoji: '😂', at: '2026-08-18T09:03:00Z' },
    { id: 'r4', messageId: 'm2', by: THEM, emoji: '😂', at: '2026-08-18T09:04:00Z' },
  ];
  const completions = [completion('egg-a', ME), completion('ph-trivia', ME)];

  const stats = computeEggStats({
    member: ME, today: '2026-08-18', pointEvents, photos, habits, reactions, messages, completions,
  });

  it('counts only this member’s things', () => {
    expect(stats.points).toBe(40);
    expect(stats.photos).toBe(1);
    expect(stats.journals).toBe(1);
  });

  it('counts distinct messages reacted to, retractions included', () => {
    // m1 was reacted then un-reacted, m2 once. Still two threads shown up in.
    expect(stats.reactionsGiven).toBe(2);
  });

  it('excludes eggs from the challenge count but counts them as eggs', () => {
    expect(stats.challenges).toBe(1);
    expect(stats.eggsFound).toBe(1);
  });

  it('reads the current streak', () => {
    expect(stats.streak).toBe(2);
  });

  it('exposes metrics by name', () => {
    expect(metricValue(stats, 'photos')).toBe(1);
    expect(metricValue(stats, 'points')).toBe(40);
  });
});

describe('passive triggers', () => {
  it('fires a date egg only on the day', () => {
    const t = { kind: 'date' as const, date: '2026-08-18' };
    expect(isPassiveTriggerSatisfied(t, ctx())).toBe(true);
    expect(isPassiveTriggerSatisfied(t, ctx({ today: '2026-08-19' }))).toBe(false);
  });

  it('fires a place egg from the itinerary, not from coordinates', () => {
    const t = { kind: 'place-day' as const, placeSlug: 'ice-bay' };
    expect(isPassiveTriggerSatisfied(t, ctx())).toBe(false);
    expect(isPassiveTriggerSatisfied(t, ctx({ todayItinerary: [item('ice-bay')] }))).toBe(true);
  });

  it('fires a milestone egg at or above the threshold', () => {
    const t = { kind: 'milestone' as const, metric: 'photos' as const, atLeast: 50 };
    expect(isPassiveTriggerSatisfied(t, ctx({ stats: { ...zeroStats, photos: 49 } }))).toBe(false);
    expect(isPassiveTriggerSatisfied(t, ctx({ stats: { ...zeroStats, photos: 50 } }))).toBe(true);
  });

  it('never treats a gesture as passive', () => {
    expect(isPassiveTriggerSatisfied({ kind: 'tap-seq', anchor: 'x', count: 3 }, ctx())).toBe(false);
    expect(isGestureTrigger({ kind: 'long-press', anchor: 'x', ms: 900 })).toBe(true);
    expect(isGestureTrigger({ kind: 'date', date: '2026-08-18' })).toBe(false);
  });
});

describe('pending passive eggs', () => {
  it('offers a satisfied, unfound egg', () => {
    expect(pendingPassiveEggs([egg()], ctx(), new Set())).toHaveLength(1);
  });

  it('drops one already found — a discovery, not a recurring popup', () => {
    expect(pendingPassiveEggs([egg()], ctx(), new Set(['e1']))).toHaveLength(0);
  });

  it('leaves gesture eggs to the UI', () => {
    const gesture = egg({ id: 'g', trigger: { kind: 'tap-seq', anchor: 'streak-pill', count: 7 } });
    expect(pendingPassiveEggs([gesture], ctx(), new Set())).toHaveLength(0);
  });
});

describe('gesture wiring', () => {
  const tap = egg({ id: 'tap', trigger: { kind: 'tap-seq', anchor: 'streak-pill', count: 7 } });
  const press = egg({ id: 'press', trigger: { kind: 'long-press', anchor: 'sea-banner-ship', ms: 1500 } });
  const konami = egg({ id: 'konami', trigger: { kind: 'corner-code', sequence: ['tl', 'tr', 'tl', 'tr'] } });

  it('finds eggs bound to an anchor', () => {
    expect(eggsForAnchor([tap, press, konami], 'streak-pill', new Set()).map((e) => e.id)).toEqual(['tap']);
  });

  it('hides an anchor egg once found', () => {
    expect(eggsForAnchor([tap], 'streak-pill', new Set(['tap']))).toHaveLength(0);
  });

  it('collects corner-code eggs', () => {
    expect(cornerCodeEggs([tap, press, konami]).map((e) => e.id)).toEqual(['konami']);
  });

  it('counts taps toward a tap-seq', () => {
    expect(matchesGesture(tap.trigger, 6)).toBe(false);
    expect(matchesGesture(tap.trigger, 7)).toBe(true);
    expect(matchesGesture(press.trigger, 99)).toBe(false);
  });
});

describe('corner codes', () => {
  const seq = ['tl', 'tr', 'tl', 'tr'];

  it('matches an exact run', () => {
    expect(matchesCornerCode(['tl', 'tr', 'tl', 'tr'], seq)).toBe(true);
  });

  it('matches the tail, so a fumbled start still works', () => {
    expect(matchesCornerCode(['br', 'bl', 'tl', 'tr', 'tl', 'tr'], seq)).toBe(true);
  });

  it('rejects a wrong or too-short run', () => {
    expect(matchesCornerCode(['tl', 'tr', 'tl'], seq)).toBe(false);
    expect(matchesCornerCode(['tl', 'tr', 'tr', 'tr'], seq)).toBe(false);
    expect(matchesCornerCode([], seq)).toBe(false);
  });
});

describe('crew deck', () => {
  const eggs = [
    egg({ id: 'a', title: 'Flame on', copy: 'You did it' }),
    egg({ id: 'b', title: 'Dawn Patrol', copy: 'Up before six', secret: true }),
    egg({ id: 'c', title: 'Sonar', copy: 'Ping' }),
  ];

  it('withholds a secret’s name until it is found', () => {
    const deck = buildDeck(eggs, new Set(['a']));
    expect(deck[0]).toMatchObject({ found: true, title: 'Flame on', copy: 'You did it' });
    expect(deck[1]).toMatchObject({ found: false, title: '???', copy: null });
  });

  it('names an unfound non-secret so there is something to chase', () => {
    expect(buildDeck(eggs, new Set())[2]).toMatchObject({ found: false, title: 'Sonar', copy: null });
  });

  it('summarizes progress', () => {
    expect(deckSummary(buildDeck(eggs, new Set(['a', 'c'])))).toEqual({ found: 2, total: 3 });
  });
});
