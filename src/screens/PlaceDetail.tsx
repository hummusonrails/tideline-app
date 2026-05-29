import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Check, X, Sparkles } from 'lucide-react';
import { db } from '../lib/db';
import { useSession } from '../state/session';
import { useMyProfile } from '../lib/profile';
import { usePlaceImage } from '../lib/places';
import { GlassCard } from '../ui/GlassCard';
import { PillButton } from '../ui/PillButton';
import type { Trivia } from '../types';

export function PlaceDetail() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const myProfile = useMyProfile();
  const place = useLiveQuery(() => (slug ? db.places.get(slug) : undefined), [slug]);
  const heroUrl = usePlaceImage(slug);

  if (!slug) return null;
  if (place === undefined) {
    return (
      <div className="min-h-dvh grid place-items-center text-ink-600">Loading…</div>
    );
  }
  if (place === null) {
    return (
      <div className="min-h-dvh grid place-items-center p-6 text-ink-600 text-center">
        Place not found.
      </div>
    );
  }

  const myNote =
    place.kidsCorner && session.identity ? place.kidsCorner[session.identity] : undefined;

  return (
    <div className="min-h-dvh pb-28">
      {/* Hero with back button overlay */}
      <div className="relative h-[420px] -mt-[max(env(safe-area-inset-top),0px)]">
        {heroUrl ? (
          <img src={heroUrl} alt={place.name} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-sage-300 to-sage-700" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-black/30" />
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="absolute top-[max(env(safe-area-inset-top),1rem)] left-4 grid h-10 w-10 place-items-center rounded-full glass text-ink-900"
          aria-label="Back"
        >
          <ChevronLeft size={20} strokeWidth={1.75} />
        </button>
        <div className="absolute left-5 right-5 bottom-6">
          <div className="inline-flex items-center gap-1.5 glass rounded-full px-3 py-1 text-xs font-medium text-ink-900 mb-3">
            📍 {place.name}
          </div>
          <h1 className="font-display text-[34px] leading-[1.05] font-semibold tracking-tight text-white drop-shadow-lg">
            {place.name}
          </h1>
          {place.subtitle && (
            <p className="mt-2 text-white/90 text-sm leading-snug">{place.subtitle}</p>
          )}
        </div>
        {place.heroCredit && place.heroCredit !== 'TBD' && (
          <div className="absolute bottom-1 right-2 text-[10px] text-white/60">{place.heroCredit}</div>
        )}
      </div>

      <div className="px-4 -mt-5 space-y-5">
        {/* Intro */}
        <GlassCard>
          <p className="text-[15px] leading-relaxed text-ink-900">{place.intro}</p>
        </GlassCard>

        {/* Did you know */}
        {place.didYouKnow.length > 0 && (
          <section>
            <SectionHeader>Did you know</SectionHeader>
            <div className="space-y-3">
              {place.didYouKnow.map((f, i) => (
                <GlassCard key={i} className="flex gap-3">
                  <div className="text-2xl shrink-0">{f.icon}</div>
                  <div className="text-[14px] leading-relaxed text-ink-900">{f.fact}</div>
                </GlassCard>
              ))}
            </div>
          </section>
        )}

        {/* Hunt for */}
        {place.huntFor.length > 0 && (
          <section>
            <SectionHeader>Hunt for</SectionHeader>
            <GlassCard>
              <ul className="space-y-2">
                {place.huntFor.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 text-[14px]">
                    <Sparkles size={14} className="mt-1 text-sage-700 shrink-0" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </GlassCard>
          </section>
        )}

        {/* Trivia */}
        {place.trivia.length > 0 && (
          <section>
            <SectionHeader>Trivia</SectionHeader>
            <div className="space-y-3">
              {place.trivia.map((q, i) => (
                <TriviaCard key={i} q={q} />
              ))}
            </div>
          </section>
        )}

        {/* Kids corner — personalized */}
        {myNote && (
          <section>
            <SectionHeader>For you{myProfile?.displayName ? `, ${myProfile.displayName}` : ''}</SectionHeader>
            <GlassCard className="bg-gradient-to-br from-white/60 to-sage-100/60">
              <p className="text-[14px] leading-relaxed text-ink-900">{myNote}</p>
            </GlassCard>
          </section>
        )}

        {/* Tags */}
        {place.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {place.tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-white/60 ring-1 ring-white/80 px-3 py-1 text-xs text-ink-700"
              >
                #{t}
              </span>
            ))}
          </div>
        )}

        <div className="pt-2">
          <PillButton onClick={() => navigate(-1)}>Back</PillButton>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs uppercase tracking-wider text-ink-400 mb-2 px-1 font-medium">
      {children}
    </div>
  );
}

function TriviaCard({ q }: { q: Trivia }) {
  const [picked, setPicked] = useState<number | null>(null);
  const revealed = picked !== null;

  return (
    <GlassCard>
      <div className="font-medium mb-3">{q.q}</div>
      <div className="space-y-2">
        {q.options.map((opt, i) => {
          const isCorrect = i === q.answer;
          const isPicked = picked === i;
          const cls = !revealed
            ? 'glass text-ink-900 hover:bg-white/70'
            : isCorrect
            ? 'bg-sage-200 text-sage-700 ring-1 ring-sage-300'
            : isPicked
            ? 'bg-coral/15 text-coral ring-1 ring-coral/30'
            : 'bg-white/40 text-ink-600';
          return (
            <button
              key={i}
              type="button"
              onClick={() => !revealed && setPicked(i)}
              disabled={revealed}
              className={`w-full text-left text-sm rounded-2xl px-4 py-2.5 flex items-center justify-between transition ${cls}`}
            >
              <span>{opt}</span>
              {revealed && isCorrect && <Check size={16} />}
              {revealed && isPicked && !isCorrect && <X size={16} />}
            </button>
          );
        })}
      </div>
      <AnimatePresence>
        {revealed && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 text-[13px] text-ink-600"
          >
            {q.explanation}
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}
