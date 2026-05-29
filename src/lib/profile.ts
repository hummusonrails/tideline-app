import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { useSession } from '../state/session';
import type { Profile } from '../types';

/** Live-queried current-user profile, or undefined while pre-sync / signed-out. */
export function useMyProfile(): Profile | undefined {
  const id = useSession((s) => s.identity);
  return useLiveQuery(() => (id ? db.profiles.get(id) : undefined), [id]);
}

/**
 * Resolve a member's avatar (stored as a local blob) to an object URL.
 * Returns undefined when there's no avatar yet. Revokes the URL on cleanup.
 */
export function useAvatarSrc(memberId: string | null | undefined): string | undefined {
  const blob = useLiveQuery(
    () => (memberId ? db.avatarBlobs.get(memberId) : undefined),
    [memberId],
  );
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!blob?.bytes) {
      setUrl(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(blob.bytes);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return url;
}
