/**
 * Canonical GitHub paths for every event-sourced record in the trip
 * data backend. Both the live screens and the p2p bridge route through
 * here, so a record created by either path lands at exactly the same
 * place — which is what keeps the gossip protocol idempotent.
 */

import type {
  ChallengeCompletion,
  HabitCheckIn,
  MemberId,
  Message,
  Photo,
  PointEvent,
  Reaction,
} from '../types';
import { dateFolder, eventFilename } from './uuid';

export function messagePath(m: Pick<Message, 'id' | 'from' | 'sentAt'>): string {
  const at = new Date(m.sentAt);
  return `messages/${dateFolder(at)}/${eventFilename(at, m.from, m.id, '.json')}`;
}

export function photoSidecarPath(p: Pick<Photo, 'id' | 'from' | 'uploadedAt'>): string {
  const at = new Date(p.uploadedAt);
  return `photos/${dateFolder(at)}/${eventFilename(at, p.from, p.id, '.json')}`;
}

export function photoBinaryPath(p: Pick<Photo, 'id' | 'from' | 'uploadedAt'>): string {
  const at = new Date(p.uploadedAt);
  return `photos/${dateFolder(at)}/${eventFilename(at, p.from, p.id, '.jpg')}`;
}

export function pointEventPath(e: Pick<PointEvent, 'id' | 'by' | 'at'>): string {
  const at = new Date(e.at);
  return `points/${dateFolder(at)}/${eventFilename(at, e.by, e.id, '.json')}`;
}

export function completionPath(c: Pick<ChallengeCompletion, 'id' | 'by' | 'completedAt'>): string {
  const at = new Date(c.completedAt);
  return `challenges-completed/${dateFolder(at)}/${eventFilename(at, c.by, c.id, '.json')}`;
}

export function habitPath(h: Pick<HabitCheckIn, 'id' | 'by' | 'at'>): string {
  const at = new Date(h.at);
  return `habits/${dateFolder(at)}/${eventFilename(at, h.by, h.id, '.json')}`;
}

export function reactionPath(r: Pick<Reaction, 'id' | 'by' | 'at'>): string {
  const at = new Date(r.at);
  return `reactions/${dateFolder(at)}/${eventFilename(at, r.by, r.id, '.json')}`;
}

/**
 * Inverse of the builders above: recovers a record's id from its stored path.
 *
 * `eventFilename` writes `HH-MM-SS-<author>-<id>.<ext>`, and neither member
 * ids (6 hex chars) nor uids (hex) contain a dash, so the id is the last
 * dash-separated segment of the stem. Paths that aren't event files (e.g.
 * `avatars/<memberId>.jpg`) fall through to the whole stem.
 */
export function eventIdFromPath(path: string): string {
  const stem = (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '');
  return stem.split('-').pop() || stem;
}

/**
 * A member's composed avatar.
 *
 * Single-writer and mutable in place, like `profiles/<id>.json`: only the
 * member themselves ever writes it, so rewriting the same path can't clobber
 * anyone else's work. The `.avatar.json` suffix keeps it clear of the
 * `avatars/<id>.jpg` uploaded-photo route.
 */
export function avatarSpecPath(memberId: MemberId): string {
  return `avatars/${memberId}.avatar.json`;
}

/**
 * Web Push subscription for one device. Keyed by the p2p device fingerprint
 * so re-subscribing on the same device overwrites in place instead of
 * accumulating dead endpoints.
 *
 * Read only by the notifier workflow in the data repo — `routeFor` in the
 * sync engine has no route for this prefix, so clients skip these files.
 */
export function pushSubPath(memberId: MemberId, deviceFingerprint: string): string {
  return `push-subs/${memberId}/${deviceFingerprint}.json`;
}
