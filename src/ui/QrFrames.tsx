import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

/**
 * Cycle through a list of QR frame strings, rendering each as an SVG
 * QR code in turn. Single-frame payloads are shown statically.
 *
 * `intervalMs` is the time spent on each frame. ~500ms is the sweet
 * spot for hand-held scanning — fast enough that all frames cycle in a
 * few seconds, slow enough for a phone camera to lock on cleanly.
 */
export function QrFrames({
  frames,
  intervalMs = 500,
  size = 280,
}: {
  frames: string[];
  intervalMs?: number;
  size?: number;
}) {
  const [idx, setIdx] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (frames.length <= 1) {
      setIdx(0);
      return;
    }
    const t = setInterval(() => setIdx((i) => (i + 1) % frames.length), intervalMs);
    return () => clearInterval(t);
  }, [frames, intervalMs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || frames.length === 0) return;
    // Errors here would only happen for absurdly large frames; the
    // codec's chunk size keeps every frame well within QR limits.
    void QRCode.toCanvas(canvas, frames[idx], {
      errorCorrectionLevel: 'L',
      margin: 1,
      width: size,
    });
  }, [frames, idx, size]);

  if (frames.length === 0) {
    return <div className="text-sm text-ink-600">Nothing to share.</div>;
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <canvas ref={canvasRef} width={size} height={size} className="rounded-xl bg-white p-2" />
      {frames.length > 1 && (
        <div className="text-xs text-ink-600">
          Frame {idx + 1} of {frames.length}
        </div>
      )}
    </div>
  );
}
