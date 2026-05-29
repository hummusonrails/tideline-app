import imageCompression from 'browser-image-compression';
import exifr from 'exifr';

export interface CompressResult {
  file: File;
  width: number;
  height: number;
  bytes: number;
  takenAt: string;        // ISO; EXIF DateTimeOriginal if present, else now()
  exifPresent: boolean;
}

export async function compressForPost(input: File): Promise<CompressResult> {
  const compressed = await imageCompression(input, {
    maxWidthOrHeight: 1600,
    initialQuality: 0.8,
    fileType: 'image/jpeg',
    useWebWorker: true,
    preserveExif: true,
  });

  let exifPresent = false;
  let takenAt = new Date().toISOString();
  try {
    const tags = (await exifr.parse(input)) as { DateTimeOriginal?: Date } | undefined;
    if (tags?.DateTimeOriginal instanceof Date && !Number.isNaN(tags.DateTimeOriginal.getTime())) {
      takenAt = tags.DateTimeOriginal.toISOString();
      exifPresent = true;
    }
  } catch {
    // EXIF parse can fail on non-photo inputs (e.g., screenshots). Fall back to now().
  }

  const { width, height } = await readImageDimensions(compressed);
  return {
    file: compressed,
    width,
    height,
    bytes: compressed.size,
    takenAt,
    exifPresent,
  };
}

function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const out = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(out);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image load failed'));
    };
    img.src = url;
  });
}

/** Smaller square-ish compression for profile avatars (~400px, ~150KB). */
export async function compressAvatar(input: File): Promise<File> {
  return imageCompression(input, {
    maxWidthOrHeight: 400,
    initialQuality: 0.82,
    fileType: 'image/jpeg',
    useWebWorker: true,
  });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const u8 = new Uint8Array(buf);
  let s = '';
  // chunk to avoid arg-list limits for large files
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  }
  return btoa(s);
}
