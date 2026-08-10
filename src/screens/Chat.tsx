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
import { uid } from '../lib/uuid';
import { messagePath, reactionPath } from '../lib/paths';
import { textToBase64 } from '../lib/github';
import {
  effectiveReactions,
  hasEverReacted,
  nextEmojiFor,
  type EffectiveReactions,
} from '../lib/reactions';
import { deliveryLabel, deliveryState } from '../lib/delivery';
import { useNetState } from '../lib/net';
import { getPeerManager, type PeerSummary } from '../lib/p2p/manager';
import { useVisualViewportInset } from '../lib/viewport';
import { prettyDate } from '../lib/time';
import {
  encodePoll,
  parsePoll,
  parseVote,
  tallyVotes,
  voteEmoji,
  votePercent,
  MAX_OPTIONS,
  MIN_OPTIONS,
  type Poll,
} from '../lib/poll';
import { Send, BookOpen, MessageSquare, SmilePlus, BarChart3 } from 'lucide-react';
import type { Message, MemberId, Reaction } from '../types';

const REACTIONS = ['❤️', '😂', '😮', '🔥', '👍', '🙏'];

export function Chat() {
  const session = useSession();
  const myId = session.identity!;
  const myProfile = useMyProfile();
  const myAvatar = useAvatarSrc(myId);
  const messages = useLiveQuery(() => db.messages.orderBy('sentAt').toArray()) ?? [];
  const reactionEvents = useLiveQuery(() => db.reactions.toArray()) ?? [];
  const profiles = useLiveQuery(() => db.profiles.toArray()) ?? [];
  const byId = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);
  // Bucket by message once per change instead of rescanning the whole event
  // table inside each bubble's render.
  const reactionsByMessage = useMemo(() => {
    const out = new Map<string, Reaction[]>();
    for (const e of reactionEvents) {
      const list = out.get(e.messageId);
      if (list) list.push(e);
      else out.set(e.messageId, [e]);
    }
    return out;
  }, [reactionEvents]);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'message' | 'journal'>('message');
  const [reactingTo, setReactingTo] = useState<string | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const [composingPoll, setComposingPoll] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const firstScrollRef = useRef(true);
  const keyboardInset = useVisualViewportInset();

  // Delivery inputs.
  const outbox = useLiveQuery(() => db.outbox.toArray()) ?? [];
  const deliveries = useLiveQuery(() => db.deliveries.toArray()) ?? [];
  const netState = useNetState((s) => s.state);
  const [summaries, setSummaries] = useState<PeerSummary[]>([]);
  useEffect(() => getPeerManager().subscribe(setSummaries), []);

  const queuedIds = useMemo(() => new Set(outbox.map((o) => o.id)), [outbox]);
  const deliveryCounts = useMemo(() => {
    const out = new Map<string, number>();
    for (const d of deliveries) out.set(d.messageId, (out.get(d.messageId) ?? 0) + 1);
    return out;
  }, [deliveries]);
  const seenIds = useMemo(() => {
    const out = new Set<string>();
    for (const s of summaries) for (const id of s.seenIds) out.add(id);
    return out;
  }, [summaries]);

  const lastOwnId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].from === myId) return messages[i].id;
    }
    return null;
  }, [messages, myId]);

  /**
   * Only follow new messages when the reader is already at the bottom.
   * Yanking someone out of the history they're scrolled back through is worse
   * than making them tap to catch up.
   */
  useEffect(() => {
    if (firstScrollRef.current) {
      firstScrollRef.current = false;
      endRef.current?.scrollIntoView({ behavior: 'auto' });
      return;
    }
    if (nearBottomRef.current) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  useEffect(() => {
    const el = endRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => { nearBottomRef.current = entry.isIntersecting; },
      { rootMargin: '0px 0px 160px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Tell peers what's on screen, but only while the app is actually in front.
  const incomingIds = useMemo(
    () => messages.filter((m) => m.from !== myId).map((m) => m.id),
    [messages, myId],
  );
  useEffect(() => {
    // An empty list is a real message: it tells peers we've looked away, so
    // their "Seen" marker clears instead of sticking for the session.
    const report = () => {
      getPeerManager().reportSeen(document.hidden ? [] : incomingIds);
    };
    report();
    document.addEventListener('visibilitychange', report);
    return () => {
      document.removeEventListener('visibilitychange', report);
      getPeerManager().reportSeen([]);
    };
  }, [incomingIds]);

  async function send() {
    if (!draft.trim()) return;
    await sendMessage(myId, draft.trim(), mode);
    setDraft('');
    nearBottomRef.current = true;
  }

  return (
    <Page eyebrow="Family" title="Chat" avatarSeed={myId} avatarDisplayName={myProfile?.displayName} avatarSrc={myAvatar}>
      {/* Bottom padding clears the fixed composer, which would otherwise sit
          on top of the newest message. */}
      <div className="space-y-3 pb-32">
        {messages.map((m, i) => {
          const mine = m.from === myId;
          const isJournal = m.kind === 'journal';
          const myEvents = reactionsByMessage.get(m.id) ?? [];
          const standing = effectiveReactions(m, myEvents);
          // Votes share the reaction store, so they'd otherwise render as
          // literal "vote:0" chips under every poll.
          const reactionEntries = Object.entries(standing).filter(
            ([, emoji]) => parseVote(emoji) === null,
          );
          const poll = m.kind === 'poll' ? parsePoll(m.body) : null;
          const prev = i > 0 ? messages[i - 1] : null;
          const newDay = !prev || ymd(prev.sentAt) !== ymd(m.sentAt);
          return (
            <div key={m.id}>
            {newDay && (
              <div className="flex justify-center py-1">
                <span className="text-[11px] text-ink-600 bg-white/60 rounded-full px-3 py-0.5">
                  {prettyDate(ymd(m.sentAt))}
                </span>
              </div>
            )}
            <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[82%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                {!mine && (
                  <div className="flex items-center gap-1.5 mb-0.5 ml-1">
                    <Avatar seed={m.from} displayName={byId[m.from]?.displayName} src={undefined} size={18} />
                    <span className="text-[11px] text-ink-500">{byId[m.from]?.displayName ?? '—'}</span>
                  </div>
                )}
                {/* A poll bubble contains its own vote buttons, so it can't
                    itself be a button — nested buttons are invalid and break
                    tap handling. The accepted trade-off: polls take votes but
                    not emoji reactions. */}
                {poll ? (
                  <div
                    className={`text-left px-4 py-2.5 text-[15px] leading-snug ${
                      mine
                        ? 'bg-ink-900 text-white rounded-3xl rounded-br-md'
                        : 'glass text-ink-900 rounded-3xl rounded-bl-md'
                    }`}
                  >
                    <PollBody
                      poll={poll}
                      message={m}
                      events={myEvents}
                      myId={myId}
                      mine={mine}
                      onVote={(i) => void voteOnPoll(m, myId, i, standing, myEvents)}
                    />
                    <span className={`block text-[11px] mt-2 tabular ${mine ? 'text-white/60' : 'text-ink-600'}`}>
                      {clockTime(m.sentAt)}
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setReactingTo(reactingTo === m.id ? null : m.id)}
                    aria-expanded={reactingTo === m.id}
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
                    <span
                      className={`block text-[11px] mt-1 tabular ${
                        mine && !isJournal ? 'text-white/60' : 'text-ink-600'
                      }`}
                    >
                      {clockTime(m.sentAt)}
                    </span>
                  </button>
                )}

                {m.id === lastOwnId && (
                  <span className="text-[11px] text-ink-600 mt-0.5 mr-1">
                    {(() => {
                      const deliveredTo = deliveryCounts.get(m.id) ?? 0;
                      return deliveryLabel(
                        deliveryState({
                          queued: queuedIds.has(m.id),
                          online: netState === 'internet',
                          deliveredTo,
                          seenByAnyone: seenIds.has(m.id),
                        }),
                        deliveredTo,
                      );
                    })()}
                  </span>
                )}

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
                          void reactToMessage(m, myId, emoji, standing, myEvents);
                          setReactingTo(null);
                        }}
                        aria-pressed={standing[myId] === emoji}
                        className={`text-lg active:scale-90 transition ${
                          standing[myId] === emoji ? 'scale-110' : ''
                        }`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            </div>
          );
        })}
        {messages.length === 0 && (
          <GlassCard className="text-ink-600 text-sm text-center">Be the first to say something.</GlassCard>
        )}
        <div ref={endRef} />
      </div>

      {/* While the keyboard is up we sit directly on top of it; otherwise we
          sit above the tab bar. `bottom` is driven by the visual viewport
          because iOS never shrinks the layout viewport for the keyboard. */}
      <div
        className="fixed left-1/2 -translate-x-1/2 z-30 w-[min(96%,400px)] px-2"
        style={{
          bottom: keyboardInset > 0
            ? `${keyboardInset + 8}px`
            : 'calc(6rem + env(safe-area-inset-bottom))',
        }}
      >
        <div className="glass rounded-3xl px-2 py-2">
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => setMode(mode === 'message' ? 'journal' : 'message')}
              className="grid h-9 w-9 place-items-center rounded-full bg-white/70 text-ink-700 shrink-0"
              aria-label={mode === 'message' ? 'Switch to journal' : 'Switch to message'}
              title={mode === 'message' ? 'Switch to journal' : 'Switch to message'}
            >
              {mode === 'message' ? <MessageSquare size={16} /> : <BookOpen size={16} />}
            </button>
            <button
              type="button"
              onClick={() => setComposingPoll(true)}
              className="grid h-9 w-9 place-items-center rounded-full bg-white/70 text-ink-700 shrink-0"
              aria-label="New poll"
              title="New poll"
            >
              <BarChart3 size={16} />
            </button>
            {/* A textarea, not an input: journal entries need 30+ words to
                score, which is more than one line of typing. */}
            <textarea
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={() => setComposerFocused(true)}
              onBlur={() => setComposerFocused(false)}
              onKeyDown={(e) => {
                // Enter sends a chat message; journal entries want newlines,
                // so those send from the button only.
                if (e.key === 'Enter' && !e.shiftKey && mode === 'message') {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={mode === 'message' ? 'Message family…' : 'Write a journal entry (30+ words earns points)…'}
              className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-400 min-w-0 resize-none max-h-24 py-1.5 leading-snug"
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
            <div className="px-2 pt-1.5 text-[11px] text-ink-600 flex items-center gap-1">
              <SmilePlus size={11} /> {wordCount(draft)} words {wordCount(draft) >= 30 ? '· earns points ✓' : '· need 30+ for points'}
            </div>
          )}
        </div>
      </div>

      {composingPoll && (
        <PollComposer
          onCancel={() => setComposingPoll(false)}
          onCreate={(q, opts) => {
            setComposingPoll(false);
            void sendPoll(myId, q, opts);
            nearBottomRef.current = true;
          }}
        />
      )}

      {/* The tab bar would otherwise sit between the composer and the
          keyboard, which reads as a stray strip of icons mid-screen. */}
      {(composerFocused || keyboardInset > 0) && (
        <style>{'nav[aria-label="Primary"]{display:none}'}</style>
      )}
    </Page>
  );
}

function PollBody({
  poll, message, events, myId, mine, onVote,
}: {
  poll: Poll;
  message: Message;
  events: readonly Reaction[];
  myId: MemberId;
  mine: boolean;
  onVote: (optionIndex: number) => void;
}) {
  const tally = tallyVotes(message, events, poll, myId);
  return (
    <div className="min-w-[200px]">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider opacity-70 mb-1.5">
        <BarChart3 size={11} /> Poll
      </div>
      <div className="font-medium mb-2">{poll.question}</div>
      <div className="space-y-1.5">
        {poll.options.map((opt, i) => {
          const picked = tally.mine === i;
          const pct = votePercent(tally.counts[i], tally.total);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onVote(i)}
              aria-pressed={picked}
              className={`relative w-full overflow-hidden rounded-2xl px-3 py-2 text-left text-sm transition ${
                mine ? 'bg-white/15' : 'bg-white/60'
              } ${picked ? 'ring-1 ring-ocean' : ''}`}
            >
              {/* Result bar sits behind the label rather than beside it, so
                  the option stays readable at any vote share. */}
              <span
                aria-hidden
                className={`absolute inset-y-0 left-0 ${mine ? 'bg-white/20' : 'bg-sage-200/70'} transition-[width] duration-300`}
                style={{ width: `${pct}%` }}
              />
              <span className="relative flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{opt}</span>
                <span className="tabular text-xs opacity-80 shrink-0">{tally.counts[i]}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="text-[11px] opacity-70 mt-1.5">
        {tally.total === 0
          ? 'No votes yet'
          : `${tally.total} vote${tally.total === 1 ? '' : 's'}${tally.mine === null ? ' · tap to vote' : ''}`}
      </div>
    </div>
  );
}

/** Compose a poll: a question plus two to four options. */
function PollComposer({
  onCancel, onCreate,
}: {
  onCancel: () => void;
  onCreate: (question: string, options: string[]) => void;
}) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const canCreate = question.trim().length > 0 && filled.length >= MIN_OPTIONS;

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-end justify-center" onClick={onCancel}>
      <div
        className="w-[min(100%,430px)] glass rounded-t-[28px] p-5 pb-8 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-medium">New poll</div>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What should we do tonight?"
          className="w-full rounded-2xl bg-white/70 px-3 py-2.5 text-sm outline-none ring-1 ring-white/80 focus:ring-ocean/40"
        />
        {options.map((opt, i) => (
          <input
            key={i}
            value={opt}
            onChange={(e) => setOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))}
            placeholder={`Option ${i + 1}`}
            className="w-full rounded-2xl bg-white/70 px-3 py-2 text-sm outline-none ring-1 ring-white/80 focus:ring-ocean/40"
          />
        ))}
        {options.length < MAX_OPTIONS && (
          <button
            type="button"
            onClick={() => setOptions((prev) => [...prev, ''])}
            className="text-xs text-ocean font-semibold"
          >
            + Add option
          </button>
        )}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-full bg-white/70 text-ink-700 text-sm font-medium py-2.5"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => onCreate(question, filled)}
            className="flex-1 rounded-full bg-ink-900 text-white text-sm font-medium py-2.5 disabled:opacity-40"
          >
            Post poll
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Cast or change a vote.
 *
 * Reuses the reaction write path exactly — a vote is a reaction whose emoji
 * encodes an option index — so it converges the same way across every
 * transport with no extra plumbing.
 */
async function voteOnPoll(
  message: Message,
  by: MemberId,
  optionIndex: number,
  standing: EffectiveReactions,
  priorEvents: readonly Reaction[],
) {
  await reactToMessage(message, by, voteEmoji(optionIndex), standing, priorEvents);
}

/** Local calendar day of an ISO timestamp — for grouping, not display. */
function ymd(iso: string): string {
  const d = new Date(iso);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

/** Post a poll. It's a message with an encoded body — see lib/poll.ts. */
async function sendPoll(from: MemberId, question: string, options: string[]) {
  const now = new Date();
  const id = uid();
  const msg: Message = {
    id,
    from,
    sentAt: now.toISOString(),
    body: encodePoll(question, options),
    kind: 'poll',
  };
  await db.messages.put(msg);
  await enqueue({
    id,
    enqueuedAt: now.toISOString(),
    op: {
      kind: 'put-file',
      path: messagePath(msg),
      contentBase64: textToBase64(JSON.stringify(msg)),
      commitMessage: 'post poll',
    },
  });
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
      path: messagePath(msg),
      contentBase64: textToBase64(JSON.stringify(msg)),
      commitMessage: kind === 'journal' ? 'journal entry' : 'send message',
    },
  });

  if (kind === 'journal' && wordCount(body) >= 30) {
    await awardPoints({ to: from, by: from, amount: EARN.journal, reason: 'journal', refId: id, dailyCap: CAPS.journalPerDay });
  }
}

/**
 * Record a reaction as its own event.
 *
 * Deliberately does not touch the message record. Mutating the message made
 * reactions invisible to every peer that already had it (gossip dedupes by id)
 * and made two people reacting to the same message clobber each other on the
 * backend. See {@link Reaction}.
 */
async function reactToMessage(
  message: Message,
  by: MemberId,
  emoji: string,
  standing: EffectiveReactions,
  priorEvents: readonly Reaction[],
) {
  const now = new Date();
  const nextEmoji = nextEmojiFor(standing, by, emoji);
  const alreadyReacted = hasEverReacted(message, priorEvents, by);

  const reaction: Reaction = {
    id: uid(),
    messageId: message.id,
    by,
    emoji: nextEmoji,
    at: now.toISOString(),
  };
  await db.reactions.put(reaction);
  await enqueue({
    id: `reaction-${reaction.id}`,
    enqueuedAt: now.toISOString(),
    op: {
      kind: 'put-file',
      path: reactionPath(reaction),
      contentBase64: textToBase64(JSON.stringify(reaction)),
      commitMessage: nextEmoji === null ? 'remove reaction' : 'react to message',
    },
  });

  // First-ever reaction to this message only, and never to your own — so
  // retracting and re-adding can't be farmed for points.
  //
  // Poll votes ride this same path but must never pay out: a poll with four
  // options would otherwise be four taps of free points, and voting should be
  // about the decision, not the score.
  const isVote = parseVote(nextEmoji) !== null;
  if (!alreadyReacted && nextEmoji !== null && !isVote && message.from !== by) {
    await awardPoints({ to: by, by, amount: EARN.reaction, reason: 'reaction', refId: message.id, dailyCap: CAPS.reactionPerDay });
  }
}
