import { describe, expect, it } from 'vitest';
import { FrameReassembler, crc32, encodeFrames, parseFrame } from './qr';

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 0xff;
  return b;
}

describe('qr codec', () => {
  it('round-trips a small payload in a single frame', () => {
    const payload = new TextEncoder().encode('hello');
    const frames = encodeFrames(payload);
    expect(frames).toHaveLength(1);
    const r = new FrameReassembler();
    expect(r.ingest(frames[0])).toBe(true);
    expect(Array.from(r.complete()!)).toEqual(Array.from(payload));
  });

  it('round-trips a large payload across many frames', () => {
    const payload = randomBytes(5000);
    const frames = encodeFrames(payload);
    expect(frames.length).toBeGreaterThan(5);
    const r = new FrameReassembler();
    for (const f of frames) expect(r.ingest(f)).toBe(true);
    expect(Array.from(r.complete()!)).toEqual(Array.from(payload));
  });

  it('rejects mid-stream frames from a different session', () => {
    const a = encodeFrames(randomBytes(1500));
    const b = encodeFrames(randomBytes(1500));
    const r = new FrameReassembler();
    r.ingest(a[0]);
    expect(r.ingest(b[0])).toBe(false);
    for (const f of a.slice(1)) r.ingest(f);
    expect(r.complete()).toBeTruthy();
  });

  it('returns null until every frame is present', () => {
    const payload = randomBytes(2000);
    const frames = encodeFrames(payload);
    const r = new FrameReassembler();
    for (let i = 0; i < frames.length - 1; i++) r.ingest(frames[i]);
    expect(r.complete()).toBeNull();
    r.ingest(frames[frames.length - 1]);
    expect(Array.from(r.complete()!)).toEqual(Array.from(payload));
  });

  it('handles frames arriving out of order', () => {
    const payload = randomBytes(1800);
    const frames = encodeFrames(payload);
    const shuffled = [...frames].reverse();
    const r = new FrameReassembler();
    for (const f of shuffled) r.ingest(f);
    expect(Array.from(r.complete()!)).toEqual(Array.from(payload));
  });

  it('detects corruption via CRC', () => {
    const payload = randomBytes(1200);
    const frames = encodeFrames(payload);
    // Decode + mangle frame 1 by re-encoding a flipped byte chunk under
    // the SAME session id/idx/total/crc header so it slips past parseFrame
    // but fails the final CRC check.
    const parsed = parseFrame(frames[1]);
    expect(parsed).not.toBeNull();
    const corrupted = new Uint8Array(parsed!.chunk);
    corrupted[0] ^= 0xff;
    const replaced = frames[1].replace(/\|[^|]+$/, `|${btoa(String.fromCharCode(...corrupted))}`);
    const r = new FrameReassembler();
    r.ingest(frames[0]);
    r.ingest(replaced);
    for (const f of frames.slice(2)) r.ingest(f);
    expect(r.complete()).toBeNull();
  });

  it('rejects junk text', () => {
    expect(parseFrame('not a tideline frame')).toBeNull();
    expect(parseFrame('TL1|abc|0|1|xx')).toBeNull();
  });

  it('crc32 matches a known fixture', () => {
    // 'abcdefg' has well-known IEEE 802.3 CRC32 0x312A6AA6
    expect(crc32(new TextEncoder().encode('abcdefg')).toString(16)).toEqual('312a6aa6');
  });

  it('reset() lets the reassembler accept a brand new session', () => {
    const a = encodeFrames(randomBytes(400));
    const b = encodeFrames(randomBytes(400));
    const r = new FrameReassembler();
    r.ingest(a[0]);
    r.reset();
    for (const f of b) r.ingest(f);
    expect(r.complete()).not.toBeNull();
  });
});
