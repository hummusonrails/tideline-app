import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { useSession } from '../state/session';
import { todayYMD } from './time';
import { shabbatDates, useShabbatTimes } from './shabbat';
import { completeSynthetic } from './award';
import {
  computeEggStats,
  eggChallengeId,
  eggsForAnchor,
  foundEggIds,
  cornerCodeEggs,
  matchesCornerCode,
  matchesGesture,
  pendingPassiveEggs,
  type EggContext,
} from './eggs';
import type { EggDef } from '../types';

/**
 * Runtime for easter eggs: watches for the conditions, records the find, and
 * hands the effect to whoever is rendering the overlay.
 *
 * Lives above the router so a gesture on one screen and a milestone noticed on
 * another share one found-set and one queue. Everything it needs is already in
 * IndexedDB, so it works with the ship's WiFi off.
 */

type Corner = 'tl' | 'tr' | 'bl' | 'br';

interface EggRuntime {
  /** The egg currently being shown, if any. */
  active: EggDef | null;
  dismiss: () => void;
  /** Register a tap on a named anchor. Returns true if it popped an egg. */
  tapAnchor: (anchor: string) => void;
  /** Register a completed long-press on a named anchor. */
  pressAnchor: (anchor: string) => void;
  /** Register a corner tap for Konami-style codes. */
  tapCorner: (corner: Corner) => void;
  /**
   * Set once the built-in Crew Deck code has been entered. Watched by a
   * component inside the router, which does the navigating and clears it.
   */
  deckRequested: boolean;
  clearDeckRequest: () => void;
  /** Every authored egg, for the Crew Deck. */
  eggs: EggDef[];
  found: Set<string>;
}

/**
 * The way into the Crew Deck.
 *
 * Lives here, above the router, rather than in the component that listens for
 * taps: entering it means tapping controls that navigate, and a buffer held by
 * a screen-level component would be wiped by the very first tap.
 */
const DECK_CODE: Corner[] = ['tl', 'tr', 'tl', 'tr'];

const Ctx = createContext<EggRuntime | null>(null);

/** How long a run of corner taps stays "live" before the buffer resets. */
const CORNER_WINDOW_MS = 6000;
/** Taps on an anchor expire too, so yesterday's stray taps don't accumulate. */
const TAP_WINDOW_MS = 4000;

export function EggProvider({ children }: { children: React.ReactNode }) {
  const myId = useSession((s) => s.identity);
  const today = todayYMD();

  const eggsRow = useLiveQuery(() => db.meta.get('eggs'), []);
  const completions = useLiveQuery(() => db.completions.toArray(), []) ?? [];
  const pointEvents = useLiveQuery(() => db.pointEvents.toArray(), []) ?? [];
  const photos = useLiveQuery(() => db.photos.toArray(), []) ?? [];
  const habits = useLiveQuery(() => db.habits.toArray(), []) ?? [];
  const reactions = useLiveQuery(() => db.reactions.toArray(), []) ?? [];
  const messages = useLiveQuery(() => db.messages.toArray(), []) ?? [];
  const todayItinerary =
    useLiveQuery(() => db.itinerary.where('date').equals(today).toArray(), [today]) ?? [];
  const shabbatTimes = useShabbatTimes();

  const [active, setActive] = useState<EggDef | null>(null);
  const [deckRequested, setDeckRequested] = useState(false);
  const taps = useRef(new Map<string, { count: number; at: number }>());
  const corners = useRef<{ seq: Corner[]; at: number }>({ seq: [], at: 0 });

  const eggs = useMemo<EggDef[]>(
    () => (Array.isArray(eggsRow?.value) ? (eggsRow.value as EggDef[]) : []),
    [eggsRow],
  );
  const found = useMemo(
    () => (myId ? foundEggIds(completions, myId) : new Set<string>()),
    [completions, myId],
  );

  const shabbatFree = useMemo(() => shabbatDates(shabbatTimes), [shabbatTimes]);
  const ctx = useMemo<EggContext>(() => {
    const stats = myId
      ? computeEggStats({
          member: myId, today, pointEvents, photos, habits, reactions, messages,
          completions, shabbatFree,
        })
      : { points: 0, photos: 0, streak: 0, reactionsGiven: 0, journals: 0, challenges: 0, eggsFound: 0 };
    return { today, todayItinerary, stats };
  }, [myId, today, pointEvents, photos, habits, reactions, messages, completions, shabbatFree, todayItinerary]);

  /**
   * Record a find and raise the effect.
   *
   * The write is guarded by completeSynthetic, so two triggers racing for the
   * same egg (a milestone crossing at the same moment it's tapped) still pay
   * out once.
   */
  const fire = useCallback(
    (egg: EggDef) => {
      if (!myId || found.has(egg.id)) return;
      setActive(egg);
      void completeSynthetic({
        challengeId: eggChallengeId(egg.id),
        by: myId,
        points: egg.points,
        commitMessage: `found: ${egg.id}`,
      });
    },
    [myId, found],
  );

  // Passive eggs — a date arriving, a place reached, a milestone crossed.
  // Only one at a time: two overlays stacked would hide each other.
  useEffect(() => {
    if (active || !myId) return;
    const next = pendingPassiveEggs(eggs, ctx, found)[0];
    if (next) fire(next);
  }, [active, eggs, ctx, found, myId, fire]);

  const tapAnchor = useCallback(
    (anchor: string) => {
      const now = Date.now();
      const prior = taps.current.get(anchor);
      const count = prior && now - prior.at < TAP_WINDOW_MS ? prior.count + 1 : 1;
      taps.current.set(anchor, { count, at: now });
      for (const egg of eggsForAnchor(eggs, anchor, found)) {
        if (matchesGesture(egg.trigger, count)) {
          taps.current.delete(anchor);
          fire(egg);
          return;
        }
      }
    },
    [eggs, found, fire],
  );

  const pressAnchor = useCallback(
    (anchor: string) => {
      for (const egg of eggsForAnchor(eggs, anchor, found)) {
        if (egg.trigger.kind === 'long-press') {
          fire(egg);
          return;
        }
      }
    },
    [eggs, found, fire],
  );

  const tapCorner = useCallback(
    (corner: Corner) => {
      const now = Date.now();
      const stale = now - corners.current.at > CORNER_WINDOW_MS;
      const seq = [...(stale ? [] : corners.current.seq), corner].slice(-8);
      corners.current = { seq, at: now };

      for (const egg of cornerCodeEggs(eggs)) {
        if (found.has(egg.id)) continue;
        if (egg.trigger.kind !== 'corner-code') continue;
        if (matchesCornerCode(seq, egg.trigger.sequence)) {
          corners.current = { seq: [], at: 0 };
          fire(egg);
          return;
        }
      }

      if (matchesCornerCode(seq, DECK_CODE)) {
        corners.current = { seq: [], at: 0 };
        setDeckRequested(true);
      }
    },
    [eggs, found, fire],
  );

  const value = useMemo<EggRuntime>(
    () => ({
      active,
      dismiss: () => setActive(null),
      tapAnchor,
      pressAnchor,
      tapCorner,
      deckRequested,
      clearDeckRequest: () => setDeckRequested(false),
      eggs,
      found,
    }),
    [active, tapAnchor, pressAnchor, tapCorner, deckRequested, eggs, found],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Access the runtime.
 *
 * Returns a no-op shim outside the provider (the onboarding tree, tests) so a
 * component never has to guard before wiring up a gesture.
 */
export function useEggs(): EggRuntime {
  return (
    useContext(Ctx) ?? {
      active: null,
      dismiss: () => {},
      tapAnchor: () => {},
      pressAnchor: () => {},
      tapCorner: () => {},
      deckRequested: false,
      clearDeckRequest: () => {},
      eggs: [],
      found: new Set<string>(),
    }
  );
}

/**
 * Bind tap-count and long-press gestures to a named anchor.
 *
 * Spread onto any element. Deliberately does not swallow clicks: the streak
 * pill still behaves like a streak pill while it's also counting taps.
 */
export function useEggAnchor(anchor: string): {
  onClick: () => void;
  onPointerDown: () => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
} {
  const { tapAnchor, pressAnchor, eggs } = useEggs();
  const timer = useRef<number | null>(null);

  const holdMs = useMemo(() => {
    const press = eggs.find(
      (e) => e.trigger.kind === 'long-press' && e.trigger.anchor === anchor,
    );
    return press && press.trigger.kind === 'long-press' ? press.trigger.ms : null;
  }, [eggs, anchor]);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  return {
    onClick: () => tapAnchor(anchor),
    onPointerDown: () => {
      if (holdMs === null) return;
      clear();
      timer.current = window.setTimeout(() => pressAnchor(anchor), holdMs);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
  };
}
