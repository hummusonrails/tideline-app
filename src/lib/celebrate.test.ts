import { describe, expect, it } from 'vitest';
import { tierAckKey, tierRank, tierToCelebrate } from './celebrate';
import { DEFAULT_CONFIG } from './points';
import type { PointEvent } from '../types';

const ev = (amount: number, to = 'm-a'): PointEvent => ({
  id: `e-${Math.random()}`, to, by: to, at: '2026-08-14T12:00:00.000Z', amount, reason: 'photo',
});

describe('tierRank', () => {
  it('orders the tiers', () => {
    expect(tierRank('none')).toBeLessThan(tierRank('bronze'));
    expect(tierRank('bronze')).toBeLessThan(tierRank('silver'));
    expect(tierRank('silver')).toBeLessThan(tierRank('gold'));
    expect(tierRank('gold')).toBeLessThan(tierRank('platinum'));
  });
});

describe('tierToCelebrate', () => {
  it('says nothing below the first threshold', () => {
    expect(tierToCelebrate([ev(50)], 'm-a', DEFAULT_CONFIG, null)).toBeNull();
  });

  it('celebrates the first crossing', () => {
    expect(tierToCelebrate([ev(120)], 'm-a', DEFAULT_CONFIG, null)).toBe('bronze');
  });

  it('does not celebrate the same tier twice', () => {
    expect(tierToCelebrate([ev(120)], 'm-a', DEFAULT_CONFIG, 'bronze')).toBeNull();
  });

  it('celebrates the next tier up', () => {
    expect(tierToCelebrate([ev(320)], 'm-a', DEFAULT_CONFIG, 'bronze')).toBe('silver');
  });

  it('does not celebrate going backwards after a correction', () => {
    // Acknowledged gold, points since dropped to silver — nothing to say.
    expect(tierToCelebrate([ev(320)], 'm-a', DEFAULT_CONFIG, 'gold')).toBeNull();
  });

  it('skips straight to the reached tier if several are crossed at once', () => {
    expect(tierToCelebrate([ev(700)], 'm-a', DEFAULT_CONFIG, null)).toBe('gold');
  });

  it('only counts the member’s own points', () => {
    expect(tierToCelebrate([ev(500, 'm-b')], 'm-a', DEFAULT_CONFIG, null)).toBeNull();
  });
});

describe('tierAckKey', () => {
  it('is per member', () => {
    expect(tierAckKey('m-a')).not.toBe(tierAckKey('m-b'));
  });
});
