import { describe, expect, it } from 'vitest';
import { beaconFrame, decideRole, parseBeacon } from './faceToFace';

describe('beacon encoding', () => {
  it('round-trips a fingerprint and nonce', () => {
    const text = beaconFrame('ABCDEFGHJK', 'a1b2c3');
    expect(parseBeacon(text)).toEqual({ fingerprint: 'ABCDEFGHJK', nonce: 'a1b2c3' });
  });

  it('ignores a handshake frame', () => {
    expect(parseBeacon('TL1|abc|0|1|ff|payload')).toBeNull();
  });

  it('ignores unrelated QR content', () => {
    expect(parseBeacon('https://example.com')).toBeNull();
  });

  it('rejects a truncated beacon', () => {
    expect(parseBeacon('TLB|ABCDEFGHJK')).toBeNull();
    expect(parseBeacon('TLB|')).toBeNull();
  });
});

describe('decideRole', () => {
  const a = { fingerprint: 'AAAAAAAAAA', nonce: '111111' };
  const b = { fingerprint: 'BBBBBBBBBB', nonce: '222222' };

  it('gives the smaller fingerprint the initiator role', () => {
    expect(decideRole(a, b)).toBe('initiator');
  });

  it('is symmetric — the two phones never pick the same role', () => {
    expect(decideRole(a, b)).toBe('initiator');
    expect(decideRole(b, a)).toBe('responder');
  });

  it('agrees for every ordering of a realistic fingerprint set', () => {
    const fps = ['0R3TZ9QF2M', 'K8W1PJ4CDN', 'ZZ9QW2E4RT', '7A6B5C4D3E'];
    for (const mine of fps) {
      for (const theirs of fps) {
        if (mine === theirs) continue;
        const me = { fingerprint: mine, nonce: 'aaa' };
        const them = { fingerprint: theirs, nonce: 'bbb' };
        // Exactly one side must consider itself the initiator.
        const roles = [decideRole(me, them), decideRole(them, me)];
        expect(roles.filter((r) => r === 'initiator')).toHaveLength(1);
      }
    }
  });

  it('falls back to the nonce if two devices somehow share a fingerprint', () => {
    const same = 'AAAAAAAAAA';
    const lo = { fingerprint: same, nonce: '000000' };
    const hi = { fingerprint: same, nonce: 'ffffff' };
    expect(decideRole(lo, hi)).toBe('initiator');
    expect(decideRole(hi, lo)).toBe('responder');
  });
});
