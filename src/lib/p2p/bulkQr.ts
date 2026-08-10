/**
 * "Plan B" data transport: when WebRTC won't connect at all (true
 * zero-network: airline mode, no in-flight wifi, an AP-isolated ship LAN),
 * two devices can still trade event records by passing chunked QR code
 * frames in front of each other's cameras.
 *
 * Payload bytes are `[4-byte magic][body]`:
 *
 *   TLZ1  body is deflate-raw compressed envelope JSON
 *   TLJ1  body is envelope JSON verbatim
 *
 * Compression typically cuts the frame count several-fold, which matters a
 * lot here: frames cycle on a timer and every extra one is another rotation
 * someone has to stand still for. TLJ1 exists because `CompressionStream`
 * isn't guaranteed everywhere, and a slower transfer beats none.
 *
 * The envelope is signed. Unlike the WebRTC path there's no handshake proving
 * who's on the other end, and absorbed records are forwarded to the backend
 * outbox — so without a signature any QR code from anyone would be accepted
 * and then uploaded on the family's behalf.
 *
 * Photos here carry metadata only; JPEG bytes are far too large for
 * hand-scanned QR. Use the AirDrop bundle for photos, or wait for a real
 * connection.
 */

import type {
  ChallengeCompletion,
  HabitCheckIn,
  Message,
  Photo,
  PointEvent,
  Reaction,
} from '../../types';
import { db } from '../db';
import { absorbData } from './sync';
import { encodeFrames } from './qr';
import { enc } from './base';
import { signPayload, verifyPayload, type PeerIdentity, type SignedPayload } from './identity';
import { COLLECTIONS, type Collection, type CollectionRecord } from './protocol';

const MAGIC_DEFLATE = 'TLZ1';
const MAGIC_PLAIN = 'TLJ1';

export interface BulkEnvelope {
  v: 1;
  from: { memberId: string; fingerprint: string };
  signed: SignedPayload;
  records: Partial<Record<Collection, CollectionRecord[]>>;
}

/**
 * Exactly what the signature covers.
 *
 * Both sides build this the same way from the same fields, so the bytes match
 * on re-serialisation. Deliberately excludes `signed` itself.
 */
function signedBody(
  from: BulkEnvelope['from'],
  records: BulkEnvelope['records'],
): Uint8Array {
  return enc.encode(JSON.stringify({ from, records }));
}

/**
 * Push bytes through a transform stream and collect the result.
 *
 * Written against the reader/writer API rather than `Blob.stream()` or
 * `new Response(stream)`, because neither of those is reliably present
 * everywhere this runs — jsdom implements no Blob streaming at all. Reading
 * and writing are interleaved so a payload larger than the internal buffer
 * can't deadlock.
 */
async function pump(
  // Typed against what the DOM lib actually declares: the writable side of a
  // Compression/DecompressionStream accepts any BufferSource.
  transform: { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> },
  bytes: Uint8Array,
): Promise<Uint8Array> {
  // Copy into a freshly-allocated buffer. A Uint8Array can be backed by a
  // SharedArrayBuffer, which BufferSource doesn't accept — same dance as
  // Peer.sendBinary.
  const chunk = new Uint8Array(bytes.byteLength);
  chunk.set(bytes);

  const writer = transform.writable.getWriter();
  // The catch matters: if the transform errors mid-read, this promise rejects
  // while nothing is awaiting it yet, which surfaces as an unhandled rejection
  // rather than the read-side error we actually want to propagate.
  const writing = writer.write(chunk).then(() => writer.close()).catch(() => {});

  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await writing;

  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream !== 'function') return null;
  try {
    return await pump(new CompressionStream('deflate-raw'), bytes);
  } catch {
    // Compression is an optimisation. Falling back to plain JSON costs frames,
    // not correctness.
    return null;
  }
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('this device cannot read compressed sync codes');
  }
  return pump(new DecompressionStream('deflate-raw'), bytes);
}

function withMagic(magic: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + body.byteLength);
  out.set(enc.encode(magic), 0);
  out.set(body, 4);
  return out;
}

/**
 * Pull recent local records and pack them into QR frames.
 *
 * `sinceDate` really matters: exporting everything can mean sixty-plus frames,
 * which nobody will stand through. Callers should default to a few days and
 * let the user widen it deliberately.
 */
export async function exportBulkFrames(opts: {
  identity: PeerIdentity;
  memberId: string;
  /** Inclusive lower bound (ISO date YYYY-MM-DD). Records older than this are skipped. */
  sinceDate?: string;
  /** Limit per collection — protects from a runaway QR stream. */
  perCollectionLimit?: number;
}): Promise<{
  frames: string[];
  counts: Record<Collection, number>;
  compressed: boolean;
}> {
  const since = opts.sinceDate;
  const cap = opts.perCollectionLimit ?? 200;

  const messages: Message[] = (await db.messages.toArray())
    .filter((m) => !since || m.sentAt >= since)
    .slice(-cap);
  const photos: Photo[] = (await db.photos.toArray())
    .filter((p) => !since || p.uploadedAt >= since)
    .slice(-cap);
  const pointEvents: PointEvent[] = (await db.pointEvents.toArray())
    .filter((e) => !since || e.at >= since)
    .slice(-cap);
  const completions: ChallengeCompletion[] = (await db.completions.toArray())
    .filter((c) => !since || c.completedAt >= since)
    .slice(-cap);
  const habits: HabitCheckIn[] = (await db.habits.toArray())
    .filter((h) => !since || h.at >= since)
    .slice(-cap);
  const reactions: Reaction[] = (await db.reactions.toArray())
    .filter((r) => !since || r.at >= since)
    .slice(-cap);

  const from = { memberId: opts.memberId, fingerprint: opts.identity.fingerprint };
  const records: BulkEnvelope['records'] = {
    messages, photos, pointEvents, completions, habits, reactions,
  };
  const signed = await signPayload(opts.identity, signedBody(from, records));

  const envelope: BulkEnvelope = { v: 1, from, signed, records };
  const json = enc.encode(JSON.stringify(envelope));
  const squeezed = await deflate(json);
  const payload = squeezed
    ? withMagic(MAGIC_DEFLATE, squeezed)
    : withMagic(MAGIC_PLAIN, json);

  return {
    frames: encodeFrames(payload),
    counts: {
      messages: messages.length,
      photos: photos.length,
      pointEvents: pointEvents.length,
      completions: completions.length,
      habits: habits.length,
      reactions: reactions.length,
    },
    compressed: squeezed !== null,
  };
}

export interface BulkImportResult {
  from: BulkEnvelope['from'];
  absorbed: Record<Collection, number>;
}

/**
 * Decode a bulk envelope and check who signed it, without writing anything.
 *
 * Split from absorption so the UI can refuse — or prompt about — an unknown
 * fingerprint before its records reach the database and the upload queue.
 */
export async function decodeBulkEnvelope(bytes: Uint8Array): Promise<{
  envelope: BulkEnvelope;
  authentic: boolean;
}> {
  if (bytes.byteLength < 5) throw new Error('sync code is too short to be valid');
  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  const body = bytes.subarray(4);

  let json: Uint8Array;
  if (magic === MAGIC_DEFLATE) json = await inflate(body);
  else if (magic === MAGIC_PLAIN) json = body;
  else throw new Error('this QR code is not a Tideline sync code');

  let envelope: BulkEnvelope;
  try {
    envelope = JSON.parse(new TextDecoder().decode(json)) as BulkEnvelope;
  } catch {
    throw new Error('sync code is not valid JSON');
  }
  if (!envelope || envelope.v !== 1 || !envelope.records || !envelope.from || !envelope.signed) {
    throw new Error('sync code shape is wrong');
  }

  const authentic =
    envelope.signed.fingerprint === envelope.from.fingerprint &&
    (await verifyPayload(envelope.signed, signedBody(envelope.from, envelope.records)));

  return { envelope, authentic };
}

/** Write a decoded envelope's records into the local store. */
export async function absorbBulkEnvelope(envelope: BulkEnvelope): Promise<BulkImportResult> {
  const absorbed = Object.fromEntries(
    COLLECTIONS.map((c) => [c, 0]),
  ) as Record<Collection, number>;
  for (const collection of COLLECTIONS) {
    const records = envelope.records[collection] ?? [];
    if (records.length === 0) continue;
    const result = await absorbData(collection, records);
    absorbed[collection] = result.newIds.length;
  }
  return { from: envelope.from, absorbed };
}

/**
 * Decode, authenticate, and absorb in one step.
 *
 * @throws if the signature doesn't verify. Callers that want to show the
 * sender before deciding should use {@link decodeBulkEnvelope} instead.
 */
export async function importBulkEnvelope(bytes: Uint8Array): Promise<BulkImportResult> {
  const { envelope, authentic } = await decodeBulkEnvelope(bytes);
  if (!authentic) throw new Error('sync code signature is invalid');
  return absorbBulkEnvelope(envelope);
}
