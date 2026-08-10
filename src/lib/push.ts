/**
 * Web Push subscription management.
 *
 * The app has no server, so the notifier lives as a workflow in the data repo:
 * every device parks its push subscription at `push-subs/<memberId>/<device>.json`
 * (written through the normal outbox, so it works offline), and the workflow
 * signs and sends pushes with the VAPID private key when new messages or point
 * events land.
 *
 * iOS notes, since that's the whole family:
 *  - Web Push only exists in an installed PWA (Add to Home Screen), iOS 16.4+.
 *    In a plain Safari tab `PushManager` is simply absent — hence `needs-install`.
 *  - `Notification.requestPermission()` must be called from a user gesture, so
 *    everything here is driven by an explicit button, never on mount.
 *  - `userVisibleOnly: true` is mandatory; silent pushes are not permitted.
 */

import { db } from './db';
import { enqueue } from './sync';
import { textToBase64 } from './github';
import { pushSubPath } from './paths';
import { getOrCreateIdentity } from './p2p/identity';
import { VAPID_PUBLIC_KEY, isPushConfigured } from './pushConfig';
import type { MemberId } from '../types';

const STATE_KEY = 'push-state';

export type PushStatus =
  /** No VAPID key baked into this build — nothing to subscribe to. */
  | 'unconfigured'
  /** Browser has no service worker / PushManager and never will (desktop Safari, old iOS). */
  | 'unsupported'
  /** iOS Safari tab: Push exists only once the app is on the Home Screen. */
  | 'needs-install'
  /** Supported, not yet asked. */
  | 'prompt'
  /** User said no. Only recoverable through OS settings. */
  | 'denied'
  /** Subscribed and recorded. */
  | 'on';

export interface PushState {
  status: PushStatus;
  endpoint?: string;
  updatedAt?: string;
}

/** Stored subscription record, as the notifier workflow reads it. */
export interface PushSubscriptionRecord {
  memberId: MemberId;
  device: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** False after an explicit turn-off; the notifier skips these. */
  active: boolean;
  updatedAt: string;
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * Inspect current capability + permission. Cheap and side-effect free, so the
 * UI can call it on mount.
 */
export async function getPushStatus(): Promise<PushStatus> {
  if (!isPushConfigured()) return 'unconfigured';
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return 'unsupported';
  if (!('PushManager' in window)) {
    // On iOS this is the "you're in a Safari tab" case, which Add to Home
    // Screen fixes. Everywhere else it means the browser can't do push.
    return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'default') return 'prompt';

  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'prompt';
}

function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports as Mac; the touch-point check disambiguates.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/**
 * Ask for permission and subscribe. Must be called from a user gesture.
 * Returns the resulting status; throws only on unexpected failures.
 */
export async function enablePush(memberId: MemberId): Promise<PushStatus> {
  const pre = await getPushStatus();
  if (pre === 'unconfigured' || pre === 'unsupported' || pre === 'needs-install') return pre;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    await saveState({ status: permission === 'denied' ? 'denied' : 'prompt' });
    return permission === 'denied' ? 'denied' : 'prompt';
  }

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    }));

  await publishSubscription(memberId, sub, true);
  await saveState({ status: 'on', endpoint: sub.endpoint, updatedAt: new Date().toISOString() });
  return 'on';
}

/**
 * Turn notifications off for this device: drop the browser subscription and
 * mark the stored record inactive so the notifier stops targeting it.
 *
 * The record is rewritten rather than deleted because deletes need the file's
 * blob sha, which we may not have offline — and a tombstone drains through the
 * same outbox as everything else.
 */
export async function disablePush(memberId: MemberId): Promise<PushStatus> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await publishSubscription(memberId, sub, false);
    await sub.unsubscribe().catch(() => {});
  }
  await saveState({ status: 'prompt', updatedAt: new Date().toISOString() });
  return 'prompt';
}

/**
 * Re-publish the current subscription if the browser rotated it. Safe to call
 * on every unlock; a no-op when nothing changed.
 */
export async function refreshSubscription(memberId: MemberId): Promise<void> {
  if ((await getPushStatus()) !== 'on') return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const prev = await loadState();
  if (prev?.endpoint === sub.endpoint) return;
  await publishSubscription(memberId, sub, true);
  await saveState({ status: 'on', endpoint: sub.endpoint, updatedAt: new Date().toISOString() });
}

async function publishSubscription(
  memberId: MemberId,
  sub: PushSubscription,
  active: boolean,
): Promise<void> {
  const { fingerprint } = await getOrCreateIdentity();
  const json = sub.toJSON();
  const record: PushSubscriptionRecord = {
    memberId,
    device: fingerprint,
    endpoint: sub.endpoint,
    keys: {
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    },
    active,
    updatedAt: new Date().toISOString(),
  };
  const path = pushSubPath(memberId, fingerprint);
  await enqueue({
    // Stable id: a re-subscribe replaces the pending write instead of queueing
    // a second one behind it.
    id: `push-sub-${fingerprint}`,
    enqueuedAt: record.updatedAt,
    op: {
      kind: 'put-file',
      path,
      contentBase64: textToBase64(JSON.stringify(record, null, 2)),
      commitMessage: `push: ${active ? 'subscribe' : 'unsubscribe'} ${fingerprint}`,
    },
  });
}

async function saveState(state: PushState): Promise<void> {
  await db.meta.put({ key: STATE_KEY, value: state });
}

export async function loadState(): Promise<PushState | null> {
  return ((await db.meta.get(STATE_KEY))?.value as PushState | undefined) ?? null;
}

/** VAPID keys are base64url; `PushManager` wants raw bytes. */
export function urlBase64ToUint8Array(base64UrlEncoded: string): Uint8Array {
  const padding = '='.repeat((4 - (base64UrlEncoded.length % 4)) % 4);
  const base64 = (base64UrlEncoded + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
