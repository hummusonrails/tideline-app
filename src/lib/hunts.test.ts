import { describe, it, expect } from 'vitest';
import {
  huntStageId,
  huntFinaleId,
  parseHuntStageId,
  normalizeAnswer,
  hashAnswer,
  checkCodeAnswer,
  huntTeamMembers,
  isOnHuntTeam,
  huntProgress,
  currentStageIndex,
  completedStageCount,
  isHuntComplete,
  stagePoints,
  hasFinaleBonus,
  isHuntVisible,
  sortHunts,
  stageLockReason,
  type HuntContext,
} from './hunts';
import type { ChallengeCompletion, Hunt, ItineraryItem, Profile } from '../types';

const PARENT_A = 'aaa111';
const PARENT_B = 'bbb222';
const KID_A = 'ccc333';
const KID_B = 'ddd444';

const profiles: Profile[] = [
  { id: PARENT_A, displayName: 'P1', role: 'parent', createdAt: '2026-01-01T00:00:00Z' },
  { id: PARENT_B, displayName: 'P2', role: 'parent', createdAt: '2026-01-01T00:00:00Z' },
  { id: KID_A, displayName: 'K1', role: 'kid', createdAt: '2026-01-01T00:00:00Z' },
  { id: KID_B, displayName: 'K2', role: 'kid', createdAt: '2026-01-01T00:00:00Z' },
];

function hunt(over: Partial<Hunt> = {}): Hunt {
  return {
    id: 'trail',
    title: 'The Trail',
    icon: '⛏️',
    intro: 'Follow it.',
    kind: 'port',
    finaleBonus: 50,
    activeFrom: '2026-08-17',
    activeUntil: '2026-08-17',
    stages: [
      { clue: 'one', proof: { type: 'checkbox' }, points: 20 },
      { clue: 'two', proof: { type: 'photo' }, points: 15 },
      { clue: 'three', proof: { type: 'checkbox' }, points: 10 },
    ],
    ...over,
  };
}

function completion(challengeId: string, by: string, marks?: number[]): ChallengeCompletion {
  return {
    id: `c-${challengeId}-${by}`,
    challengeId,
    by,
    completedAt: '2026-08-17T12:00:00Z',
    awardedPoints: 10,
    triviaAnswers: marks,
  };
}

function ctx(over: Partial<HuntContext> = {}): HuntContext {
  return {
    today: '2026-08-17',
    now: new Date('2026-08-17T12:00:00-08:00'),
    todayItinerary: [],
    profiles,
    completions: [],
    member: KID_A,
    ...over,
  };
}

const item = (placeSlug: string): ItineraryItem => ({
  id: `i-${placeSlug}`,
  date: '2026-08-17',
  kind: 'stop',
  title: placeSlug,
  placeSlug,
});

describe('synthetic ids', () => {
  it('derives a stable stage id', () => {
    expect(huntStageId('trail', 0)).toBe('hunt2-trail-s0');
    expect(huntStageId('trail', 12)).toBe('hunt2-trail-s12');
  });

  it('round-trips through the parser', () => {
    expect(parseHuntStageId(huntStageId('example-trail', 3))).toEqual({
      huntId: 'example-trail',
      stageIndex: 3,
    });
  });

  it('ignores ids belonging to other mechanics', () => {
    expect(parseHuntStageId('hunt-somewhere-2')).toBeNull();   // v1 place checklist
    expect(parseHuntStageId('egg-flame-7')).toBeNull();
    expect(parseHuntStageId(huntFinaleId('trail'))).toBeNull();
  });
});

describe('answer normalization', () => {
  it('forgives case, padding and doubled spaces', () => {
    expect(normalizeAnswer('  Arctic   Brotherhood ')).toBe('arctic brotherhood');
  });

  it('forgives trailing punctuation', () => {
    expect(normalizeAnswer('2865 ft.')).toBe('2865 ft');
    expect(normalizeAnswer('yes!')).toBe('yes');
  });

  it('matches a hashed answer typed sloppily', async () => {
    const stored = await hashAnswer('AB');
    expect(await checkCodeAnswer('  ab ', stored)).toBe(true);
    expect(await checkCodeAnswer('ba', stored)).toBe(false);
  });

  it('rejects an empty answer without hashing it', async () => {
    const stored = await hashAnswer('');
    expect(await checkCodeAnswer('   ', stored)).toBe(false);
  });
});

describe('teams', () => {
  it('defaults to everyone', () => {
    expect(huntTeamMembers(hunt(), profiles)).toHaveLength(4);
  });

  it('resolves kids and parents by role', () => {
    expect(huntTeamMembers(hunt({ team: 'kids' }), profiles)).toEqual([KID_A, KID_B]);
    expect(huntTeamMembers(hunt({ team: 'parents' }), profiles)).toEqual([PARENT_A, PARENT_B]);
  });

  it('keeps the other team out', () => {
    expect(isOnHuntTeam(hunt({ team: 'kids' }), profiles, PARENT_A)).toBe(false);
    expect(isOnHuntTeam(hunt({ team: 'kids' }), profiles, KID_B)).toBe(true);
  });
});

describe('stage gating', () => {
  it('opens the first stage and hides the rest', () => {
    const states = huntProgress(hunt(), ctx());
    expect(states.map((s) => s.status)).toEqual(['open', 'future', 'future']);
    expect(currentStageIndex(states)).toBe(0);
  });

  it('advances the frontier as stages are solved', () => {
    const states = huntProgress(
      hunt(),
      ctx({ completions: [completion(huntStageId('trail', 0), KID_A)] }),
    );
    expect(states.map((s) => s.status)).toEqual(['done', 'open', 'future']);
    expect(completedStageCount(states)).toBe(1);
  });

  it('lets a teammate advance the stage for the whole team', () => {
    const states = huntProgress(
      hunt({ team: 'kids' }),
      ctx({ member: KID_B, completions: [completion(huntStageId('trail', 0), KID_A)] }),
    );
    expect(states[0].status).toBe('done');
  });

  it("ignores the other team's completions", () => {
    const states = huntProgress(
      hunt({ team: 'kids' }),
      ctx({ member: KID_B, completions: [completion(huntStageId('trail', 0), PARENT_A)] }),
    );
    expect(states[0].status).toBe('open');
  });

  it('records that a hint was taken', () => {
    const states = huntProgress(
      hunt(),
      ctx({ completions: [completion(huntStageId('trail', 0), KID_A, [1])] }),
    );
    expect(states[0]).toMatchObject({ status: 'done', hintUsed: true });
  });

  it('reports completion only when every stage is done', () => {
    const all = [0, 1, 2].map((i) => completion(huntStageId('trail', i), KID_A));
    expect(isHuntComplete(huntProgress(hunt(), ctx({ completions: all })))).toBe(true);
    expect(isHuntComplete(huntProgress(hunt(), ctx({ completions: all.slice(0, 2) })))).toBe(false);
  });
});

describe('unlock conditions', () => {
  const dated = hunt({
    stages: [{ clue: 'later', proof: { type: 'checkbox' }, points: 10, unlock: { onOrAfterDate: '2026-08-18' } }],
  });

  it('locks a stage dated in the future', () => {
    const states = huntProgress(dated, ctx({ today: '2026-08-17' }));
    expect(states[0]).toMatchObject({ status: 'locked' });
  });

  it('opens it on the day', () => {
    expect(huntProgress(dated, ctx({ today: '2026-08-18' }))[0].status).toBe('open');
  });

  it('requires the itinerary to put us in the place', () => {
    const stage = { clue: 'here', proof: { type: 'checkbox' as const }, points: 10, unlock: { placeSlug: 'harbour-town' } };
    expect(stageLockReason(stage, ctx())).toContain('Unlocks when');
    expect(stageLockReason(stage, ctx({ todayItinerary: [item('harbour-town')] }))).toBeNull();
  });

  it('respects a wall-clock gate', () => {
    const stage = {
      clue: 'after the bus leaves',
      proof: { type: 'checkbox' as const },
      points: 10,
      unlock: { notBeforeISO: '2026-08-17T09:30:00-08:00' },
    };
    expect(stageLockReason(stage, ctx({ now: new Date('2026-08-17T08:00:00-08:00') }))).toBe('Unlocks later today');
    expect(stageLockReason(stage, ctx({ now: new Date('2026-08-17T10:00:00-08:00') }))).toBeNull();
  });

  it('needs every present condition to pass', () => {
    const stage = {
      clue: 'both',
      proof: { type: 'checkbox' as const },
      points: 10,
      unlock: { onOrAfterDate: '2026-08-17', placeSlug: 'harbour-town' },
    };
    // Date is fine, place is not.
    expect(stageLockReason(stage, ctx())).not.toBeNull();
    expect(stageLockReason(stage, ctx({ todayItinerary: [item('harbour-town')] }))).toBeNull();
  });
});

describe('points', () => {
  it('halves a stage when the hint was taken, rounding up', () => {
    expect(stagePoints({ clue: '', proof: { type: 'checkbox' }, points: 20 }, false)).toBe(20);
    expect(stagePoints({ clue: '', proof: { type: 'checkbox' }, points: 20 }, true)).toBe(10);
    expect(stagePoints({ clue: '', proof: { type: 'checkbox' }, points: 15 }, true)).toBe(8);
  });

  it('tracks the finale bonus per member, not per team', () => {
    const done = [completion(huntFinaleId('trail'), KID_A)];
    expect(hasFinaleBonus(hunt(), done, KID_A)).toBe(true);
    expect(hasFinaleBonus(hunt(), done, KID_B)).toBe(false);
  });
});

describe('visibility', () => {
  it('hides a hunt outside its window', () => {
    expect(isHuntVisible(hunt(), ctx({ today: '2026-08-16' }))).toBe(false);
    expect(isHuntVisible(hunt(), ctx({ today: '2026-08-18' }))).toBe(false);
    expect(isHuntVisible(hunt(), ctx())).toBe(true);
  });

  it('hides a hunt from someone not on its team', () => {
    expect(isHuntVisible(hunt({ team: 'kids' }), ctx({ member: PARENT_A }))).toBe(false);
  });

  it('keeps a hidden hunt out of sight until its first stage could open', () => {
    const secret = hunt({
      hidden: true,
      stages: [{ clue: 'psst', proof: { type: 'checkbox' }, points: 10, unlock: { placeSlug: 'harbour-town' } }],
    });
    expect(isHuntVisible(secret, ctx())).toBe(false);
    expect(isHuntVisible(secret, ctx({ todayItinerary: [item('harbour-town')] }))).toBe(true);
  });

  it('keeps a hidden hunt visible once it has been started', () => {
    const secret = hunt({
      hidden: true,
      stages: [
        { clue: 'psst', proof: { type: 'checkbox' }, points: 10, unlock: { placeSlug: 'harbour-town' } },
        { clue: 'next', proof: { type: 'checkbox' }, points: 10 },
      ],
    });
    const started = ctx({ completions: [completion(huntStageId('trail', 0), KID_A)] });
    expect(isHuntVisible(secret, started)).toBe(true);
  });
});

describe('ordering', () => {
  it('floats actionable hunts above locked ones and finished ones last', () => {
    const open = { hunt: hunt({ id: 'open' }), states: huntProgress(hunt({ id: 'open' }), ctx()) };
    const lockedHunt = hunt({
      id: 'locked',
      stages: [{ clue: 'x', proof: { type: 'checkbox' }, points: 10, unlock: { onOrAfterDate: '2026-08-20' } }],
    });
    const locked = { hunt: lockedHunt, states: huntProgress(lockedHunt, ctx()) };
    const doneHunt = hunt({ id: 'done', stages: [{ clue: 'x', proof: { type: 'checkbox' }, points: 10 }] });
    const done = {
      hunt: doneHunt,
      states: huntProgress(doneHunt, ctx({ completions: [completion(huntStageId('done', 0), KID_A)] })),
    };

    expect(sortHunts([done, locked, open]).map((h) => h.hunt.id)).toEqual(['open', 'locked', 'done']);
  });
});
