import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InitiatorSession, ResponderSession } from './session';
import { _resetIdentityCacheForTests, getOrCreateIdentity } from './identity';
import { FrameReassembler } from './qr';
import { db } from '../db';
import type { PeerIdentity } from './identity';

/**
 * jsdom has no WebRTC, so the whole handshake is exercised against a stub that
 * records what it was asked to do and hands back fixture SDPs. That's enough
 * to pin the parts we actually own: what gets signed, which payload version we
 * emit, and the ordering constraint that camera permission is warm before
 * candidates are gathered.
 */

const OFFER_SDP = [
  'v=0',
  'o=- 1 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:1 1 udp 2113937151 192.168.1.5 50000 typ host',
  'a=ice-ufrag:offR',
  'a=ice-pwd:offerPasswordValue123456',
  'a=fingerprint:sha-256 11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
].join('\r\n') + '\r\n';

const ANSWER_SDP = OFFER_SDP
  .replace('a=ice-ufrag:offR', 'a=ice-ufrag:ansR')
  .replace('a=ice-pwd:offerPasswordValue123456', 'a=ice-pwd:answerPasswordValue65432')
  .replace('a=setup:actpass', 'a=setup:active')
  .replace('192.168.1.5 50000', '192.168.1.9 50001');

/** Order of operations observed across the stubbed peer connection. */
let trace: string[] = [];

class FakeDataChannel {
  readyState = 'connecting';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  removeEventListener() {}
  send() {}
  close() {}
}

class FakeRTCPeerConnection {
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((e: { channel: FakeDataChannel }) => void) | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
  connectionState = 'new';
  iceGatheringState = 'complete';
  localDescription: { type: string; sdp: string } | null = null;

  createDataChannel() {
    return new FakeDataChannel();
  }
  async createOffer() {
    trace.push('createOffer');
    return { type: 'offer', sdp: OFFER_SDP };
  }
  async createAnswer() {
    trace.push('createAnswer');
    return { type: 'answer', sdp: ANSWER_SDP };
  }
  async setLocalDescription(d: { type: string; sdp: string }) {
    this.localDescription = { type: d.type, sdp: d.type === 'offer' ? OFFER_SDP : ANSWER_SDP };
  }
  async setRemoteDescription(d: { type: string; sdp: string }) {
    trace.push(`setRemote:${d.type}`);
    lastRemoteSdp = d.sdp;
  }
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

let lastRemoteSdp = '';

/** Reassemble QR frames back into the payload object they encode. */
function decodeFrames(frames: string[]): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(reassemble(frames))) as Record<string, unknown>;
}

let alice: PeerIdentity;
let bob: PeerIdentity;

/** Two distinct identities: the store holds one at a time, so mint sequentially. */
async function mintIdentity(): Promise<PeerIdentity> {
  _resetIdentityCacheForTests();
  await db.meta.clear();
  return getOrCreateIdentity();
}

beforeEach(async () => {
  trace = [];
  lastRemoteSdp = '';
  vi.stubGlobal('RTCPeerConnection', FakeRTCPeerConnection);
  alice = await mintIdentity();
  bob = await mintIdentity();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('camera warm-up ordering', () => {
  it('grants capture permission before any candidate is gathered', async () => {
    const warmCapture = vi.fn(async () => {
      trace.push('warmCapture');
      return null;
    });
    const s = new InitiatorSession({ identity: alice, memberId: 'm-a', warmCapture });
    await s.beginFrames();
    expect(trace).toEqual(['warmCapture', 'createOffer']);
  });

  it('still produces frames when the camera prompt is declined', async () => {
    const s = new InitiatorSession({
      identity: alice,
      memberId: 'm-a',
      warmCapture: async () => null,
    });
    await expect(s.beginFrames()).resolves.not.toHaveLength(0);
  });
});

describe('compact handshake payloads', () => {
  it('emits the compact v2 form for a normal datachannel offer', async () => {
    const s = new InitiatorSession({ identity: alice, memberId: 'm-a', warmCapture: async () => null });
    const payload = decodeFrames(await s.beginFrames());
    expect(payload.v).toBe(2);
    expect(payload.kind).toBe('offer');
    expect(payload.c).toBeTypeOf('object');
  });

  it('fits the offer in a single QR frame', async () => {
    const s = new InitiatorSession({ identity: alice, memberId: 'm-a', warmCapture: async () => null });
    expect(await s.beginFrames()).toHaveLength(1);
  });

  it('completes a v2 offer → v2 answer handshake', async () => {
    const initiator = new InitiatorSession({
      identity: alice, memberId: 'm-a', warmCapture: async () => null,
    });
    const offerFrames = await initiator.beginFrames();
    const offerBytes = reassemble(offerFrames);

    const responder = new ResponderSession({ identity: bob, memberId: 'm-b' });
    const { frames: answerFrames, remoteHello } = await responder.respond(offerBytes);
    expect(remoteHello.fingerprint).toBe(alice.fingerprint);

    // The responder must have received a reconstructed SDP good enough to use.
    expect(lastRemoteSdp).toContain('a=ice-ufrag:offR');
    expect(lastRemoteSdp).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel');

    const answerPayload = decodeFrames(answerFrames);
    expect(answerPayload.v).toBe(2);

    const accepted = await initiator.accept(reassemble(answerFrames));
    expect(accepted.remoteHello.fingerprint).toBe(bob.fingerprint);
  });

  it('sends a verbatim SDP when preferV1 is set', async () => {
    // This is the escape hatch the face-to-face error state points at, so it
    // has to actually differ from the default path — otherwise a peer that
    // rejected the reconstructed description just fails again.
    const s = new InitiatorSession({
      identity: alice, memberId: 'm-a', warmCapture: async () => null, preferV1: true,
    });
    const payload = decodeFrames(await s.beginFrames());
    expect(payload.v).toBe(1);
    expect(payload.sdp).toContain('a=ice-ufrag:offR');
  });

  it('answers a legacy v1 offer in v1, so an older build can still pair', async () => {
    const helloV1 = await signV1(alice, 'm-a', OFFER_SDP);
    const v1Offer = encodeJson({ v: 1, sdp: OFFER_SDP, hello: helloV1 });

    const responder = new ResponderSession({ identity: bob, memberId: 'm-b' });
    const { frames } = await responder.respond(v1Offer);
    expect(decodeFrames(frames).v).toBe(1);
  });

  it('rejects a payload whose signature does not match its body', async () => {
    const initiator = new InitiatorSession({
      identity: alice, memberId: 'm-a', warmCapture: async () => null,
    });
    const payload = decodeFrames(await initiator.beginFrames());
    // Tamper with the signed body — the fingerprint the peer would commit to.
    const c = payload.c as Record<string, unknown>;
    c.u = 'evil';

    const responder = new ResponderSession({ identity: bob, memberId: 'm-b' });
    await expect(responder.respond(encodeJson(payload))).rejects.toThrow(/signature invalid/);
  });

  it('rejects a structurally invalid payload', async () => {
    const responder = new ResponderSession({ identity: bob, memberId: 'm-b' });
    await expect(responder.respond(encodeJson({ v: 2, hello: {} }))).rejects.toThrow(
      /invalid initiator payload/,
    );
  });
});

// --- helpers ---------------------------------------------------------------

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function reassemble(frames: string[]): Uint8Array {
  const r = new FrameReassembler();
  for (const f of frames) r.ingest(f);
  const bytes = r.complete();
  if (!bytes) throw new Error('frames did not reassemble');
  return bytes;
}

/** Recreate a v1 hello the way the pre-compact build signed them. */
async function signV1(identity: PeerIdentity, memberId: string, sdp: string) {
  const { sign } = await import('./identity');
  const { sha256, enc, bytesToB64 } = await import('./base');
  const digest = await sha256(enc.encode(sdp));
  const prefix = enc.encode('tideline-p2p:');
  const buf = new Uint8Array(prefix.byteLength + digest.byteLength);
  buf.set(prefix, 0);
  buf.set(digest, prefix.byteLength);
  return {
    publicKey: identity.publicKeyB64,
    memberId,
    fingerprint: identity.fingerprint,
    sig: bytesToB64(await sign(identity, buf)),
  };
}
