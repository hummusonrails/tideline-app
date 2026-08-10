/**
 * Lossy-but-sufficient compression of a datachannel-only SDP.
 *
 * A raw offer runs 1.5–2.5 KB, which spreads pairing across four or five QR
 * frames per side. Frames cycle on a timer, so a scanner has to catch every
 * one — miss a frame and you wait a whole rotation. At sea, where pairing is
 * the only way messages move between phones, that's the difference between a
 * gesture and a chore.
 *
 * Almost all of that bulk is boilerplate identical on both ends: codec lines
 * we don't use, a fixed media section, and attributes with one legal value for
 * our configuration. Only six things actually vary. We ship those and rebuild
 * the rest from a template, which fits one frame.
 *
 * This is not a general SDP codec. It handles exactly the shape
 * {@link Peer} produces — one `application` m-line carrying
 * `webrtc-datachannel` over `UDP/DTLS/SCTP`, bundled, no media tracks.
 * {@link compressSdp} throws on anything else, and callers fall back to
 * sending the SDP verbatim.
 */

export interface CompactSdp {
  /** a=ice-ufrag */
  u: string;
  /** a=ice-pwd */
  p: string;
  /** a=fingerprint sha-256 value, colon-separated hex as it appears in SDP. */
  f: string;
  /** a=setup */
  s: 'actpass' | 'active' | 'passive';
  /** Candidates as "address port typ", e.g. "192.168.1.4 51820 host". */
  c: string[];
  /** a=max-message-size, when present. */
  x?: number;
  /** a=sctp-port, when it isn't the usual 5000. */
  sp?: number;
}

const DEFAULT_SCTP_PORT = 5000;

function firstMatch(sdp: string, re: RegExp): string | null {
  const m = sdp.match(re);
  return m ? m[1] : null;
}

/**
 * Reduce an SDP to its varying parts.
 *
 * @throws if the SDP isn't the datachannel-only shape this codec understands,
 * or is missing a field the far side would need. Callers should treat a throw
 * as "send the full SDP instead", never as a fatal error.
 */
export function compressSdp(sdp: string): CompactSdp {
  const u = firstMatch(sdp, /^a=ice-ufrag:(.+)$/m);
  const p = firstMatch(sdp, /^a=ice-pwd:(.+)$/m);
  const f = firstMatch(sdp, /^a=fingerprint:sha-256 (.+)$/m);
  const s = firstMatch(sdp, /^a=setup:(actpass|active|passive)$/m);

  if (!u || !p || !f || !s) {
    throw new Error('sdp is missing ice-ufrag / ice-pwd / sha-256 fingerprint / setup');
  }
  if (!/^m=application \d+ UDP\/DTLS\/SCTP webrtc-datachannel$/m.test(sdp)) {
    throw new Error('sdp is not a datachannel-only offer/answer');
  }

  // Host candidates are the ones that matter on a LAN; keep srflx too when a
  // STUN server happened to be configured. Everything else (relay, tcp) can't
  // help us without infrastructure we don't have at sea.
  const c: string[] = [];
  const candidateRe =
    /^a=candidate:\S+ \d+ (udp) \d+ (\S+) (\d+) typ (host|srflx)/gim;
  for (const m of sdp.matchAll(candidateRe)) {
    c.push(`${m[2]} ${m[3]} ${m[4]}`);
  }

  const out: CompactSdp = { u, p, f, s: s as CompactSdp['s'], c };

  const maxMsg = firstMatch(sdp, /^a=max-message-size:(\d+)$/m);
  if (maxMsg) out.x = Number(maxMsg);

  const sctpPort = firstMatch(sdp, /^a=sctp-port:(\d+)$/m);
  if (sctpPort && Number(sctpPort) !== DEFAULT_SCTP_PORT) out.sp = Number(sctpPort);

  return out;
}

/** Basic shape check for something that arrived over the wire. */
export function isCompactSdp(v: unknown): v is CompactSdp {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.u === 'string' &&
    typeof o.p === 'string' &&
    typeof o.f === 'string' &&
    (o.s === 'actpass' || o.s === 'active' || o.s === 'passive') &&
    Array.isArray(o.c) &&
    (o.c as unknown[]).every((x) => typeof x === 'string')
  );
}

/**
 * Rebuild a complete SDP from its compact form.
 *
 * The template is the canonical minimal datachannel description. Values that
 * only ever have one legal setting for us (session id/version, the dummy
 * connection address, BUNDLE group, mid) are hard-coded; anything a peer could
 * legitimately vary travels in {@link CompactSdp}.
 *
 * Candidate priorities are synthesised in descending order. Priority only
 * influences the order ICE tries pairs, not which succeed, so regenerating
 * rather than transmitting them costs nothing.
 */
export function expandSdp(c: CompactSdp, kind: 'offer' | 'answer'): string {
  const lines = [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
  ];

  c.c.forEach((cand, i) => {
    const [address, port, typ] = cand.split(' ');
    if (!address || !port || !typ) return;
    // Descending, and floored so a long candidate list can't go negative.
    const priority = Math.max(1, 2113937151 - i);
    // RFC 5245 requires raddr/rport on any non-host candidate. Omitting them
    // yields a line a strict parser can reject — and a rejected description
    // fails the whole pairing, so emit placeholders rather than risk it.
    const related = typ === 'host' ? '' : ' raddr 0.0.0.0 rport 0';
    lines.push(`a=candidate:${i + 1} 1 udp ${priority} ${address} ${port} typ ${typ}${related}`);
  });

  lines.push(
    'a=ice-options:trickle',
    `a=ice-ufrag:${c.u}`,
    `a=ice-pwd:${c.p}`,
    `a=fingerprint:sha-256 ${c.f}`,
    `a=setup:${c.s}`,
    'a=mid:0',
    'a=sctp-port:' + (c.sp ?? DEFAULT_SCTP_PORT),
  );
  if (typeof c.x === 'number') lines.push(`a=max-message-size:${c.x}`);

  // `kind` doesn't change the body for datachannel-only descriptions — the
  // direction is carried by a=setup. It stays in the signature because
  // setRemoteDescription needs the type alongside this string, and callers
  // that have one invariably have the other.
  void kind;

  return lines.join('\r\n') + '\r\n';
}
