/**
 * Bundle codec tests.
 *
 * These drive {@link encodeBundle} with real byte arrays rather than going
 * through Dexie. jsdom's Blob implements none of `arrayBuffer`/`text`/`stream`
 * and fake-indexeddb doesn't preserve Blobs across a round trip, so a test
 * routed through storage would be measuring the test environment instead of
 * the format. `exportBundle`'s own job — reading rows and filtering by date —
 * is covered separately using records only.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import {
  absorbBundle,
  bundleFilename,
  encodeBundle,
  exportBundle,
  parseBundle,
  totalRecords,
  type BundleHeader,
} from './fileBundle';
import { _resetIdentityCacheForTests, getOrCreateIdentity } from './identity';
import type { PeerIdentity } from './identity';
import type { Message, Photo, Reaction } from '../../types';

const TODAY = new Date().toISOString();
const enc = new TextEncoder();

async function mintIdentity(): Promise<PeerIdentity> {
  _resetIdentityCacheForTests();
  await db.meta.clear();
  return getOrCreateIdentity();
}

async function clearAll(): Promise<void> {
  await Promise.all([
    db.messages.clear(),
    db.photos.clear(),
    db.photoBlobs.clear(),
    db.pointEvents.clear(),
    db.completions.clear(),
    db.habits.clear(),
    db.reactions.clear(),
    db.outbox.clear(),
  ]);
}

const message = (id: string, body = 'hello'): Message => ({
  id, from: 'mem-a', sentAt: TODAY, body, kind: 'message',
});

const photoMeta = (id: string): Photo => ({
  id, from: 'mem-a', takenAt: TODAY, uploadedAt: TODAY,
  filePath: `photos/x/${id}.jpg`, width: 2, height: 2, bytes: 4, exifPresent: false,
});

const reactionRec = (id: string): Reaction => ({
  id, messageId: 'm1', by: 'mem-b', emoji: '❤️', at: TODAY,
});

let identity: PeerIdentity;

beforeEach(async () => {
  await clearAll();
  identity = await mintIdentity();
  await clearAll();
});

function bundle(
  records: BundleHeader['records'],
  photos: { photoId: string; mime: string; bytes: Uint8Array }[] = [],
): Promise<Uint8Array> {
  return encodeBundle({ identity, memberId: 'mem-a', records, photos });
}

describe('bundle round trip', () => {
  it('carries records through encode → parse → absorb', async () => {
    const bytes = await bundle({ messages: [message('m1')], reactions: [reactionRec('r1')] });

    const parsed = await parseBundle(bytes);
    expect(parsed.authentic).toBe(true);

    const counts = await absorbBundle(parsed);
    expect(counts.records.messages).toBe(1);
    expect(counts.records.reactions).toBe(1);
    expect(await db.messages.get('m1')).toMatchObject({ body: 'hello' });
    expect(await db.reactions.get('r1')).toMatchObject({ emoji: '❤️' });
  });

  it('carries photo bytes, which QR transport cannot', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const bytes = await bundle(
      { photos: [photoMeta('p1')] },
      [{ photoId: 'p1', mime: 'image/jpeg', bytes: jpeg }],
    );

    const parsed = await parseBundle(bytes);
    expect(parsed.authentic).toBe(true);
    expect(parsed.header.photoIndex).toEqual([
      { photoId: 'p1', mime: 'image/jpeg', offset: 0, len: 8 },
    ]);

    const absorbed = await absorbBundle(parsed);
    expect(absorbed.photos).toBe(1);
    expect(await db.photoBlobs.get('p1')).toBeTruthy();
  });

  it('indexes several photos at the right offsets', async () => {
    const bytes = await bundle({}, [
      { photoId: 'p1', mime: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) },
      { photoId: 'p2', mime: 'image/jpeg', bytes: new Uint8Array([4, 5]) },
      { photoId: 'p3', mime: 'image/png', bytes: new Uint8Array([6]) },
    ]);
    const parsed = await parseBundle(bytes);
    expect(parsed.header.photoIndex).toEqual([
      { photoId: 'p1', mime: 'image/jpeg', offset: 0, len: 3 },
      { photoId: 'p2', mime: 'image/jpeg', offset: 3, len: 2 },
      { photoId: 'p3', mime: 'image/png', offset: 5, len: 1 },
    ]);
    expect(parsed.photoRegion).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });

  it('dedupes on a second import instead of duplicating', async () => {
    const bytes = await bundle({ messages: [message('m1')] });
    await absorbBundle(await parseBundle(bytes));
    const second = await absorbBundle(await parseBundle(bytes));
    expect(second.records.messages).toBe(0);
    expect(await db.messages.count()).toBe(1);
  });

  it('queues absorbed records for the backend like any other write', async () => {
    const bytes = await bundle({ messages: [message('m1')] });
    await absorbBundle(await parseBundle(bytes));
    expect(await db.outbox.get('p2p-messages-m1')).toBeTruthy();
  });

  it('skips a photo whose index range runs past the photo region', async () => {
    const bytes = await bundle({}, [{ photoId: 'p1', mime: 'image/jpeg', bytes: new Uint8Array([1, 2]) }]);
    const parsed = await parseBundle(bytes);
    // Simulate a header claiming more bytes than were actually shipped.
    parsed.header.photoIndex[0].len = 999;
    const absorbed = await absorbBundle(parsed);
    expect(absorbed.photos).toBe(0);
  });

  it('handles a bundle with no photos at all', async () => {
    const parsed = await parseBundle(await bundle({ messages: [message('m1')] }));
    expect(parsed.photoRegion.byteLength).toBe(0);
    expect(await absorbBundle(parsed)).toMatchObject({ photos: 0 });
  });
});

describe('authenticity', () => {
  it('rejects a tampered record body', async () => {
    const bytes = await bundle({ messages: [message('m1', 'original')] });
    const at = new TextDecoder().decode(bytes).indexOf('original');
    expect(at).toBeGreaterThan(-1);
    const tampered = bytes.slice();
    tampered.set(enc.encode('OVERRIDE'), at);
    expect((await parseBundle(tampered)).authentic).toBe(false);
  });

  it('rejects tampered photo bytes', async () => {
    const bytes = await bundle({}, [
      { photoId: 'p1', mime: 'image/jpeg', bytes: new Uint8Array([1, 2, 3, 4]) },
    ]);
    const tampered = bytes.slice();
    tampered[tampered.byteLength - 1] ^= 0xff;
    expect((await parseBundle(tampered)).authentic).toBe(false);
  });

  it('rejects a fingerprint that does not derive from the enclosed key', async () => {
    const bytes = await bundle({ messages: [message('m1')] });
    const parsed = await parseBundle(bytes);
    const forged: BundleHeader = {
      ...parsed.header,
      signed: { ...parsed.header.signed, fingerprint: 'ZZZZZZZZZZ' },
    };
    expect((await parseBundle(rebuild(forged, parsed.photoRegion))).authentic).toBe(false);
  });

  it('rejects a payload signed by a different device', async () => {
    const bytes = await bundle({ messages: [message('m1')] });
    const parsed = await parseBundle(bytes);

    const other = await mintIdentity();
    const otherBytes = await encodeBundle({
      identity: other, memberId: 'mem-a',
      records: { messages: [message('m2')] }, photos: [],
    });
    const otherParsed = await parseBundle(otherBytes);

    // Graft the second device's signature onto the first device's body.
    const forged: BundleHeader = { ...parsed.header, signed: otherParsed.header.signed };
    expect((await parseBundle(rebuild(forged, parsed.photoRegion))).authentic).toBe(false);
  });

  it('refuses a file that is not a bundle at all', async () => {
    await expect(parseBundle(enc.encode('just a text file'))).rejects.toThrow(
      /not a Tideline sync file/,
    );
  });

  it('refuses a truncated file', async () => {
    await expect(parseBundle(new Uint8Array([84, 76, 70]))).rejects.toThrow(
      /not a Tideline sync file/,
    );
  });

  it('refuses a header length that overruns the file', async () => {
    const bytes = new Uint8Array(12);
    bytes.set(enc.encode('TLF1'), 0);
    new DataView(bytes.buffer).setUint32(4, 9_999_999, true);
    await expect(parseBundle(bytes)).rejects.toThrow(/corrupt/);
  });

  it('refuses a header that is not valid JSON', async () => {
    const junk = enc.encode('{{{not json');
    const bytes = new Uint8Array(8 + junk.byteLength);
    bytes.set(enc.encode('TLF1'), 0);
    new DataView(bytes.buffer).setUint32(4, junk.byteLength, true);
    bytes.set(junk, 8);
    await expect(parseBundle(bytes)).rejects.toThrow(/not valid JSON/);
  });
});

describe('exportBundle', () => {
  it('includes only records at or after the since date', async () => {
    await db.messages.put({ ...message('old'), sentAt: '2020-01-01T00:00:00.000Z' });
    await db.messages.put(message('new'));
    const { counts } = await exportBundle({ identity, memberId: 'mem-a', sinceDate: '2026-01-01' });
    expect(counts.records.messages).toBe(1);
  });

  it('includes everything when no since date is given', async () => {
    // The UI's "All" option passes no bound. A silent default here used to
    // make that option quietly ship only the last week.
    await db.messages.put({ ...message('ancient'), sentAt: '2015-01-01T00:00:00.000Z' });
    await db.messages.put(message('recent'));
    const { counts } = await exportBundle({ identity, memberId: 'mem-a' });
    expect(counts.records.messages).toBe(2);
  });

  it('produces a file whose bytes parse and verify', async () => {
    await db.messages.put(message('m1'));
    const { file } = await exportBundle({ identity, memberId: 'mem-a' });
    expect(file.name).toMatch(/^sync-\d{8}-[A-Z0-9]+\.tlsync$/);
    const parsed = await parseBundle(await fileBytes(file));
    expect(parsed.authentic).toBe(true);
    expect(parsed.header.records.messages).toHaveLength(1);
  });

  it('skips photos when asked to', async () => {
    await db.photos.put(photoMeta('p1'));
    const { counts } = await exportBundle({ identity, memberId: 'mem-a', includePhotos: false });
    expect(counts.photos).toBe(0);
  });
});

describe('bundleFilename', () => {
  it('reveals a date and a fingerprint, and nothing else', () => {
    expect(bundleFilename('A1B2C3D4E5', new Date(2026, 7, 14))).toBe(
      'sync-20260814-A1B2C3D4E5.tlsync',
    );
  });
});

describe('totalRecords', () => {
  it('sums across collections', () => {
    expect(
      totalRecords({
        records: { messages: 2, photos: 1, pointEvents: 0, completions: 3, habits: 0, reactions: 4 },
        photos: 1,
      }),
    ).toBe(10);
  });
});

// --- helpers ---------------------------------------------------------------

/** jsdom's File has no arrayBuffer(); FileReader is the path it implements. */
async function fileBytes(file: File): Promise<Uint8Array> {
  const { blobToBytes } = await import('../blobBytes');
  return blobToBytes(file);
}

/** Re-encode a header + photo region into bundle bytes, as encodeBundle does. */
function rebuild(header: BundleHeader, photoRegion: Uint8Array): Uint8Array {
  const headerBytes = enc.encode(JSON.stringify(header));
  const out = new Uint8Array(8 + headerBytes.byteLength + photoRegion.byteLength);
  out.set(enc.encode('TLF1'), 0);
  new DataView(out.buffer).setUint32(4, headerBytes.byteLength, true);
  out.set(headerBytes, 8);
  out.set(photoRegion, 8 + headerBytes.byteLength);
  return out;
}
