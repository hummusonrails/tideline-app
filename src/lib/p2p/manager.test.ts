/**
 * Integration tests for PeerManager + the gossip protocol.
 *
 * We stand up two independent IndexedDB-backed "devices" (Dexie's
 * per-tab isolation isn't enough — we instead use one DB and reset
 * between tests, then drive two managers against each other using
 * loopback `MockPeer` pairs). For each end we model an identity +
 * a manager; the MockPeers hand text/binary frames straight from
 * one side's `setEvents` callbacks into the other's.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { _resetPeerManagerForTests, PeerManager } from './manager';
import type { PeerLike, PeerEvents } from './peer';
import { _resetIdentityCacheForTests, fingerprintFromPublicKey } from './identity';
import type { HandshakeHello } from './session';
import type { Message, Photo } from '../../types';

/** Minimal Peer stand-in. Two MockPeers wired through {@link pairMockPeers}
 *  delegate every send into the *other*'s handler. */
class MockPeer implements PeerLike {
  events: PeerEvents = {};
  partner: MockPeer | null = null;
  closed = false;
  setEvents(events: PeerEvents): void { this.events = { ...this.events, ...events }; }
  sendText(text: string): void {
    if (this.closed || !this.partner) return;
    queueMicrotask(() => this.partner?.events.onText?.(text));
  }
  async sendBinary(bytes: Uint8Array): Promise<void> {
    if (this.closed || !this.partner) return;
    // Copy the bytes since we may reuse the underlying buffer.
    const copy = new Uint8Array(bytes);
    queueMicrotask(() => this.partner?.events.onBinary?.(copy.buffer));
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => this.events.onClose?.());
    if (this.partner && !this.partner.closed) this.partner.close();
  }
}

function pairMockPeers(): [MockPeer, MockPeer] {
  const a = new MockPeer();
  const b = new MockPeer();
  a.partner = b;
  b.partner = a;
  return [a, b];
}

/** Spin up an identity-shaped hello from a freshly-generated keypair. */
async function makeHello(memberId: string): Promise<{ hello: HandshakeHello; raw: { pub: Uint8Array } }> {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const fp = await fingerprintFromPublicKey(pubRaw);
  const publicKeyB64 = b64encode(pubRaw);
  return {
    hello: {
      publicKey: publicKeyB64,
      memberId,
      fingerprint: fp,
      sig: 'unused-in-manager-tests', // manager only checks fingerprint↔key match
    },
    raw: { pub: pubRaw },
  };
}

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function tick(): Promise<void> {
  // Let microtasks (queueMicrotask) and `setTimeout(0)` work flush.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushUntil(predicate: () => boolean | Promise<boolean>, attempts = 100): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await predicate()) return;
    await tick();
  }
  throw new Error('flushUntil: predicate never satisfied');
}

beforeEach(async () => {
  _resetIdentityCacheForTests();
  _resetPeerManagerForTests();
  await Promise.all([
    db.messages.clear(),
    db.photos.clear(),
    db.photoBlobs.clear(),
    db.pointEvents.clear(),
    db.completions.clear(),
    db.habits.clear(),
    db.outbox.clear(),
    db.peers.clear(),
    db.meta.clear(),
  ]);
});

afterEach(() => {
  _resetPeerManagerForTests();
});

describe('PeerManager — trust + adoption', () => {
  it('puts a brand-new peer into awaiting-trust state', async () => {
    const m = new PeerManager();
    const [peer] = pairMockPeers();
    const { hello } = await makeHello('mem-a');
    const state = await m.adopt(peer, hello, 'Alice');
    expect(state).toBe('awaiting-trust');
    expect(m.summarize()[0].state).toBe('awaiting-trust');
  });

  it('rejects a hello whose fingerprint does not match its public key', async () => {
    const m = new PeerManager();
    const [peer] = pairMockPeers();
    const { hello } = await makeHello('mem-a');
    const tampered = { ...hello, fingerprint: 'AAAAAAAAAA' };
    await expect(m.adopt(peer, tampered, 'Eve')).rejects.toThrow(/fingerprint/);
  });

  it('auto-syncs a peer that is already in the trust store', async () => {
    const { hello } = await makeHello('mem-a');
    await db.peers.put({
      fingerprint: hello.fingerprint,
      publicKeyB64: hello.publicKey,
      memberId: hello.memberId,
      displayName: 'Alice',
      pairedAt: new Date().toISOString(),
      lastSeenAt: null,
    });
    const m = new PeerManager();
    const [peer] = pairMockPeers();
    const state = await m.adopt(peer, hello, 'Alice');
    expect(state).toBe('syncing');
  });

  it('forget() closes the connection and removes the trust row', async () => {
    const m = new PeerManager();
    const [peer] = pairMockPeers();
    const { hello } = await makeHello('mem-a');
    await m.adopt(peer, hello, 'Alice');
    await m.trust(hello.fingerprint, 'Alice');
    expect(await db.peers.count()).toBe(1);
    await m.forget(hello.fingerprint);
    expect(await db.peers.count()).toBe(0);
    expect(m.summarize()).toHaveLength(0);
  });
});

describe('PeerManager — gossip exchange', () => {
  /**
   * Tests below model "the remote peer" as a hand-driven partner that
   * captures outbound frames from our manager and synthesizes the
   * replies. The "local" Dexie tables stand in for our device's state.
   */

  async function trustedAdopt(): Promise<{ manager: PeerManager; partner: MockPeer; hello: HandshakeHello }> {
    const { hello } = await makeHello('mem-remote');
    await db.peers.put({
      fingerprint: hello.fingerprint,
      publicKeyB64: hello.publicKey,
      memberId: hello.memberId,
      displayName: 'Remote',
      pairedAt: 'now',
      lastSeenAt: null,
    });
    const manager = new PeerManager();
    const [local, partner] = pairMockPeers();
    await manager.adopt(local, hello, 'Remote');
    return { manager, partner, hello };
  }

  function captureFrames(partner: MockPeer): { texts: string[]; binaries: ArrayBuffer[] } {
    const texts: string[] = [];
    const binaries: ArrayBuffer[] = [];
    partner.setEvents({
      onText: (t) => { texts.push(t); },
      onBinary: (b) => { binaries.push(b); },
    });
    return { texts, binaries };
  }

  it('emits initial HAVE frames for every collection that has local data', async () => {
    await db.messages.put({ id: 'localA', from: 'me', sentAt: '2026-05-31T10:00:00Z', body: 'x', kind: 'message' } satisfies Message);
    await db.messages.put({ id: 'localB', from: 'me', sentAt: '2026-05-31T10:00:01Z', body: 'y', kind: 'message' } satisfies Message);

    // Stage trust + peers, then capture frames BEFORE adopt so the
    // synchronous initial HAVE doesn't slip past an empty handler.
    const { hello } = await makeHello('mem-remote');
    await db.peers.put({
      fingerprint: hello.fingerprint, publicKeyB64: hello.publicKey, memberId: hello.memberId,
      displayName: 'Remote', pairedAt: 'now', lastSeenAt: null,
    });
    const manager = new PeerManager();
    const [local, partner] = pairMockPeers();
    const { texts } = captureFrames(partner);
    await manager.adopt(local, hello, 'Remote');
    await flushUntil(() => texts.some((t) => {
      const m = JSON.parse(t);
      return m.type === 'have' && m.collection === 'messages';
    }));

    const haves = texts.map((t) => JSON.parse(t)).filter((m) => m.type === 'have');
    const messagesHave = haves.find((h) => h.collection === 'messages');
    expect(messagesHave).toBeTruthy();
    expect(messagesHave.ids.sort()).toEqual(['localA', 'localB']);
  });

  it('responds to a remote HAVE with a WANT for ids we lack', async () => {
    const { partner } = await trustedAdopt();
    const { texts } = captureFrames(partner);

    partner.sendText(JSON.stringify({ type: 'have', collection: 'messages', ids: ['remoteOnly'] }));
    await tick(); await tick();
    const want = texts.map((t) => JSON.parse(t)).find((m) => m.type === 'want' && m.collection === 'messages');
    expect(want).toBeTruthy();
    expect(want.ids).toEqual(['remoteOnly']);
  });

  it('absorbs an incoming DATA payload into Dexie + outbox', async () => {
    const { partner } = await trustedAdopt();
    captureFrames(partner);

    const incoming: Message = { id: 'incoming1', from: 'mem-remote', sentAt: '2026-05-31T11:00:00Z', body: 'hi', kind: 'message' };
    partner.sendText(JSON.stringify({ type: 'data', collection: 'messages', records: [incoming] }));
    await flushUntil(async () => (await db.messages.count()) >= 1);

    const stored = await db.messages.get('incoming1');
    expect(stored?.body).toBe('hi');
    const outboxEntry = await db.outbox.get('p2p-messages-incoming1');
    expect(outboxEntry?.op.kind).toBe('put-file');
    expect((outboxEntry?.op as { path: string }).path).toMatch(/^messages\/2026-05-31\//);
  });

  it('after photo metadata arrives, asks for the binary stream and assembles it', async () => {
    const { partner } = await trustedAdopt();
    const { binaries } = captureFrames(partner);

    const photo: Photo = {
      id: 'pIn', from: 'mem-remote',
      takenAt: '2026-05-31T10:00:00Z', uploadedAt: '2026-05-31T10:00:00Z',
      filePath: 'photos/2026-05-31/10-00-00-mem-remote-pIn.jpg',
      width: 1, height: 1, bytes: 4, exifPresent: false,
    };
    partner.sendText(JSON.stringify({ type: 'data', collection: 'photos', records: [photo] }));
    await flushUntil(async () => (await db.photos.count()) >= 1);

    // Now ship the binary as a single frame.
    const { encodeBinaryFrame } = await import('./protocol');
    const bytes = new Uint8Array([9, 8, 7, 6]);
    const frame = encodeBinaryFrame({ kind: 'photo', photoId: 'pIn', idx: 0, total: 1, mime: 'image/jpeg' }, bytes);
    await partner.sendBinary(frame);
    await flushUntil(async () => (await db.photoBlobs.count()) >= 1);

    const blobRow = await db.photoBlobs.get('pIn');
    expect(blobRow).toBeTruthy();
    expect(binaries.length).toBe(0); // partner only *sent*; nothing came back as binary
    // After absorbing the binary, an outbox entry for the bytes upload should appear.
    expect(await db.outbox.get('p2p-photo-bin-pIn')).toBeTruthy();
  }, 5000);

  it('untrusted peer messages are dropped (no DB writes, no outbox)', async () => {
    const m = new PeerManager();
    const [peer, partner] = pairMockPeers();
    const { hello } = await makeHello('mem-a');
    await m.adopt(peer, hello, 'Alice');
    expect(m.summarize()[0].state).toBe('awaiting-trust');

    partner.sendText(JSON.stringify({ type: 'have', collection: 'messages', ids: ['x'] }));
    partner.sendText(JSON.stringify({ type: 'data', collection: 'messages', records: [{ id: 'x', from: 'm', sentAt: '2026-05-31T10:00:00Z', body: 'spam', kind: 'message' }] }));
    await tick(); await tick();
    expect(await db.outbox.count()).toBe(0);
    expect(await db.messages.count()).toBe(0);
  });
});
