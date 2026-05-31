/**
 * Wire protocol that rides on a Peer's data channel.
 *
 * Two frame kinds reach the network:
 *
 *  - TEXT frames are JSON objects of one of the {@link ControlMessage}
 *    union variants. Used for handshake + gossip + structured data.
 *  - BINARY frames carry photo bytes. Each starts with a 4-byte little-endian
 *    header length, then a JSON {@link BinaryHeader}, then the chunk bytes.
 *    Splitting like this means we can stream a photo without baking it into
 *    base64 first (saves ~33% on the wire).
 *
 * The state machine:
 *
 *   1. Each side sends HELLO with its identity + a signature over the
 *      session nonce, proving possession of the private key.
 *   2. The other side verifies, looks up trust, and responds with HELLO_ACK.
 *      A non-accepted ACK closes the connection.
 *   3. Both sides exchange HAVE for each tracked collection.
 *   4. Each side compares HAVE vs local and sends WANT for missing ids.
 *   5. Each side responds with DATA carrying the requested records.
 *      Photos additionally trigger a PHOTO_BIN binary stream.
 *
 * After convergence, the connection stays open and the manager pushes
 * new local writes as DATA frames (single-record batches) on insert.
 */

import type {
  ChallengeCompletion,
  HabitCheckIn,
  Message,
  Photo,
  PointEvent,
} from '../../types';

export const PROTOCOL_VERSION = 1;

export type Collection =
  | 'messages'
  | 'photos'
  | 'pointEvents'
  | 'completions'
  | 'habits';

export const COLLECTIONS: readonly Collection[] = [
  'messages', 'photos', 'pointEvents', 'completions', 'habits',
] as const;

export type CollectionRecord =
  | Message
  | Photo
  | PointEvent
  | ChallengeCompletion
  | HabitCheckIn;

export interface Hello {
  type: 'hello';
  v: number;
  publicKey: string;       // base64 raw P-256
  memberId: string;
  fingerprint: string;
  nonce: string;           // base64
  signature: string;       // base64 — sign(privateKey, nonceBytes)
}

export interface HelloAck {
  type: 'hello-ack';
  v: number;
  accepted: boolean;
  reason?: string;
}

export interface Have {
  type: 'have';
  collection: Collection;
  ids: string[];
}

export interface Want {
  type: 'want';
  collection: Collection;
  ids: string[];
}

export interface Data {
  type: 'data';
  collection: Collection;
  records: CollectionRecord[];
}

export interface Ping {
  type: 'ping';
  at: number;
}

export interface Pong {
  type: 'pong';
  at: number;
}

export type ControlMessage = Hello | HelloAck | Have | Want | Data | Ping | Pong;

export interface BinaryHeader {
  /** Always 'photo' for now — leaves room for other binary kinds later. */
  kind: 'photo';
  photoId: string;
  idx: number;
  total: number;
  /** mime type — receiver re-wraps the bytes into a Blob with this. */
  mime: string;
}

// --- text framing ------------------------------------------------------

export function encodeControl(msg: ControlMessage): string {
  return JSON.stringify(msg);
}

export function decodeControl(text: string): ControlMessage | null {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!isObj(parsed) || typeof parsed.type !== 'string') return null;
  switch (parsed.type) {
    case 'hello':
      if (typeof parsed.publicKey === 'string' &&
          typeof parsed.memberId === 'string' &&
          typeof parsed.fingerprint === 'string' &&
          typeof parsed.nonce === 'string' &&
          typeof parsed.signature === 'string' &&
          typeof parsed.v === 'number') {
        return parsed as unknown as Hello;
      }
      return null;
    case 'hello-ack':
      if (typeof parsed.accepted === 'boolean' && typeof parsed.v === 'number') {
        return parsed as unknown as HelloAck;
      }
      return null;
    case 'have':
    case 'want':
      if (typeof parsed.collection === 'string' && Array.isArray(parsed.ids)) {
        return parsed as unknown as Have | Want;
      }
      return null;
    case 'data':
      if (typeof parsed.collection === 'string' && Array.isArray(parsed.records)) {
        return parsed as unknown as Data;
      }
      return null;
    case 'ping':
    case 'pong':
      if (typeof parsed.at === 'number') return parsed as unknown as Ping | Pong;
      return null;
    default:
      return null;
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

// --- binary framing ----------------------------------------------------

const enc = new TextEncoder();
const dec = new TextDecoder();

export function encodeBinaryFrame(header: BinaryHeader, payload: Uint8Array): Uint8Array {
  const headerBytes = enc.encode(JSON.stringify(header));
  const out = new Uint8Array(4 + headerBytes.byteLength + payload.byteLength);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, headerBytes.byteLength, true);
  out.set(headerBytes, 4);
  out.set(payload, 4 + headerBytes.byteLength);
  return out;
}

export interface DecodedBinaryFrame {
  header: BinaryHeader;
  payload: Uint8Array;
}

export function decodeBinaryFrame(buf: ArrayBuffer): DecodedBinaryFrame | null {
  if (buf.byteLength < 5) return null;
  const dv = new DataView(buf);
  const headerLen = dv.getUint32(0, true);
  if (headerLen <= 0 || headerLen > buf.byteLength - 4) return null;
  let header: BinaryHeader;
  try {
    const headerText = dec.decode(new Uint8Array(buf, 4, headerLen));
    header = JSON.parse(headerText) as BinaryHeader;
  } catch {
    return null;
  }
  if (header.kind !== 'photo' || typeof header.photoId !== 'string' ||
      typeof header.idx !== 'number' || typeof header.total !== 'number' ||
      typeof header.mime !== 'string') {
    return null;
  }
  const payload = new Uint8Array(buf, 4 + headerLen);
  return { header, payload };
}

export interface ReassembledPhoto {
  photoId: string;
  mime: string;
  bytes: Uint8Array;
}

/**
 * Re-assembles photo bytes from binary frames. Keyed by photoId — caller
 * should drop the reassembler after `ingest()` returns a payload.
 *
 * Yields raw bytes + mime. The bridge layer wraps them in a Blob for
 * IndexedDB storage; keeping this layer Blob-free avoids host-environment
 * quirks (Node/jsdom Blob constructors disagree on Uint8Array parts).
 */
export class PhotoReassembler {
  private chunks = new Map<string, { mime: string; total: number; parts: Map<number, Uint8Array> }>();

  ingest(frame: DecodedBinaryFrame): ReassembledPhoto | null {
    const { header, payload } = frame;
    let entry = this.chunks.get(header.photoId);
    if (!entry) {
      entry = { mime: header.mime, total: header.total, parts: new Map() };
      this.chunks.set(header.photoId, entry);
    }
    entry.parts.set(header.idx, payload);
    if (entry.parts.size < entry.total) return null;
    let total = 0;
    for (let i = 0; i < entry.total; i++) {
      const p = entry.parts.get(i);
      if (!p) return null;
      total += p.byteLength;
    }
    const merged = new Uint8Array(total);
    let off = 0;
    for (let i = 0; i < entry.total; i++) {
      const p = entry.parts.get(i)!;
      merged.set(p, off);
      off += p.byteLength;
    }
    const mime = entry.mime;
    this.chunks.delete(header.photoId);
    return { photoId: header.photoId, mime, bytes: merged };
  }

  /** Returns photoIds that have started but not yet finished arriving. */
  pendingPhotoIds(): string[] {
    return Array.from(this.chunks.keys());
  }

  reset(): void { this.chunks.clear(); }
}
