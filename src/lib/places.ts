import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';

/**
 * Resolve a place's hero photo (synced from the private backend into a local
 * blob) to an object URL. Returns undefined until the photo has synced, so
 * callers can show a gradient placeholder in the meantime.
 */
export function usePlaceImage(slug: string | undefined): string | undefined {
  const row = useLiveQuery(() => (slug ? db.placeBlobs.get(slug) : undefined), [slug]);
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!row?.bytes) {
      setUrl(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(row.bytes);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [row]);
  return url;
}
