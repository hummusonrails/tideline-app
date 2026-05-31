/**
 * Tiny shared encoders / hashes used across the p2p layer.
 *
 * Keeping these in their own module lets identity / protocol / signaling
 * import them without dragging in WebRTC or storage code.
 */

export const enc = new TextEncoder();
export const dec = new TextDecoder();

export function bytesToB64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // Chunk to avoid blowing the call stack for large inputs.
  const CHUNK = 0x8000;
  let s = '';
  for (let i = 0; i < u8.byteLength; i += CHUNK) {
    s += String.fromCharCode(...u8.subarray(i, Math.min(u8.byteLength, i + CHUNK)));
  }
  return btoa(s);
}

export function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Crockford-style base32 (no I/L/O/U) so fingerprints stay readable & unambiguous. */
const B32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function bytesToBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return new Uint8Array(buf);
}
