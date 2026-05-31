import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
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
import { getPeerManager, type PeerSummary } from '../lib/p2p/manager';
import { FrameReassembler } from '../lib/p2p/qr';
import { exportBulkFrames, importBulkEnvelope } from '../lib/p2p/bulkQr';
import type { Collection } from '../lib/p2p/protocol';
import { Smartphone, Plane, Trash2, X, ScanLine, QrCode, Wifi, WifiOff } from 'lucide-react';

type Mode =
  | { name: 'home' }
  | { name: 'initiator-show'; frames: string[]; session: InitiatorSession }
  | { name: 'initiator-scan'; session: InitiatorSession; reassembler: FrameReassembler }
  | { name: 'responder-scan'; session: ResponderSession; reassembler: FrameReassembler }
  | { name: 'responder-show'; frames: string[]; session: ResponderSession }
  | { name: 'awaiting-trust'; hello: HandshakeHello }
  | { name: 'bulk-show'; frames: string[]; counts: Record<Collection, number> }
  | { name: 'bulk-scan'; reassembler: FrameReassembler; absorbed: Record<Collection, number> | null }
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

  const pairedPeers = useLiveQuery(() => db.peers.toArray(), []) ?? [];

  useEffect(() => {
    void getOrCreateIdentity().then(setIdentity);
  }, []);

  useEffect(() => {
    const m = getPeerManager();
    return m.subscribe(setSummaries);
  }, []);

  // Keep a derived map for quick "is fingerprint X live?" lookups.
  const liveByFingerprint = useMemo(() => {
    const m = new Map<string, PeerSummary>();
    for (const s of summaries) m.set(s.fingerprint, s);
    return m;
  }, [summaries]);

  function reset() { setMode({ name: 'home' }); }

  async function startInitiator() {
    if (!identity || !myProfile) return;
    const s = new InitiatorSession({ identity, memberId: myId });
    try {
      const frames = await s.beginFrames();
      setMode({ name: 'initiator-show', frames, session: s });
    } catch (err) {
      s.cancel();
      setMode({ name: 'error', msg: err instanceof Error ? err.message : String(err) });
    }
  }

  function startResponder() {
    if (!identity || !myProfile) return;
    const s = new ResponderSession({ identity, memberId: myId });
    setMode({ name: 'responder-scan', session: s, reassembler: new FrameReassembler() });
  }

  function startBulkShow() {
    if (!identity) return;
    void (async () => {
      const { frames, counts } = await exportBulkFrames({
        memberId: myId,
        fingerprint: identity.fingerprint,
      });
      setMode({ name: 'bulk-show', frames, counts });
    })();
  }

  function startBulkScan() {
    setMode({ name: 'bulk-scan', reassembler: new FrameReassembler(), absorbed: null });
  }

  async function onScannedFrameInitiator(text: string) {
    if (mode.name !== 'initiator-scan') return;
    if (!mode.reassembler.ingest(text)) return;
    setMode({ ...mode });
    const bytes = mode.reassembler.complete();
    if (!bytes) return;
    try {
      const { peer, remoteHello } = await mode.session.accept(bytes);
      const initState = await getPeerManager().adopt(peer, remoteHello, displayNameFromHello(remoteHello, pairedPeers));
      setMode(initState === 'awaiting-trust'
        ? { name: 'awaiting-trust', hello: remoteHello }
        : { name: 'connected' });
    } catch (err) {
      setMode({ name: 'error', msg: err instanceof Error ? err.message : String(err) });
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
      // The initiator will scan our frames; meanwhile, adopt the peer
      // so it's tracked. Connection state will progress once both ends
      // complete ICE.
      const initState = await getPeerManager().adopt(peer, remoteHello, displayNameFromHello(remoteHello, pairedPeers));
      // If we already trust this peer, jump to responder-show; otherwise we
      // still need to display our QR (we always have to show it so the
      // initiator can finish), then transition to trust-prompt.
      if (initState === 'awaiting-trust') {
        setMode({ name: 'responder-show', frames, session: mode.session });
        // Stash the pending trust decision via a side-effect — after the
        // user is done showing the QR, the connected state will surface.
        // Simpler: just show responder-show; once initiator scans + ICE
        // completes, the trust prompt will pop up via the trust banner
        // (rendered below).
      } else {
        setMode({ name: 'responder-show', frames, session: mode.session });
      }
    } catch (err) {
      setMode({ name: 'error', msg: err instanceof Error ? err.message : String(err) });
    }
  }

  async function onScannedFrameBulk(text: string) {
    if (mode.name !== 'bulk-scan') return;
    if (!mode.reassembler.ingest(text)) return;
    setMode({ ...mode });
    const bytes = mode.reassembler.complete();
    if (!bytes) return;
    try {
      const result = await importBulkEnvelope(bytes);
      setMode({ ...mode, absorbed: result.absorbed });
    } catch (err) {
      setMode({ name: 'error', msg: err instanceof Error ? err.message : String(err) });
    }
  }

  // Promote an awaiting-trust connection in the live list to a prompt.
  const awaitingTrust = summaries.find((s) => s.state === 'awaiting-trust');

  return (
    <Page
      eyebrow="Offline sync"
      title="Devices"
      avatarSeed={myId}
      avatarDisplayName={myProfile?.displayName}
      avatarSrc={myAvatar}
    >
      {/* My identity */}
      <GlassCard className="space-y-1">
        <div className="text-xs uppercase tracking-wider text-ink-400">This device</div>
        <div className="font-medium">{myProfile?.displayName ?? '—'}</div>
        <div className="text-xs text-ink-500 font-mono break-all">
          {identity ? formatFingerprint(identity.fingerprint) : 'preparing…'}
        </div>
        <div className="text-xs text-ink-500">
          Share your code with another family device to keep messaging,
          photos, and points in sync when there's no internet (e.g. on a
          plane or cruise).
        </div>
      </GlassCard>

      {/* Trust prompt — appears in any mode if a peer is awaiting trust */}
      {awaitingTrust && (
        <GlassCard className="space-y-3 ring-2 ring-ocean/40">
          <div className="text-xs uppercase tracking-wider text-ocean">New device</div>
          <div className="font-medium">{awaitingTrust.displayName || 'Unknown device'}</div>
          <div className="text-xs text-ink-500 font-mono break-all">
            {formatFingerprint(awaitingTrust.fingerprint)}
          </div>
          <div className="text-xs text-ink-600">
            Make sure this fingerprint matches what's shown on the other
            person's device. If it matches, they're really who they say
            they are — accept to start syncing.
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void getPeerManager().trust(awaitingTrust.fingerprint)}
              className="flex-1 rounded-full bg-ink-900 text-white text-sm font-medium px-4 py-2 active:scale-[0.98] transition"
            >
              Accept &amp; pair
            </button>
            <button
              type="button"
              onClick={() => void getPeerManager().forget(awaitingTrust.fingerprint)}
              className="rounded-full bg-coral/15 text-coral text-sm font-medium px-4 py-2"
            >
              Reject
            </button>
          </div>
        </GlassCard>
      )}

      {/* Mode-specific content */}
      {mode.name === 'home' && (
        <>
          <GlassCard className="space-y-3">
            <div className="flex items-center gap-2">
              <Wifi size={16} />
              <div className="font-medium">Direct connection</div>
            </div>
            <div className="text-xs text-ink-600">
              Best when both devices are on the same WiFi (ship, hotel,
              airplane). One device shows a QR, the other scans it.
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

          <GlassCard className="space-y-3">
            <div className="flex items-center gap-2">
              <WifiOff size={16} />
              <div className="font-medium">No WiFi? Pure QR transfer</div>
            </div>
            <div className="text-xs text-ink-600">
              Even with no network at all, one device can <em>show</em> a
              chain of QR frames and the other can <em>scan</em> them to
              copy recent messages, points, and quest results across.
            </div>
            <div className="flex gap-2">
              <PillButton onClick={startBulkShow} icon={<QrCode size={14} />} className="flex-1 justify-center">
                Send via QR
              </PillButton>
              <PillButton onClick={startBulkScan} icon={<ScanLine size={14} />} className="flex-1 justify-center">
                Receive via QR
              </PillButton>
            </div>
          </GlassCard>

          {/* Active connections */}
          {summaries.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-ink-400 px-1">Live</div>
              {summaries.map((s) => (
                <ConnectionRow key={s.fingerprint} summary={s} />
              ))}
            </div>
          )}

          {/* Paired but not live */}
          {pairedPeers.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-ink-400 px-1">Paired devices</div>
              {pairedPeers
                .filter((p) => !liveByFingerprint.has(p.fingerprint))
                .map((p) => (
                  <GlassCard key={p.fingerprint} className="flex items-center gap-3">
                    <Smartphone size={20} className="text-ink-400" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.displayName || p.memberId}</div>
                      <div className="text-xs text-ink-500 font-mono truncate">
                        {formatFingerprint(p.fingerprint)}
                      </div>
                      {p.lastSeenAt && (
                        <div className="text-xs text-ink-400">Last seen {shortDate(p.lastSeenAt)}</div>
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
        </>
      )}

      {mode.name === 'initiator-show' && (
        <GlassCard className="space-y-3 items-center flex flex-col">
          <div className="text-xs uppercase tracking-wider text-ink-400">Step 1 of 2</div>
          <div className="font-medium">Have the other person scan this</div>
          <QrFrames frames={mode.frames} />
          <PillButton
            onClick={() => setMode({ name: 'initiator-scan', session: mode.session, reassembler: new FrameReassembler() })}
            icon={<ScanLine size={14} />}
          >
            Done — now scan theirs
          </PillButton>
          <button type="button" onClick={() => { mode.session.cancel(); reset(); }} className="text-xs text-ink-500">
            Cancel
          </button>
        </GlassCard>
      )}

      {mode.name === 'initiator-scan' && (
        <GlassCard className="space-y-3 items-center flex flex-col">
          <div className="text-xs uppercase tracking-wider text-ink-400">Step 2 of 2</div>
          <div className="font-medium">Scan their reply QR</div>
          <QrScanner active onCode={(t) => void onScannedFrameInitiator(t)} />
          <div className="text-xs text-ink-500">
            Captured {mode.reassembler.receivedCount}/{mode.reassembler.expectedCount || '?'} frames
          </div>
          <button type="button" onClick={() => { mode.session.cancel(); reset(); }} className="text-xs text-ink-500">
            Cancel
          </button>
        </GlassCard>
      )}

      {mode.name === 'responder-scan' && (
        <GlassCard className="space-y-3 items-center flex flex-col">
          <div className="text-xs uppercase tracking-wider text-ink-400">Step 1 of 2</div>
          <div className="font-medium">Scan their QR</div>
          <QrScanner active onCode={(t) => void onScannedFrameResponder(t)} />
          <div className="text-xs text-ink-500">
            Captured {mode.reassembler.receivedCount}/{mode.reassembler.expectedCount || '?'} frames
          </div>
          <button type="button" onClick={() => { mode.session.cancel(); reset(); }} className="text-xs text-ink-500">
            Cancel
          </button>
        </GlassCard>
      )}

      {mode.name === 'responder-show' && (
        <GlassCard className="space-y-3 items-center flex flex-col">
          <div className="text-xs uppercase tracking-wider text-ink-400">Step 2 of 2</div>
          <div className="font-medium">Have them scan this reply</div>
          <QrFrames frames={mode.frames} />
          <PillButton onClick={reset} icon={<X size={14} />}>
            Done
          </PillButton>
        </GlassCard>
      )}

      {mode.name === 'connected' && (
        <GlassCard className="space-y-2">
          <div className="font-medium">Connected. Syncing now.</div>
          <PillButton onClick={reset}>Back</PillButton>
        </GlassCard>
      )}

      {mode.name === 'awaiting-trust' && (
        <GlassCard className="space-y-2">
          <div className="font-medium">Confirm the new device in the prompt above.</div>
          <PillButton onClick={reset}>Back</PillButton>
        </GlassCard>
      )}

      {mode.name === 'bulk-show' && (
        <GlassCard className="space-y-3 items-center flex flex-col">
          <div className="text-xs uppercase tracking-wider text-ink-400">Sending</div>
          <div className="text-xs text-ink-500 text-center">
            {sumCounts(mode.counts)} items packed into {mode.frames.length} QR{mode.frames.length === 1 ? '' : ' frames'}. Hold steady while the other phone scans.
          </div>
          <QrFrames frames={mode.frames} />
          <PillButton onClick={reset} icon={<X size={14} />}>Done</PillButton>
        </GlassCard>
      )}

      {mode.name === 'bulk-scan' && (
        <GlassCard className="space-y-3 items-center flex flex-col">
          <div className="text-xs uppercase tracking-wider text-ink-400">Receiving</div>
          {!mode.absorbed && (
            <>
              <QrScanner active onCode={(t) => void onScannedFrameBulk(t)} />
              <div className="text-xs text-ink-500">
                Captured {mode.reassembler.receivedCount}/{mode.reassembler.expectedCount || '?'} frames
              </div>
            </>
          )}
          {mode.absorbed && (
            <div className="text-sm text-center">
              <Plane size={20} className="mx-auto mb-1" />
              Got {sumCounts(mode.absorbed)} new items.
              <div className="text-xs text-ink-500 mt-1">
                {Object.entries(mode.absorbed)
                  .filter(([, n]) => n > 0)
                  .map(([k, n]) => `${n} ${k}`)
                  .join(' · ')}
              </div>
            </div>
          )}
          <PillButton onClick={reset} icon={<X size={14} />}>Done</PillButton>
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

function ConnectionRow({ summary }: { summary: PeerSummary }) {
  return (
    <GlassCard className="flex items-center gap-3">
      <span className={`grid h-9 w-9 place-items-center rounded-full ${stateBgClass(summary.state)}`}>
        <Smartphone size={16} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{summary.displayName || summary.memberId}</div>
        <div className="text-xs text-ink-500">{stateLabel(summary.state)}</div>
        {summary.pendingPhotos.length > 0 && (
          <div className="text-xs text-ink-400">Photos arriving: {summary.pendingPhotos.length}</div>
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
    case 'closed':         return 'bg-ink-100 text-ink-500';
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

function displayNameFromHello(hello: HandshakeHello, known: { fingerprint: string; displayName: string }[]): string {
  const match = known.find((k) => k.fingerprint === hello.fingerprint);
  return match?.displayName ?? hello.memberId;
}

function formatFingerprint(fp: string): string {
  // Group in 4-char chunks for legibility: ABCD-EFGH-JK
  return fp.replace(/(.{4})(?!$)/g, '$1-');
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function sumCounts(c: Record<Collection, number>): number {
  return Object.values(c).reduce((a, b) => a + b, 0);
}
