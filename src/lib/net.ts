/**
 * Reachability state for the data backend.
 *
 * `navigator.onLine` is worse than useless at sea: a phone associated to a
 * cruise ship's WiFi reports `true` while every request is intercepted by a
 * captive portal. Anything gated on it burns battery on doomed fetches and
 * tells the user they're online when they aren't.
 *
 * So we probe for real. Three states:
 *
 *   internet     GitHub verifiably answered us.
 *   no-internet  It didn't. Captive portal, AP-isolated LAN, airplane mode —
 *                deliberately not distinguished, because nothing we *do*
 *                differs between them.
 *   unknown      Before the first probe resolves.
 */

import { create } from 'zustand';

export type NetState = 'internet' | 'no-internet' | 'unknown';

/** Cheap, unauthenticated, tiny response. */
const PROBE_URL = 'https://api.github.com/zen';
const PROBE_TIMEOUT_MS = 8_000;
/** Re-probe cadence: fast while we're cut off, lazy once we're through. */
const INTERVAL_NO_INTERNET_MS = 60_000;
const INTERVAL_INTERNET_MS = 5 * 60_000;

interface NetStore {
  state: NetState;
  checkedAt: number | null;
  set: (state: NetState) => void;
}

export const useNetState = create<NetStore>((set) => ({
  state: 'unknown',
  checkedAt: null,
  set: (state) => set({ state, checkedAt: Date.now() }),
}));

export function getNetState(): NetState {
  return useNetState.getState().state;
}

/**
 * True when it's worth attempting a backend call.
 *
 * Before the first probe lands we fall back to `navigator.onLine` so a cold
 * start isn't blocked on the probe — it's a bad signal, but "probably yes" is
 * the right default for the one-second window before we know better.
 */
export function shouldAttemptNetwork(): boolean {
  const s = getNetState();
  if (s === 'unknown') return navigator.onLine;
  return s === 'internet';
}

let inFlight: Promise<NetState> | null = null;

/**
 * Probe the backend and update the store.
 *
 * A captive portal happily returns HTTP 200 with its own login HTML, so status
 * alone proves nothing. We validate `x-github-request-id`, a header only the
 * real API sets — a portal would have to be impersonating GitHub specifically
 * to fool it.
 */
export async function probeNow(): Promise<NetState> {
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<NetState> => {
    let next: NetState = 'no-internet';
    try {
      const res = await fetch(PROBE_URL, {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (res.ok && res.headers.get('x-github-request-id')) next = 'internet';
    } catch {
      next = 'no-internet';
    }
    useNetState.getState().set(next);
    return next;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Start probing. Returns a teardown function.
 *
 * Re-probes on mount, whenever the OS claims connectivity changed, whenever
 * the app comes back to the foreground (the common case: phone was in a
 * pocket, we're now in port), and on an interval whose length depends on what
 * we found last time.
 */
export function startNetLoop(): () => void {
  let stopped = false;
  let timer: number | undefined;

  const schedule = (state: NetState) => {
    if (stopped) return;
    window.clearTimeout(timer);
    const delay = state === 'internet' ? INTERVAL_INTERNET_MS : INTERVAL_NO_INTERNET_MS;
    timer = window.setTimeout(run, delay);
  };

  const run = () => {
    if (stopped) return;
    void probeNow().then(schedule);
  };

  const onVis = () => {
    if (!document.hidden) run();
  };
  const onOnline = () => run();
  const onOffline = () => {
    // The OS is certain here in a way it never is about the positive case.
    useNetState.getState().set('no-internet');
    schedule('no-internet');
  };

  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  run();

  return () => {
    stopped = true;
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}
