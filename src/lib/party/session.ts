/**
 * Running a party game: the roster, the scoreboard, and what happens when
 * everyone puts the phone down.
 *
 * The awkward question in a one-device game is who is allowed to mint points.
 * The app's rule everywhere else is self-mint only — your device awards you,
 * nobody else — because two devices observing the same event would otherwise
 * both pay out. A party game breaks that assumption: only the host's phone
 * ever sees the result, and the other players' phones will never learn about
 * it at all.
 *
 * So the ending is split three ways, and each part uses machinery that
 * already exists:
 *
 *  - **The host self-mints** for hosting and playing, through the same
 *    synthetic-completion path as hunts, eggs and arcade runs, capped per day.
 *  - **The results get posted to the family chat** as an ordinary journal
 *    message. That's the family-wide record: it syncs, it gossips, it turns
 *    up in the recap, and it needed no new record type.
 *  - **A parent host may award the podium** through `parent-bonus`, which is
 *    the app's existing and only sanctioned cross-member mint. A kid hosting
 *    can't hand out points, which is the correct answer to "can my brother
 *    just award himself two hundred points".
 */

import { useCallback, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { uid } from '../uuid';
import { todayYMD } from '../time';
import { awardPoints, completeSynthetic } from '../award';
import { enqueue } from '../sync';
import { textToBase64 } from '../github';
import { messagePath } from '../paths';
import { useSession } from '../../state/session';
import type { AvatarSpec, MemberId, Message } from '../../types';
import type { PartyGameDef } from './catalog';
import { isVipId, type VipPortrait } from './vips';

export const PARTY_PREFIX = 'party-';
/** Points the host earns for running and playing a session. */
export const PARTY_HOST_POINTS = 12;
/** How many sessions a day pay out. Beyond this they're free but unpaid. */
export const PARTY_SESSIONS_PER_DAY = 3;
/** What a parent host may hand the podium, in order. */
export const PODIUM_BONUS = [15, 10, 5];

export interface PartyPlayer {
  id: MemberId;
  name: string;
  spec: AvatarSpec | null;
  /**
   * Set for guests of honour who have no account — see `lib/party/vips.ts`.
   * Its presence is what tells the UI to draw a bespoke portrait instead of a
   * composed crew avatar, and what keeps guests out of the points system.
   */
  vip?: VipPortrait;
}

export interface PartySession {
  players: PartyPlayer[];
  scores: Record<MemberId, number>;
  addScore: (memberId: MemberId, delta: number) => void;
  resetScores: () => void;
  /** Players sorted by score, highest first. Ties keep roster order. */
  standings: { player: PartyPlayer; score: number; rank: number }[];
  round: number;
  nextRound: () => void;
  /** Rotates through the roster — used for judge, psychic, guesser roles. */
  roleHolder: PartyPlayer;
}

export function usePartySession(players: PartyPlayer[]): PartySession {
  const [scores, setScores] = useState<Record<MemberId, number>>(() =>
    Object.fromEntries(players.map((p) => [p.id, 0])),
  );
  const [round, setRound] = useState(0);

  const addScore = useCallback((memberId: MemberId, delta: number) => {
    setScores((prev) => ({ ...prev, [memberId]: (prev[memberId] ?? 0) + delta }));
  }, []);

  const resetScores = useCallback(() => {
    setScores(Object.fromEntries(players.map((p) => [p.id, 0])));
    setRound(0);
  }, [players]);

  const standings = useMemo(() => {
    const ranked = players
      .map((player) => ({ player, score: scores[player.id] ?? 0 }))
      .sort((a, b) => b.score - a.score);
    // Equal scores share a rank — a three-way tie for first should read as
    // three firsts, not first/second/third in roster order.
    let lastScore = Number.POSITIVE_INFINITY;
    let lastRank = 0;
    return ranked.map((entry, i) => {
      const rank = entry.score === lastScore ? lastRank : i + 1;
      lastScore = entry.score;
      lastRank = rank;
      return { ...entry, rank };
    });
  }, [players, scores]);

  return {
    players,
    scores,
    addScore,
    resetScores,
    standings,
    round,
    nextRound: () => setRound((r) => r + 1),
    roleHolder: players[round % Math.max(1, players.length)] ?? players[0],
  };
}

// ---------- ending a session ----------

export function usePartyHistory(gameId?: string) {
  return (
    useLiveQuery(async () => {
      const all = await db.partySessions.toArray();
      const filtered = gameId ? all.filter((s) => s.gameId === gameId) : all;
      return filtered.sort((a, b) => b.playedAt.localeCompare(a.playedAt)).slice(0, 12);
    }, [gameId]) ?? []
  );
}

/**
 * Save the session and pay the host.
 *
 * Returns the session id so the caller can post the results card against it.
 * Recording is unconditional; the *points* are what the daily cap limits, so
 * a fourth game of the evening still goes in the history.
 */
export async function recordSession(input: {
  game: PartyGameDef;
  hostId: MemberId;
  standings: { player: PartyPlayer; score: number }[];
}): Promise<string> {
  const sessionId = uid();
  const now = new Date();

  await db.partySessions.put({
    id: sessionId,
    gameId: input.game.id,
    playedAt: now.toISOString(),
    hostId: input.hostId,
    players: input.standings.map((s) => ({
      memberId: s.player.id,
      name: s.player.name,
      score: s.score,
    })),
  });

  const today = todayYMD(now);
  const paidToday = (await db.partySessions.toArray()).filter(
    (s) => s.playedAt.slice(0, 10) === today && s.hostId === input.hostId,
  ).length;

  await completeSynthetic({
    challengeId: `${PARTY_PREFIX}${input.game.id}-${sessionId}`,
    by: input.hostId,
    points: paidToday <= PARTY_SESSIONS_PER_DAY ? PARTY_HOST_POINTS : 0,
    commitMessage: `party: ${input.game.id}`,
  });

  return sessionId;
}

/** Is this member allowed to hand out podium bonuses? */
export async function canAwardPodium(memberId: MemberId): Promise<boolean> {
  const profile = await db.profiles.get(memberId);
  return profile?.role === 'parent';
}

/**
 * A parent host paying the podium.
 *
 * Rides `parent-bonus`, which is already the app's one sanctioned
 * cross-member mint and already capped by the points config. The note names
 * the game so the point shows up in the ledger as something explicable
 * rather than a mystery adjustment.
 */
export async function awardPodium(input: {
  game: PartyGameDef;
  hostId: MemberId;
  standings: { player: PartyPlayer; score: number; rank: number }[];
}): Promise<number> {
  let awarded = 0;
  for (const entry of input.standings) {
    const bonus = PODIUM_BONUS[entry.rank - 1];
    // Only a podium place with an actual score gets paid — otherwise a
    // three-player game pays everybody for turning up. Guests are skipped
    // outright: there is no account to pay the points into, and minting them
    // against a local-only id would write a point event nobody owns.
    if (!bonus || entry.score <= 0 || isVipId(entry.player.id)) continue;
    const event = await awardPoints({
      to: entry.player.id,
      by: input.hostId,
      amount: bonus,
      reason: 'parent-bonus',
      refId: input.game.id,
      note: `${input.game.title} — ${ordinal(entry.rank)} place`,
    });
    if (event) awarded += bonus;
  }
  return awarded;
}

/** Post the scoreboard into the family chat as a journal entry. */
export async function postResults(input: {
  game: PartyGameDef;
  hostId: MemberId;
  standings: { player: PartyPlayer; score: number; rank: number }[];
}): Promise<void> {
  const now = new Date();
  const lines = input.standings
    .map((s) => `${medal(s.rank)} ${s.player.name} — ${s.score}`)
    .join('\n');
  const message: Message = {
    id: uid(),
    from: input.hostId,
    sentAt: now.toISOString(),
    kind: 'journal',
    body: `${input.game.glyph} ${input.game.title}\n\n${lines}`,
  };
  await db.messages.put(message);
  await enqueue({
    id: `msg-${message.id}`,
    enqueuedAt: now.toISOString(),
    op: {
      kind: 'put-file',
      path: messagePath(message),
      contentBase64: textToBase64(JSON.stringify(message)),
      commitMessage: `party results: ${input.game.id}`,
    },
  });
}

function medal(rank: number): string {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '·';
}

function ordinal(n: number): string {
  return n === 1 ? 'first' : n === 2 ? 'second' : n === 3 ? 'third' : `${n}th`;
}

/** The signed-in member, as a party player. */
export function useHostId(): MemberId | null {
  return useSession((s) => s.identity);
}
