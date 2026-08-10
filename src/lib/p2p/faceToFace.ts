/**
 * One-gesture pairing: hold two phones facing each other.
 *
 * The honest constraint first. iOS Safari PWAs get no Web Bluetooth, no NFC,
 * no raw sockets, no mDNS API, and no background execution — and WebRTC needs
 * a fresh SDP exchange every session, because DTLS certificates and ICE
 * candidates are per-session. So "pair once, reconnect silently forever" is
 * not achievable on this platform. There is no signaling channel at sea.
 *
 * What *is* achievable: make reconnecting a single gesture instead of a
 * six-step wizard. Trust already persists (`db.peers`), so a known peer needs
 * no prompts, and the compact SDP codec fits an offer in one QR frame. Both
 * phones show a small beacon and watch for the other's; whoever has the
 * lexicographically smaller fingerprint becomes the initiator. From there the
 * offer and answer flow automatically. Nobody picks a role, nobody taps
 * "next", and the whole thing takes about five seconds.
 *
 * This module is pure state-machine logic with no React and no DOM, so the
 * flow can be tested without a camera.
 */

import { InitiatorSession, ResponderSession, type HandshakeHello } from './session';
import type { Peer } from './peer';
import { FrameReassembler } from './qr';
import type { PeerIdentity } from './identity';

const BEACON_PREFIX = 'TLB';
/** Handshake payload frames start with the QR framing magic. */
const FRAME_PREFIX = 'TL1|';
/** How long to wait for ICE after the answer before declaring the LAN hostile. */
export const CONNECT_TIMEOUT_MS = 20_000;

export interface Beacon {
  fingerprint: string;
  nonce: string;
}

export function beaconFrame(fingerprint: string, nonce: string): string {
  return `${BEACON_PREFIX}|${fingerprint}|${nonce}`;
}

export function parseBeacon(text: string): Beacon | null {
  if (!text.startsWith(`${BEACON_PREFIX}|`)) return null;
  const [, fingerprint, nonce] = text.split('|');
  if (!fingerprint || !nonce) return null;
  return { fingerprint, nonce };
}

export type Role = 'initiator' | 'responder';

/**
 * Pick roles without negotiating.
 *
 * Both phones run this on the same two values and must reach opposite
 * conclusions, so the rule has to be a total order on something both sides
 * know. Fingerprints are unique per device; the nonce only matters in the
 * impossible case of a collision, where it at least avoids a deadlock.
 */
export function decideRole(mine: Beacon, theirs: Beacon): Role {
  if (mine.fingerprint !== theirs.fingerprint) {
    return mine.fingerprint < theirs.fingerprint ? 'initiator' : 'responder';
  }
  return mine.nonce < theirs.nonce ? 'initiator' : 'responder';
}

export type F2FState =
  /** Showing our beacon, looking for theirs. */
  | { name: 'searching' }
  /** We're the initiator: showing the offer, watching for their answer. */
  | { name: 'offering' }
  /** We're the responder: saw their beacon, waiting for their offer frames. */
  | { name: 'awaiting-offer' }
  /** Showing our answer; they need to scan it. */
  | { name: 'answering' }
  /** Both descriptions exchanged; ICE is working. */
  | { name: 'connecting' }
  | { name: 'connected'; hello: HandshakeHello; peer: Peer }
  /** ICE never completed — almost always AP isolation. */
  | { name: 'blocked' }
  | { name: 'error'; message: string };

export interface F2FEvents {
  onState: (state: F2FState) => void;
  /** QR content this device should be displaying, or null to display nothing. */
  onDisplay: (frames: string[] | null) => void;
}

/**
 * Drives the face-to-face flow.
 *
 * Feed it every scanned QR string via {@link onCode}; it decides what that
 * code means given where we are, and reports what to display and where we've
 * got to. Callers own the camera and the screen.
 */
export class FaceToFaceSession {
  private state: F2FState = { name: 'searching' };
  private readonly mine: Beacon;
  private initiator: InitiatorSession | null = null;
  private responder: ResponderSession | null = null;
  private reassembler = new FrameReassembler();
  /** Beacon we've already acted on, so repeat scans of it are ignored. */
  private engagedWith: string | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private done = false;
  /** Set once the open Peer becomes the PeerManager's responsibility. */
  private handedOff = false;

  constructor(
    private readonly identity: PeerIdentity,
    private readonly memberId: string,
    private readonly events: F2FEvents,
    nonce = randomNonce(),
  ) {
    this.mine = { fingerprint: identity.fingerprint, nonce };
  }

  /** Begin advertising. */
  start(): void {
    this.setState({ name: 'searching' });
    this.events.onDisplay([beaconFrame(this.mine.fingerprint, this.mine.nonce)]);
  }

  get beacon(): Beacon {
    return this.mine;
  }

  /** Feed in a scanned QR code. Safe to call with unrelated codes. */
  async onCode(text: string): Promise<void> {
    if (this.done) return;
    try {
      if (text.startsWith(BEACON_PREFIX + '|')) return await this.onBeacon(text);
      if (text.startsWith(FRAME_PREFIX)) return await this.onFrame(text);
    } catch (err) {
      this.fail(err);
    }
  }

  /** Abandon the session and release the peer connection. */
  cancel(): void {
    this.done = true;
    this.clearTimeout();
    this.closeSessions();
    this.events.onDisplay(null);
  }

  // --- internals ---------------------------------------------------------

  private async onBeacon(text: string): Promise<void> {
    const theirs = parseBeacon(text);
    if (!theirs) return;
    if (theirs.fingerprint === this.mine.fingerprint && theirs.nonce === this.mine.nonce) return;
    if (this.engagedWith === theirs.fingerprint) return;
    if (this.state.name !== 'searching') return;

    this.engagedWith = theirs.fingerprint;

    if (decideRole(this.mine, theirs) === 'initiator') {
      // The scanner's stream is already live here, which is exactly the
      // capture permission that makes WebKit emit real-IP host candidates.
      //
      // So the warm-up must be suppressed, not merely redundant: WebKit allows
      // one active capture at a time, and a second getUserMedia would freeze
      // the viewfinder we're about to need for scanning their answer — turning
      // a working pairing into a 20s timeout that blames the ship's WiFi.
      this.initiator = new InitiatorSession({
        identity: this.identity,
        memberId: this.memberId,
        warmCapture: async () => null,
      });
      const frames = await this.initiator.beginFrames();
      this.setState({ name: 'offering' });
      this.events.onDisplay(frames);
    } else {
      this.responder = new ResponderSession({ identity: this.identity, memberId: this.memberId });
      this.setState({ name: 'awaiting-offer' });
      // Keep showing the beacon: the other side may still be looking for it.
      this.events.onDisplay([beaconFrame(this.mine.fingerprint, this.mine.nonce)]);
    }
  }

  private async onFrame(text: string): Promise<void> {
    // A peer that started first may send offer frames before we ever saw its
    // beacon. Accept that: become the responder on the spot.
    if (this.state.name === 'searching' && !this.responder) {
      this.responder = new ResponderSession({ identity: this.identity, memberId: this.memberId });
      this.setState({ name: 'awaiting-offer' });
    }

    if (!this.reassembler.ingest(text)) return;
    const bytes = this.reassembler.complete();
    if (!bytes) return;
    this.reassembler = new FrameReassembler();

    if (this.state.name === 'offering' && this.initiator) {
      const { peer, remoteHello } = await this.initiator.accept(bytes);
      this.armConnectTimeout();
      this.setState({ name: 'connecting' });
      this.events.onDisplay(null);
      this.watchPeer(peer, remoteHello);
      return;
    }

    if (this.state.name === 'awaiting-offer' && this.responder) {
      const { peer, frames, remoteHello } = await this.responder.respond(bytes);
      this.armConnectTimeout();
      this.setState({ name: 'answering' });
      this.events.onDisplay(frames);
      this.watchPeer(peer, remoteHello);
      return;
    }
  }

  /**
   * Resolve once the data channel opens.
   *
   * Both sides reach 'connected' independently; the responder keeps showing
   * its answer QR until then, because the initiator still has to scan it.
   */
  private watchPeer(peer: Peer, hello: HandshakeHello): void {
    peer.setEvents({
      onOpen: () => {
        if (this.done) return;
        this.clearTimeout();
        this.done = true;
        this.handedOff = true;
        this.setState({ name: 'connected', hello, peer });
        this.events.onDisplay(null);
      },
    });
  }

  /**
   * If ICE hasn't completed in time, the LAN is almost certainly isolating
   * clients from each other. Nothing in the browser can defeat that, so the
   * UI's job becomes pointing at a transport that doesn't need the LAN.
   */
  private armConnectTimeout(): void {
    this.clearTimeout();
    this.timeout = setTimeout(() => {
      if (this.done) return;
      this.done = true;
      // Release the connection attempt. Left running, ICE can complete a
      // second later and the far side adopts a peer this side has stopped
      // listening to — showing them a phantom "syncing" device until the
      // keepalive reaps it.
      this.closeSessions();
      this.setState({ name: 'blocked' });
      this.events.onDisplay(null);
    }, CONNECT_TIMEOUT_MS);
  }

  /**
   * Tear down the connection attempt.
   *
   * No-op once we've reached `connected`: at that point the Peer has been
   * handed to the PeerManager, which owns its lifetime. Closing it here would
   * drop a working connection the moment the user leaves the pairing screen —
   * which is exactly when they expect syncing to be underway.
   */
  private closeSessions(): void {
    if (this.handedOff) return;
    this.initiator?.cancel();
    this.responder?.cancel();
    this.initiator = null;
    this.responder = null;
  }

  private clearTimeout(): void {
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null;
  }

  private fail(err: unknown): void {
    this.clearTimeout();
    this.done = true;
    this.closeSessions();
    this.setState({
      name: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
    this.events.onDisplay(null);
  }

  private setState(next: F2FState): void {
    this.state = next;
    this.events.onState(next);
  }
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
