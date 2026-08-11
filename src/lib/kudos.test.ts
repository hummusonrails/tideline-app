import { describe, it, expect } from 'vitest';
import {
  kudosGivenOn, kudosRemaining, canSendKudos, kudosReceived,
  crewTotal, goalProgress, KUDOS_PER_DAY, MAX_NOTE_LENGTH,
} from './kudos';
import type { PointEvent } from '../types';

const A = 'aaa111';
const B = 'bbb222';
const C = 'ccc333';
const DATE = '2026-08-18';

let seq = 0;
function gift(by: string, to: string, at = `${DATE}T10:00:00Z`): PointEvent {
  return { id: `g${++seq}`, to, by, at, amount: 1, reason: 'gift', note: 'nice one' };
}
function earned(to: string, amount: number): PointEvent {
  return { id: `e${++seq}`, to, by: to, at: `${DATE}T10:00:00Z`, amount, reason: 'challenge' };
}

describe('the cap is on the giver', () => {
  it('counts what one member gave today', () => {
    const events = [gift(A, B), gift(A, C), gift(B, C)];
    expect(kudosGivenOn(events, A, DATE)).toBe(2);
    expect(kudosGivenOn(events, B, DATE)).toBe(1);
  });

  it('resets by day', () => {
    const events = [gift(A, B, '2026-08-17T10:00:00Z'), gift(A, B)];
    expect(kudosGivenOn(events, A, DATE)).toBe(1);
  });

  it('reports what is left', () => {
    expect(kudosRemaining([], A, DATE)).toBe(KUDOS_PER_DAY);
    expect(kudosRemaining([gift(A, B), gift(A, C)], A, DATE)).toBe(KUDOS_PER_DAY - 2);
  });

  it('never reports negative', () => {
    const many = Array.from({ length: 10 }, () => gift(A, B));
    expect(kudosRemaining(many, A, DATE)).toBe(0);
  });

  it("one sibling's generosity cannot exhaust the other's", () => {
    // The critical property of capping by giver: B is still full after A
    // spends everything.
    const spent = Array.from({ length: KUDOS_PER_DAY }, () => gift(A, C));
    expect(kudosRemaining(spent, A, DATE)).toBe(0);
    expect(kudosRemaining(spent, B, DATE)).toBe(KUDOS_PER_DAY);
  });

  it('receiving does not use up your own allowance', () => {
    const received = Array.from({ length: KUDOS_PER_DAY }, () => gift(B, A));
    expect(kudosRemaining(received, A, DATE)).toBe(KUDOS_PER_DAY);
  });
});

describe('validation', () => {
  const base = { events: [] as PointEvent[], giver: A, to: B, note: 'shared the snacks', date: DATE };

  it('allows a normal gift', () => {
    expect(canSendKudos(base)).toEqual({ ok: true });
  });

  it('refuses self-gifting', () => {
    expect(canSendKudos({ ...base, to: A }).ok).toBe(false);
  });

  it('requires a note — the note is the point', () => {
    expect(canSendKudos({ ...base, note: '   ' }).ok).toBe(false);
  });

  it('refuses an essay', () => {
    expect(canSendKudos({ ...base, note: 'x'.repeat(MAX_NOTE_LENGTH + 1) }).ok).toBe(false);
    expect(canSendKudos({ ...base, note: 'x'.repeat(MAX_NOTE_LENGTH) }).ok).toBe(true);
  });

  it('refuses once the daily allowance is spent', () => {
    const events = Array.from({ length: KUDOS_PER_DAY }, () => gift(A, C));
    const check = canSendKudos({ ...base, events });
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('today');
  });
});

describe('received list', () => {
  it('shows only gifts to me, newest first', () => {
    const events = [
      gift(B, A, '2026-08-18T09:00:00Z'),
      gift(C, A, '2026-08-18T11:00:00Z'),
      gift(A, B, '2026-08-18T12:00:00Z'),
      earned(A, 50),
    ];
    const mine = kudosReceived(events, A);
    expect(mine).toHaveLength(2);
    expect(mine[0].by).toBe(C);
  });
});

describe('crew goal', () => {
  const events = [earned(A, 400), earned(B, 300), earned(C, 200), gift(A, B)];

  it('sums everyone, gifts included', () => {
    expect(crewTotal(events)).toBe(901);
  });

  it('reports progress toward the target', () => {
    expect(goalProgress(events, 2500)).toEqual({ total: 901, pct: 36, reached: false });
  });

  it('caps the bar at full and marks it reached', () => {
    expect(goalProgress(events, 500)).toEqual({ total: 901, pct: 100, reached: true });
  });

  it('handles a nonsense target without dividing by zero', () => {
    expect(goalProgress(events, 0).pct).toBe(100);
  });

  it('counts a correction against the crew, not around it', () => {
    const withPenalty = [...events, { id: 'z', to: A, by: A, at: `${DATE}T13:00:00Z`, amount: -100, reason: 'correction' as const }];
    expect(crewTotal(withPenalty)).toBe(801);
  });
});
