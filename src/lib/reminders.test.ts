import { describe, it, expect } from 'vitest';
import { expiringToday, isStreakAtRisk, buildReminders, STREAK_NUDGE_HOUR } from './reminders';
import type { Challenge, ChallengeCompletion, HabitCheckIn } from '../types';

const ME = 'aaa111';
const THEM = 'bbb222';
const TODAY = '2026-08-18';

function challenge(over: Partial<Challenge> = {}): Challenge {
  return {
    id: 'c1', title: 'Bluest thing', description: '', icon: '💙',
    kind: 'daily', points: 20, proofType: 'photo',
    activeFrom: TODAY, activeUntil: TODAY, ...over,
  };
}

function completion(challengeId: string, by: string): ChallengeCompletion {
  return { id: `x-${challengeId}-${by}`, challengeId, by, completedAt: `${TODAY}T10:00:00Z`, awardedPoints: 20 };
}

/** A local Date at a given hour today — the nudge is wall-clock, not UTC. */
function atHour(hour: number): Date {
  const d = new Date(`${TODAY}T00:00:00`);
  d.setHours(hour, 0, 0, 0);
  return d;
}

describe('expiring today', () => {
  it('lists an open, unclaimed challenge ending today', () => {
    expect(expiringToday({ challenges: [challenge()], completions: [], member: ME, today: TODAY })).toHaveLength(1);
  });

  it('drops one this member already claimed', () => {
    expect(
      expiringToday({ challenges: [challenge()], completions: [completion('c1', ME)], member: ME, today: TODAY }),
    ).toHaveLength(0);
  });

  it("does not count someone else's claim as mine", () => {
    expect(
      expiringToday({ challenges: [challenge()], completions: [completion('c1', THEM)], member: ME, today: TODAY }),
    ).toHaveLength(1);
  });

  it('ignores challenges that end later', () => {
    expect(
      expiringToday({ challenges: [challenge({ activeUntil: '2026-08-20' })], completions: [], member: ME, today: TODAY }),
    ).toHaveLength(0);
  });

  it("ignores one that hasn't opened yet, even if it closes today", () => {
    // A same-day open/close authored in the future is not "expiring tonight".
    const notYet = challenge({ activeFrom: '2026-08-19', activeUntil: TODAY });
    expect(expiringToday({ challenges: [notYet], completions: [], member: ME, today: TODAY })).toHaveLength(0);
  });
});

describe('streak at risk', () => {
  const base = { habits: [] as HabitCheckIn[], member: ME, today: TODAY, onShabbat: false };

  it('stays quiet before the evening', () => {
    expect(isStreakAtRisk({ ...base, now: atHour(STREAK_NUDGE_HOUR - 1) })).toBe(false);
  });

  it('speaks up in the evening with no check-in', () => {
    expect(isStreakAtRisk({ ...base, now: atHour(STREAK_NUDGE_HOUR) })).toBe(true);
  });

  it('stays quiet once checked in', () => {
    const habits: HabitCheckIn[] = [{ id: 'h', by: ME, date: TODAY, at: `${TODAY}T09:00:00Z` }];
    expect(isStreakAtRisk({ ...base, habits, now: atHour(20) })).toBe(false);
  });

  it("does not count someone else's check-in", () => {
    const habits: HabitCheckIn[] = [{ id: 'h', by: THEM, date: TODAY, at: `${TODAY}T09:00:00Z` }];
    expect(isStreakAtRisk({ ...base, habits, now: atHour(20) })).toBe(true);
  });

  it('never nags on Shabbat', () => {
    expect(isStreakAtRisk({ ...base, now: atHour(21), onShabbat: true })).toBe(false);
  });
});

describe('building the list', () => {
  const opts = {
    challenges: [challenge(), challenge({ id: 'c2', title: 'Water in motion' })],
    completions: [],
    habits: [] as HabitCheckIn[],
    member: ME,
    today: TODAY,
    onShabbat: false,
  };

  it('puts the expiry first, then the streak', () => {
    const out = buildReminders({ ...opts, now: atHour(19) });
    expect(out.map((r) => r.id)).toEqual(['expiring', 'streak']);
  });

  it('summarizes more than one expiry', () => {
    const out = buildReminders({ ...opts, now: atHour(19) });
    expect(out[0].title).toBe('2 challenges expire tonight');
    expect(out[0].detail).toContain('and 1 more');
  });

  it('names a lone expiring challenge', () => {
    const out = buildReminders({ ...opts, challenges: [challenge()], now: atHour(12) });
    expect(out[0].title).toBe('1 challenge expires tonight');
    expect(out[0].detail).toBe('Bluest thing');
  });

  it('goes completely silent on Shabbat', () => {
    expect(buildReminders({ ...opts, now: atHour(21), onShabbat: true })).toEqual([]);
  });

  it('shows nothing when there is nothing to say', () => {
    expect(
      buildReminders({
        ...opts,
        challenges: [],
        habits: [{ id: 'h', by: ME, date: TODAY, at: `${TODAY}T09:00:00Z` }],
        now: atHour(21),
      }),
    ).toEqual([]);
  });
});
