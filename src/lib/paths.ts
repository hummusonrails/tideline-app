/**
 * Canonical GitHub paths for every event-sourced record in the trip
 * data backend. Both the live screens and the p2p bridge route through
 * here, so a record created by either path lands at exactly the same
 * place — which is what keeps the gossip protocol idempotent.
 */

import type {
  ChallengeCompletion,
  HabitCheckIn,
  Message,
  Photo,
  PointEvent,
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
