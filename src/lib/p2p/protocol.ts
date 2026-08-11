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
  Reaction,
} from '../../types';

export const PROTOCOL_VERSION = 1;

export type Collection =
  | 'messages'
  | 'photos'
  | 'pointEvents'
  | 'completions'
  | 'habits'
  | 'reactions';

export const COLLECTIONS: readonly Collection[] = [
  'messages', 'photos', 'pointEvents', 'completions', 'habits', 'reactions',
] as const;

export type CollectionRecord =
  | Message
  | Photo
  | PointEvent
  | ChallengeCompletion
  | HabitCheckIn
  | Reaction;

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
  /** Sender's clock when the ping went out; echoed back untouched. */
  at: number;
}

export interface Pong {
  type: 'pong';
  /** Echo of the ping's `at`, so the sender can compute round-trip time. */
  at: number;
  /**
   * Responder's clock when it answered. Optional: a peer running a build from
   * before this field existed still produces a valid pong, we just can't
   * estimate its clock offset.
   */
  now?: number;
}

/**
 * "I'm looking at these messages right now."
 *
 * Deliberately never persisted on either side. Read receipts as records would
 * mean a commit to the trip history every time someone opens the chat, for
 * information nobody will ever want to read back. It lives in memory for the
 * length of the connection and then it's gone.
 */
export interface Seen {
  type: 'seen';
  ids: string[];
}

/**
 * Live game traffic (the kart duel). Transient by design, like {@link Seen}:
 * nothing here is ever persisted or gossiped onward — race *results* ride the
 * completions collection instead, exactly like hunts and moments do.
 *
 * The envelope is deliberately opaque at this layer. `k` discriminates the
 * game's own message kinds and `p` is whatever that kind carries; both are
 * validated by the game module (see lib/race/net.ts), not here. Keeping the
 * protocol layer ignorant of game internals means new game kinds never touch
 * this file — and a peer running an older build ignores the whole message
 * (unknown `type` → decodeControl returns null), which is the mixed-build
 * safety property everything in this file exists to preserve.
 *
 * `gv` versions the game protocol separately from PROTOCOL_VERSION. Bumping
 * PROTOCOL_VERSION would gate the *handshake* and split the family's gossip
 * mesh over a minigame; a game-only version lets two mismatched builds keep
 * syncing photos while politely declining to race each other.
 */
export interface GameMsg {
  type: 'game';
  /** Game protocol version — see lib/race/net.ts. */
  gv: number;
  /** Game message kind ('invite', 'in', 'st', …). */
  k: string;
  /** Kind-specific payload; the game layer validates it. */
  p?: unknown;
}

export type ControlMessage = Hello | HelloAck | Have | Want | Data | Ping | Pong | Seen | GameMsg;

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
    case 'seen':
      if (Array.isArray(parsed.ids)) return parsed as unknown as Seen;
      return null;
    case 'game':
      // Only the envelope is checked here; payload validation belongs to the
      // game layer so a malformed race message degrades to "ignored frame",
      // never to a torn-down sync connection.
      if (typeof parsed.gv === 'number' && typeof parsed.k === 'string') {
        return parsed as unknown as GameMsg;
      }
      return null;
    default:
      return null;
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Is this a collection this build knows how to handle?
 *
 * Needed because peers may run different builds: a newer one can advertise a
 * collection we've never heard of. Without this check the unknown name flows
 * into `collectHave`, whose switch has no matching case, returns `undefined`,
 * and `new Set(undefined)` throws — taking down the whole connection over what
 * should be a skipped message.
 */
export function isCollection(v: unknown): v is Collection {
  return typeof v === 'string' && (COLLECTIONS as readonly string[]).includes(v);
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
