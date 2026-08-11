import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Page } from '../ui/Page';
import { GlassCard } from '../ui/GlassCard';
import { Avatar } from '../ui/Avatar';
import { AvatarStack } from '../ui/AvatarStack';
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
  tallyVotes,
  voteEmoji,
  votePercent,
  MAX_OPTIONS,
  MIN_OPTIONS,
  type Poll,
} from '../lib/poll';
import {
  encodePrediction,
  parsePrediction,
  predictionAsPoll,
  isLocked,
  outcomeEmoji,
  settledOutcome,
  myGuess,
  didWin,
  predictionPayoutId,
  encodeDuel,
  parseDuel,
  duelWinEmoji,
  duelWinner,
  isDuelAccepted,
  duelPayoutId,
  isReservedEmoji,
  DUEL_ACCEPT,
  DUEL_POINTS,
  PREDICTION_POINTS,
  type Prediction,
  type Duel,
} from '../lib/predictions';
import { completeSynthetic } from '../lib/award';
import { Send, BookOpen, MessageSquare, SmilePlus, BarChart3, Dice5, Swords } from 'lucide-react';
import type { Message, MemberId, Reaction, Profile } from '../types';

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
  const [composingPrediction, setComposingPrediction] = useState(false);
  const [composingDuel, setComposingDuel] = useState(false);
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

  usePayouts(myId, messages, reactionEvents, profiles);

  const anySheetOpen = composingPoll || composingPrediction || composingDuel;

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
          // Votes, outcome marks and duel calls all share the reaction store,
          // so they'd otherwise render as literal "vote:0" chips.
          const reactionEntries = Object.entries(standing).filter(
            ([, emoji]) => !isReservedEmoji(emoji),
          );
          const prediction = m.kind === 'poll' ? parsePrediction(m.body) : null;
          const poll = m.kind === 'poll' && !prediction ? parsePoll(m.body) : null;
          const duel = m.kind !== 'poll' ? parseDuel(m.body) : null;
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
                {prediction ? (
                  <div
                    className={`text-left px-4 py-2.5 text-[15px] leading-snug ${
                      mine
                        ? 'bg-ink-900 text-white rounded-3xl rounded-br-md'
                        : 'glass text-ink-900 rounded-3xl rounded-bl-md'
                    }`}
                  >
                    <PredictionBody
                      prediction={prediction}
                      message={m}
                      events={myEvents}
                      profiles={profiles}
                      myId={myId}
                      mine={mine}
                      onVote={(i) => void voteOnPoll(m, myId, i, standing, myEvents)}
                      onSettle={(i) =>
                        void reactToMessage(m, myId, outcomeEmoji(i), standing, myEvents)
                      }
                    />
                    <span className={`block text-[11px] mt-2 tabular ${mine ? 'text-white/60' : 'text-ink-600'}`}>
                      {clockTime(m.sentAt)}
                    </span>
                  </div>
                ) : duel ? (
                  <div
                    className={`text-left px-4 py-2.5 text-[15px] leading-snug ${
                      mine
                        ? 'bg-ink-900 text-white rounded-3xl rounded-br-md'
                        : 'glass text-ink-900 rounded-3xl rounded-bl-md'
                    }`}
                  >
                    <DuelBody
                      duel={duel}
                      message={m}
                      events={myEvents}
                      profiles={profiles}
                      byId={byId}
                      myId={myId}
                      mine={mine}
                      onAccept={() => void reactToMessage(m, myId, DUEL_ACCEPT, standing, myEvents)}
                      onCall={(winner) =>
                        void reactToMessage(m, myId, duelWinEmoji(winner), standing, myEvents)
                      }
                    />
                    <span className={`block text-[11px] mt-2 tabular ${mine ? 'text-white/60' : 'text-ink-600'}`}>
                      {clockTime(m.sentAt)}
                    </span>
                  </div>
                ) : poll ? (
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
                    {/* The reactor's face rides with the emoji. A row of bare
                        hearts tells you a message landed; these tell you who
                        with — which is the part worth knowing in a group of
                        four. */}
                    {reactionEntries.map(([who, emoji]) => (
                      <span
                        key={who}
                        className="flex items-center gap-1 text-sm rounded-full bg-white/70 ring-1 ring-white/80 pl-0.5 pr-1.5 py-0.5"
                        title={byId[who]?.displayName}
                      >
                        <Avatar seed={who} displayName={byId[who]?.displayName} size={16} alt="" />
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
            <button
              type="button"
              onClick={() => setComposingPrediction(true)}
              className="grid h-9 w-9 place-items-center rounded-full bg-white/70 text-ink-700 shrink-0"
              aria-label="New prediction"
              title="New prediction"
            >
              <Dice5 size={16} />
            </button>
            <button
              type="button"
              onClick={() => setComposingDuel(true)}
              className="grid h-9 w-9 place-items-center rounded-full bg-white/70 text-ink-700 shrink-0"
              aria-label="New duel"
              title="New duel"
            >
              <Swords size={16} />
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

      {composingPrediction && (
        <PredictionComposer
          onCancel={() => setComposingPrediction(false)}
          onCreate={(q, opts, lockISO) => {
            setComposingPrediction(false);
            void sendPrediction(myId, q, opts, lockISO);
            nearBottomRef.current = true;
          }}
        />
      )}

      {composingDuel && (
        <DuelComposer
          candidates={profiles.filter((p) => p.id !== myId)}
          onCancel={() => setComposingDuel(false)}
          onCreate={(text, target) => {
            setComposingDuel(false);
            void sendDuel(myId, text, target);
            nearBottomRef.current = true;
          }}
        />
      )}

      {/* The tab bar would otherwise sit between the composer and the
          keyboard, which reads as a stray strip of icons mid-screen — and it
          sat directly on top of every sheet's submit button, because a
          bottom-anchored sheet ends exactly where the tab bar begins. Sheets
          also render above it now; this hides it so there's nothing to layer
          against in the first place. */}
      {(composerFocused || keyboardInset > 0 || anySheetOpen) && (
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
                {/* Who voted, not just how many. A count is a statistic; four
                    faces is who you have to argue with at dinner. */}
                <span className="flex items-center gap-1.5 shrink-0">
                  <AvatarStack members={tally.votersByOption[i]} size={20} max={4} />
                  <span className="tabular text-xs opacity-80">{tally.counts[i]}</span>
                </span>
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

/**
 * Pay out settled predictions and duels — for this member only.
 *
 * Self-minting is the rule that makes this safe under gossip: every device
 * evaluates the same records and awards nobody but its own signed-in member,
 * so two phones seeing the same result can't produce two payments. The write
 * itself dedups on a deterministic id, so re-running this on every render pass
 * is inert after the first time.
 *
 * It lives on Chat because that's where the records are already loaded, and
 * because a payout you find out about by opening the chat is a payout you find
 * out about at the moment it's interesting.
 */
function usePayouts(
  myId: MemberId,
  messages: readonly Message[],
  events: readonly Reaction[],
  profiles: readonly Profile[],
) {
  useEffect(() => {
    if (profiles.length === 0) return;
    let cancelled = false;

    void (async () => {
      for (const m of messages) {
        if (cancelled) return;

        if (m.kind === 'poll' && parsePrediction(m.body)) {
          if (didWin({ message: m, events, profiles, me: myId })) {
            await completeSynthetic({
              challengeId: predictionPayoutId(m.id),
              by: myId,
              points: PREDICTION_POINTS,
              commitMessage: 'called it',
            });
          }
          continue;
        }

        const duel = parseDuel(m.body);
        if (duel && duelWinner(m, events, profiles) === myId) {
          await completeSynthetic({
            challengeId: duelPayoutId(m.id),
            by: myId,
            points: DUEL_POINTS,
            commitMessage: 'won a duel',
          });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [myId, messages, events, profiles]);
}

/**
 * A prediction bubble: vote until the lock, then wait for a judge, then find
 * out whether you called it.
 */
function PredictionBody({
  prediction, message, events, profiles, myId, mine, onVote, onSettle,
}: {
  prediction: Prediction;
  message: Message;
  events: readonly Reaction[];
  profiles: readonly Profile[];
  myId: MemberId;
  mine: boolean;
  onVote: (optionIndex: number) => void;
  onSettle: (optionIndex: number) => void;
}) {
  // Re-render on the minute so the lock closes without needing a tap.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const poll = predictionAsPoll(prediction);
  const tally = tallyVotes(message, events, poll, myId);
  const locked = isLocked(prediction, now);
  const outcome = settledOutcome(message, events, profiles);
  const iAmParent = profiles.find((p) => p.id === myId)?.role === 'parent';
  const guess = myGuess(message, events, myId);
  const won = outcome !== null && guess === outcome;

  return (
    <div className="min-w-[220px]">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider opacity-70 mb-1.5">
        <Dice5 size={11} /> Prediction
      </div>
      <div className="font-medium mb-2">{prediction.question}</div>
      <div className="space-y-1.5">
        {poll.options.map((opt, i) => {
          const picked = tally.mine === i;
          const isOutcome = outcome === i;
          const pct = votePercent(tally.counts[i], tally.total);
          return (
            <button
              key={i}
              type="button"
              disabled={locked}
              onClick={() => onVote(i)}
              aria-pressed={picked}
              className={`relative w-full overflow-hidden rounded-2xl px-3 py-2 text-left text-sm transition ${
                mine ? 'bg-white/15' : 'bg-white/60'
              } ${picked ? 'ring-1 ring-ocean' : ''} ${isOutcome ? 'ring-2 ring-sage-400' : ''} ${
                locked ? 'cursor-default' : ''
              }`}
            >
              <span
                aria-hidden
                className={`absolute inset-y-0 left-0 ${mine ? 'bg-white/20' : 'bg-sage-200/70'} transition-[width] duration-300`}
                style={{ width: `${locked || outcome !== null ? pct : 0}%` }}
              />
              <span className="relative flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {isOutcome && '✅ '}
                  {opt}
                </span>
                {/* Guesses stay secret until the lock, then everyone's face
                    appears against what they called. That reveal is the fun. */}
                {(locked || outcome !== null) && (
                  <span className="flex items-center gap-1.5 shrink-0">
                    <AvatarStack members={tally.votersByOption[i]} size={20} max={4} />
                    <span className="tabular text-xs opacity-80">{tally.counts[i]}</span>
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="text-[11px] opacity-70 mt-1.5">
        {outcome !== null
          ? won
            ? `You called it · +${PREDICTION_POINTS}`
            : guess === null
              ? 'Result is in'
              : 'Not this time'
          : locked
            ? 'Locked — waiting for the judges'
            : `Locks ${clockTime(prediction.lockISO)}${tally.mine === null ? ' · tap to guess' : ''}`}
      </div>

      {/* Only a parent can settle it, and only once it's locked — calling a
          result while people can still change their guess defeats the point. */}
      {iAmParent && locked && outcome === null && (
        <div className="mt-2 pt-2 border-t border-white/20">
          <div className="text-[11px] opacity-70 mb-1">What actually happened?</div>
          <div className="flex flex-wrap gap-1">
            {poll.options.map((opt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onSettle(i)}
                className={`text-[11px] rounded-full px-2.5 py-1 ${
                  mine ? 'bg-white/20' : 'bg-white/70 text-ink-900'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** A duel bubble: challenge, accept, and a parent's call. */
function DuelBody({
  duel, message, events, profiles, byId, myId, mine, onAccept, onCall,
}: {
  duel: Duel;
  message: Message;
  events: readonly Reaction[];
  profiles: readonly Profile[];
  byId: Record<string, Profile>;
  myId: MemberId;
  mine: boolean;
  onAccept: () => void;
  onCall: (winner: MemberId) => void;
}) {
  const accepted = isDuelAccepted(message, events, duel.target);
  const winner = duelWinner(message, events, profiles);
  const iAmParent = profiles.find((p) => p.id === myId)?.role === 'parent';
  const targetName = byId[duel.target]?.displayName ?? 'them';
  const challengerName = byId[message.from]?.displayName ?? 'someone';

  return (
    <div className="min-w-[220px]">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider opacity-70 mb-1.5">
        <Swords size={11} /> Duel
      </div>
      <div className="font-medium">{duel.text}</div>
      {/* Two faces with a VS between them. A duel that renders as a sentence
          reads like an announcement; this reads like a fixture. */}
      <div className="flex items-center justify-center gap-3 mt-2.5">
        <div className="flex flex-col items-center gap-1">
          <Avatar seed={message.from} displayName={challengerName} size={40} alt={challengerName} />
          <span className="text-[10px] opacity-70 max-w-[64px] truncate">{challengerName}</span>
        </div>
        <span className="font-display text-sm font-semibold opacity-60">VS</span>
        <div className="flex flex-col items-center gap-1">
          <Avatar seed={duel.target} displayName={targetName} size={40} alt={targetName} />
          <span className="text-[10px] opacity-70 max-w-[64px] truncate">{targetName}</span>
        </div>
      </div>

      {winner ? (
        <div className={`mt-2 rounded-2xl px-3 py-1.5 text-sm ${mine ? 'bg-white/20' : 'bg-sage-200 text-sage-700'}`}>
          🏆 {byId[winner]?.displayName ?? 'Winner'} takes it
        </div>
      ) : !accepted && myId === duel.target ? (
        <button
          type="button"
          onClick={onAccept}
          className={`mt-2 w-full rounded-full py-2 text-sm font-medium ${
            mine ? 'bg-white/20' : 'bg-ink-900 text-white'
          }`}
        >
          Accept ⚔️
        </button>
      ) : !accepted ? (
        <div className="text-[11px] opacity-70 mt-2">Waiting for {targetName} to accept…</div>
      ) : iAmParent ? (
        <div className="mt-2 pt-2 border-t border-white/20">
          <div className="text-[11px] opacity-70 mb-1">Who won?</div>
          <div className="flex flex-wrap gap-1">
            {[message.from, duel.target].map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => onCall(id)}
                className={`text-[11px] rounded-full px-2.5 py-1 ${
                  mine ? 'bg-white/20' : 'bg-white/70 text-ink-900'
                }`}
              >
                {byId[id]?.displayName ?? id.slice(0, 4)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-[11px] opacity-70 mt-2">On! Waiting on a judge to call it.</div>
      )}
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
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center" onClick={onCancel}>
      <div
        className="w-[min(100%,430px)] glass rounded-t-[28px] p-5 pb-[max(2rem,env(safe-area-inset-bottom))] space-y-3 max-h-[85dvh] overflow-y-auto scroll-clean"
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

/** Ready-made predictions, so opening a book takes one tap and not a paragraph. */
const PREDICTION_PRESETS: { q: string; options: string[] }[] = [
  { q: 'Do we see a whale today?', options: ['Yes', 'No'] },
  { q: 'Rain or shine when we get off?', options: ['Rain', 'Shine'] },
  { q: 'Who spots the first eagle?', options: ['A grown-up', 'A kid'] },
  { q: 'Do we arrive early, on time, or late?', options: ['Early', 'On time', 'Late'] },
];

/** How long a prediction stays open, offered as one-tap choices. */
const LOCK_CHOICES: { label: string; minutes: number }[] = [
  { label: '30 min', minutes: 30 },
  { label: '2 hours', minutes: 120 },
  { label: 'End of day', minutes: 8 * 60 },
];

function PredictionComposer({
  onCancel, onCreate,
}: {
  onCancel: () => void;
  onCreate: (question: string, options: string[], lockISO: string) => void;
}) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['Yes', 'No']);
  const [lockMinutes, setLockMinutes] = useState(LOCK_CHOICES[1].minutes);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const canCreate = question.trim().length > 0 && filled.length >= MIN_OPTIONS;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center" onClick={onCancel}>
      <div
        className="w-[min(100%,430px)] glass rounded-t-[28px] p-5 pb-[max(2rem,env(safe-area-inset-bottom))] space-y-3 max-h-[85dvh] overflow-y-auto scroll-clean"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-medium">🎲 New prediction</div>

        <div className="flex flex-wrap gap-1.5">
          {PREDICTION_PRESETS.map((p) => (
            <button
              key={p.q}
              type="button"
              onClick={() => { setQuestion(p.q); setOptions(p.options); }}
              className="text-[11px] rounded-full bg-white/70 ring-1 ring-white/80 px-2.5 py-1 text-ink-700"
            >
              {p.q}
            </button>
          ))}
        </div>

        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What are we calling?"
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

        <div>
          <div className="text-xs text-ink-600 mb-1.5">Guesses lock in</div>
          <div className="flex gap-1.5">
            {LOCK_CHOICES.map((c) => (
              <button
                key={c.minutes}
                type="button"
                onClick={() => setLockMinutes(c.minutes)}
                className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  lockMinutes === c.minutes ? 'bg-ink-900 text-white' : 'bg-white/70 text-ink-700'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

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
            onClick={() =>
              onCreate(
                question,
                filled,
                new Date(Date.now() + lockMinutes * 60_000).toISOString(),
              )
            }
            className="flex-1 rounded-full bg-ink-900 text-white text-sm font-medium py-2.5 disabled:opacity-40"
          >
            Open the book
          </button>
        </div>
      </div>
    </div>
  );
}

const DUEL_PRESETS = [
  'First eagle photo wins',
  'First salmon photo wins',
  'Most hunt-for items ticked today',
  'Best towel-animal recreation',
  'First to find today’s secret',
  'Longest wildlife video',
  'First to 20 points today',
  'Best pun in a photo caption',
];

function DuelComposer({
  candidates, onCancel, onCreate,
}: {
  candidates: readonly Profile[];
  onCancel: () => void;
  onCreate: (text: string, target: MemberId) => void;
}) {
  const [text, setText] = useState('');
  const [target, setTarget] = useState<MemberId | null>(candidates[0]?.id ?? null);
  const canCreate = text.trim().length > 0 && !!target;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center" onClick={onCancel}>
      <div
        className="w-[min(100%,430px)] glass rounded-t-[28px] p-5 pb-[max(2rem,env(safe-area-inset-bottom))] space-y-3 max-h-[85dvh] overflow-y-auto scroll-clean"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-medium">⚔️ Challenge someone</div>

        <div className="flex flex-wrap gap-1.5">
          {DUEL_PRESETS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setText(d)}
              className="text-[11px] rounded-full bg-white/70 ring-1 ring-white/80 px-2.5 py-1 text-ink-700"
            >
              {d}
            </button>
          ))}
        </div>

        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What's the contest?"
          className="w-full rounded-2xl bg-white/70 px-3 py-2.5 text-sm outline-none ring-1 ring-white/80 focus:ring-ocean/40"
        />

        <div>
          <div className="text-xs text-ink-600 mb-1.5">Against</div>
          <div className="flex flex-wrap gap-1.5">
            {candidates.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setTarget(p.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  target === p.id ? 'bg-ink-900 text-white' : 'bg-white/70 text-ink-700'
                }`}
              >
                {p.displayName}
              </button>
            ))}
          </div>
        </div>

        <div className="text-[11px] text-ink-500">
          A grown-up calls the winner. Winner takes +{DUEL_POINTS}.
        </div>

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
            onClick={() => target && onCreate(text, target)}
            className="flex-1 rounded-full bg-ink-900 text-white text-sm font-medium py-2.5 disabled:opacity-40"
          >
            Throw down
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

/**
 * Post a prediction. Kind stays 'poll' on purpose: a build that has never
 * heard of predictions then renders it as an ordinary poll rather than as a
 * message full of markers.
 */
async function sendPrediction(
  from: MemberId,
  question: string,
  options: string[],
  lockISO: string,
) {
  const now = new Date();
  const id = uid();
  const msg: Message = {
    id,
    from,
    sentAt: now.toISOString(),
    body: encodePrediction(question, options, lockISO),
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
      commitMessage: 'open a prediction',
    },
  });
}

/** Post a duel. A plain message, so older builds show the challenge text. */
async function sendDuel(from: MemberId, text: string, target: MemberId) {
  const now = new Date();
  const id = uid();
  const msg: Message = {
    id,
    from,
    sentAt: now.toISOString(),
    body: encodeDuel(text, target),
    kind: 'message',
  };
  await db.messages.put(msg);
  await enqueue({
    id,
    enqueuedAt: now.toISOString(),
    op: {
      kind: 'put-file',
      path: messagePath(msg),
      contentBase64: textToBase64(JSON.stringify(msg)),
      commitMessage: 'throw down a duel',
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
  // Every mechanic that rides the reaction store must be excluded here: poll
  // votes, prediction guesses and outcome marks, duel accepts and calls. A
  // four-option poll would otherwise be four taps of free points, and marking
  // who won a duel should not itself pay.
  const isMechanic = isReservedEmoji(nextEmoji);
  if (!alreadyReacted && nextEmoji !== null && !isMechanic && message.from !== by) {
    await awardPoints({ to: by, by, amount: EARN.reaction, reason: 'reaction', refId: message.id, dailyCap: CAPS.reactionPerDay });
  }
}
