/**
 * Tracks every live peer connection and runs the gossip protocol on it.
 *
 * Lifecycle per peer:
 *
 *   1. The UI's session flow produces an open {@link Peer} plus the
 *      remote {@link HandshakeHello}. It calls {@link PeerManager.adopt}.
 *   2. The manager looks up the peer's fingerprint in the trust store.
 *      - Known peer → auto-accept.
 *      - Unknown   → marked `awaiting-trust`. The UI must call
 *        {@link PeerManager.trust} (after the user confirms) before
 *        any data flows.
 *   3. On trust, the manager sends HAVE for every collection and starts
 *      a periodic "refresh tick" that pushes deltas for new local writes.
 *   4. Messages from the peer drive the WANT/DATA exchange.
 *
 * One photo binary stream is in flight at a time per peer (chunked via
 * {@link Peer.sendBinary}) — keeps memory predictable and lets a single
 * data channel handle both control and bytes without head-of-line
 * blockage too painful for typical phone-sized photos (~200KB).
 */

import type { PeerLike } from './peer';
import {
  COLLECTIONS,
  type Collection,
  type ControlMessage,
  type Data,
  type Have,
  type Want,
  type Pong,
  PhotoReassembler,
  decodeBinaryFrame,
  decodeControl,
  encodeBinaryFrame,
  encodeControl,
  isCollection,
} from './protocol';
import {
  absorbData,
  absorbPhotoBinary,
  collectAllHaves,
  collectHave,
  fetchRecords,
} from './sync';
import { db } from '../db';
import { useSession } from '../../state/session';
import type { HandshakeHello } from './session';
import { fingerprintFromPublicKey } from './identity';
import { b64ToBytes } from './base';
import type { PeerRow } from '../db';
import { blobToBytes } from '../blobBytes';
import type { Photo } from '../../types';

const REFRESH_TICK_MS = 8_000;
const PHOTO_CHUNK_SIZE = 60 * 1024; // 60 KB per binary frame
/** Heartbeat cadence. Also our only liveness signal on an idle channel. */
const KEEPALIVE_MS = 15_000;
/**
 * Silence longer than this means the peer is gone. iOS suspends a
 * backgrounded PWA without closing the data channel, so `onClose` never
 * fires and the connection lingers as a zombie the UI still shows as live.
 */
const PEER_TIMEOUT_MS = 45_000;
/** Coalesce bursts of local writes into one HAVE push. */
const ENQUEUE_DEBOUNCE_MS = 300;
/** Clocks further apart than this make message ordering visibly wrong. */
export const CLOCK_SKEW_WARN_MS = 2 * 60_000;

export type ConnectionState =
  | 'awaiting-trust'   // hello accepted but user hasn't approved yet
  | 'syncing'          // exchanging HAVE/WANT/DATA
  | 'idle'             // converged, periodic refresh tick
  | 'closed';

export interface PeerSummary {
  fingerprint: string;
  memberId: string;
  displayName: string;
  state: ConnectionState;
  /** Most recent ISO timestamp where we received any frame from this peer. */
  lastActivityAt: string | null;
  /** Photo ids still streaming in from this peer. */
  pendingPhotos: string[];
  /**
   * Estimated `theirClock - ourClock`, in ms, or null before the first pong
   * answers. Messages are ordered by wall-clock timestamp, so a badly-set
   * clock on one phone silently interleaves its messages wrongly.
   */
  clockOffsetMs: number | null;
  /** Ids of our messages this peer has open right now. Empty once it leaves. */
  seenIds: string[];
}

interface ManagedPeer {
  peer: PeerLike;
  remoteHello: HandshakeHello;
  displayName: string;
  state: ConnectionState;
  trusted: boolean;
  sentHave: Record<Collection, Set<string>>;   // ids we've told them about
  receivedWant: Record<Collection, Set<string>>; // their outstanding wants
  photoReassembler: PhotoReassembler;
  /** Message ids this peer says it's currently looking at. In-memory only. */
  seenIds: Set<string>;
  refreshTimer: ReturnType<typeof setInterval> | null;
  keepaliveTimer: ReturnType<typeof setInterval> | null;
  lastActivityAt: string | null;
  /** Same instant as lastActivityAt, kept numeric for timeout arithmetic. */
  lastFrameAtMs: number;
  clockOffsetMs: number | null;
}

export type ManagerListener = (summaries: PeerSummary[]) => void;

export class PeerManager {
  private peers = new Map<string, ManagedPeer>();
  private listeners = new Set<ManagerListener>();
  private enqueueDebounce: ReturnType<typeof setTimeout> | null = null;
  /**
   * Who's signed in on this device. Needed to tell our own messages apart from
   * everyone else's when recording delivery. Null until the app sets it.
   */
  private localMemberId: string | null = null;

  /** Called on sign-in; clears on sign-out. */
  setLocalMember(memberId: string | null): void {
    this.localMemberId = memberId;
  }

  /**
   * Push new local writes to peers the moment they happen.
   *
   * The refresh tick alone means a chat message can sit up to
   * REFRESH_TICK_MS before the other phone hears about it — long enough to
   * feel broken when two people are sitting next to each other. The outbox
   * already announces every write, so we piggyback on that and keep the tick
   * purely as a safety net.
   */
  private readonly onLocalWrite = () => {
    if (this.enqueueDebounce !== null) return;
    this.enqueueDebounce = setTimeout(() => {
      this.enqueueDebounce = null;
      for (const mp of this.peers.values()) {
        if (mp.trusted && mp.state !== 'closed') void this.pushHaves(mp);
      }
    }, ENQUEUE_DEBOUNCE_MS);
  };

  constructor() {
    window.addEventListener('tideline:outbox-enqueued', this.onLocalWrite);
  }

  /**
   * Permanently detach from the window. Distinct from {@link shutdown}, which
   * drops connections but leaves the manager reusable after a re-sign-in.
   */
  dispose(): void {
    this.shutdown();
    if (this.enqueueDebounce !== null) clearTimeout(this.enqueueDebounce);
    this.enqueueDebounce = null;
    window.removeEventListener('tideline:outbox-enqueued', this.onLocalWrite);
  }

  /** Pre-load known peer rows so manager UI can render trusted fingerprints. */
  async listKnownPeers(): Promise<PeerRow[]> {
    return db.peers.toArray();
  }

  subscribe(fn: ManagerListener): () => void {
    this.listeners.add(fn);
    fn(this.summarize());
    return () => { this.listeners.delete(fn); };
  }

  /**
   * Adopt a freshly-handshaken Peer. Returns the connection state —
   * 'syncing' for known peers, 'awaiting-trust' for new ones.
   */
  async adopt(peer: PeerLike, remoteHello: HandshakeHello, displayNameFallback: string): Promise<ConnectionState> {
    // Sanity: the fingerprint claimed in the hello must match the public key.
    const computed = await fingerprintFromPublicKey(b64ToBytes(remoteHello.publicKey));
    if (computed !== remoteHello.fingerprint) {
      peer.close();
      throw new Error('hello fingerprint does not match its public key');
    }

    const known = await db.peers.get(remoteHello.fingerprint);
    const trusted = !!known && known.publicKeyB64 === remoteHello.publicKey;
    const displayName = known?.displayName ?? displayNameFallback;

    if (this.peers.has(remoteHello.fingerprint)) {
      // Replace any stale connection — keep the freshest one only.
      this.peers.get(remoteHello.fingerprint)!.peer.close();
    }

    const mp: ManagedPeer = {
      peer,
      remoteHello,
      displayName,
      trusted,
      state: trusted ? 'syncing' : 'awaiting-trust',
      sentHave: emptyHaveMap(),
      receivedWant: emptyHaveMap(),
      photoReassembler: new PhotoReassembler(),
      seenIds: new Set(),
      refreshTimer: null,
      keepaliveTimer: null,
      lastActivityAt: null,
      lastFrameAtMs: Date.now(),
      clockOffsetMs: null,
    };
    this.peers.set(remoteHello.fingerprint, mp);

    peer.setEvents({
      // Callers adopt as soon as the SDP exchange completes, which is before
      // ICE finishes — so the channel usually isn't open yet.
      onOpen: () => { void this.onPeerOpen(mp); },
      onText: (text) => { void this.handleText(mp, text); },
      onBinary: (buf) => { void this.handleBinary(mp, buf); },
      onClose: () => { this.handlePeerClose(mp); },
    });

    const initialState = mp.state;
    if (trusted) {
      // Gossiping now would throw ("peer not open") and tear the connection
      // down mid-handshake — which is to say, every reconnection with a peer
      // we already trust would kill itself. Wait for the channel.
      if (peer.isOpen()) await this.startGossip(mp);
      void db.peers.update(remoteHello.fingerprint, { lastSeenAt: new Date().toISOString() });
    }

    this.notify();
    return initialState;
  }

  /** UI-confirmed trust for an awaiting-trust peer. */
  async trust(fingerprint: string, displayName?: string): Promise<void> {
    const mp = this.peers.get(fingerprint);
    if (!mp) throw new Error('no such peer');
    if (mp.trusted) return;
    const row: PeerRow = {
      fingerprint,
      publicKeyB64: mp.remoteHello.publicKey,
      memberId: mp.remoteHello.memberId,
      displayName: displayName ?? mp.displayName,
      pairedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    await db.peers.put(row);
    mp.trusted = true;
    if (displayName) mp.displayName = displayName;
    mp.state = 'syncing';
    // Same reasoning as adopt: if the user confirms trust before ICE lands,
    // gossip waits for onOpen rather than throwing.
    if (mp.peer.isOpen()) await this.startGossip(mp);
    this.notify();
  }

  /** The channel is live — start (or restart) gossip if this peer is trusted. */
  private async onPeerOpen(mp: ManagedPeer): Promise<void> {
    if (!mp.trusted || mp.state === 'closed') return;
    await this.startGossip(mp);
    this.notify();
  }

  /** Drop a peer entirely — closes its connection and forgets the trust row. */
  async forget(fingerprint: string): Promise<void> {
    const mp = this.peers.get(fingerprint);
    if (mp) {
      this.teardown(mp);
      this.peers.delete(fingerprint);
    }
    await db.peers.delete(fingerprint);
    this.notify();
  }

  /** Close the live connection but keep the trust row. */
  disconnect(fingerprint: string): void {
    const mp = this.peers.get(fingerprint);
    if (!mp) return;
    this.teardown(mp);
    this.peers.delete(fingerprint);
    this.notify();
  }

  /** Close every connection and stop every timer. Trust store untouched. */
  shutdown(): void {
    for (const mp of this.peers.values()) this.teardown(mp);
    this.peers.clear();
    this.notify();
  }

  summarize(): PeerSummary[] {
    return Array.from(this.peers.values()).map((mp) => ({
      fingerprint: mp.remoteHello.fingerprint,
      memberId: mp.remoteHello.memberId,
      displayName: mp.displayName,
      state: mp.state,
      lastActivityAt: mp.lastActivityAt,
      pendingPhotos: mp.photoReassembler.pendingPhotoIds(),
      clockOffsetMs: mp.clockOffsetMs,
      seenIds: Array.from(mp.seenIds),
    }));
  }

  // --- internals -----------------------------------------------------

  private async startGossip(mp: ManagedPeer): Promise<void> {
    if (mp.refreshTimer) clearInterval(mp.refreshTimer);
    await this.pushHaves(mp);
    mp.refreshTimer = setInterval(() => { void this.pushHaves(mp); }, REFRESH_TICK_MS);
    this.startKeepalive(mp);
  }

  /**
   * Heartbeat + dead-peer reaping.
   *
   * Every tick we first check whether anything has arrived recently; if not,
   * the peer is treated as gone. Otherwise we ping, which both keeps the
   * channel warm and gives us the round-trip needed for a clock estimate.
   */
  private startKeepalive(mp: ManagedPeer): void {
    if (mp.keepaliveTimer) clearInterval(mp.keepaliveTimer);
    mp.lastFrameAtMs = Date.now();
    mp.keepaliveTimer = setInterval(() => {
      if (mp.state === 'closed') return;
      if (Date.now() - mp.lastFrameAtMs > PEER_TIMEOUT_MS) {
        this.handlePeerClose(mp);
        return;
      }
      if (!mp.peer.isOpen()) return;
      this.sendControl(mp, { type: 'ping', at: Date.now() });
    }, KEEPALIVE_MS);
  }

  /**
   * Estimate the peer's clock offset from one ping/pong round trip.
   *
   * Assumes a symmetric path, so the remote's `now` corresponds to our
   * send-time plus half the round trip. Good to well within the couple of
   * minutes we actually care about.
   */
  private notePong(mp: ManagedPeer, msg: Pong): void {
    if (typeof msg.now !== 'number') return;
    const rtt = Date.now() - msg.at;
    if (rtt < 0 || rtt > PEER_TIMEOUT_MS) return; // nonsense sample; ignore
    mp.clockOffsetMs = Math.round(msg.now - (msg.at + rtt / 2));
  }

  private async pushHaves(mp: ManagedPeer): Promise<void> {
    // Bail before touching `sentHave`. Marking ids as advertised and then
    // failing to send them would lose those records until the next id shows
    // up, since the delta is computed against `sentHave`.
    if (!mp.trusted || mp.state === 'closed' || !mp.peer.isOpen()) return;
    let anyChange = false;
    const haves = await collectAllHaves();
    for (const collection of COLLECTIONS) {
      const ids = haves[collection];
      const already = mp.sentHave[collection];
      const delta: string[] = [];
      for (const id of ids) if (!already.has(id)) delta.push(id);
      if (delta.length === 0) continue;
      anyChange = true;
      for (const id of ids) already.add(id);
      this.sendControl(mp, { type: 'have', collection, ids: delta });
    }
    if (!anyChange && mp.state === 'syncing') {
      // Converged for now.
      mp.state = 'idle';
      this.notify();
    }
  }

  private sendControl(mp: ManagedPeer, msg: ControlMessage): void {
    try { mp.peer.sendText(encodeControl(msg)); }
    catch { this.handlePeerClose(mp); }
  }

  private async handleText(mp: ManagedPeer, text: string): Promise<void> {
    mp.lastActivityAt = new Date().toISOString();
    mp.lastFrameAtMs = Date.now();
    const msg = decodeControl(text);
    if (!msg) return;
    if (!mp.trusted) {
      // Drop everything from un-trusted peers until UI confirms.
      return;
    }
    switch (msg.type) {
      case 'have':  await this.onHave(mp, msg); break;
      case 'want':  await this.onWant(mp, msg); break;
      case 'data':  await this.onData(mp, msg); break;
      case 'ping':  this.sendControl(mp, { type: 'pong', at: msg.at, now: Date.now() }); break;
      case 'pong':  this.notePong(mp, msg); break;
      // Replace rather than accumulate: "seen" means *currently* on screen,
      // and an empty list is how a peer says it has looked away.
      case 'seen':  mp.seenIds = new Set(msg.ids); break;
      // hello / hello-ack are absorbed by the handshake — no-op here.
      default: break;
    }
    this.notify();
  }

  private async handleBinary(mp: ManagedPeer, buf: ArrayBuffer): Promise<void> {
    mp.lastActivityAt = new Date().toISOString();
    mp.lastFrameAtMs = Date.now();
    if (!mp.trusted) return;
    const frame = decodeBinaryFrame(buf);
    if (!frame) return;
    const done = mp.photoReassembler.ingest(frame);
    if (done) await absorbPhotoBinary(done.photoId, done.bytes, done.mime);
    this.notify();
  }

  private async onHave(mp: ManagedPeer, msg: Have): Promise<void> {
    if (!isCollection(msg.collection)) return;
    mp.state = 'syncing';
    const local = new Set(await collectHave(msg.collection));
    const want: string[] = [];
    for (const id of msg.ids) if (!local.has(id)) want.push(id);
    if (want.length > 0) this.sendControl(mp, { type: 'want', collection: msg.collection, ids: want });

    // A peer advertising one of our own messages is proof it arrived.
    if (msg.collection === 'messages') {
      await this.recordDeliveries(mp, msg.ids.filter((id) => local.has(id)));
    }
  }

  /**
   * Note that specific messages of ours reached a specific device.
   *
   * Only our own authored messages are tracked: "delivered" is a statement
   * about something you sent, and recording it for everyone's messages would
   * multiply rows by peers for information no screen reads.
   */
  private async recordDeliveries(mp: ManagedPeer, ids: string[]): Promise<void> {
    // Fall back to the persisted session rather than failing silently if
    // `setLocalMember` was never called — the failure mode otherwise is
    // "delivery receipts quietly never appear", which nobody would report.
    const me = this.localMemberId ?? useSession.getState().identity;
    if (ids.length === 0 || !me) return;
    const mine = (await db.messages.bulkGet(ids))
      .filter((m): m is NonNullable<typeof m> => m != null)
      .filter((m) => m.from === me)
      .map((m) => m.id);
    if (mine.length === 0) return;
    const at = new Date().toISOString();
    await db.deliveries.bulkPut(
      mine.map((messageId) => ({ messageId, fingerprint: mp.remoteHello.fingerprint, at })),
    );
  }

  /**
   * Tell peers which messages are on screen right now.
   *
   * Fire-and-forget and unacknowledged: if it doesn't arrive, the sender just
   * doesn't see a "Seen" marker, which is the correct failure mode for
   * something this inconsequential.
   */
  reportSeen(ids: string[]): void {
    for (const mp of this.peers.values()) {
      if (mp.trusted && mp.state !== 'closed' && mp.peer.isOpen()) {
        this.sendControl(mp, { type: 'seen', ids });
      }
    }
  }

  private async onWant(mp: ManagedPeer, msg: Want): Promise<void> {
    if (!isCollection(msg.collection)) return;
    mp.state = 'syncing';
    for (const id of msg.ids) mp.receivedWant[msg.collection].add(id);
    const BATCH = 25;
    const ids = Array.from(mp.receivedWant[msg.collection]);
    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = ids.slice(i, i + BATCH);
      const records = await fetchRecords(msg.collection, slice);
      this.sendControl(mp, { type: 'data', collection: msg.collection, records });
      for (const id of slice) mp.receivedWant[msg.collection].delete(id);
    }
    // After sending photo metadata, stream the actual bytes.
    if (msg.collection === 'photos') {
      for (const id of ids) {
        const blobRow = await db.photoBlobs.get(id);
        const meta = await db.photos.get(id);
        if (!blobRow || !meta) continue;
        await this.streamPhoto(mp, meta, blobRow.bytes);
      }
    }
  }

  private async onData(mp: ManagedPeer, msg: Data): Promise<void> {
    if (!isCollection(msg.collection)) return;
    const result = await absorbData(msg.collection, msg.records);
    if (result.needPhotoBinary.length > 0) {
      this.sendControl(mp, { type: 'want', collection: 'photos', ids: result.needPhotoBinary });
    }
    if (result.newIds.length > 0) mp.state = 'syncing';
  }

  private async streamPhoto(mp: ManagedPeer, meta: Photo, blob: Blob): Promise<void> {
    const buf = await blobToBytes(blob);
    const total = Math.max(1, Math.ceil(buf.byteLength / PHOTO_CHUNK_SIZE));
    const mime = blob.type || 'image/jpeg';
    for (let i = 0; i < total; i++) {
      const slice = buf.subarray(i * PHOTO_CHUNK_SIZE, Math.min(buf.byteLength, (i + 1) * PHOTO_CHUNK_SIZE));
      const frame = encodeBinaryFrame(
        { kind: 'photo', photoId: meta.id, idx: i, total, mime },
        slice,
      );
      try { await mp.peer.sendBinary(frame); }
      catch { this.handlePeerClose(mp); return; }
    }
  }

  private handlePeerClose(mp: ManagedPeer): void {
    if (mp.state === 'closed') return;
    this.teardown(mp);
    mp.state = 'closed';
    this.peers.delete(mp.remoteHello.fingerprint);
    this.notify();
  }

  private teardown(mp: ManagedPeer): void {
    if (mp.refreshTimer) clearInterval(mp.refreshTimer);
    mp.refreshTimer = null;
    if (mp.keepaliveTimer) clearInterval(mp.keepaliveTimer);
    mp.keepaliveTimer = null;
    try { mp.peer.close(); } catch { /* ignore */ }
  }

  private notify(): void {
    const snapshot = this.summarize();
    for (const fn of this.listeners) fn(snapshot);
  }
}

function emptyHaveMap(): Record<Collection, Set<string>> {
  return {
    messages: new Set(),
    photos: new Set(),
    pointEvents: new Set(),
    completions: new Set(),
    habits: new Set(),
    reactions: new Set(),
  };
}

// --- module singleton -------------------------------------------------

let instance: PeerManager | null = null;

export function getPeerManager(): PeerManager {
  if (!instance) instance = new PeerManager();
  return instance;
}

export function _resetPeerManagerForTests(): void {
  if (instance) instance.dispose();
  instance = null;
}
