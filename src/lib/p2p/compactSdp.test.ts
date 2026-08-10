import { describe, expect, it } from 'vitest';
import { compressSdp, expandSdp, isCompactSdp } from './compactSdp';

/**
 * Shape a Chromium-family browser emits for a datachannel-only offer, with
 * mDNS-obfuscated host candidates (what you get without camera permission).
 */
const CHROME_OFFER = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:1510613869 1 udp 2113937151 8a4b1f2c-1234-4d5e-9f01-abcdef123456.local 51820 typ host generation 0 network-cost 999',
  'a=ice-ufrag:4ZcD',
  'a=ice-pwd:by/xShcGVJx9CDGSbEZ0yWDF',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 6B:8B:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
].join('\r\n') + '\r\n';

/** Safari's answer shape, with real-IP host candidates (camera permission granted). */
const SAFARI_ANSWER = [
  'v=0',
  'o=- 1234567890123456789 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:1 1 udp 2113937151 192.168.1.42 54321 typ host',
  'a=candidate:2 1 udp 2113937150 10.0.0.7 54322 typ host',
  'a=ice-ufrag:9xKp',
  'a=ice-pwd:AbCdEfGhIjKlMnOpQrStUv',
  'a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
  'a=setup:active',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
].join('\r\n') + '\r\n';

describe('compressSdp', () => {
  it('extracts the fields that actually vary', () => {
    const c = compressSdp(CHROME_OFFER);
    expect(c.u).toBe('4ZcD');
    expect(c.p).toBe('by/xShcGVJx9CDGSbEZ0yWDF');
    expect(c.s).toBe('actpass');
    expect(c.f).toMatch(/^6B:8B:45/);
    expect(c.x).toBe(262144);
  });

  it('keeps mDNS host candidates intact', () => {
    const c = compressSdp(CHROME_OFFER);
    expect(c.c).toEqual([
      '8a4b1f2c-1234-4d5e-9f01-abcdef123456.local 51820 host',
    ]);
  });

  it('keeps every real-IP host candidate', () => {
    const c = compressSdp(SAFARI_ANSWER);
    expect(c.c).toEqual(['192.168.1.42 54321 host', '10.0.0.7 54322 host']);
  });

  it('omits sctp-port when it is the usual one', () => {
    expect(compressSdp(CHROME_OFFER).sp).toBeUndefined();
  });

  it('drops relay and tcp candidates we cannot use without infrastructure', () => {
    const withRelay = SAFARI_ANSWER.replace(
      'a=ice-ufrag:9xKp',
      [
        'a=candidate:3 1 tcp 1518280447 192.168.1.42 9 typ host tcptype active',
        'a=candidate:4 1 udp 41885439 203.0.113.7 61000 typ relay raddr 0.0.0.0 rport 0',
        'a=ice-ufrag:9xKp',
      ].join('\r\n'),
    );
    expect(compressSdp(withRelay).c).toEqual([
      '192.168.1.42 54321 host',
      '10.0.0.7 54322 host',
    ]);
  });

  it('keeps srflx candidates when a STUN server was configured', () => {
    const withSrflx = SAFARI_ANSWER.replace(
      'a=ice-ufrag:9xKp',
      'a=candidate:5 1 udp 1677729535 203.0.113.9 60000 typ srflx raddr 192.168.1.42 rport 54321\r\na=ice-ufrag:9xKp',
    );
    expect(compressSdp(withSrflx).c).toContain('203.0.113.9 60000 srflx');
  });

  it('rejects an SDP carrying media, which this codec cannot rebuild', () => {
    const withAudio = CHROME_OFFER.replace(
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    );
    expect(() => compressSdp(withAudio)).toThrow(/datachannel-only/);
  });

  it('rejects an SDP with no fingerprint', () => {
    const noFp = CHROME_OFFER.split('\r\n')
      .filter((l) => !l.startsWith('a=fingerprint'))
      .join('\r\n');
    expect(() => compressSdp(noFp)).toThrow(/fingerprint/);
  });
});

describe('expandSdp', () => {
  it('produces an SDP that compresses back to the same fields', () => {
    const original = compressSdp(SAFARI_ANSWER);
    const rebuilt = compressSdp(expandSdp(original, 'answer'));
    expect(rebuilt).toEqual(original);
  });

  it('is a fixed point under repeated round trips', () => {
    const once = compressSdp(CHROME_OFFER);
    const twice = compressSdp(expandSdp(once, 'offer'));
    const thrice = compressSdp(expandSdp(twice, 'offer'));
    expect(thrice).toEqual(once);
  });

  it('emits the lines a peer needs to accept the description', () => {
    const sdp = expandSdp(compressSdp(SAFARI_ANSWER), 'answer');
    expect(sdp).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel');
    expect(sdp).toContain('a=ice-ufrag:9xKp');
    expect(sdp).toContain('a=setup:active');
    expect(sdp).toContain('a=mid:0');
    expect(sdp).toContain('a=sctp-port:5000');
    expect(sdp).toContain('a=candidate:1 1 udp');
    expect(sdp.endsWith('\r\n')).toBe(true);
  });

  it('round-trips a non-default sctp-port', () => {
    const odd = SAFARI_ANSWER.replace('a=sctp-port:5000', 'a=sctp-port:5001');
    const c = compressSdp(odd);
    expect(c.sp).toBe(5001);
    expect(expandSdp(c, 'answer')).toContain('a=sctp-port:5001');
  });

  it('handles a candidate-free description without emitting junk', () => {
    const c = compressSdp(SAFARI_ANSWER);
    const sdp = expandSdp({ ...c, c: [] }, 'answer');
    expect(sdp).not.toContain('a=candidate');
    expect(compressSdp(sdp).c).toEqual([]);
  });

  it('keeps synthesised candidate priorities positive even for long lists', () => {
    const many = Array.from({ length: 40 }, (_, i) => `192.168.1.${i} 5000 host`);
    const sdp = expandSdp({ ...compressSdp(SAFARI_ANSWER), c: many }, 'answer');
    for (const line of sdp.split('\r\n').filter((l) => l.startsWith('a=candidate'))) {
      const priority = Number(line.split(' ')[3]);
      expect(priority).toBeGreaterThan(0);
    }
  });
});

describe('compact payload size', () => {
  it('fits comfortably inside one 600-byte QR frame', () => {
    const json = JSON.stringify(compressSdp(SAFARI_ANSWER));
    expect(json.length).toBeLessThan(600);
  });

  it('is a large reduction over the raw SDP', () => {
    const json = JSON.stringify(compressSdp(CHROME_OFFER));
    expect(json.length).toBeLessThan(CHROME_OFFER.length / 2);
  });
});

describe('isCompactSdp', () => {
  it('accepts a well-formed compact sdp', () => {
    expect(isCompactSdp(compressSdp(CHROME_OFFER))).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['a missing ufrag', { p: 'x', f: 'y', s: 'actpass', c: [] }],
    ['a bad setup value', { u: 'a', p: 'b', f: 'c', s: 'sideways', c: [] }],
    ['non-string candidates', { u: 'a', p: 'b', f: 'c', s: 'actpass', c: [42] }],
  ])('rejects %s', (_label, value) => {
    expect(isCompactSdp(value)).toBe(false);
  });
});
