import { describe, it, expect } from 'vitest';
import {
  momentJoinId,
  momentAllId,
  momentPhase,
  activeMoment,
  hasJoined,
  joinedMembers,
  hasAllCrewBonus,
  shouldMintAllCrew,
  formatCountdown,
  LEAD_MS,
} from './moments';
import type { ChallengeCompletion, Moment, Profile } from '../types';

const A = 'aaa111';
const B = 'bbb222';
const C = 'ccc333';
const D = 'ddd444';

const crew: Profile[] = [A, B, C, D].map((id) => ({
  id, displayName: id, role: 'kid' as const, createdAt: '2026-01-01T00:00:00Z',
}));

function moment(over: Partial<Moment> = {}): Moment {
  return {
    id: 'glacier',
    title: "Glacier o'clock",
    prompt: 'Port side, top deck.',
    startISO: '2026-08-18T10:00:00-08:00',
    endISO: '2026-08-18T14:00:00-08:00',
    joinPoints: 15,
    allBonus: 20,
    ...over,
  };
}

function completion(challengeId: string, by: string): ChallengeCompletion {
  return { id: `c-${challengeId}-${by}`, challengeId, by, completedAt: '2026-08-18T11:00:00Z', awardedPoints: 15 };
}

const at = (iso: string) => new Date(iso);

describe('ids', () => {
  it('namespaces joins and the crew bonus separately', () => {
    expect(momentJoinId('glacier')).toBe('moment-glacier');
    expect(momentAllId('glacier')).toBe('moment-glacier-all');
    expect(momentJoinId('glacier')).not.toBe(momentAllId('glacier'));
  });
});

describe('phases', () => {
  it('stays idle until the lead window', () => {
    expect(momentPhase(moment(), at('2026-08-17T10:00:00-08:00')).phase).toBe('idle');
  });

  it('counts down inside the lead window', () => {
    const state = momentPhase(moment(), at('2026-08-18T09:18:00-08:00'));
    expect(state.phase).toBe('soon');
    if (state.phase === 'soon') expect(state.msRemaining).toBe(42 * 60 * 1000);
  });

  it('opens exactly at the start', () => {
    expect(momentPhase(moment(), at('2026-08-18T10:00:00-08:00')).phase).toBe('live');
  });

  it('is live through the window and over at the end', () => {
    expect(momentPhase(moment(), at('2026-08-18T13:59:00-08:00')).phase).toBe('live');
    expect(momentPhase(moment(), at('2026-08-18T14:00:00-08:00')).phase).toBe('over');
  });

  it('appears exactly on the lead boundary', () => {
    const start = Date.parse('2026-08-18T10:00:00-08:00');
    expect(momentPhase(moment(), new Date(start - LEAD_MS)).phase).toBe('soon');
    expect(momentPhase(moment(), new Date(start - LEAD_MS - 1000)).phase).toBe('idle');
  });

  it('ignores an unparseable window rather than throwing', () => {
    expect(momentPhase(moment({ startISO: 'nope' })).phase).toBe('idle');
  });
});

describe('picking the one to show', () => {
  const soon = moment({ id: 'soon', startISO: '2026-08-18T13:00:00-08:00', endISO: '2026-08-18T15:00:00-08:00' });
  const live = moment({ id: 'live', startISO: '2026-08-18T09:00:00-08:00', endISO: '2026-08-18T12:00:00-08:00' });
  const past = moment({ id: 'past', startISO: '2026-08-17T09:00:00-08:00', endISO: '2026-08-17T12:00:00-08:00' });

  it('prefers a live moment over an upcoming one', () => {
    const picked = activeMoment([soon, live, past], at('2026-08-18T10:00:00-08:00'));
    expect(picked?.moment.id).toBe('live');
  });

  it('falls back to the nearest upcoming', () => {
    const later = moment({ id: 'later', startISO: '2026-08-18T20:00:00-08:00', endISO: '2026-08-18T22:00:00-08:00' });
    const picked = activeMoment([later, soon], at('2026-08-18T12:30:00-08:00'));
    expect(picked?.moment.id).toBe('soon');
  });

  it('shows nothing when everything is done', () => {
    expect(activeMoment([past], at('2026-08-18T10:00:00-08:00'))).toBeNull();
    expect(activeMoment([], at('2026-08-18T10:00:00-08:00'))).toBeNull();
  });
});

describe('check-ins', () => {
  it('tracks per member', () => {
    const rows = [completion(momentJoinId('glacier'), A)];
    expect(hasJoined(rows, A, 'glacier')).toBe(true);
    expect(hasJoined(rows, B, 'glacier')).toBe(false);
  });

  it('lists everyone in, without duplicates', () => {
    const rows = [
      completion(momentJoinId('glacier'), A),
      { ...completion(momentJoinId('glacier'), A), id: 'dupe' },
      completion(momentJoinId('glacier'), B),
    ];
    expect(joinedMembers(rows, 'glacier').sort()).toEqual([A, B]);
  });
});

describe('all-crew bonus', () => {
  const all = [A, B, C, D].map((m) => completion(momentJoinId('glacier'), m));

  it('mints once everyone is visibly in', () => {
    expect(shouldMintAllCrew({ moment: moment(), profiles: crew, completions: all, member: A })).toBe(true);
  });

  it('waits for the last hold-out', () => {
    expect(
      shouldMintAllCrew({ moment: moment(), profiles: crew, completions: all.slice(0, 3), member: A }),
    ).toBe(false);
  });

  it('never mints for someone who did not check in themselves', () => {
    const withoutMe = [B, C, D].map((m) => completion(momentJoinId('glacier'), m));
    expect(
      shouldMintAllCrew({ moment: moment(), profiles: crew, completions: withoutMe, member: A }),
    ).toBe(false);
  });

  it('does not pay twice', () => {
    const paid = [...all, completion(momentAllId('glacier'), A)];
    expect(hasAllCrewBonus(paid, A, 'glacier')).toBe(true);
    expect(shouldMintAllCrew({ moment: moment(), profiles: crew, completions: paid, member: A })).toBe(false);
    // ...but a crewmate who hasn't been paid still can be.
    expect(shouldMintAllCrew({ moment: moment(), profiles: crew, completions: paid, member: B })).toBe(true);
  });

  it('still pays after the window closes — gossip is late by nature', () => {
    expect(
      shouldMintAllCrew({ moment: moment({ endISO: '2020-01-01T00:00:00Z' }), profiles: crew, completions: all, member: A }),
    ).toBe(true);
  });

  it('is inert when the moment offers no bonus, or nobody is synced', () => {
    expect(shouldMintAllCrew({ moment: moment({ allBonus: 0 }), profiles: crew, completions: all, member: A })).toBe(false);
    expect(shouldMintAllCrew({ moment: moment(), profiles: [], completions: all, member: A })).toBe(false);
  });
});

describe('countdown formatting', () => {
  it('drops the hour when there is none', () => {
    expect(formatCountdown(42 * 60 * 1000 + 10_000)).toBe('42:10');
  });

  it('shows hours when there are some', () => {
    expect(formatCountdown((3 * 3600 + 4 * 60 + 5) * 1000)).toBe('3:04:05');
  });

  it('never goes negative', () => {
    expect(formatCountdown(-5000)).toBe('0:00');
  });
});
