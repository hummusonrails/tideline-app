/**
 * Hand-off point between the global invite watcher and the race screen.
 *
 * Game frames are transient: the p2p layer buffers nothing for late
 * subscribers. When an invite arrives while the player is on, say, the
 * Photos tab, the watcher banner navigates them to /race — but by then the
 * frame is long gone. This one-slot mailbox carries the invite across that
 * navigation. Deliberately not a zustand store: nothing renders from it,
 * exactly one writer and one reader, and it must not persist.
 */

import type { RacerIntro } from './net';

export interface PendingInvite {
  fromFingerprint: string;
  intro: RacerIntro;
  at: number;
}

/** Invites older than this are stale — the other kart has probably given up. */
const INVITE_TTL_MS = 60_000;

let pending: PendingInvite | null = null;

export function setPendingInvite(invite: PendingInvite): void {
  pending = invite;
}

/** Read-and-clear. Returns null when there's nothing fresh. */
export function consumePendingInvite(): PendingInvite | null {
  const p = pending;
  pending = null;
  if (!p || Date.now() - p.at > INVITE_TTL_MS) return null;
  return p;
}

/** Non-destructive check, for the watcher to avoid duplicate banners. */
export function peekPendingInvite(): PendingInvite | null {
  if (pending && Date.now() - pending.at > INVITE_TTL_MS) pending = null;
  return pending;
}

export function clearPendingInvite(): void {
  pending = null;
}
