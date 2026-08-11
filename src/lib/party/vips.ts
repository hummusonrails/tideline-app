/**
 * VIP guests — the people who play but don't have a phone in this.
 *
 * Grandparents, cousins, the family friend in the next deckchair. They join a
 * party game, they hold the phone when it comes round, they win, and their
 * score goes on the board with everyone else's. What they don't have is an
 * account: no member id in the trip data, no PAT, no device, and therefore no
 * trip points — the points system's whole integrity rests on records being
 * self-minted by the person they belong to, and a guest has nobody to mint
 * them.
 *
 * So a VIP is deliberately a *local* record on the host's phone. It never
 * syncs, never claims a MemberId, and can't be confused for a crew member
 * anywhere downstream: their ids are prefixed, which is the check the podium
 * award uses to skip them.
 *
 * Bobbi and Zeidi ship as defaults because they're kinship words — Yiddish
 * for grandmother and grandfather — not anybody's name, in the same class as
 * "Mum" and "Dad". Both are renamable on the device, and any number of extra
 * guests can be added alongside them.
 */

import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { uid } from '../uuid';

/** Prefix that marks an id as belonging to a guest, not a crew member. */
export const VIP_PREFIX = 'vip-';

export function isVipId(id: string): boolean {
  return id.startsWith(VIP_PREFIX);
}

/** Which bespoke portrait to draw. See `ui/party/VipAvatar.tsx`. */
export type VipPortrait = 'bobbi' | 'zeidi' | 'guest';

export interface Vip {
  id: string;
  name: string;
  portrait: VipPortrait;
  /** Line shown under the name on the roster — pure flavour. */
  title: string;
  addedAt: string;
}

const DEFAULTS: Omit<Vip, 'addedAt'>[] = [
  {
    id: `${VIP_PREFIX}bobbi`,
    name: 'Bobbi',
    portrait: 'bobbi',
    title: 'Guest of honour',
  },
  {
    id: `${VIP_PREFIX}zeidi`,
    name: 'Zeidi',
    portrait: 'zeidi',
    title: 'Guest of honour',
  },
];

/**
 * Put the two standing guests on the list, once ever.
 *
 * Guarded by a meta flag rather than by the table being empty, so a guest
 * somebody deliberately removed stays removed instead of reappearing on the
 * next launch.
 */
async function seedGuests(): Promise<void> {
  if (await db.meta.get('vips-seeded')) return;
  const now = new Date().toISOString();
  await db.vips.bulkPut(DEFAULTS.map((v) => ({ ...v, addedAt: now })));
  await db.meta.put({ key: 'vips-seeded', value: true });
}

/**
 * The guest list.
 *
 * The seed runs in an effect, *not* inside the live query. Dexie's liveQuery
 * runs its querier in a read-only observability zone — writing from inside it
 * throws, and the whole screen goes with it. The query below only reads; the
 * effect below it does the one write, and the live query picks the new rows
 * up the moment it lands.
 */
export function useVips(): Vip[] {
  const rows = useLiveQuery(() => db.vips.orderBy('addedAt').toArray(), []);
  useEffect(() => {
    void seedGuests();
  }, []);
  return rows ?? [];
}

export async function addVip(name: string, portrait: VipPortrait = 'guest'): Promise<Vip> {
  const vip: Vip = {
    id: `${VIP_PREFIX}${uid()}`,
    name: name.trim().slice(0, 16),
    portrait,
    title: 'Guest',
    addedAt: new Date().toISOString(),
  };
  await db.vips.put(vip);
  return vip;
}

export async function renameVip(id: string, name: string): Promise<void> {
  const existing = await db.vips.get(id);
  if (!existing) return;
  await db.vips.put({ ...existing, name: name.trim().slice(0, 16) || existing.name });
}

export async function removeVip(id: string): Promise<void> {
  await db.vips.delete(id);
}

/**
 * Lifetime record for a guest, read back out of the local session history.
 *
 * A guest can't have a synced leaderboard, so this is the honest substitute:
 * what this phone has watched them do. It's also the bit that makes bringing
 * them into a game feel like it counted.
 */
export function useVipRecord(vipId: string): { games: number; wins: number; points: number } {
  return (
    useLiveQuery(async () => {
      const sessions = await db.partySessions.toArray();
      let games = 0;
      let wins = 0;
      let points = 0;
      for (const session of sessions) {
        const row = session.players.find((p) => p.memberId === vipId);
        if (!row) continue;
        games += 1;
        points += row.score;
        const top = Math.max(...session.players.map((p) => p.score));
        if (row.score === top && top > 0) wins += 1;
      }
      return { games, wins, points };
    }, [vipId]) ?? { games: 0, wins: 0, points: 0 }
  );
}
