import { describe, it, expect } from 'vitest';
import {
  photoBinaryPath,
  photoSidecarPath,
  messagePath,
  eventIdFromPath,
} from './paths';

describe('eventIdFromPath', () => {
  it('recovers the photo id from a binary path', () => {
    const photo = {
      id: 'a1b2c3d4e5f6',
      from: 'fb99f8',
      uploadedAt: '2026-08-09T21:04:33.000Z',
    };
    expect(eventIdFromPath(photoBinaryPath(photo))).toBe('a1b2c3d4e5f6');
  });

  it('recovers the photo id from a sidecar path', () => {
    const photo = {
      id: 'a1b2c3d4e5f6',
      from: 'fb99f8',
      uploadedAt: '2026-08-09T21:04:33.000Z',
    };
    expect(eventIdFromPath(photoSidecarPath(photo))).toBe('a1b2c3d4e5f6');
  });

  it('recovers the id from any event path built by eventFilename', () => {
    const msg = { id: 'ff00ff00ff00', from: 'adb355', sentAt: '2026-08-09T08:00:00.000Z' };
    expect(eventIdFromPath(messagePath(msg))).toBe('ff00ff00ff00');
  });

  it('does not mistake the timestamp or author for the id', () => {
    // The regression this exists for: taking the whole filename stem meant
    // synced photo bytes were stored under "21-04-33-fb99f8-a1b2..." and the
    // gallery, which looks them up by bare id, rendered blank tiles.
    const path = 'photos/2026-08-09/21-04-33-fb99f8-a1b2c3d4e5f6.jpg';
    const id = eventIdFromPath(path);
    expect(id).toBe('a1b2c3d4e5f6');
    expect(id).not.toContain('-');
    expect(id).not.toContain('fb99f8');
  });

  it('handles a midnight timestamp, where every time part is zeros', () => {
    const path = 'photos/2026-08-09/00-00-00-e10131-0123456789ab.jpg';
    expect(eventIdFromPath(path)).toBe('0123456789ab');
  });

  it('falls back to the stem for a path with no author/id structure', () => {
    expect(eventIdFromPath('avatars/fb99f8.jpg')).toBe('fb99f8');
  });
});
