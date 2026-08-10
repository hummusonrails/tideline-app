/**
 * QR-code-based pairing session between two devices.
 *
 * Goal: produce an open, authenticated {@link Peer} without any
 * signaling server. The two sides exchange a single QR-encoded
 * payload each — the WebRTC SDP plus a hello block proving they
 * hold the private key for the public key they're claiming.
 *
 * Authentication rides on the SDP's DTLS fingerprint:
 *
 *   hello.sig = sign(privateKey, "tideline-p2p:" + sha256(sdp))
 *
 * Verifying the signature confirms the signer holds privateKey AND
 * committed to a specific SDP (which carries a unique-per-session
 * DTLS cert fingerprint). The subsequent WebRTC handshake then
 * fails unless the actual DTLS cert matches the SDP — so the
 * end-to-end identity binding is complete.
 *
 * Pure-QR offline transport (no WebRTC at all) lives in {@link bulkQr}.
 */

import { Peer } from './peer';
import {
  type PeerIdentity,
  importPublicKeyB64,
  sign,
  verify,
} from './identity';
import { bytesToB64, b64ToBytes, enc, sha256 } from './base';
import { FrameReassembler, encodeFrames } from './qr';
import { compressSdp, expandSdp, isCompactSdp, type CompactSdp } from './compactSdp';

const SIG_PREFIX = 'tideline-p2p:';

export interface HandshakeHello {
  publicKey: string;       // base64, raw P-256 public key (uncompressed, 65 bytes)
  memberId: string;
  fingerprint: string;     // 10-char crockford base32 of sha256(publicKey)
  sig: string;             // base64
}

/** Original format: the SDP verbatim. Still accepted, and still our fallback. */
export interface HandshakePayloadV1 {
  v: 1;
  sdp: string;
  hello: HandshakeHello;
}

/**
 * Compact format: the SDP reduced to its varying fields so the whole payload
 * fits one QR frame. See {@link CompactSdp}.
 */
export interface HandshakePayloadV2 {
  v: 2;
  c: CompactSdp;
  kind: 'offer' | 'answer';
  hello: HandshakeHello;
}

export type HandshakePayload = HandshakePayloadV1 | HandshakePayloadV2;

/**
 * What the hello signature commits to.
 *
 * v1 signs the SDP text. v2 signs the compact form's canonical JSON — it can't
 * sign the expanded SDP, because expansion is a local reconstruction and the
 * two sides must agree byte-for-byte on what was signed.
 *
 * Either way the signature binds the sender's key to a specific DTLS
 * fingerprint, which is what makes the pairing authentic.
 */
function signedMaterialFor(payload: HandshakePayload): string {
  return payload.v === 2 ? JSON.stringify(payload.c) : payload.sdp;
}

/** Reconstruct the SDP a payload describes, whichever version it is. */
function sdpFrom(payload: HandshakePayload): string {
  return payload.v === 2 ? expandSdp(payload.c, payload.kind) : payload.sdp;
}

function isValidPayload(p: unknown): p is HandshakePayload {
  if (typeof p !== 'object' || p === null) return false;
  const o = p as Record<string, unknown>;
  if (!o.hello || typeof o.hello !== 'object') return false;
  if (o.v === 1) return typeof o.sdp === 'string' && o.sdp.length > 0;
  if (o.v === 2) return isCompactSdp(o.c) && (o.kind === 'offer' || o.kind === 'answer');
  return false;
}

/**
 * Build the payload to display, preferring the compact form.
 *
 * Compression is best-effort: an SDP shape the codec doesn't recognise falls
 * back to v1 rather than failing the pairing. A few extra QR frames is a much
 * better outcome than no connection.
 */
async function buildPayload(
  identity: PeerIdentity,
  memberId: string,
  sdp: string,
  kind: 'offer' | 'answer',
): Promise<HandshakePayload> {
  try {
    const c = compressSdp(sdp);
    // Only trust the compact form if it actually round-trips back to something
    // usable — cheaper to find out here than to hand the peer a broken SDP.
    expandSdp(c, kind);
    const draft: HandshakePayloadV2 = { v: 2, c, kind, hello: PLACEHOLDER_HELLO };
    const hello = await signSdp(identity, memberId, signedMaterialFor(draft));
    return { ...draft, hello };
  } catch {
    const hello = await signSdp(identity, memberId, sdp);
    return { v: 1, sdp, hello };
  }
}

/** Stand-in while computing the signature over the payload's own body. */
const PLACEHOLDER_HELLO: HandshakeHello = {
  publicKey: '', memberId: '', fingerprint: '', sig: '',
};

async function signSdp(id: PeerIdentity, memberId: string, sdp: string): Promise<HandshakeHello> {
  const digest = await sha256(enc.encode(sdp));
  const material = enc.encode(SIG_PREFIX);
  const buf = new Uint8Array(material.byteLength + digest.byteLength);
  buf.set(material, 0);
  buf.set(digest, material.byteLength);
  const sig = await sign(id, buf);
  return {
    publicKey: id.publicKeyB64,
    memberId,
    fingerprint: id.fingerprint,
    sig: bytesToB64(sig),
  };
}

async function verifyHello(hello: HandshakeHello, sdp: string): Promise<boolean> {
  let pubKey: CryptoKey;
  try {
    pubKey = await importPublicKeyB64(hello.publicKey);
  } catch {
    return false;
  }
  const digest = await sha256(enc.encode(sdp));
  const material = enc.encode(SIG_PREFIX);
  const buf = new Uint8Array(material.byteLength + digest.byteLength);
  buf.set(material, 0);
  buf.set(digest, material.byteLength);
  let sig: Uint8Array;
  try { sig = b64ToBytes(hello.sig); } catch { return false; }
  return verify(pubKey, sig, buf);
}

/**
 * Hold a camera stream open across SDP creation.
 *
 * WebKit (like Chrome) hides local IPs behind ephemeral `<uuid>.local` mDNS
 * names in host candidates — unless the page currently has device-capture
 * permission, in which case it emits the real addresses. That difference
 * decides whether pairing works on a network that filters multicast, which
 * ship and hotel WiFi routinely do: with mDNS filtered, neither phone can
 * resolve the other's `.local` name and ICE fails even though a direct
 * connection over that LAN was available the whole time.
 *
 * Never throws. A declined camera prompt costs us real-IP candidates, not the
 * connection — mDNS still works on a well-behaved network.
 */
export async function warmCapturePermission(): Promise<MediaStream | null> {
  try {
    if (!navigator.mediaDevices?.getUserMedia) return null;
    return await navigator.mediaDevices.getUserMedia({ video: true });
  } catch {
    return null;
  }
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

function jsonBytes(value: unknown): Uint8Array {
  return enc.encode(JSON.stringify(value));
}

function bytesToJson<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

// --- Initiator (the device that "starts" the pairing) ----------------------

export class InitiatorSession {
  private peer: Peer;
  private identity: PeerIdentity;
  private memberId: string;
  private warm: () => Promise<MediaStream | null>;

  constructor(opts: {
    identity: PeerIdentity;
    memberId: string;
    /** Seam for tests; defaults to the real camera warm-up. */
    warmCapture?: () => Promise<MediaStream | null>;
  }) {
    this.identity = opts.identity;
    this.memberId = opts.memberId;
    this.warm = opts.warmCapture ?? warmCapturePermission;
    this.peer = new Peer();
  }

  /** Returns the QR frames the initiator should display first. */
  async beginFrames(): Promise<string[]> {
    // Must happen before createOffer: candidates are gathered during it, and
    // capture permission is what decides whether they carry real IPs.
    // (The responder gets this for free — its scanner is already running.)
    const stream = await this.warm();
    let sdp: string;
    try {
      sdp = await this.peer.createOffer();
    } finally {
      stopStream(stream);
    }
    const payload = await buildPayload(this.identity, this.memberId, sdp, 'offer');
    return encodeFrames(jsonBytes(payload));
  }

  /**
   * Apply a fully reassembled responder payload. Returns the
   * connected Peer and the responder's hello (caller decides
   * whether to trust the fingerprint).
   */
  async accept(responderBytes: Uint8Array): Promise<{ peer: Peer; remoteHello: HandshakeHello }> {
    const payload = bytesToJson<unknown>(responderBytes);
    if (!isValidPayload(payload)) {
      throw new Error('invalid responder payload');
    }
    const ok = await verifyHello(payload.hello, signedMaterialFor(payload));
    if (!ok) throw new Error('responder hello signature invalid');
    await this.peer.acceptAnswer(sdpFrom(payload));
    return { peer: this.peer, remoteHello: payload.hello };
  }

  cancel(): void { this.peer.close(); }
}

// --- Responder (the device that "joins" by scanning first) ----------------

export class ResponderSession {
  private peer: Peer;
  private identity: PeerIdentity;
  private memberId: string;

  constructor(opts: { identity: PeerIdentity; memberId: string }) {
    this.identity = opts.identity;
    this.memberId = opts.memberId;
    this.peer = new Peer();
  }

  /**
   * Given the fully reassembled initiator payload, verify its hello,
   * create the answer SDP, and return the responder's frames + the
   * peer to monitor + the initiator's hello.
   *
   * Invariant worth preserving: every caller reaches this with the QR scanner
   * live, so capture permission is already granted and the answer's host
   * candidates carry real IPs. See {@link warmCapturePermission} for why that
   * matters. If a future caller ever responds without a camera open, it must
   * warm capture first.
   */
  async respond(initiatorBytes: Uint8Array): Promise<{
    peer: Peer;
    frames: string[];
    remoteHello: HandshakeHello;
  }> {
    const payload = bytesToJson<unknown>(initiatorBytes);
    if (!isValidPayload(payload)) {
      throw new Error('invalid initiator payload');
    }
    const ok = await verifyHello(payload.hello, signedMaterialFor(payload));
    if (!ok) throw new Error('initiator hello signature invalid');
    const answer = await this.peer.acceptOfferAndCreateAnswer(sdpFrom(payload));
    // Answer in whichever format the initiator spoke: a peer on an older build
    // sends v1 and can only parse v1 back.
    const myPayload =
      payload.v === 2
        ? await buildPayload(this.identity, this.memberId, answer, 'answer')
        : { v: 1 as const, sdp: answer, hello: await signSdp(this.identity, this.memberId, answer) };
    return {
      peer: this.peer,
      frames: encodeFrames(jsonBytes(myPayload)),
      remoteHello: payload.hello,
    };
  }

  cancel(): void { this.peer.close(); }
}

// --- Shared reassembler -----------------------------------------------------

/** Tiny convenience wrapper — scanner callers can keep one of these per session. */
export function newScanBuffer(): FrameReassembler {
  return new FrameReassembler();
}

export { verifyHello };
