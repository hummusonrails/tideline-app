import { describe, it, expect } from 'vitest';
import { isBeforeTrip } from './trip';

describe('trip gating', () => {
  it('is before the trip when today precedes the start date', () => {
    expect(isBeforeTrip('2099-03-15', '2099-01-01')).toBe(true);
    expect(isBeforeTrip('2099-03-15', '2099-03-14')).toBe(true);
  });

  it('is not before the trip on the start date or after', () => {
    expect(isBeforeTrip('2099-03-15', '2099-03-15')).toBe(false);
    expect(isBeforeTrip('2099-03-15', '2099-04-01')).toBe(false);
  });

  it('is never "before" when the start date is unknown', () => {
    expect(isBeforeTrip(undefined, '2099-01-01')).toBe(false);
  });
});
