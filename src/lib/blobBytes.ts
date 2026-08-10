/**
 * Read a Blob's bytes across every environment this code runs in.
 *
 * There is no single method that works everywhere. Safari has
 * `Blob.arrayBuffer()`. jsdom's Blob implements none of `arrayBuffer`, `text`,
 * or `stream`, and passing a Blob to `new Response()` there stringifies it to
 * "[object Blob]" — silently producing 13 bytes of garbage rather than
 * throwing, which is the failure mode most likely to be mistaken for a real
 * bug. FileReader is the one path jsdom implements properly.
 *
 * So: try the modern method, fall back to FileReader, and only then to
 * Response. Ordered by preference, not by likelihood.
 */
export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  const maybe = blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof maybe.arrayBuffer === 'function') {
    return new Uint8Array(await maybe.arrayBuffer());
  }

  if (typeof FileReader === 'function') {
    return new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error ?? new Error('could not read blob'));
      reader.readAsArrayBuffer(blob);
    });
  }

  return new Uint8Array(await new Response(blob).arrayBuffer());
}
