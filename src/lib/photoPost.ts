/**
 * Posting a photo into the shared album.
 *
 * Extracted from the Quest claim flow once hunt stages needed to accept photo
 * proof too. Both callers must produce byte-identical records — the binary and
 * its sidecar are two separate outbox entries, and a second implementation
 * that drifted on path building would strand one half of a photo in the repo.
 */

import { db } from './db';
import { enqueue } from './sync';
import { uid } from './uuid';
import { textToBase64 } from './github';
import { photoBinaryPath, photoSidecarPath } from './paths';
import { blobToBase64, type CompressResult } from './compress';
import type { MemberId, Photo } from '../types';

/**
 * Persist a compressed photo locally and queue both remote writes.
 * Returns the new photo id.
 */
export async function postPhoto(
  result: CompressResult,
  by: MemberId,
  opts: { placeSlug?: string; caption?: string; commitMessage?: string } = {},
): Promise<string> {
  const now = new Date();
  const id = uid();
  const photo: Photo = {
    id,
    from: by,
    takenAt: result.takenAt,
    uploadedAt: now.toISOString(),
    caption: opts.caption,
    placeSlug: opts.placeSlug,
    filePath: '',
    width: result.width,
    height: result.height,
    bytes: result.bytes,
    exifPresent: result.exifPresent,
  };
  const jpgPath = photoBinaryPath(photo);
  const sidecarPath = photoSidecarPath(photo);
  photo.filePath = jpgPath;

  await db.photos.put(photo);
  await db.photoBlobs.put({ photoId: id, bytes: result.file });
  await enqueue({
    id: `${id}-bin`,
    enqueuedAt: now.toISOString(),
    op: {
      kind: 'put-file',
      path: jpgPath,
      contentBase64: await blobToBase64(result.file),
      commitMessage: opts.commitMessage ?? 'add photo',
    },
  });
  await enqueue({
    id: `${id}-meta`,
    enqueuedAt: now.toISOString(),
    op: {
      kind: 'put-file',
      path: sidecarPath,
      contentBase64: textToBase64(JSON.stringify(photo)),
      commitMessage: 'add photo metadata',
    },
  });
  return id;
}
