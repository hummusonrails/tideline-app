/**
 * Family Quiz.
 *
 * Ten questions generated from the trip itself: authored place trivia, "which
 * day is that on", and — the ones that make people put their drinks down —
 * questions about the crew, computed from what everyone has actually done in
 * the app. See `lib/arcade/content.ts` for how they're built and why a tied
 * answer is never asked.
 *
 * Scored on speed as well as accuracy, because a quiz where thinking for
 * forty seconds costs nothing isn't a game, it's a form.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { hueColor } from '../../../lib/arcade/catalog';
import { sfx } from '../../../lib/arcade/sound';
import { rngFromString, shuffle } from '../../../lib/arcade/rng';
import { Board, StatusRow } from '../shared';
import type { QuizQuestion, QuizSource } from '../../../lib/arcade/content';
import type { GameProps } from '../shared';

const QUESTIONS = 10;
const SECONDS_PER_Q = 15;

const SOURCE_LABEL: Record<QuizSource, string> = {
  place: 'Place',
  trip: 'Itinerary',
  crew: 'Crew',
  general: 'General',
};

export default function FamilyQuiz({ run, content }: GameProps) {
  const color = hueColor(run.game.hue);
  const questions = useMemo(() => pickQuestions(content.quiz, run.nonce), [content.quiz, run.nonce]);
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [timeLeft, setTimeLeft] = useState(SECONDS_PER_Q);
  const answeredRef = useRef(false);

  const question = questions[index];

  // Per-question timer. Restarting on `index` is what makes each question its
  // own clock rather than one long round timer.
  useEffect(() => {
    if (run.phase !== 'playing' || !question) return;
    answeredRef.current = false;
    setChosen(null);
    setTimeLeft(SECONDS_PER_Q);
    run.setStatus(`Q${index + 1}/${questions.length}`);

    const id = window.setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          window.clearInterval(id);
          if (!answeredRef.current) answer(-1);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, run.phase, question?.id]);

  function answer(option: number) {
    if (answeredRef.current || !question) return;
    answeredRef.current = true;
    setChosen(option);

    const right = option === question.answer;
    if (right) {
      // Speed bonus plus a streak bonus: knowing it fast and knowing several
      // in a row are both worth more than knowing one eventually.
      const gained = 60 + timeLeft * 6 + Math.min(80, streak * 20);
      run.addScore(gained);
      setCorrectCount((c) => c + 1);
      setStreak((s) => s + 1);
      sfx.right();
    } else {
      setStreak(0);
      sfx.wrong();
    }

    window.setTimeout(() => {
      if (index + 1 >= questions.length) {
        run.end();
      } else {
        setIndex((i) => i + 1);
      }
    }, 1800);
  }

  if (!question) {
    return (
      <Board>
        <p className="py-16 text-center text-[11px]" style={{ color: 'var(--cab-dim)' }}>
          No questions available yet.
        </p>
      </Board>
    );
  }

  return (
    <Board>
      <StatusRow
        left={`${correctCount}/${questions.length} right${streak > 1 ? ` · ${streak} streak` : ''}`}
        right={`${timeLeft}s`}
      />

      {/* Timer bar — a number alone doesn't create urgency. */}
      <div className="mb-3 h-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }}>
        <div
          className="h-full rounded-full transition-[width] duration-1000 ease-linear"
          style={{
            width: `${(timeLeft / SECONDS_PER_Q) * 100}%`,
            background: timeLeft <= 4 ? 'var(--neon-red)' : color,
          }}
        />
      </div>

      <div className="mb-1 text-[9px] uppercase tracking-[0.25em]" style={{ color: 'var(--neon-gold)' }}>
        {SOURCE_LABEL[question.source]}
      </div>
      <h3 className="mb-4 text-sm font-bold leading-snug">{question.q}</h3>

      <ul className="space-y-2">
        {question.options.map((option, i) => {
          const isAnswer = i === question.answer;
          const isChosen = i === chosen;
          const revealed = chosen !== null;
          return (
            <li key={i}>
              <button
                type="button"
                disabled={revealed}
                onClick={() => answer(i)}
                className="w-full rounded-lg border px-3 py-2.5 text-left text-[12px] leading-snug transition"
                style={{
                  borderColor: revealed
                    ? isAnswer
                      ? 'var(--neon-lime)'
                      : isChosen
                      ? 'var(--neon-red)'
                      : 'var(--cab-line)'
                    : 'var(--cab-line)',
                  background: revealed && isAnswer ? 'rgba(124,255,77,0.12)' : 'rgba(255,255,255,0.04)',
                  color: revealed && !isAnswer && !isChosen ? 'var(--cab-dim)' : 'var(--cab-text)',
                }}
              >
                <span className="mr-2 font-bold" style={{ color }}>
                  {String.fromCharCode(65 + i)}
                </span>
                {option}
              </button>
            </li>
          );
        })}
      </ul>

      {chosen !== null && question.note && (
        <p className="pop-in mt-3 rounded-lg border px-3 py-2 text-[10px] leading-relaxed"
           style={{ borderColor: 'var(--cab-line)', color: 'var(--cab-dim)' }}>
          {question.note}
        </p>
      )}
      {chosen === -1 && (
        <p className="mt-2 text-center text-[10px]" style={{ color: 'var(--neon-red)' }}>
          Out of time.
        </p>
      )}
    </Board>
  );
}

/**
 * Ten questions, weighted towards the trip.
 *
 * Trip-specific questions are drawn first and generic ones only fill the gap,
 * so a synced device asks about the holiday and an unsynced one still gets a
 * full quiz.
 */
function pickQuestions(pool: readonly QuizQuestion[], nonce: number): QuizQuestion[] {
  const rng = rngFromString(`quiz-${nonce}`);
  const specific = shuffle(pool.filter((q) => q.source !== 'general'), rng);
  const generic = shuffle(pool.filter((q) => q.source === 'general'), rng);
  const chosen = [...specific.slice(0, QUESTIONS)];
  for (const q of generic) {
    if (chosen.length >= QUESTIONS) break;
    chosen.push(q);
  }
  return shuffle(chosen, rng);
}
