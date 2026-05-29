import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Page } from '../ui/Page';
import { GlassCard } from '../ui/GlassCard';
import { Avatar } from '../ui/Avatar';
import { db } from '../lib/db';
import { useSession } from '../state/session';
import { useMyProfile, useAvatarSrc } from '../lib/profile';
import { enqueue } from '../lib/sync';
import { awardPoints, EARN, CAPS } from '../lib/award';
import { uid, eventFilename, dateFolder } from '../lib/uuid';
import { textToBase64 } from '../lib/github';
import { Send, BookOpen, MessageSquare, SmilePlus } from 'lucide-react';
import type { Message, MemberId } from '../types';

const REACTIONS = ['❤️', '😂', '😮', '🔥', '👍', '🙏'];

export function Chat() {
  const session = useSession();
  const myId = session.identity!;
  const myProfile = useMyProfile();
  const myAvatar = useAvatarSrc(myId);
  const messages = useLiveQuery(() => db.messages.orderBy('sentAt').toArray()) ?? [];
  const profiles = useLiveQuery(() => db.profiles.toArray()) ?? [];
  const byId = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'message' | 'journal'>('message');
  const [reactingTo, setReactingTo] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function send() {
    if (!draft.trim()) return;
    await sendMessage(myId, draft.trim(), mode);
    setDraft('');
  }

  return (
    <Page eyebrow="Family" title="Chat" avatarSeed={myId} avatarDisplayName={myProfile?.displayName} avatarSrc={myAvatar}>
      <div className="space-y-3 pb-2">
        {messages.map((m) => {
          const mine = m.from === myId;
          const isJournal = m.kind === 'journal';
          const reactionEntries = Object.entries(m.reactions ?? {});
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[82%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                {!mine && (
                  <div className="flex items-center gap-1.5 mb-0.5 ml-1">
                    <Avatar seed={m.from} displayName={byId[m.from]?.displayName} src={undefined} size={18} />
                    <span className="text-[11px] text-ink-500">{byId[m.from]?.displayName ?? '—'}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setReactingTo(reactingTo === m.id ? null : m.id)}
                  className={`text-left px-4 py-2.5 text-[15px] leading-snug ${
                    isJournal
                      ? 'glass rounded-3xl border-l-4 border-l-sage-400'
                      : mine
                        ? 'bg-ink-900 text-white rounded-3xl rounded-br-md'
                        : 'glass text-ink-900 rounded-3xl rounded-bl-md'
                  }`}
                >
                  {isJournal && (
                    <span className="flex items-center gap-1 text-[11px] uppercase tracking-wider opacity-70 mb-1">
                      <BookOpen size={11} /> Journal
                    </span>
                  )}
                  {m.body}
                </button>

                {reactionEntries.length > 0 && (
                  <div className="flex gap-1 mt-1 mx-1">
                    {reactionEntries.map(([who, emoji]) => (
                      <span key={who} className="text-sm rounded-full bg-white/70 ring-1 ring-white/80 px-1.5 py-0.5">
                        {emoji}
                      </span>
                    ))}
                  </div>
                )}

                {reactingTo === m.id && (
                  <div className="flex gap-1 mt-1 glass rounded-full px-2 py-1.5">
                    {REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          void reactToMessage(m, myId, emoji);
                          setReactingTo(null);
                        }}
                        className="text-lg active:scale-90 transition"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {messages.length === 0 && (
          <GlassCard className="text-ink-600 text-sm text-center">Be the first to say something.</GlassCard>
        )}
        <div ref={endRef} />
      </div>

      <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 w-[min(96%,400px)] px-2">
        <div className="glass rounded-3xl px-2 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode(mode === 'message' ? 'journal' : 'message')}
              className="grid h-9 w-9 place-items-center rounded-full bg-white/70 text-ink-700 shrink-0"
              aria-label={mode === 'message' ? 'Switch to journal' : 'Switch to message'}
              title={mode === 'message' ? 'Switch to journal' : 'Switch to message'}
            >
              {mode === 'message' ? <MessageSquare size={16} /> : <BookOpen size={16} />}
            </button>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
              placeholder={mode === 'message' ? 'Message family…' : 'Write a journal entry (30+ words earns points)…'}
              className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-400 min-w-0"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!draft.trim()}
              className="grid h-10 w-10 place-items-center rounded-full bg-ink-900 text-white disabled:opacity-40 active:scale-95 transition shrink-0"
              aria-label="Send"
            >
              <Send size={16} />
            </button>
          </div>
          {mode === 'journal' && (
            <div className="px-2 pt-1.5 text-[11px] text-ink-500 flex items-center gap-1">
              <SmilePlus size={11} /> {wordCount(draft)} words {wordCount(draft) >= 30 ? '· earns points ✓' : '· need 30+ for points'}
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}

function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

async function sendMessage(from: MemberId, body: string, kind: 'message' | 'journal') {
  const now = new Date();
  const id = uid();
  const msg: Message = { id, from, sentAt: now.toISOString(), body, kind };
  await db.messages.put(msg);
  await enqueue({
    id,
    enqueuedAt: now.toISOString(),
    op: {
      kind: 'put-file',
      path: `messages/${dateFolder(now)}/${eventFilename(now, from, id, '.json')}`,
      contentBase64: textToBase64(JSON.stringify(msg)),
      commitMessage: kind === 'journal' ? 'journal entry' : 'send message',
    },
  });

  if (kind === 'journal' && wordCount(body) >= 30) {
    await awardPoints({ to: from, by: from, amount: EARN.journal, reason: 'journal', refId: id, dailyCap: CAPS.journalPerDay });
  }
}

async function reactToMessage(message: Message, by: MemberId, emoji: string) {
  const now = new Date();
  const reactions = { ...(message.reactions ?? {}) };
  const alreadyReacted = !!reactions[by];
  reactions[by] = emoji;
  const updated: Message = { ...message, reactions };
  await db.messages.put(updated);

  // Re-write the message file (reactions live on the message record).
  const day = message.sentAt.slice(0, 10);
  const sentDate = new Date(message.sentAt);
  await enqueue({
    id: `react-${message.id}-${by}`,
    enqueuedAt: now.toISOString(),
    op: {
      kind: 'put-file',
      path: `messages/${day}/${eventFilename(sentDate, message.from, message.id, '.json')}`,
      contentBase64: textToBase64(JSON.stringify(updated)),
      commitMessage: 'react to message',
    },
  });

  // Only award on first-time reaction by this person to this message,
  // and never for reacting to your own message.
  if (!alreadyReacted && message.from !== by) {
    await awardPoints({ to: by, by, amount: EARN.reaction, reason: 'reaction', refId: message.id, dailyCap: CAPS.reactionPerDay });
  }
}
