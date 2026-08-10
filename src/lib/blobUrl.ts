import { useEffect, useState } from 'react';

/**
 * An object URL for a Blob, revoked when it's no longer needed.
 *
 * Object URLs pin their Blob in memory until explicitly revoked. Creating one
 * per render — or during render, without cleanup — leaks the full decoded
 * image every time, which on a phone scrolling a gallery of photos is the
 * difference between a smooth grid and a tab the OS kills.
 *
 * Creating it in an effect also keeps render pure, so StrictMode's double
 * render doesn't produce two live URLs.
 */
export function useObjectUrl(blob: Blob | undefined | null): string | undefined {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
      // Don't leave the revoked URL in state — an <img> still pointing at it
      // renders as a broken image rather than nothing.
      setUrl(undefined);
    };
  }, [blob]);

  return url;
}
