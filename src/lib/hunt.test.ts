import { describe, expect, it } from 'vitest';
import { huntChallengeId, isHuntDone, shouldLockTrivia } from './hunt';
import type { Challenge, ChallengeCompletion } from '../types';

const completion = (challengeId: string, by = 'm-a'): ChallengeCompletion => ({
  id: `c-${challengeId}-${by}`,
  challengeId,
  by,
  completedAt: '2026-08-14T10:00:00.000Z',
  awardedPoints: 10,
});

const trivia = (over: Partial<Challenge> = {}): Challenge => ({
  id: 'ch-trivia',
  title: 'Quiz',
  description: '',
  icon: '🧠',
  kind: 'place-specific',
  points: 15,
  proofType: 'trivia',
  activeFrom: '2026-08-10',
  activeUntil: '2026-08-20',
  triviaPlaceSlug: 'harbour',
  ...over,
});

describe('huntChallengeId', () => {
  it('is stable for the same place and index', () => {
    expect(huntChallengeId('harbour', 2)).toBe(huntChallengeId('harbour', 2));
  });

  it('differs across indices and places', () => {
    expect(huntChallengeId('harbour', 0)).not.toBe(huntChallengeId('harbour', 1));
    expect(huntChallengeId('harbour', 0)).not.toBe(huntChallengeId('glacier', 0));
  });
});

describe('isHuntDone', () => {
  it('is false with no completions', () => {
    expect(isHuntDone([], 'm-a', 'harbour', 0)).toBe(false);
  });

  it('is true once that member claimed that item', () => {
    const done = [completion(huntChallengeId('harbour', 0), 'm-a')];
    expect(isHuntDone(done, 'm-a', 'harbour', 0)).toBe(true);
  });

  it('does not leak another member’s claim', () => {
    const done = [completion(huntChallengeId('harbour', 0), 'm-b')];
    expect(isHuntDone(done, 'm-a', 'harbour', 0)).toBe(false);
  });

  it('does not confuse neighbouring items', () => {
    const done = [completion(huntChallengeId('harbour', 0), 'm-a')];
    expect(isHuntDone(done, 'm-a', 'harbour', 1)).toBe(false);
  });
});

describe('shouldLockTrivia', () => {
  const base = {
    placeSlug: 'harbour',
    completions: [] as ChallengeCompletion[],
    member: 'm-a',
    today: '2026-08-14',
  };

  it('locks while a scored quiz on the same questions is still open', () => {
    expect(shouldLockTrivia({ ...base, challenges: [trivia()] })?.id).toBe('ch-trivia');
  });

  it('unlocks once the member has taken it', () => {
    expect(
      shouldLockTrivia({
        ...base,
        challenges: [trivia()],
        completions: [completion('ch-trivia', 'm-a')],
      }),
    ).toBeNull();
  });

  it('stays locked if a different member took it', () => {
    expect(
      shouldLockTrivia({
        ...base,
        challenges: [trivia()],
        completions: [completion('ch-trivia', 'm-b')],
      }),
    ).not.toBeNull();
  });

  it('unlocks after the challenge window closes', () => {
    expect(
      shouldLockTrivia({ ...base, challenges: [trivia({ activeUntil: '2026-08-12' })] }),
    ).toBeNull();
  });

  it('locks before the window opens, so answers cannot be pre-read', () => {
    expect(
      shouldLockTrivia({ ...base, challenges: [trivia({ activeFrom: '2026-08-18' })] }),
    ).not.toBeNull();
  });

  it('ignores quizzes about a different place', () => {
    expect(
      shouldLockTrivia({ ...base, challenges: [trivia({ triviaPlaceSlug: 'glacier' })] }),
    ).toBeNull();
  });

  it('ignores non-trivia challenges that mention the place', () => {
    expect(
      shouldLockTrivia({
        ...base,
        challenges: [trivia({ proofType: 'photo' })],
      }),
    ).toBeNull();
  });

  it('does not lock when there is no scored quiz at all', () => {
    expect(shouldLockTrivia({ ...base, challenges: [] })).toBeNull();
  });
});
