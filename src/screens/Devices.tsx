import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Page } from '../ui/Page';
import { GlassCard } from '../ui/GlassCard';
import { PillButton } from '../ui/PillButton';
import { QrFrames } from '../ui/QrFrames';
import { QrScanner } from '../ui/QrScanner';
import { useSession } from '../state/session';
import { useMyProfile, useAvatarSrc } from '../lib/profile';
import { db } from '../lib/db';
import { getOrCreateIdentity, type PeerIdentity } from '../lib/p2p/identity';
import { InitiatorSession, ResponderSession, type HandshakeHello } from '../lib/p2p/session';
import { FaceToFaceSession, type F2FState } from '../lib/p2p/faceToFace';
import { getPeerManager, CLOCK_SKEW_WARN_MS, type PeerSummary } from '../lib/p2p/manager';
import { FrameReassembler } from '../lib/p2p/qr';
import {
  absorbBulkEnvelope,
  decodeBulkEnvelope,
  exportBulkFrames,
  type BulkEnvelope,
} from '../lib/p2p/bulkQr';
import {
  absorbBundle,
  exportBundle,
  parseBundle,
  totalRecords,
  type BundleCounts,
  type ParsedBundle,
} from '../lib/p2p/fileBundle';
import { blobToBytes } from '../lib/blobBytes';
import type { Collection } from '../lib/p2p/protocol';
import {
  Smartphone, Trash2, X, ScanLine, QrCode, Wifi, Share2, FolderInput,
  ChevronDown, Users, AlertTriangle,
} from 'lucide-react';

/** How far back each "days" option reaches for QR / file transfer. */
const DAY_OPTIONS = [1, 3, 7, 0] as const; // 0 = everything

type Mode =
  | { name: 'home' }
  | { name: 'face-to-face' }
  | { name: 'airdrop' }
  | { name: 'bulk-show'; frames: string[]; counts: Record<Collection, number>; compressed: boolean }
  | { name: 'bulk-scan'; reassembler: FrameReassembler; pending: BulkEnvelope | null; absorbed: Record<Collection, number> | null }
  // The original two-step flow, kept as a manual fallback.
  | { name: 'initiator-show'; frames: string[]; session: InitiatorSession }
  | { name: 'initiator-scan'; session: InitiatorSession; reassembler: FrameReassembler }
  | { name: 'responder-scan'; session: ResponderSession; reassembler: FrameReassembler }
  | { name: 'responder-show'; frames: string[]; session: ResponderSession }
  | { name: 'connected' }
  | { name: 'error'; msg: string };

export function Devices() {
  const session = useSession();
  const myId = session.identity!;
  const myProfile = useMyProfile();
  const myAvatar = useAvatarSrc(myId);

  const [identity, setIdentity] = useState<PeerIdentity | null>(null);
  const [mode, setMode] = useState<Mode>({ name: 'home' });
  const [summaries, setSummaries] = useState<PeerSummary[]>([]);
  const [days, setDays] = useState<number>(3);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const pairedPeers = useLiveQuery(() => db.peers.toArray(), []) ?? [];
  const profiles = useLiveQuery(() => db.profiles.toArray(), []) ?? [];

  useEffect(() => {
    void getOrCreateIdentity().then(setIdentity);
  }, []);

  useEffect(() => getPeerManager().subscribe(setSummaries), []);

  const liveByFingerprint = useMemo(() => {
    const m = new Map<string, PeerSummary>();
    for (const s of summaries) m.set(s.fingerprint, s);
    return m;
  }, [summaries]);

  const sinceDate = useMemo(() => sinceFor(days), [days]);

  function reset() { setMode({ name: 'home' }); }

  async function startBulkShow() {
    if (!identity) return;
    try {
      const { frames, counts, compressed } = await exportBulkFrames({
        identity,
        memberId: myId,
        sinceDate,
      });
      setMode({ name: 'bulk-show', frames, counts, compressed });
    } catch (err) {
      setMode({ name: 'error', msg: errText(err) });
    }
  }

  async function onScannedFrameBulk(text: string) {
    if (mode.name !== 'bulk-scan') return;
    if (!mode.reassembler.ingest(text)) return;
    setMode({ ...mode });
    const bytes = mode.reassembler.complete();
    if (!bytes) return;
    try {
      const { envelope, authentic } = await decodeBulkEnvelope(bytes);
      if (!authentic) {
        setMode({ name: 'error', msg: "That code's signature didn't check out. It wasn't created by a Tideline device." });
        return;
      }
      // A code from a device we've never paired with still needs a human to
      // confirm it, exactly like a live connection would.
      if (!pairedPeers.some((p) => p.fingerprint === envelope.from.fingerprint)) {
        setMode({ ...mode, pending: envelope });
        return;
      }
      const result = await absorbBulkEnvelope(envelope);
      setMode({ ...mode, pending: null, absorbed: result.absorbed });
    } catch (err) {
      setMode({ name: 'error', msg: errText(err) });
    }
  }

  async function acceptPendingBulk() {
    if (mode.name !== 'bulk-scan' || !mode.pending) return;
    const result = await absorbBulkEnvelope(mode.pending);
    setMode({ ...mode, pending: null, absorbed: result.absorbed });
  }

  // --- legacy two-step flow ------------------------------------------------

  async function startInitiator() {
    if (!identity || !myProfile) return;
    const s = new InitiatorSession({ identity, memberId: myId });
    try {
      setMode({ name: 'initiator-show', frames: await s.beginFrames(), session: s });
    } catch (err) {
      s.cancel();
      setMode({ name: 'error', msg: errText(err) });
    }
  }

  function startResponder() {
    if (!identity || !myProfile) return;
    setMode({
      name: 'responder-scan',
      session: new ResponderSession({ identity, memberId: myId }),
      reassembler: new FrameReassembler(),
    });
  }

  async function onScannedFrameInitiator(text: string) {
    if (mode.name !== 'initiator-scan') return;
    if (!mode.reassembler.ingest(text)) return;
    setMode({ ...mode });
    const bytes = mode.reassembler.complete();
    if (!bytes) return;
    try {
      const { peer, remoteHello } = await mode.session.accept(bytes);
      await getPeerManager().adopt(peer, remoteHello, displayNameFor(remoteHello, pairedPeers, profiles));
      setMode({ name: 'connected' });
    } catch (err) {
      setMode({ name: 'error', msg: errText(err) });
    }
  }

  async function onScannedFrameResponder(text: string) {
    if (mode.name !== 'responder-scan') return;
    if (!mode.reassembler.ingest(text)) return;
    setMode({ ...mode });
    const bytes = mode.reassembler.complete();
    if (!bytes) return;
    try {
      const { peer, frames, remoteHello } = await mode.session.respond(bytes);
      await getPeerManager().adopt(peer, remoteHello, displayNameFor(remoteHello, pairedPeers, profiles));
      setMode({ name: 'responder-show', frames, session: mode.session });
    } catch (err) {
      setMode({ name: 'error', msg: errText(err) });
    }
  }

  const awaitingTrust = summaries.find((s) => s.state === 'awaiting-trust');

  return (
    <Page
      eyebrow="Offline sync"
      title="Devices"
      avatarSeed={myId}
      avatarDisplayName={myProfile?.displayName}
      avatarSrc={myAvatar}
    >
      <GlassCard className="space-y-1">
        <div className="text-xs uppercase tracking-wider text-ink-600">This device</div>
        <div className="font-medium">{myProfile?.displayName ?? '—'}</div>
        <div className="text-xs text-ink-600 font-mono tabular break-all">
          {identity ? formatFingerprint(identity.fingerprint) : 'preparing…'}
        </div>
        <div className="text-xs text-ink-600">
          Everything you post is saved on this phone. These tools copy it to
          the rest of the family when there's no internet.
        </div>
      </GlassCard>

      {awaitingTrust && (
        <TrustPrompt summary={awaitingTrust} profiles={profiles} />
      )}

      {mode.name === 'home' && (
        <>
          <GlassCard className="space-y-3">
            <div className="flex items-center gap-2">
              <Users size={16} />
              <div className="font-medium">Sync with another phone</div>
            </div>
            <div className="text-xs text-ink-600">
              Hold the two phones facing each other. They'll find each other and
              connect on their own — no steps to follow.
            </div>
            <PillButton
              onClick={() => setMode({ name: 'face-to-face' })}
              icon={<Wifi size={14} />}
              className="w-full justify-center"
            >
              Start
            </PillButton>
          </GlassCard>

          <GlassCard className="space-y-3">
            <div className="flex items-center gap-2">
              <Share2 size={16} />
              <div className="font-medium">AirDrop sync</div>
              <span className="text-[10px] uppercase tracking-wider bg-sage-200 text-ink-700 rounded-full px-2 py-0.5">
                works anywhere
              </span>
            </div>
            <div className="text-xs text-ink-600">
              Sends photos too, and doesn't need WiFi at all. Use this when the
              ship's network won't let the phones talk to each other.
            </div>
            <PillButton
              onClick={() => setMode({ name: 'airdrop' })}
              icon={<Share2 size={14} />}
              className="w-full justify-center"
            >
              Open
            </PillButton>
          </GlassCard>

          <GlassCard className="space-y-3">
            <div className="flex items-center gap-2">
              <QrCode size={16} />
              <div className="font-medium">QR transfer</div>
            </div>
            <div className="text-xs text-ink-600">
              No network at all. One phone shows a chain of codes, the other
              scans them. Messages, points and quest results only — no photos.
            </div>
            <DayPicker days={days} onChange={setDays} />
            <div className="flex gap-2">
              <PillButton onClick={() => void startBulkShow()} icon={<QrCode size={14} />} className="flex-1 justify-center">
                Send
              </PillButton>
              <PillButton
                onClick={() => setMode({ name: 'bulk-scan', reassembler: new FrameReassembler(), pending: null, absorbed: null })}
                icon={<ScanLine size={14} />}
                className="flex-1 justify-center"
              >
                Receive
              </PillButton>
            </div>
          </GlassCard>

          <ShipPlaybook />

          {summaries.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-ink-600 px-1">Live</div>
              {summaries.map((s) => <ConnectionRow key={s.fingerprint} summary={s} />)}
            </div>
          )}

          {pairedPeers.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-ink-600 px-1">Paired devices</div>
              {pairedPeers
                .filter((p) => !liveByFingerprint.has(p.fingerprint))
                .map((p) => (
                  <GlassCard key={p.fingerprint} className="flex items-center gap-3">
                    <Smartphone size={20} className="text-ink-500" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.displayName || p.memberId}</div>
                      <div className="text-xs text-ink-600 font-mono tabular truncate">
                        {formatFingerprint(p.fingerprint)}
                      </div>
                      {p.lastSeenAt && (
                        <div className="text-xs text-ink-600">Last seen {shortDate(p.lastSeenAt)}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label={`Forget ${p.displayName || p.memberId}`}
                      onClick={() => void getPeerManager().forget(p.fingerprint)}
                      className="grid h-9 w-9 place-items-center rounded-full bg-coral/15 text-coral"
                    >
                      <Trash2 size={15} />
                    </button>
                  </GlassCard>
                ))}
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
              className="w-full flex items-center justify-between px-4 py-2 text-xs text-ink-600"
            >
              Pair step by step
              <ChevronDown size={14} className={`transition ${showAdvanced ? 'rotate-180' : ''}`} />
            </button>
            {showAdvanced && (
              <GlassCard className="space-y-3">
                <div className="text-xs text-ink-600">
                  Only needed if the automatic pairing above won't start. One
                  phone shows, the other scans, then swap.
                </div>
                <div className="flex gap-2">
                  <PillButton onClick={() => void startInitiator()} icon={<QrCode size={14} />} className="flex-1 justify-center">
                    Show my QR
                  </PillButton>
                  <PillButton onClick={startResponder} icon={<ScanLine size={14} />} className="flex-1 justify-center">
                    Scan a QR
                  </PillButton>
                </div>
              </GlassCard>
            )}
          </div>
        </>
      )}

      {mode.name === 'face-to-face' && identity && (
        <FaceToFacePanel
          identity={identity}
          memberId={myId}
          knownPeers={pairedPeers}
          profiles={profiles}
          onDone={reset}
        />
      )}

      {mode.name === 'airdrop' && identity && (
        <AirDropPanel identity={identity} memberId={myId} sinceDate={sinceDate} days={days} onDays={setDays} onDone={reset} />
      )}

      {mode.name === 'bulk-show' && (
        <GlassCard className="space-y-3 items-center flex flex-col">
          <div className="text-xs uppercase tracking-wider text-ink-600">Sending</div>
          <div className="text-xs text-ink-600 text-center">
            {sumCounts(mode.counts)} items in {mode.frames.length} code{mode.frames.length === 1 ? '' : 's'}.
            {' '}Hold steady while the other phone scans.
          </div>
          <QrFrames frames={mode.frames} />
          <PillButton onClick={reset} icon={<X size={14} />}>Done</PillButton>
        </GlassCard>
      )}

      {mode.name === 'bulk-scan' && (
        <GlassCard className="space-y-3 items-center flex flex-col">
          <div className="text-xs uppercase tracking-wider text-ink-600">Receiving</div>
          {!mode.absorbed && !mode.pending && (
            <>
              <QrScanner active onCode={(t) => void onScannedFrameBulk(t)} />
              <div className="text-xs text-ink-600 tabular">
                Captured {mode.reassembler.receivedCount}/{mode.reassembler.expectedCount || '?'} codes
              </div>
            </>
          )}
          {mode.pending && (
            <div className="space-y-3 text-center">
              <div className="text-sm">This code is from a device you haven't paired with.</div>
              <div className="text-xs text-ink-600 font-mono tabular break-all">
                {formatFingerprint(mode.pending.from.fingerprint)}
              </div>
              <div className="flex gap-2">
                <PillButton onClick={() => void acceptPendingBulk()} className="flex-1 justify-center">
                  Accept anyway
                </PillButton>
                <PillButton onClick={reset} className="flex-1 justify-center">Cancel</PillButton>
              </div>
            </div>
          )}
          {mode.absorbed && (
            <div className="text-sm text-center">
              Got {sumCounts(mode.absorbed)} new item{sumCounts(mode.absorbed) === 1 ? '' : 's'}.
              <div className="text-xs text-ink-600 mt-1">
                {Object.entries(mode.absorbed).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(' · ') || 'Nothing new — already in sync.'}
              </div>
            </div>
          )}
          <PillButton onClick={reset} icon={<X size={14} />}>Done</PillButton>
        </GlassCard>
      )}

      {mode.name === 'initiator-show' && (
        <GlassCard className="space-y-3 items-center flex flex-col">
          <div className="text-xs uppercase tracking-wider text-ink-600">Step 1 of 2</div>
          <div className="font-medium">Have the other person scan this</div>
          <QrFrames frames={mode.frames} />
          <PillButton
            onClick={() => setMode({ name: 'initiator-scan', session: mode.session, reassembler: new FrameReassembler() })}
            icon={<ScanLine size={14} />}
          >
            Done — now scan theirs
          </PillButton>
          <button type="button" onClick={() => { mode.session.cancel(); reset(); }} className="text-xs text-ink-600">
            Cancel
          </button>
        </GlassCard>
      )}

      {mode.name === 'initiator-scan' && (
        <GlassCard className="space-y-3 items-center flex flex-col">
          <div className="text-xs uppercase tracking-wider text-ink-600">Step 2 of 2</div>
          <div className="font-medium">Scan their reply</div>
          <QrScanner active onCode={(t) => void onScannedFrameInitiator(t)} />
          <div className="text-xs text-ink-600 tabular">
            Captured {mode.reassembler.receivedCount}/{mode.reassembler.expectedCount || '?'} codes
          </div>
          <button type="button" onClick={() => { mode.session.cancel(); reset(); }} className="text-xs text-ink-600">
            Cancel
          </button>
        </GlassCard>
      )}

      {mode.name === 'responder-scan' && (
        <GlassCard className="space-y-3 items-center flex flex-col">
          <div className="text-xs uppercase tracking-wider text-ink-600">Step 1 of 2</div>
          <div className="font-medium">Scan their code</div>
          <QrScanner active onCode={(t) => void onScannedFrameResponder(t)} />
          <div className="text-xs text-ink-600 tabular">
            Captured {mode.reassembler.receivedCount}/{mode.reassembler.expectedCount || '?'} codes
          </div>
          <button type="button" onClick={() => { mode.session.cancel(); reset(); }} className="text-xs text-ink-600">
            Cancel
          </button>
        </GlassCard>
      )}

      {mode.name === 'responder-show' && (
        <GlassCard className="space-y-3 items-center flex flex-col">
          <div className="text-xs uppercase tracking-wider text-ink-600">Step 2 of 2</div>
          <div className="font-medium">Have them scan this reply</div>
          <QrFrames frames={mode.frames} />
          <PillButton onClick={reset} icon={<X size={14} />}>Done</PillButton>
        </GlassCard>
      )}

      {mode.name === 'connected' && (
        <GlassCard className="space-y-2">
          <div className="font-medium">Connected. Syncing now.</div>
          <PillButton onClick={reset}>Back</PillButton>
        </GlassCard>
      )}

      {mode.name === 'error' && (
        <GlassCard className="space-y-2">
          <div className="text-coral font-medium">Something went wrong</div>
          <div className="text-xs text-ink-600 break-all">{mode.msg}</div>
          <PillButton onClick={reset}>Back</PillButton>
        </GlassCard>
      )}
    </Page>
  );
}

// --- face to face ----------------------------------------------------------

function FaceToFacePanel({
  identity, memberId, knownPeers, profiles, onDone,
}: {
  identity: PeerIdentity;
  memberId: string;
  knownPeers: { fingerprint: string; displayName: string }[];
  profiles: { id: string; displayName: string }[];
  onDone: () => void;
}) {
  const [state, setState] = useState<F2FState>({ name: 'searching' });
  const [display, setDisplay] = useState<string[] | null>(null);
  const sessionRef = useRef<FaceToFaceSession | null>(null);
  // Adoption must happen exactly once even though `connected` may re-render.
  const adoptedRef = useRef(false);

  useEffect(() => {
    const s = new FaceToFaceSession(identity, memberId, {
      onState: setState,
      onDisplay: setDisplay,
    });
    sessionRef.current = s;
    s.start();
    return () => s.cancel();
  }, [identity, memberId]);

  useEffect(() => {
    if (state.name !== 'connected' || adoptedRef.current) return;
    adoptedRef.current = true;
    void getPeerManager().adopt(
      state.peer,
      state.hello,
      displayNameFor(state.hello, knownPeers, profiles),
    );
  }, [state, knownPeers, profiles]);

  const onCode = useCallback((text: string) => {
    void sessionRef.current?.onCode(text);
  }, []);

  const scanning = state.name === 'searching' || state.name === 'offering' || state.name === 'awaiting-offer' || state.name === 'answering';

  return (
    <GlassCard className="space-y-3 flex flex-col items-center">
      <div className="text-xs uppercase tracking-wider text-ink-600">{f2fLabel(state)}</div>

      {display && <QrFrames frames={display} size={220} />}

      {scanning && <QrScanner active onCode={onCode} />}

      {state.name === 'connecting' && (
        <div className="text-sm text-center">Connecting…</div>
      )}

      {state.name === 'connected' && (
        <div className="text-sm text-center">Connected — syncing now.</div>
      )}

      {state.name === 'blocked' && (
        <div className="space-y-2 text-xs text-ink-700">
          <div className="flex items-center gap-2 font-medium text-ink-900">
            <AlertTriangle size={14} /> This WiFi is blocking phone-to-phone connections
          </div>
          <div>
            Cruise and hotel networks often stop devices on the same network
            from reaching each other. Two things that still work:
          </div>
          <ol className="list-decimal ml-4 space-y-1">
            <li>
              Turn on <strong>Personal Hotspot</strong> on one phone (Settings →
              Personal Hotspot), have the others join it, then try again.
            </li>
            <li>
              Use <strong>AirDrop sync</strong> — it doesn't use WiFi at all and
              carries photos too.
            </li>
          </ol>
        </div>
      )}

      {state.name === 'error' && (
        <div className="space-y-2 text-xs">
          <div className="text-coral break-all">{state.message}</div>
          {/* Most realistic cause is a description one of the phones wouldn't
              accept. The step-by-step flow sends the full, unmodified SDP, so
              it's a genuine second chance rather than a retry of the same
              thing. */}
          <div className="text-ink-700">
            If this keeps happening, close this and use <strong>Pair step by step</strong> at
            the bottom of the Devices screen — it uses a longer, more
            compatible code.
          </div>
        </div>
      )}

      <PillButton onClick={onDone} icon={<X size={14} />}>
        {state.name === 'connected' ? 'Done' : 'Cancel'}
      </PillButton>
    </GlassCard>
  );
}

function f2fLabel(state: F2FState): string {
  switch (state.name) {
    case 'searching':      return 'Point the phones at each other';
    case 'offering':       return 'Found them — hold still';
    case 'awaiting-offer': return 'Found them — hold still';
    case 'answering':      return 'Almost there';
    case 'connecting':     return 'Connecting';
    case 'connected':      return 'Connected';
    case 'blocked':        return 'Blocked by this network';
    case 'error':          return 'Something went wrong';
  }
}

// --- AirDrop ---------------------------------------------------------------

function AirDropPanel({
  identity, memberId, sinceDate, days, onDays, onDone,
}: {
  identity: PeerIdentity;
  memberId: string;
  sinceDate: string | undefined;
  days: number;
  onDays: (d: number) => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [counts, setCounts] = useState<BundleCounts | null>(null);
  const [building, setBuilding] = useState(false);
  const [imported, setImported] = useState<BundleCounts | null>(null);
  const [pending, setPending] = useState<ParsedBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pairedPeers = useLiveQuery(() => db.peers.toArray(), []) ?? [];

  // Build ahead of the tap. iOS only honours navigator.share from inside a
  // user gesture, and awaiting the bundle first would lose that context.
  useEffect(() => {
    let cancelled = false;
    setBuilding(true);
    setFile(null);
    void (async () => {
      try {
        const out = await exportBundle({ identity, memberId, sinceDate });
        if (cancelled) return;
        setFile(out.file);
        setCounts(out.counts);
      } catch (err) {
        if (!cancelled) setError(errText(err));
      } finally {
        if (!cancelled) setBuilding(false);
      }
    })();
    return () => { cancelled = true; };
  }, [identity, memberId, sinceDate]);

  function share() {
    if (!file) return;
    const nav = navigator as Navigator & {
      canShare?: (data: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    if (nav.canShare?.({ files: [file] }) && nav.share) {
      void nav.share({ files: [file], title: 'Tideline sync' }).catch(() => { /* user cancelled */ });
      return;
    }
    // Desktop and any browser without file sharing: fall back to a download.
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    setError(null);
    try {
      const parsed = await parseBundle(await blobToBytes(picked));
      if (!parsed.authentic) {
        setError("That file's signature didn't check out — it wasn't created by a Tideline device, or it was modified.");
        return;
      }
      if (!pairedPeers.some((p) => p.fingerprint === parsed.header.signed.fingerprint)) {
        setPending(parsed);
        return;
      }
      setImported(await absorbBundle(parsed));
    } catch (err) {
      setError(errText(err));
    }
  }

  async function acceptPending() {
    if (!pending) return;
    setImported(await absorbBundle(pending));
    setPending(null);
  }

  return (
    <GlassCard className="space-y-4">
      <div className="flex items-center gap-2">
        <Share2 size={16} />
        <div className="font-medium">AirDrop sync</div>
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-ink-600">Send</div>
        <DayPicker days={days} onChange={onDays} />
        <div className="text-xs text-ink-600">
          {building && 'Packing…'}
          {!building && counts && (
            <>Ready: {totalRecords(counts)} item{totalRecords(counts) === 1 ? '' : 's'}
              {counts.photos > 0 && ` and ${counts.photos} photo${counts.photos === 1 ? '' : 's'}`}.</>
          )}
        </div>
        <PillButton
          onClick={share}
          // Taps during "Packing…" would silently do nothing — the file that
          // `share` needs doesn't exist yet.
          disabled={building || !file}
          icon={<Share2 size={14} />}
          className="w-full justify-center"
        >
          {building ? 'Packing…' : 'Share'}
        </PillButton>
        <ol className="text-xs text-ink-600 list-decimal ml-4 space-y-0.5">
          <li>Tap Share, pick the other person in AirDrop.</li>
          <li>On their phone, tap <strong>Save to Files</strong>.</li>
          <li>They open Tideline → Devices → AirDrop sync → Import.</li>
        </ol>
      </div>

      <div className="space-y-2 border-t border-white/60 pt-3">
        <div className="text-xs uppercase tracking-wider text-ink-600">Receive</div>
        <PillButton
          onClick={() => fileInput.current?.click()}
          icon={<FolderInput size={14} />}
          className="w-full justify-center"
        >
          Import a sync file
        </PillButton>
        {/* No `accept` filter: iOS Files sometimes hides files behind an
            extension filter, and the magic-byte check rejects anything wrong
            anyway. */}
        <input ref={fileInput} type="file" className="hidden" onChange={(e) => void onPick(e)} />

        {pending && (
          <div className="space-y-2 text-xs">
            <div>This file is from a device you haven't paired with.</div>
            <div className="font-mono tabular break-all text-ink-600">
              {formatFingerprint(pending.header.signed.fingerprint)}
            </div>
            <div className="flex gap-2">
              <PillButton onClick={() => void acceptPending()} className="flex-1 justify-center">Accept anyway</PillButton>
              <PillButton onClick={() => setPending(null)} className="flex-1 justify-center">Cancel</PillButton>
            </div>
          </div>
        )}

        {imported && (
          <div className="text-xs text-ink-700">
            Imported {totalRecords(imported)} new item{totalRecords(imported) === 1 ? '' : 's'}
            {imported.photos > 0 && ` and ${imported.photos} photo${imported.photos === 1 ? '' : 's'}`}.
          </div>
        )}
        {error && <div className="text-xs text-coral">{error}</div>}
      </div>

      <PillButton onClick={onDone} icon={<X size={14} />}>Done</PillButton>
    </GlassCard>
  );
}

// --- shared bits -----------------------------------------------------------

function DayPicker({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  return (
    <div className="flex gap-1" role="group" aria-label="How far back to include">
      {DAY_OPTIONS.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          aria-pressed={days === d}
          className={`flex-1 rounded-full px-2 py-1.5 text-xs transition ${
            days === d ? 'bg-ink-900 text-white' : 'bg-white/70 text-ink-700'
          }`}
        >
          {d === 0 ? 'All' : `${d}d`}
        </button>
      ))}
    </div>
  );
}

function ShipPlaybook() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-2 text-xs text-ink-600"
      >
        What to do at sea
        <ChevronDown size={14} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <GlassCard className="space-y-2 text-xs text-ink-700">
          <div>
            <strong>1. Same WiFi.</strong> If everyone's on the ship's network,
            try <em>Sync with another phone</em> first. It's the fastest and
            carries everything.
          </div>
          <div>
            <strong>2. Personal Hotspot.</strong> Ship networks often block
            phones from reaching each other. One phone turns on Personal
            Hotspot, the others join it, then sync as usual. Worth testing
            before you sail — whether it works with no signal varies by phone
            and carrier.
          </div>
          <div>
            <strong>3. AirDrop.</strong> Always works, needs no network, and is
            the only offline way to move photos.
          </div>
          <div className="text-ink-600">
            Nothing is ever lost in the meantime — everything you post stays on
            your phone and uploads by itself the next time there's internet.
          </div>
        </GlassCard>
      )}
    </div>
  );
}

function TrustPrompt({
  summary, profiles,
}: {
  summary: PeerSummary;
  profiles: { id: string; displayName: string }[];
}) {
  const knownProfile = profiles.find((p) => p.id === summary.memberId);
  return (
    <GlassCard className="space-y-3 ring-2 ring-ocean/40">
      <div className="text-xs uppercase tracking-wider text-ocean">New device</div>
      <div className="font-medium">{knownProfile?.displayName || summary.displayName || 'Unknown device'}</div>
      <div className="text-xs text-ink-600 font-mono tabular break-all">
        {formatFingerprint(summary.fingerprint)}
      </div>
      {!knownProfile && (
        <div className="flex items-start gap-2 text-xs text-coral">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>This device isn't claiming to be anyone in the family. Only accept if you know exactly what it is.</span>
        </div>
      )}
      <div className="text-xs text-ink-600">
        Check this code matches the one on their screen. If it does, they are
        who they say they are.
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void getPeerManager().trust(summary.fingerprint, knownProfile?.displayName)}
          className="flex-1 rounded-full bg-ink-900 text-white text-sm font-medium px-4 py-2 active:scale-[0.98] transition"
        >
          Accept &amp; pair
        </button>
        <button
          type="button"
          onClick={() => void getPeerManager().forget(summary.fingerprint)}
          className="rounded-full bg-coral/15 text-coral text-sm font-medium px-4 py-2"
        >
          Reject
        </button>
      </div>
    </GlassCard>
  );
}

function ConnectionRow({ summary }: { summary: PeerSummary }) {
  const skewed =
    summary.clockOffsetMs !== null && Math.abs(summary.clockOffsetMs) > CLOCK_SKEW_WARN_MS;
  return (
    <GlassCard className="flex items-center gap-3">
      <span className={`grid h-9 w-9 place-items-center rounded-full ${stateBgClass(summary.state)}`}>
        <Smartphone size={16} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{summary.displayName || summary.memberId}</div>
        <div className="text-xs text-ink-600">{stateLabel(summary.state)}</div>
        {summary.pendingPhotos.length > 0 && (
          <div className="text-xs text-ink-600">Photos arriving: {summary.pendingPhotos.length}</div>
        )}
        {skewed && (
          <div className="text-xs text-coral">
            Their clock is {formatSkew(summary.clockOffsetMs!)} off — messages may sort oddly.
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="Disconnect"
        onClick={() => getPeerManager().disconnect(summary.fingerprint)}
        className="grid h-8 w-8 place-items-center rounded-full bg-ink-100 text-ink-700"
      >
        <X size={14} />
      </button>
    </GlassCard>
  );
}

function stateBgClass(s: PeerSummary['state']): string {
  switch (s) {
    case 'awaiting-trust': return 'bg-ocean/15 text-ocean';
    case 'syncing':        return 'bg-ocean/15 text-ocean animate-pulse';
    case 'idle':           return 'bg-sage-200 text-ink-700';
    case 'closed':         return 'bg-ink-100 text-ink-600';
  }
}

function stateLabel(s: PeerSummary['state']): string {
  switch (s) {
    case 'awaiting-trust': return 'Awaiting your confirmation';
    case 'syncing':        return 'Syncing…';
    case 'idle':           return 'Connected · up to date';
    case 'closed':         return 'Disconnected';
  }
}

function formatSkew(ms: number): string {
  const mins = Math.round(Math.abs(ms) / 60_000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  return `${hours} hr`;
}

function displayNameFor(
  hello: HandshakeHello,
  known: { fingerprint: string; displayName: string }[],
  profiles: { id: string; displayName: string }[],
): string {
  const paired = known.find((k) => k.fingerprint === hello.fingerprint);
  if (paired?.displayName) return paired.displayName;
  return profiles.find((p) => p.id === hello.memberId)?.displayName ?? hello.memberId;
}

function formatFingerprint(fp: string): string {
  return fp.replace(/(.{4})(?!$)/g, '$1-');
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function sumCounts(c: Record<Collection, number>): number {
  return Object.values(c).reduce((a, b) => a + b, 0);
}

/** ISO date `days` back, or undefined for "everything". */
function sinceFor(days: number): string | undefined {
  if (days <= 0) return undefined;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
