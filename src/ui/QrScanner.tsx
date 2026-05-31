import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

/**
 * Live camera viewfinder that runs jsQR on each frame. The component
 * never holds on to media — it stops the stream and the rAF loop on
 * unmount and on `onPause`.
 *
 * Calls `onCode(text)` for every distinct QR text it sees while
 * mounted. Duplicates within `dedupeWindowMs` are dropped so that a
 * single QR doesn't fire dozens of times in a row.
 */
export function QrScanner({
  active,
  onCode,
  onError,
  dedupeWindowMs = 1500,
}: {
  active: boolean;
  onCode: (text: string) => void;
  onError?: (err: Error) => void;
  dedupeWindowMs?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastSeen = useRef<Map<string, number>>(new Map());
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<'idle' | 'requesting' | 'running' | 'error'>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      cleanup();
      setStatus('idle');
      return;
    }

    let stopped = false;
    setStatus('requesting');

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => {/* iOS sometimes throws; we recover via canplay */});
        setStatus('running');
        loop();
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setStatus('error');
        setErrorText(e.message);
        onError?.(e);
      }
    })();

    function loop() {
      if (stopped) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w === 0 || h === 0) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas');
      }
      const canvas = canvasRef.current;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const code = jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (code && code.data) {
        const now = Date.now();
        const last = lastSeen.current.get(code.data) ?? 0;
        if (now - last > dedupeWindowMs) {
          lastSeen.current.set(code.data, now);
          onCode(code.data);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    }

    return () => { stopped = true; cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function cleanup() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    lastSeen.current.clear();
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  return (
    <div className="relative w-full max-w-sm aspect-square overflow-hidden rounded-2xl bg-black">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="w-full h-full object-cover"
      />
      {status === 'requesting' && (
        <div className="absolute inset-0 grid place-items-center text-white text-sm">Requesting camera…</div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 grid place-items-center p-4 text-white text-sm text-center">
          Camera unavailable: {errorText ?? 'unknown error'}
        </div>
      )}
    </div>
  );
}
