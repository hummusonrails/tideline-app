/**
 * Thin wrapper around a single RTCPeerConnection + data channel.
 *
 * Non-trickle ICE: we gather every candidate before handing the SDP to
 * the caller, so signaling is one round-trip (offer → answer) — the
 * shape QR-code signaling needs. Real-time apps trickle candidates over
 * a persistent channel, but we don't have one.
 *
 * ICE servers: see {@link defaultIceServers}. The original design passed none
 * at all, on the reasoning that host + mDNS candidates are all you need on a
 * shared WiFi. That reasoning has a hole, and it cost us a working pairing:
 * browsers no longer put real local IPs in host candidates. They emit an
 * mDNS `<uuid>.local` hostname instead, and the far side can only use it if it
 * can resolve that name over multicast DNS. Hotel and cruise-ship networks
 * almost always run client isolation, which blocks exactly that — so the two
 * phones exchange perfectly valid SDP, find no usable candidate pair, and sit
 * in "connecting" until they give up.
 *
 * With a STUN server configured there is also a server-reflexive candidate to
 * try, which doesn't depend on multicast. It needs internet at the moment of
 * pairing, so it's not a cure for every case — but it turns the common case
 * (pairing in a hotel or on a hotspot, before the ship sails) from broken into
 * working.
 */

export type PeerSide = 'initiator' | 'responder';

export type PeerState =
  | 'idle'
  | 'gathering'
  | 'awaiting-answer'
  | 'connecting'
  | 'connected'
  | 'closed'
  | 'failed';

export interface PeerOptions {
  iceServers?: RTCIceServer[];
  /** Bytes that should trigger pause-and-drain for backpressure on binary sends. */
  bufferHighWaterMark?: number;
  /** Resolve gathering after this long even if "complete" never fires. */
  iceGatherTimeoutMs?: number;
}

export interface PeerEvents {
  onOpen?: () => void;
  onText?: (text: string) => void;
  onBinary?: (bytes: ArrayBuffer) => void;
  onState?: (state: PeerState) => void;
  onClose?: () => void;
}

/**
 * Subset of {@link Peer} the manager actually uses. Lets tests pass
 * a hand-rolled stand-in instead of needing a real RTCPeerConnection.
 */
export interface PeerLike {
  setEvents(events: PeerEvents): void;
  sendText(text: string): void;
  sendBinary(bytes: Uint8Array): Promise<void>;
  close(): void;
  /** Is the data channel actually ready to carry a frame right now? */
  isOpen(): boolean;
}

const DEFAULT_BUFFER_HIGH = 1 * 1024 * 1024;
const DEFAULT_ICE_TIMEOUT = 4000;

/**
 * Public STUN servers, used only to learn our own reflexive address.
 *
 * No trip data touches these — STUN is a "what does my address look like from
 * outside" question and nothing more. Two are listed so one being unreachable
 * doesn't cost us the candidate; gathering ends on the first to answer, or on
 * {@link DEFAULT_ICE_TIMEOUT} if neither does.
 */
export const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/**
 * What to gather with, given what we know about connectivity.
 *
 * Offline, STUN can only ever time out, and making every pairing attempt wait
 * out that timeout would turn the one situation the app was built for — two
 * phones alone at sea — into the slowest one. So we ask for reflexive
 * candidates when there's plausibly internet and skip them when there isn't.
 */
export function defaultIceServers(hasInternet: boolean): RTCIceServer[] {
  return hasInternet ? STUN_SERVERS : [];
}

export class Peer {
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private state_: PeerState = 'idle';
  private readonly bufferHigh: number;
  private readonly iceTimeoutMs: number;
  private events: PeerEvents;
  private gatheringDone: Promise<void> | null = null;

  constructor(opts: PeerOptions = {}, events: PeerEvents = {}) {
    this.pc = new RTCPeerConnection({ iceServers: opts.iceServers ?? [] });
    this.bufferHigh = opts.bufferHighWaterMark ?? DEFAULT_BUFFER_HIGH;
    this.iceTimeoutMs = opts.iceGatherTimeoutMs ?? DEFAULT_ICE_TIMEOUT;
    this.events = events;
    this.pc.onconnectionstatechange = () => this.syncConnectionState();
    this.pc.ondatachannel = (e) => this.attachChannel(e.channel);
  }

  /**
   * Swap or extend event handlers after construction. The handshake flow
   * builds the Peer with no events, then the manager adopts it and wires
   * in the protocol handlers.
   */
  setEvents(events: PeerEvents): void {
    this.events = { ...this.events, ...events };
  }

  get state(): PeerState { return this.state_; }
  get bufferedAmount(): number { return this.dc?.bufferedAmount ?? 0; }

  isOpen(): boolean { return this.dc?.readyState === 'open'; }

  /** Create the offer SDP, with all ICE candidates baked in. */
  async createOffer(): Promise<string> {
    this.transition('gathering');
    this.attachChannel(this.pc.createDataChannel('tideline', { ordered: true }));
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.waitForGathering();
    this.transition('awaiting-answer');
    const local = this.pc.localDescription;
    if (!local || !local.sdp) throw new Error('no local description after gathering');
    return local.sdp;
  }

  /** Take an offer SDP, return an answer SDP (with all ICE candidates baked in). */
  async acceptOfferAndCreateAnswer(offerSdp: string): Promise<string> {
    this.transition('gathering');
    await this.pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.waitForGathering();
    this.transition('connecting');
    const local = this.pc.localDescription;
    if (!local || !local.sdp) throw new Error('no local description after gathering');
    return local.sdp;
  }

  /** Initiator: apply the responder's answer to complete the handshake. */
  async acceptAnswer(answerSdp: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    this.transition('connecting');
  }

  /**
   * Send a text frame. Throws if the channel isn't open.
   */
  sendText(text: string): void {
    const ch = this.requireOpenChannel();
    ch.send(text);
  }

  /**
   * Send a binary frame with backpressure. Resolves once the data is queued
   * AND the channel's bufferedAmount is below the high-water mark again, so
   * the caller can stream big payloads (e.g. photo chunks) without blowing
   * up memory.
   */
  async sendBinary(bytes: Uint8Array): Promise<void> {
    const ch = this.requireOpenChannel();
    // Copy into a plain ArrayBuffer to dodge TS's pickiness about
    // SharedArrayBuffer-backed views and to ensure consistent transfer.
    const buf = new Uint8Array(bytes.byteLength);
    buf.set(bytes);
    ch.send(buf.buffer);
    if (ch.bufferedAmount <= this.bufferHigh) return;
    await new Promise<void>((resolve) => {
      const orig = ch.bufferedAmountLowThreshold;
      ch.bufferedAmountLowThreshold = Math.floor(this.bufferHigh / 2);
      const onLow = () => {
        ch.removeEventListener('bufferedamountlow', onLow);
        ch.bufferedAmountLowThreshold = orig;
        resolve();
      };
      ch.addEventListener('bufferedamountlow', onLow);
    });
  }

  close(): void {
    if (this.state_ === 'closed') return;
    try { this.dc?.close(); } catch { /* ignore */ }
    try { this.pc.close(); } catch { /* ignore */ }
    this.transition('closed');
    this.events.onClose?.();
  }

  // --- internals ---------------------------------------------------------

  private requireOpenChannel(): RTCDataChannel {
    if (!this.dc || this.dc.readyState !== 'open') {
      throw new Error(`peer not open (state=${this.state_}, channel=${this.dc?.readyState ?? 'none'})`);
    }
    return this.dc;
  }

  private attachChannel(ch: RTCDataChannel): void {
    this.dc = ch;
    ch.binaryType = 'arraybuffer';
    ch.onopen = () => {
      this.transition('connected');
      this.events.onOpen?.();
    };
    ch.onclose = () => {
      if (this.state_ !== 'closed') {
        this.transition('closed');
        this.events.onClose?.();
      }
    };
    ch.onerror = () => this.transition('failed');
    ch.onmessage = (e) => {
      if (typeof e.data === 'string') this.events.onText?.(e.data);
      else if (e.data instanceof ArrayBuffer) this.events.onBinary?.(e.data);
      else if (e.data && typeof (e.data as Blob).arrayBuffer === 'function') {
        // Some browsers default to Blob even when binaryType is arraybuffer.
        (e.data as Blob).arrayBuffer().then((buf) => this.events.onBinary?.(buf));
      }
    };
  }

  private syncConnectionState(): void {
    const s = this.pc.connectionState;
    if (s === 'failed') {
      // A failed connection is a gone connection. Without notifying, the
      // manager keeps the peer in its map — and since gossip never started,
      // neither did the keepalive that would eventually reap it, so the UI
      // shows "Syncing…" forever against a peer that will never arrive.
      if (this.state_ !== 'failed' && this.state_ !== 'closed') {
        this.transition('failed');
        this.events.onClose?.();
      }
    } else if (s === 'disconnected' || s === 'closed') {
      if (this.state_ !== 'closed') {
        this.transition('closed');
        this.events.onClose?.();
      }
    }
  }

  private waitForGathering(): Promise<void> {
    if (this.gatheringDone) return this.gatheringDone;
    if (this.pc.iceGatheringState === 'complete') {
      this.gatheringDone = Promise.resolve();
      return this.gatheringDone;
    }
    this.gatheringDone = new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.pc.removeEventListener('icegatheringstatechange', onState);
        this.pc.removeEventListener('icecandidate', onCand);
        clearTimeout(timer);
        resolve();
      };
      const onState = () => {
        if (this.pc.iceGatheringState === 'complete') finish();
      };
      const onCand = (e: RTCPeerConnectionIceEvent) => {
        if (e.candidate === null) finish();
      };
      this.pc.addEventListener('icegatheringstatechange', onState);
      this.pc.addEventListener('icecandidate', onCand);
      // Belt-and-suspenders: some platforms hang on "gathering" for STUN that
      // never resolves (e.g. zero internet on a plane). Resolve anyway after
      // a generous window so the host candidates we already have can ship.
      const timer = setTimeout(finish, this.iceTimeoutMs);
    });
    return this.gatheringDone;
  }

  private transition(next: PeerState): void {
    if (this.state_ === next) return;
    this.state_ = next;
    this.events.onState?.(next);
  }
}
