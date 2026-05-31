import { describe, expect, it } from 'vitest';
import {
  PhotoReassembler,
  decodeBinaryFrame,
  decodeControl,
  encodeBinaryFrame,
  encodeControl,
  type Hello,
} from './protocol';

describe('protocol — control framing', () => {
  it('round-trips a hello message', () => {
    const msg: Hello = {
      type: 'hello',
      v: 1,
      publicKey: 'cHViLWtleQ==',
      memberId: 'mem-abc',
      fingerprint: 'ABCDEFGHJK',
      nonce: 'bm9uY2U=',
      signature: 'c2ln',
    };
    const back = decodeControl(encodeControl(msg));
    expect(back).toEqual(msg);
  });

  it('round-trips a have / want / data triplet', () => {
    expect(decodeControl(encodeControl({ type: 'have', collection: 'messages', ids: ['a', 'b'] })))
      .toEqual({ type: 'have', collection: 'messages', ids: ['a', 'b'] });
    expect(decodeControl(encodeControl({ type: 'want', collection: 'photos', ids: ['x'] })))
      .toEqual({ type: 'want', collection: 'photos', ids: ['x'] });
    expect(decodeControl(encodeControl({
      type: 'data',
      collection: 'pointEvents',
      records: [{ id: '1', to: 'm', by: 'm', at: '2026-05-31T00:00:00Z', amount: 5, reason: 'photo' }],
    }))).toMatchObject({ type: 'data', collection: 'pointEvents' });
  });

  it('rejects malformed control frames', () => {
    expect(decodeControl('not json')).toBeNull();
    expect(decodeControl('{}')).toBeNull();
    expect(decodeControl(JSON.stringify({ type: 'hello' }))).toBeNull();
    expect(decodeControl(JSON.stringify({ type: 'made-up' }))).toBeNull();
    expect(decodeControl(JSON.stringify({ type: 'have', collection: 'messages' }))).toBeNull();
  });
});

describe('protocol — binary framing', () => {
  it('round-trips a binary frame', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const enc = encodeBinaryFrame(
      { kind: 'photo', photoId: 'p-1', idx: 2, total: 4, mime: 'image/jpeg' },
      payload,
    );
    const dec = decodeBinaryFrame(enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength) as ArrayBuffer);
    expect(dec).not.toBeNull();
    expect(dec!.header.photoId).toBe('p-1');
    expect(dec!.header.idx).toBe(2);
    expect(dec!.header.total).toBe(4);
    expect(dec!.header.mime).toBe('image/jpeg');
    expect(Array.from(dec!.payload)).toEqual(Array.from(payload));
  });

  it('rejects a header-length larger than the frame', () => {
    const fake = new Uint8Array(8);
    new DataView(fake.buffer).setUint32(0, 9999, true);
    expect(decodeBinaryFrame(fake.buffer)).toBeNull();
  });

  it('reassembles photo chunks into a single byte array', () => {
    const photoId = 'p-7';
    const mime = 'image/jpeg';
    const parts = [
      new Uint8Array([10, 20, 30]),
      new Uint8Array([40, 50]),
      new Uint8Array([60, 70, 80, 90]),
    ];
    const r = new PhotoReassembler();
    let done: { photoId: string; mime: string; bytes: Uint8Array } | null = null;
    for (let i = 0; i < parts.length; i++) {
      const frame = encodeBinaryFrame(
        { kind: 'photo', photoId, idx: i, total: parts.length, mime },
        parts[i],
      );
      const decoded = decodeBinaryFrame(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) as ArrayBuffer)!;
      const out = r.ingest(decoded);
      if (out) done = out;
    }
    expect(done).not.toBeNull();
    expect(done!.photoId).toBe(photoId);
    expect(done!.mime).toBe(mime);
    expect(Array.from(done!.bytes)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
  });

  it('reassembles out-of-order chunks correctly', () => {
    const photoId = 'p-shuffle';
    const mime = 'image/jpeg';
    const parts = [
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4]),
      new Uint8Array([5, 6]),
    ];
    const order = [2, 0, 1];
    const r = new PhotoReassembler();
    let done: { photoId: string; mime: string; bytes: Uint8Array } | null = null;
    for (const i of order) {
      const frame = encodeBinaryFrame(
        { kind: 'photo', photoId, idx: i, total: parts.length, mime },
        parts[i],
      );
      const decoded = decodeBinaryFrame(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) as ArrayBuffer)!;
      const out = r.ingest(decoded);
      if (out) done = out;
    }
    expect(done).not.toBeNull();
    expect(Array.from(done!.bytes)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('keeps partial photos pending across chunks', () => {
    const r = new PhotoReassembler();
    const frame = encodeBinaryFrame(
      { kind: 'photo', photoId: 'p-9', idx: 0, total: 3, mime: 'image/jpeg' },
      new Uint8Array([1]),
    );
    const decoded = decodeBinaryFrame(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) as ArrayBuffer)!;
    expect(r.ingest(decoded)).toBeNull();
    expect(r.pendingPhotoIds()).toEqual(['p-9']);
  });
});
