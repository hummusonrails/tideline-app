/**
 * A self-contained "why won't these phones talk to each other" probe.
 *
 * Pairing can fail for several unrelated reasons that all present identically —
 * the QR exchange succeeds and then the connection hangs — and the difference
 * between them is invisible from the outside. This gathers ICE candidates
 * exactly the way a real pairing attempt does and reports what came back, so a
 * failure produces a fact instead of a shrug.
 *
 * What the answers mean:
 *
 * - **Only an mDNS host candidate.** The browser is hiding this device's local
 *   IP behind a `<uuid>.local` name. The other phone can only use that if it
 *   can resolve it over multicast DNS, which hotel and ship networks routinely
 *   filter. This is the most common cause.
 * - **A real-IP host candidate.** Good — direct LAN pairing is possible, as
 *   long as the network doesn't isolate clients from each other.
 * - **No reflexive candidate despite internet.** STUN couldn't be reached, so
 *   there's no fallback path if the LAN one is blocked.
 *
 * Uses its own RTCPeerConnection and tears it down; it never touches a live
 * pairing session.
 */

import { defaultIceServers } from './peer';

export interface PairingDiagnosis {
  /** True if this browser exposed a real local IP rather than an mDNS name. */
  realLocalIp: boolean;
  /** True if a STUN server answered with our public address. */
  reflexive: boolean;
  /** Candidate types seen, e.g. ['host', 'srflx']. */
  types: string[];
  /** How long gathering took, for spotting a network that swallows STUN. */
  ms: number;
  /** One-line plain-English summary for the UI. */
  summary: string;
}

const PROBE_TIMEOUT_MS = 6000;

export async function diagnosePairing(hasInternet: boolean): Promise<PairingDiagnosis> {
  const started = Date.now();
  const pc = new RTCPeerConnection({ iceServers: defaultIceServers(hasInternet) });
  try {
    pc.createDataChannel('probe');
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise<void>((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const timer = setTimeout(resolve, PROBE_TIMEOUT_MS);
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const lines = pc.localDescription?.sdp.match(/^a=candidate:.*$/gm) ?? [];
    const parsed = lines
      .map((l) => /udp \d+ (\S+) \d+ typ (\w+)/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ address: m[1], type: m[2] }));

    const types = [...new Set(parsed.map((p) => p.type))];
    const realLocalIp = parsed.some(
      (p) => p.type === 'host' && !p.address.endsWith('.local'),
    );
    const reflexive = parsed.some((p) => p.type === 'srflx');

    return {
      realLocalIp,
      reflexive,
      types,
      ms: Date.now() - started,
      summary: summarise({ realLocalIp, reflexive, any: parsed.length > 0, hasInternet }),
    };
  } finally {
    pc.close();
  }
}

function summarise(o: {
  realLocalIp: boolean;
  reflexive: boolean;
  any: boolean;
  hasInternet: boolean;
}): string {
  if (!o.any) {
    return 'This phone produced no connection candidates at all — something is blocking WebRTC entirely.';
  }
  if (o.realLocalIp && o.reflexive) {
    return 'This phone looks fine: it has both a local address and an internet-visible one. If pairing still fails, the network is blocking phone-to-phone traffic.';
  }
  if (o.realLocalIp) {
    return 'This phone has a usable local address. If pairing fails, this network is separating devices from each other — try a Personal Hotspot.';
  }
  if (o.reflexive) {
    return 'This phone is hiding its local address, but has an internet-visible one to fall back on. Pairing should work; if it does not, the network is blocking direct connections.';
  }
  return o.hasInternet
    ? 'This phone is hiding its local address and could not reach a STUN server, so it has nothing usable to offer. Allow camera access when asked, or switch to a Personal Hotspot.'
    : 'This phone is hiding its local address behind a name the other phone can only look up over the local network. If that lookup is blocked, pairing cannot work — try a Personal Hotspot.';
}
