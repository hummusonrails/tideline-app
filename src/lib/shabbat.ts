import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import type { ShabbatTimes } from './time';

/** Reads the cached Shabbat times pulled from the data backend. */
export function useShabbatTimes(): ShabbatTimes {
  const row = useLiveQuery(() => db.meta.get('shabbat-times'));
  const value = { ...((row?.value as Record<string, unknown>) ?? {}) };
  delete value._note; // strip the documentation field if present
  return value as ShabbatTimes;
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Every date the times file marks as Shabbat.
 *
 * A Friday entry carries candle lighting and the Saturday entry carries
 * havdalah, so both dates count — the observance spans them.
 */
export function shabbatDates(times: ShabbatTimes): Set<string> {
  const out = new Set<string>();
  for (const [date, t] of Object.entries(times ?? {})) {
    if (t && (t.candleLighting || t.havdalah)) out.add(date);
  }
  return out;
}
