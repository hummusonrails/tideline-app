import { describe, it, expect } from 'vitest';
import {
  totalPoints,
  currentTier,
  nextTier,
  streakLength,
  countEventsOnDate,
  isCapExceeded,
  leaderboard,
  hasCompletedChallenge,
  DEFAULT_CONFIG,
} from './points';
import type { PointEvent, HabitCheckIn, ChallengeCompletion } from '../types';

function ev(to: string, amount: number, reason: PointEvent['reason'], at: string): PointEvent {
  return { id: Math.random().toString(36).slice(2), to, by: to, at, amount, reason };
}

describe('points engine', () => {
  it('sums points for a member only', () => {
    const events = [
      ev('a', 10, 'photo', '2099-03-01T10:00:00Z'),
      ev('b', 5, 'photo', '2099-03-01T10:00:00Z'),
      ev('a', 25, 'challenge', '2099-03-01T11:00:00Z'),
    ];
    expect(totalPoints(events, 'a')).toBe(35);
    expect(totalPoints(events, 'b')).toBe(5);
    expect(totalPoints(events, 'c')).toBe(0);
  });

  it('computes the current tier from thresholds', () => {
    expect(currentTier(0, DEFAULT_CONFIG)).toBe('none');
    expect(currentTier(99, DEFAULT_CONFIG)).toBe('none');
    expect(currentTier(100, DEFAULT_CONFIG)).toBe('bronze');
    expect(currentTier(300, DEFAULT_CONFIG)).toBe('silver');
    expect(currentTier(600, DEFAULT_CONFIG)).toBe('gold');
    expect(currentTier(1000, DEFAULT_CONFIG)).toBe('platinum');
    expect(currentTier(5000, DEFAULT_CONFIG)).toBe('platinum');
  });

  it('reports the next tier and remaining points', () => {
    expect(nextTier(0, DEFAULT_CONFIG)).toEqual({ tier: 'bronze', remaining: 100 });
    expect(nextTier(250, DEFAULT_CONFIG)).toEqual({ tier: 'silver', remaining: 50 });
    expect(nextTier(1000, DEFAULT_CONFIG)).toBeNull();
  });

  it('counts consecutive-day streaks ending today', () => {
    const checkIns: HabitCheckIn[] = [
      { id: '1', by: 'a', date: '2099-03-01', at: '' },
      { id: '2', by: 'a', date: '2099-03-02', at: '' },
      { id: '3', by: 'a', date: '2099-03-03', at: '' },
    ];
    expect(streakLength(checkIns, 'a', '2099-03-03')).toBe(3);
    // a gap breaks the streak
    expect(streakLength(checkIns, 'a', '2099-03-05')).toBe(0);
    // only counts the trailing run
    const withGap: HabitCheckIn[] = [...checkIns, { id: '4', by: 'a', date: '2099-03-05', at: '' }];
    expect(streakLength(withGap, 'a', '2099-03-05')).toBe(1);
  });

  it('enforces per-day caps', () => {
    const date = '2099-03-01';
    const events = [
      ev('a', 5, 'photo', `${date}T10:00:00Z`),
      ev('a', 5, 'photo', `${date}T11:00:00Z`),
    ];
    expect(countEventsOnDate(events, 'a', 'photo', date)).toBe(2);
    expect(isCapExceeded(events, 'a', 'photo', date, DEFAULT_CONFIG)).toBe(false);
    const maxed = Array.from({ length: DEFAULT_CONFIG.caps.photoPerDay }, (_, i) =>
      ev('a', 5, 'photo', `${date}T${String(i).padStart(2, '0')}:00:00Z`),
    );
    expect(isCapExceeded(maxed, 'a', 'photo', date, DEFAULT_CONFIG)).toBe(true);
  });

  it('builds a sorted leaderboard', () => {
    const events = [
      ev('a', 50, 'photo', '2099-03-01T10:00:00Z'),
      ev('b', 120, 'challenge', '2099-03-01T10:00:00Z'),
    ];
    const board = leaderboard(events, ['a', 'b', 'c']);
    expect(board.map((r) => r.member)).toEqual(['b', 'a', 'c']);
    expect(board[0]).toMatchObject({ member: 'b', points: 120, tier: 'bronze' });
    expect(board[2]).toMatchObject({ member: 'c', points: 0, tier: 'none' });
  });

  it('detects completed challenges', () => {
    const completions: ChallengeCompletion[] = [
      { id: '1', challengeId: 'x', by: 'a', completedAt: '', awardedPoints: 10 },
    ];
    expect(hasCompletedChallenge(completions, 'a', 'x')).toBe(true);
    expect(hasCompletedChallenge(completions, 'a', 'y')).toBe(false);
    expect(hasCompletedChallenge(completions, 'b', 'x')).toBe(false);
  });

  it('allows negative correction events to reduce a total', () => {
    const events = [
      ev('a', 100, 'challenge', '2099-03-01T10:00:00Z'),
      ev('a', -10, 'correction', '2099-03-01T12:00:00Z'),
    ];
    expect(totalPoints(events, 'a')).toBe(90);
  });
});
