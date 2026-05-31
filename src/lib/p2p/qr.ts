/**
 * Multi-frame QR codec.
 *
 * QR codes are read most reliably when each frame stays under ~700 bytes
 * of payload — anything bigger forces version 40 + tiny modules, and a
 * phone camera will struggle to lock on. So large blobs get chunked
 * into a series of frames that the receiver reassembles by session id.
 *
 * Wire format per frame (one QR's text content):
 *
 *   TL1|<sid>|<idx>|<total>|<crc>|<b64chunk>
 *
 * - TL1   — magic + version, used to reject foreign QR codes
 * - sid   — 8-char Crockford base32 session id (random per encode)
 * - idx   — frame index, 0-based
 * - total — total frame count for this session
 * - crc   — CRC32 of the original (pre-chunk) byte sequence; the receiver
 *           verifies after reassembly so partial scans can't slip through
 * - b64   — base64 of this chunk's bytes
 *
 * Encoder accepts a Uint8Array (the caller is responsible for choosing
 * an efficient encoding — JSON, msgpack, etc.). Receiver hands back
 * the original bytes.
 */

import { b64ToBytes, bytesToB64, bytesToBase32 } from './base';

const MAGIC = 'TL1';
const SID_LEN = 8;
const CHUNK_SIZE = 600; // bytes per frame chunk (before base64 expansion)

export interface QrFrame {
  sid: string;
  idx: number;
  total: number;
  crc: number;
  chunk: Uint8Array;
}

/** Encode bytes into N QR-ready text frames. */
export function encodeFrames(payload: Uint8Array, chunkSize = CHUNK_SIZE): string[] {
  const sid = randomSid();
  const crc = crc32(payload);
  const total = Math.max(1, Math.ceil(payload.byteLength / chunkSize));
  const out: string[] = [];
  for (let i = 0; i < total; i++) {
    const slice = payload.subarray(i * chunkSize, Math.min(payload.byteLength, (i + 1) * chunkSize));
    out.push(`${MAGIC}|${sid}|${i}|${total}|${crc.toString(16)}|${bytesToB64(slice)}`);
  }
  return out;
}

export function parseFrame(text: string): QrFrame | null {
  if (!text.startsWith(`${MAGIC}|`)) return null;
  const parts = text.split('|');
  if (parts.length !== 6) return null;
  const [, sid, idxStr, totalStr, crcStr, b64] = parts;
  const idx = Number(idxStr);
  const total = Number(totalStr);
  const crc = parseInt(crcStr, 16);
  if (!Number.isInteger(idx) || !Number.isInteger(total) || !Number.isFinite(crc)) return null;
  if (idx < 0 || total <= 0 || idx >= total) return null;
  let chunk: Uint8Array;
  try { chunk = b64ToBytes(b64); } catch { return null; }
  return { sid, idx, total, crc, chunk };
}

/**
 * Stateful collector — drop frames in as they're scanned, and call
 * `complete()` after every drop to see if the full payload is ready.
 * Mixed-session frames are ignored (we lock onto the first sid we see;
 * caller can `reset()` to start over).
 */
export class FrameReassembler {
  private sid: string | null = null;
  private total = 0;
  private expectedCrc = 0;
  private frames = new Map<number, Uint8Array>();

  reset(): void {
    this.sid = null;
    this.total = 0;
    this.expectedCrc = 0;
    this.frames.clear();
  }

  /** Try to ingest a raw QR text. Returns true if the frame was accepted. */
  ingest(text: string): boolean {
    const f = parseFrame(text);
    if (!f) return false;
    if (this.sid === null) {
      this.sid = f.sid;
      this.total = f.total;
      this.expectedCrc = f.crc;
    } else if (f.sid !== this.sid) {
      return false;
    }
    this.frames.set(f.idx, f.chunk);
    return true;
  }

  get receivedCount(): number { return this.frames.size; }
  get expectedCount(): number { return this.total; }
  get sessionId(): string | null { return this.sid; }

  /** Returns reassembled bytes once every frame is in and the CRC matches. */
  complete(): Uint8Array | null {
    if (this.sid === null || this.frames.size < this.total) return null;
    let len = 0;
    for (let i = 0; i < this.total; i++) {
      const c = this.frames.get(i);
      if (!c) return null;
      len += c.byteLength;
    }
    const out = new Uint8Array(len);
    let off = 0;
    for (let i = 0; i < this.total; i++) {
      const c = this.frames.get(i)!;
      out.set(c, off);
      off += c.byteLength;
    }
    if (crc32(out) !== this.expectedCrc) return null;
    return out;
  }
}

function randomSid(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return bytesToBase32(b).slice(0, SID_LEN);
}

// --- CRC32 (IEEE 802.3) -------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}
