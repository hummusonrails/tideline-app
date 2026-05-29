/**
 * Time helpers — local YYYY-MM-DD strings and human-friendly diffs.
 * "Today" is always the device's local time (which moves with the user
 * across time zones automatically).
 */

export function todayYMD(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function shortWeekday(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' });
}

export function prettyDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

export function timeOfDay(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const dt = new Date();
  dt.setHours(h, m, 0, 0);
  return dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function diffHuman(toISO: string, from: Date = new Date()): string {
  const ms = Date.parse(toISO) - from.getTime();
  if (ms <= 0) return 'now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `in ${h}h ${m}m` : `in ${h}h`;
  const d = Math.floor(h / 24);
  return `in ${d}d`;
}

/**
 * Hebcal candle-lighting/Havdalah lookup is fetched at build time and
 * cached as config/shabbat-times.json in the data backend (per geoid).
 * At runtime we just read the cached file.
 * Format: { "<YYYY-MM-DD>": { candleLighting?: ISO, havdalah?: ISO } }
 */
export type ShabbatTimes = Record<
  string,
  { candleLighting?: string; havdalah?: string; location?: string }
>;

export function isShabbatNow(times: ShabbatTimes, now: Date = new Date()): boolean {
  const dateKey = todayYMD(now);
  const t = times[dateKey];
  if (!t) return false;
  const c = t.candleLighting ? Date.parse(t.candleLighting) : null;
  const h = t.havdalah ? Date.parse(t.havdalah) : null;
  const nowMs = now.getTime();
  // Friday after candle lighting
  if (c && nowMs >= c) {
    const tomorrow = times[addDays(dateKey, 1)];
    const havd = tomorrow?.havdalah ? Date.parse(tomorrow.havdalah) : null;
    return havd === null || nowMs < havd;
  }
  // Saturday before Havdalah
  if (h && nowMs < h) {
    const yesterday = times[addDays(dateKey, -1)];
    const cand = yesterday?.candleLighting ? Date.parse(yesterday.candleLighting) : null;
    return cand !== null && nowMs >= cand;
  }
  return false;
}

function addDays(yyyymmdd: string, n: number): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
