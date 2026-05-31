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

const SIG_PREFIX = 'tideline-p2p:';

export interface HandshakeHello {
  publicKey: string;       // base64, raw P-256 public key (uncompressed, 65 bytes)
  memberId: string;
  fingerprint: string;     // 10-char crockford base32 of sha256(publicKey)
  sig: string;             // base64
}

export interface HandshakePayload {
  v: 1;
  sdp: string;
  hello: HandshakeHello;
}

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

  constructor(opts: { identity: PeerIdentity; memberId: string }) {
    this.identity = opts.identity;
    this.memberId = opts.memberId;
    this.peer = new Peer();
  }

  /** Returns the QR frames the initiator should display first. */
  async beginFrames(): Promise<string[]> {
    const sdp = await this.peer.createOffer();
    const hello = await signSdp(this.identity, this.memberId, sdp);
    const payload: HandshakePayload = { v: 1, sdp, hello };
    return encodeFrames(jsonBytes(payload));
  }

  /**
   * Apply a fully reassembled responder payload. Returns the
   * connected Peer and the responder's hello (caller decides
   * whether to trust the fingerprint).
   */
  async accept(responderBytes: Uint8Array): Promise<{ peer: Peer; remoteHello: HandshakeHello }> {
    const payload = bytesToJson<HandshakePayload>(responderBytes);
    if (!payload || payload.v !== 1 || !payload.sdp || !payload.hello) {
      throw new Error('invalid responder payload');
    }
    const ok = await verifyHello(payload.hello, payload.sdp);
    if (!ok) throw new Error('responder hello signature invalid');
    await this.peer.acceptAnswer(payload.sdp);
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
   */
  async respond(initiatorBytes: Uint8Array): Promise<{
    peer: Peer;
    frames: string[];
    remoteHello: HandshakeHello;
  }> {
    const payload = bytesToJson<HandshakePayload>(initiatorBytes);
    if (!payload || payload.v !== 1 || !payload.sdp || !payload.hello) {
      throw new Error('invalid initiator payload');
    }
    const ok = await verifyHello(payload.hello, payload.sdp);
    if (!ok) throw new Error('initiator hello signature invalid');
    const answer = await this.peer.acceptOfferAndCreateAnswer(payload.sdp);
    const hello = await signSdp(this.identity, this.memberId, answer);
    const myPayload: HandshakePayload = { v: 1, sdp: answer, hello };
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
