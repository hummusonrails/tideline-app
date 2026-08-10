import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { db } from '../lib/db';
import { useObjectUrl } from '../lib/blobUrl';
import { todayYMD, prettyDate } from '../lib/time';
import { buildRecap, hasRecap, type RecapSlide } from '../lib/recap';
import type { Photo } from '../types';

const SLIDE_MS = 4000;

/**
 * The day, played back full-screen.
 *
 * Designed to be handed around a dinner table: big, tappable, and it advances
 * on its own so nobody has to drive it. Everything it shows is already on the
 * device, so it works with no connectivity.
 */
export function Recap() {
  const navigate = useNavigate();
  const date = todayYMD();

  const photos = useLiveQuery(() => db.photos.toArray(), []) ?? [];
  const messages = useLiveQuery(() => db.messages.toArray(), []) ?? [];
  const pointEvents = useLiveQuery(() => db.pointEvents.toArray(), []) ?? [];
  const completions = useLiveQuery(() => db.completions.toArray(), []) ?? [];
  const habits = useLiveQuery(() => db.habits.toArray(), []) ?? [];
  const profiles = useLiveQuery(() => db.profiles.toArray(), []) ?? [];

  const names = useMemo(
    () => Object.fromEntries(profiles.map((p) => [p.id, p.displayName])),
    [profiles],
  );

  const slides = useMemo(
    () => buildRecap({ date, photos, messages, pointEvents, completions, habits, names }),
    [date, photos, messages, pointEvents, completions, habits, names],
  );

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // Respect the OS setting: auto-advance is motion, and someone who has asked
  // for less of it should drive this themselves.
  const reducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    [],
  );

  useEffect(() => {
    if (paused || reducedMotion || slides.length === 0) return;
    if (index >= slides.length - 1) return;
    const t = setTimeout(() => setIndex((i) => i + 1), SLIDE_MS);
    return () => clearTimeout(t);
  }, [index, paused, reducedMotion, slides.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate('/today');
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(slides.length - 1, i + 1));
      if (e.key === ' ') { e.preventDefault(); setPaused((p) => !p); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, slides.length]);

  if (!hasRecap(slides)) {
    return (
      <div className="min-h-dvh grid place-items-center bg-ink-900 text-white p-8 text-center">
        <div>
          <div className="text-lg font-medium">Nothing to recap yet</div>
          <div className="text-sm text-white/70 mt-1">
            Post a photo or a journal entry and check back tonight.
          </div>
          <button
            type="button"
            onClick={() => navigate('/today')}
            className="mt-6 rounded-full bg-white/15 px-5 py-2.5 text-sm font-medium"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  const slide = slides[Math.min(index, slides.length - 1)];

  return (
    <div className="fixed inset-0 z-50 bg-ink-900 text-white select-none">
      {/* Progress ticks */}
      <div className="absolute top-[max(env(safe-area-inset-top),0.75rem)] left-3 right-3 z-20 flex gap-1">
        {slides.map((_, i) => (
          <span
            key={i}
            className={`h-0.5 flex-1 rounded-full ${i <= index ? 'bg-white' : 'bg-white/25'}`}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => navigate('/today')}
        aria-label="Close recap"
        className="absolute top-[max(env(safe-area-inset-top),1.75rem)] right-3 z-20 grid h-10 w-10 place-items-center rounded-full bg-white/10"
      >
        <X size={18} />
      </button>

      <SlideView slide={slide} date={date} />

      {/* Tap zones, so the whole screen is the control on a phone. */}
      <button
        type="button"
        aria-label="Previous"
        onClick={() => setIndex((i) => Math.max(0, i - 1))}
        className="absolute inset-y-0 left-0 w-1/3 z-10"
      />
      <button
        type="button"
        aria-label="Next"
        onClick={() =>
          index >= slides.length - 1 ? navigate('/today') : setIndex((i) => i + 1)
        }
        className="absolute inset-y-0 right-0 w-1/3 z-10"
      />

      <div className="absolute bottom-[max(env(safe-area-inset-bottom),1rem)] inset-x-0 z-20 flex items-center justify-center gap-4">
        <button
          type="button"
          aria-label="Previous slide"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          aria-label={paused ? 'Play' : 'Pause'}
          onClick={() => setPaused((p) => !p)}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10"
        >
          {paused || reducedMotion ? <Play size={18} /> : <Pause size={18} />}
        </button>
        <button
          type="button"
          aria-label="Next slide"
          onClick={() => setIndex((i) => Math.min(slides.length - 1, i + 1))}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

function SlideView({ slide, date }: { slide: RecapSlide; date: string }) {
  if (slide.kind === 'photo') {
    return <PhotoSlide photo={slide.photo} author={slide.author} />;
  }

  if (slide.kind === 'journal') {
    return (
      <div className="absolute inset-0 grid place-items-center p-10 text-center">
        <div>
          <div className="text-[17px] leading-relaxed">“{slide.body}”</div>
          <div className="text-sm text-white/60 mt-4">— {slide.author}</div>
        </div>
      </div>
    );
  }

  if (slide.kind === 'end') {
    return (
      <div className="absolute inset-0 grid place-items-center p-10 text-center">
        <div>
          <div className="font-display text-3xl font-semibold">{slide.headline}</div>
          <div className="text-sm text-white/60 mt-2">{prettyDate(date)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 grid place-items-center p-10 text-center">
      <div>
        <div className="font-display text-4xl font-semibold">{slide.headline}</div>
        {slide.detail && <div className="text-white/70 mt-2">{slide.detail}</div>}
      </div>
    </div>
  );
}

function PhotoSlide({ photo, author }: { photo: Photo; author: string }) {
  const blob = useLiveQuery(() => db.photoBlobs.get(photo.id), [photo.id]);
  const url = useObjectUrl(blob?.bytes);
  return (
    <div className="absolute inset-0">
      {url ? (
        <img src={url} alt={photo.caption ?? ''} className="h-full w-full object-contain" />
      ) : (
        <div className="h-full w-full grid place-items-center text-white/50 text-sm">
          Photo still syncing…
        </div>
      )}
      <div className="absolute bottom-20 left-6 right-6 text-center">
        {photo.caption && <div className="text-base drop-shadow">{photo.caption}</div>}
        <div className="text-xs text-white/60 mt-1">{author}</div>
      </div>
    </div>
  );
}
