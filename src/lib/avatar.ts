/**
 * Resolving what to draw for a member, and what they've earned the right to
 * draw with.
 *
 * Precedence is deliberate: an uploaded photo wins, then a composed crew
 * avatar, then the gradient initial. Somebody who took the trouble to put a
 * real photo on their profile shouldn't have it replaced by an otter because
 * they poked the editor once.
 */

import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { todayYMD } from './time';
import { shabbatDates, useShabbatTimes } from './shabbat';
import { DEFAULT_CONFIG, currentTier, streakLength, totalPoints } from './points';
import { foundEggIds } from './eggs';
import { huntFinaleId } from './hunts';
import { type UnlockState } from './avatarCatalog';
import type { AvatarSpec, MemberId } from '../types';

/**
 * The composed spec for a member.
 *
 * `undefined` means "still loading"; `null` means "loaded, and they haven't
 * made one". Dexie's `.get()` resolves `undefined` for a row that isn't there,
 * which is the exact value useLiveQuery reports while the query is still in
 * flight — so without mapping the miss to `null` the two states are
 * indistinguishable, and anything waiting for the load waits forever.
 * (`PlaceDetail` hit this first; same trap.)
 */
export function useAvatarSpec(
  memberId: string | null | undefined,
): AvatarSpec | null | undefined {
  return useLiveQuery(
    async () => (memberId ? ((await db.avatarSpecs.get(memberId)) ?? null) : null),
    [memberId],
  );
}

/**
 * What this member has unlocked.
 *
 * Every input is a local record, so this needs no network and can't disagree
 * across devices once they've synced the same events.
 */
export function useUnlockState(memberId: MemberId | null | undefined): UnlockState {
  const today = todayYMD();
  const pointEvents = useLiveQuery(() => db.pointEvents.toArray(), []) ?? [];
  const completions = useLiveQuery(() => db.completions.toArray(), []) ?? [];
  const photos = useLiveQuery(() => db.photos.toArray(), []) ?? [];
  const habits = useLiveQuery(() => db.habits.toArray(), []) ?? [];
  const hunts = useLiveQuery(() => db.hunts.toArray(), []) ?? [];
  const shabbatTimes = useShabbatTimes();
  const shabbatFree = useMemo(() => shabbatDates(shabbatTimes), [shabbatTimes]);

  return useMemo(() => {
    if (!memberId) {
      return { tier: 'none' as const, eggsFound: 0, huntsDone: 0, photos: 0, streak: 0 };
    }
    const points = totalPoints(pointEvents, memberId);
    // A hunt counts as done for cosmetics when its finale bonus landed —
    // that's the one marker that only exists after the last stage.
    const huntsDone = hunts.filter((h) =>
      completions.some((c) => c.by === memberId && c.challengeId === huntFinaleId(h.id)),
    ).length;
    return {
      tier: currentTier(points, DEFAULT_CONFIG),
      eggsFound: foundEggIds(completions, memberId).size,
      huntsDone,
      photos: photos.filter((p) => p.from === memberId).length,
      streak: streakLength(habits, memberId, today, shabbatFree),
    };
  }, [memberId, pointEvents, completions, photos, habits, hunts, today, shabbatFree]);
}

/** Live tier for a member, for the avatar ring. */
export function useTierFor(memberId: string | null | undefined) {
  const pointEvents = useLiveQuery(() => db.pointEvents.toArray(), []) ?? [];
  return useMemo(
    () => (memberId ? currentTier(totalPoints(pointEvents, memberId), DEFAULT_CONFIG) : 'none'),
    [pointEvents, memberId],
  );
}
