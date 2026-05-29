import { describe, it, expect } from 'vitest';
import { todayYMD, isShabbatNow, type ShabbatTimes } from './time';

describe('time', () => {
  it('formats a local YYYY-MM-DD', () => {
    const d = new Date(2099, 2, 15, 9, 30); // Mar 15 2099 local
    expect(todayYMD(d)).toBe('2099-03-15');
  });

  describe('isShabbatNow', () => {
    const times: ShabbatTimes = {
      '2099-03-15': { candleLighting: '2099-03-15T19:55:00-07:00' },
      '2099-03-16': { havdalah: '2099-03-16T20:55:00-07:00' },
    };

    it('is false before candle lighting on Friday', () => {
      const before = new Date('2099-03-15T18:00:00-07:00');
      expect(isShabbatNow(times, before)).toBe(false);
    });

    it('is true after candle lighting Friday evening', () => {
      const after = new Date('2099-03-15T20:30:00-07:00');
      expect(isShabbatNow(times, after)).toBe(true);
    });

    it('is true Saturday before Havdalah', () => {
      const sat = new Date('2099-03-16T12:00:00-07:00');
      expect(isShabbatNow(times, sat)).toBe(true);
    });

    it('is false after Havdalah Saturday night', () => {
      const after = new Date('2099-03-16T21:30:00-07:00');
      expect(isShabbatNow(times, after)).toBe(false);
    });

    it('is false on a day with no Shabbat data', () => {
      const weekday = new Date('2099-03-18T12:00:00-07:00');
      expect(isShabbatNow(times, weekday)).toBe(false);
    });
  });
});
