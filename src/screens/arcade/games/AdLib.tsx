/**
 * The Ad-Lib Machine.
 *
 * You feed it nouns and adjectives without seeing where they land, and it
 * prints a postcard home with the trip's own places and crew names already in
 * it. The joke only works because the player is answering blind, so the
 * template is never shown until the machine runs.
 *
 * The only cabinet with no failure state. Scoring is for filling every blank
 * and for reaching the end of the reel, which is enough — a timer on a
 * writing game would be worse in every direction.
 */

import { useMemo, useRef, useState } from 'react';
import { Play, RotateCcw, Send } from 'lucide-react';
import { hueColor } from '../../../lib/arcade/catalog';
import { sfx } from '../../../lib/arcade/sound';
import { rngFromString, shuffle } from '../../../lib/arcade/rng';
import { AD_LIB_STORIES, adLibContext, renderAdLib } from '../../../lib/arcade/content';
import { useSession } from '../../../state/session';
import { db } from '../../../lib/db';
import { uid } from '../../../lib/uuid';
import { enqueue } from '../../../lib/sync';
import { textToBase64 } from '../../../lib/github';
import { messagePath } from '../../../lib/paths';
import { Board, StatusRow } from '../shared';
import type { Message } from '../../../types';
import type { GameProps } from '../shared';

type Phase = 'filling' | 'printed';

export default function AdLib({ run, content }: GameProps) {
  const color = hueColor(run.game.hue);
  const memberId = useSession((s) => s.identity);
  const rng = useMemo(() => rngFromString(`adlib-${run.nonce}`), [run.nonce]);

  const story = useMemo(() => shuffle(AD_LIB_STORIES, rng)[0], [rng]);
  const ctx = useMemo(() => adLibContext(content, rng), [content, rng]);

  const [phase, setPhase] = useState<Phase>('filling');
  const [slotIndex, setSlotIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState('');
  const [shared, setShared] = useState(false);
  const storiesRef = useRef(0);

  const slot = story.slots[slotIndex];
  const filled = Object.values(answers).filter((v) => v.trim()).length;

  const submitWord = () => {
    if (run.phase !== 'playing' || !slot) return;
    const value = draft.trim();
    if (!value) return;
    const next = { ...answers, [slot.key]: value };
    setAnswers(next);
    setDraft('');
    sfx.blip();

    if (slotIndex + 1 < story.slots.length) {
      setSlotIndex(slotIndex + 1);
    } else {
      // Filling every blank is the whole task, so that's what pays.
      run.addScore(story.slots.length * 25 + 60);
      storiesRef.current += 1;
      setPhase('printed');
      sfx.record();
    }
  };

  const text = renderAdLib(story, answers, ctx);

  /**
   * Posting the postcard into the family chat.
   *
   * Written as an ordinary journal message through the existing outbox, so it
   * syncs, gossips and shows up in the recap like anything else somebody
   * wrote. No new record type for a joke.
   */
  const share = async () => {
    if (!memberId || shared) return;
    const now = new Date();
    const message: Message = {
      id: uid(),
      from: memberId,
      sentAt: now.toISOString(),
      kind: 'journal',
      body: `📝 ${story.title}\n\n${text}`,
    };
    await db.messages.put(message);
    await enqueue({
      id: `msg-${message.id}`,
      enqueuedAt: now.toISOString(),
      op: {
        kind: 'put-file',
        path: messagePath(message),
        contentBase64: textToBase64(JSON.stringify(message)),
        commitMessage: 'arcade: ad-lib postcard',
      },
    });
    setShared(true);
    run.addScore(40);
    sfx.coin();
  };

  if (phase === 'printed') {
    return (
      <Board>
        <StatusRow left={story.title} right={`${storiesRef.current} printed`} />
        <article
          className="pop-in whitespace-pre-wrap rounded-lg border p-3 text-[12px] leading-relaxed"
          style={{ borderColor: color, color: 'var(--cab-text)' }}
        >
          {text}
        </article>

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={share}
            disabled={!memberId || shared}
            className="arcade-btn text-[10px] font-bold disabled:opacity-40"
            style={{ color: 'var(--neon-lime)' }}
          >
            <Send size={12} className="mr-1.5 inline" />
            {shared ? 'Posted to chat' : 'Post to chat +40'}
          </button>
          <button
            type="button"
            onClick={() => {
              setAnswers({});
              setSlotIndex(0);
              setDraft('');
              setShared(false);
              setPhase('filling');
              sfx.select();
            }}
            className="arcade-btn text-[10px] font-bold"
            style={{ color: 'var(--neon-gold)' }}
          >
            <RotateCcw size={12} className="mr-1.5 inline" />
            Another
          </button>
          <button
            type="button"
            onClick={() => run.end()}
            className="arcade-btn text-[10px] font-bold"
            style={{ color: 'var(--cab-dim)' }}
          >
            Finish
          </button>
        </div>
      </Board>
    );
  }

  return (
    <Board>
      <StatusRow left={story.title} right={`${filled}/${story.slots.length}`} />

      <div className="mb-3 h-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${(filled / story.slots.length) * 100}%`, background: color }}
        />
      </div>

      <p className="text-center text-[9px] uppercase tracking-[0.25em]" style={{ color: 'var(--cab-dim)' }}>
        Blank {slotIndex + 1} of {story.slots.length}
      </p>
      <h3 className="mt-2 text-center text-lg font-bold" style={{ color }}>
        {slot?.prompt}
      </h3>
      <p className="mt-1 text-center text-[10px] italic" style={{ color: 'var(--cab-dim)' }}>
        e.g. {slot?.example}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitWord();
        }}
        className="mt-5"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          maxLength={28}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          aria-label={slot?.prompt}
          className="w-full rounded-lg border bg-transparent px-3 py-2.5 text-center text-base outline-none"
          style={{ borderColor: 'var(--cab-line)', color: 'var(--cab-text)' }}
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="arcade-btn mt-3 w-full py-2.5 text-[11px] font-bold disabled:opacity-40"
          style={{ color }}
        >
          <Play size={12} className="mr-1.5 inline" />
          {slotIndex + 1 === story.slots.length ? 'Run the machine' : 'Next blank'}
        </button>
      </form>

      <p className="mt-4 text-center text-[9px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
        No peeking — you find out where the words went when the machine prints.
      </p>
    </Board>
  );
}
