/**
 * The transport that cannot be blocked: a signed file, moved by AirDrop.
 *
 * Every other layer depends on the network cooperating. WebRTC needs the LAN
 * to forward peer traffic, which cruise WiFi often refuses (client isolation).
 * QR needs someone to hold two phones still, and can't realistically carry
 * photo bytes. AirDrop rides AWDL — a direct radio link between the two
 * devices — so it works with no WiFi network at all, no internet, and no
 * cooperation from anything the ship operates. It also carries megabytes
 * happily, which makes it the only offline path photos can travel.
 *
 * The cost is that it isn't a connection: iOS has no Web Share Target, so the
 * receiving side saves the file and imports it by hand. That's the ceiling on
 * this platform, and a two-tap manual step that always works beats an elegant
 * one that doesn't.
 *
 * Container layout:
 *
 *   [4B  magic "TLF1"]
 *   [4B  LE header length]
 *   [    UTF-8 JSON header    ]
 *   [    concatenated photo bytes    ]
 *
 * The header carries the records and an index into the photo region. The
 * signature covers the header bytes *and* the photo region, so neither can be
 * altered without detection. Photos sit outside the JSON to avoid base64's 33%
 * inflation on the largest part of the payload.
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
import { blobToBytes } from '../blobBytes';
import { absorbData, absorbPhotoBinary } from './sync';
import { signPayload, verifyPayload, type PeerIdentity, type SignedPayload } from './identity';
import { COLLECTIONS, type Collection, type CollectionRecord } from './protocol';

const MAGIC = 'TLF1';
const MAGIC_BYTES = new TextEncoder().encode(MAGIC);
/** Skip any single photo larger than this — almost certainly not one of ours. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
/** Ceiling on one bundle. Far above a realistic few days of ~200KB photos. */
const MAX_TOTAL_PHOTO_BYTES = 100 * 1024 * 1024;
/** Refuse to parse a header claiming an implausible size. */
const MAX_HEADER_BYTES = 32 * 1024 * 1024;

export interface PhotoIndexEntry {
  photoId: string;
  mime: string;
  /** Offset from the start of the photo region, not the file. */
  offset: number;
  len: number;
}

export interface BundleHeader {
  v: 1;
  from: { memberId: string };
  signed: SignedPayload;
  records: Partial<Record<Collection, CollectionRecord[]>>;
  photoIndex: PhotoIndexEntry[];
}

export interface BundleCounts {
  records: Record<Collection, number>;
  photos: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

export interface PhotoPayload {
  photoId: string;
  mime: string;
  bytes: Uint8Array;
}

/**
 * Serialise records + photo bytes into signed bundle bytes.
 *
 * Split out from {@link exportBundle} so the container format can be tested
 * against real bytes — the storage layer's Blob handling varies enough between
 * environments that going through it would test the environment, not the
 * format.
 */
export async function encodeBundle(opts: {
  identity: PeerIdentity;
  memberId: string;
  records: BundleHeader['records'];
  photos: PhotoPayload[];
}): Promise<Uint8Array> {
  const photoIndex: PhotoIndexEntry[] = [];
  const photoParts: Uint8Array[] = [];
  let offset = 0;
  for (const p of opts.photos) {
    if (p.bytes.byteLength > MAX_PHOTO_BYTES) continue;
    if (offset + p.bytes.byteLength > MAX_TOTAL_PHOTO_BYTES) break;
    photoIndex.push({
      photoId: p.photoId,
      mime: p.mime || 'image/jpeg',
      offset,
      len: p.bytes.byteLength,
    });
    photoParts.push(p.bytes);
    offset += p.bytes.byteLength;
  }
  const photoRegion = concat(photoParts);

  // Sign the record body plus the photo region. The signature can't live
  // inside what it signs, so we sign this canonical body and embed the result
  // alongside it.
  const signedBody = concat([
    enc.encode(JSON.stringify({ records: opts.records, photoIndex })),
    photoRegion,
  ]);
  const signed = await signPayload(opts.identity, signedBody);

  const header: BundleHeader = {
    v: 1,
    from: { memberId: opts.memberId },
    signed,
    records: opts.records,
    photoIndex,
  };
  const headerBytes = enc.encode(JSON.stringify(header));
  const lenBytes = new Uint8Array(4);
  new DataView(lenBytes.buffer).setUint32(0, headerBytes.byteLength, true);

  return concat([MAGIC_BYTES, lenBytes, headerBytes, photoRegion]);
}

/**
 * Build a shareable bundle of everything recent on this device.
 *
 * Filenames are deliberately opaque — a device fingerprint and a date, never a
 * name — because this file lands in someone's Files app and its name is the
 * one part of it a bystander can read.
 */
export async function exportBundle(opts: {
  identity: PeerIdentity;
  memberId: string;
  /**
   * Inclusive lower bound, ISO date. Omit for everything.
   *
   * Deliberately has no default: `exportBulkFrames` reads an absent bound as
   * "all time", and a silent seven-day default here meant the UI's "All"
   * option quietly shipped a week. Same word, same meaning, both paths.
   */
  sinceDate?: string;
  includePhotos?: boolean;
}): Promise<{ file: File; counts: BundleCounts }> {
  const since = opts.sinceDate;
  const includePhotos = opts.includePhotos ?? true;
  const after = (iso: string) => !since || iso >= since;

  const messages: Message[] = (await db.messages.toArray()).filter((m) => after(m.sentAt));
  const photos: Photo[] = (await db.photos.toArray()).filter((p) => after(p.uploadedAt));
  const pointEvents: PointEvent[] = (await db.pointEvents.toArray()).filter((e) => after(e.at));
  const completions: ChallengeCompletion[] = (await db.completions.toArray()).filter(
    (c) => after(c.completedAt),
  );
  const habits: HabitCheckIn[] = (await db.habits.toArray()).filter((h) => after(h.at));
  const reactions: Reaction[] = (await db.reactions.toArray()).filter((r) => after(r.at));

  const payloads: PhotoPayload[] = [];
  if (includePhotos) {
    for (const p of photos) {
      const row = await db.photoBlobs.get(p.id);
      if (!row?.bytes) continue;
      try {
        const bytes = await blobToBytes(row.bytes);
        // A zero-length read means the blob didn't survive storage; shipping
        // it would just poison the recipient's cache with an empty photo.
        if (bytes.byteLength === 0) continue;
        payloads.push({ photoId: p.id, mime: row.bytes.type || 'image/jpeg', bytes });
      } catch {
        // One unreadable photo shouldn't sink the whole bundle.
        continue;
      }
    }
  }

  const records: BundleHeader['records'] = {
    messages, photos, pointEvents, completions, habits, reactions,
  };
  const bytes = await encodeBundle({
    identity: opts.identity,
    memberId: opts.memberId,
    records,
    photos: payloads,
  });

  const file = new File([bytes as BlobPart], bundleFilename(opts.identity.fingerprint), {
    type: 'application/octet-stream',
  });

  return {
    file,
    counts: {
      records: {
        messages: messages.length,
        photos: photos.length,
        pointEvents: pointEvents.length,
        completions: completions.length,
        habits: habits.length,
        reactions: reactions.length,
      },
      photos: payloads.length,
    },
  };
}

/** `sync-20260814-A1B2C3D4E5.tlsync` — a date and a fingerprint, nothing else. */
export function bundleFilename(fingerprint: string, now = new Date()): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  return `sync-${stamp}-${fingerprint}.tlsync`;
}

export interface ParsedBundle {
  header: BundleHeader;
  photoRegion: Uint8Array;
  /** Whether the signature and fingerprint both check out. */
  authentic: boolean;
}

/**
 * Parse and authenticate a bundle without writing anything.
 *
 * Separated from {@link absorbBundle} so the UI can show who a file claims to
 * be from — and gate on trusting that fingerprint — before any of its contents
 * touch the database.
 */
export async function parseBundle(bytes: Uint8Array): Promise<ParsedBundle> {
  if (bytes.byteLength < 8) throw new Error('not a Tideline sync file');
  if (dec.decode(bytes.subarray(0, 4)) !== MAGIC) {
    throw new Error('not a Tideline sync file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = view.getUint32(4, true);
  if (headerLen === 0 || headerLen > MAX_HEADER_BYTES || 8 + headerLen > bytes.byteLength) {
    throw new Error('sync file header is corrupt');
  }

  let header: BundleHeader;
  try {
    header = JSON.parse(dec.decode(bytes.subarray(8, 8 + headerLen))) as BundleHeader;
  } catch {
    throw new Error('sync file header is not valid JSON');
  }
  if (header?.v !== 1 || !header.records || !header.signed) {
    throw new Error('sync file is in an unrecognised format');
  }

  const photoRegion = bytes.subarray(8 + headerLen);
  const signedBody = concat([
    enc.encode(JSON.stringify({ records: header.records, photoIndex: header.photoIndex ?? [] })),
    photoRegion,
  ]);
  const authentic = await verifyPayload(header.signed, signedBody);

  return { header, photoRegion, authentic };
}

/**
 * Write a parsed bundle's contents into the local store.
 *
 * Callers must have decided the sender is trusted. Everything routes through
 * the same {@link absorbData} the live gossip path uses, so records dedupe by
 * id and get forwarded to the backend outbox exactly as if they'd arrived over
 * a connection.
 */
export async function absorbBundle(parsed: ParsedBundle): Promise<BundleCounts> {
  const records = Object.fromEntries(COLLECTIONS.map((c) => [c, 0])) as Record<Collection, number>;
  for (const collection of COLLECTIONS) {
    const incoming = parsed.header.records[collection] ?? [];
    if (incoming.length === 0) continue;
    const result = await absorbData(collection, incoming);
    records[collection] = result.newIds.length;
  }

  let photos = 0;
  for (const entry of parsed.header.photoIndex ?? []) {
    const end = entry.offset + entry.len;
    if (entry.offset < 0 || end > parsed.photoRegion.byteLength) continue;
    if (await db.photoBlobs.get(entry.photoId)) continue;
    await absorbPhotoBinary(
      entry.photoId,
      parsed.photoRegion.subarray(entry.offset, end),
      entry.mime,
    );
    photos++;
  }

  return { records, photos };
}

/** Total records across every collection — for a one-line "imported N" summary. */
export function totalRecords(counts: BundleCounts): number {
  return Object.values(counts.records).reduce((a, b) => a + b, 0);
}
