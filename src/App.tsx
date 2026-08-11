import { useCallback, useEffect, useState } from 'react';
import { HashRouter, Route, Routes, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Onboarding } from './screens/Onboarding';
import { Today } from './screens/Today';
import { Itinerary } from './screens/Itinerary';
import { Photos } from './screens/Photos';
import { Chat } from './screens/Chat';
import { Quest } from './screens/Quest';
import { Profile } from './screens/Profile';
import { Panic } from './screens/Panic';
import { PlaceDetail } from './screens/PlaceDetail';
import { HuntDetail } from './screens/HuntDetail';
import { AvatarStudio } from './screens/AvatarStudio';
import { CrewDeck } from './screens/CrewDeck';
import { About } from './screens/About';
import { Devices } from './screens/Devices';
import { Recap } from './screens/Recap';
import { RaceDuel } from './screens/RaceDuel';
import { Arcade } from './screens/Arcade';
import { ArcadeGame } from './screens/ArcadeGame';
import { ArcadeLeaderboard } from './screens/ArcadeLeaderboard';
import { encodeRaceMsg, parseRaceMsg } from './lib/race/net';
import { setPendingInvite, clearPendingInvite } from './lib/race/inviteBus';
import { FirstRun, needsFirstRun } from './screens/FirstRun';
import { TabBar } from './ui/TabBar';
import { EggProvider } from './lib/eggRuntime';
import { EggOverlay, CornerTaps } from './ui/EggEffects';
import { useSession, isUnlockFresh } from './state/session';
import { startSyncLoop } from './lib/sync';
import { refreshSubscription } from './lib/push';
import { getPeerManager } from './lib/p2p/manager';
import { useSyncError, retrySync } from './lib/syncStatus';
import { startNetLoop } from './lib/net';

export function App() {
  const session = useSession();
  const [updateReady, setUpdateReady] = useState(false);

  // Runs regardless of sign-in state: Onboarding's unlock path also wants to
  // know whether validating against the backend is even possible.
  useEffect(() => startNetLoop(), []);

  useEffect(() => {
    const onUpdate = () => setUpdateReady(true);
    const onAuthExpired = () => useSession.getState().requireReunlock();
    window.addEventListener('tideline:update-available', onUpdate);
    window.addEventListener('tideline:auth-expired', onAuthExpired);
    return () => {
      window.removeEventListener('tideline:update-available', onUpdate);
      window.removeEventListener('tideline:auth-expired', onAuthExpired);
    };
  }, []);

  useEffect(() => {
    if (!session.identity || !session.pat || !session.dataOwner || !session.dataRepo) return;
    const stop = startSyncLoop({
      owner: session.dataOwner,
      repo: session.dataRepo,
      token: session.pat,
      identity: session.identity,
    });
    // Browsers rotate push endpoints without warning; re-publish ours if it
    // moved, otherwise the notifier keeps pushing into a dead endpoint.
    void refreshSubscription(session.identity);
    return stop;
  }, [session.identity, session.pat, session.dataOwner, session.dataRepo]);

  // Drop every live p2p connection on sign-out / panic. We never sign
  // outbound p2p traffic with anything tied to the GitHub PAT, but the
  // identity key + Dexie are about to be wiped, so any active session
  // would be talking on behalf of a no-longer-signed-in user.
  useEffect(() => {
    getPeerManager().setLocalMember(session.identity);
    if (!session.identity) {
      getPeerManager().shutdown();
    }
  }, [session.identity]);

  const needsOnboarding = !session.identity || !session.pat || !isUnlockFresh(session);
  const [firstRunDone, setFirstRunDone] = useState(false);
  const showFirstRun = !needsOnboarding && !firstRunDone && needsFirstRun(session.identity);

  return (
    <HashRouter>
      <EggProvider>
      {updateReady && <UpdateBanner onApply={() => triggerUpdate()} />}
      {showFirstRun && <FirstRun onDone={() => setFirstRunDone(true)} />}
      {/* A race challenge can arrive while you're on any screen. */}
      {!needsOnboarding && <RaceInviteWatcher />}
      {/* Renders whatever the egg runtime has raised, from any screen. */}
      <EggOverlay />
      <Routes>
        <Route path="/panic" element={<Panic />} />
        {needsOnboarding ? (
          <>
            <Route path="*" element={<Onboarding />} />
          </>
        ) : (
          <>
            <Route path="/today" element={<WithTabs><Today /></WithTabs>} />
            <Route path="/itinerary" element={<WithTabs><Itinerary /></WithTabs>} />
            <Route path="/photos" element={<WithTabs><Photos /></WithTabs>} />
            <Route path="/chat" element={<WithTabs><Chat /></WithTabs>} />
            <Route path="/quest" element={<WithTabs><Quest /></WithTabs>} />
            <Route path="/arcade" element={<WithTabs><Arcade /></WithTabs>} />
            <Route path="/arcade/leaderboard" element={<WithTabs><ArcadeLeaderboard /></WithTabs>} />
            {/* Full-screen: a tab bar under a cabinet eats the controls. */}
            <Route path="/arcade/:gameId" element={<ArcadeGame />} />
            <Route path="/profile" element={<WithTabs><Profile /></WithTabs>} />
            <Route path="/place/:slug" element={<WithTabs><PlaceDetail /></WithTabs>} />
            <Route path="/hunt/:id" element={<WithTabs><HuntDetail /></WithTabs>} />
            <Route path="/avatar" element={<WithTabs><AvatarStudio /></WithTabs>} />
            {/* Not linked from anywhere — you get here by finding the way in. */}
            <Route path="/crew-deck" element={<WithTabs><CrewDeck /></WithTabs>} />
            <Route path="/devices" element={<WithTabs><Devices /></WithTabs>} />
            {/* Full-screen by design — no tab bar over the slideshow. */}
            <Route path="/recap" element={<Recap />} />
            {/* Full-screen too: a tab bar under the race canvas would eat
                the touch controls. */}
            <Route path="/race" element={<RaceDuel />} />
            <Route path="/about" element={<WithTabs><About /></WithTabs>} />
            <Route path="*" element={<Navigate to="/today" replace />} />
          </>
        )}
      </Routes>
      </EggProvider>
    </HashRouter>
  );
}

function WithTabs({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SyncErrorBanner />
      {/* Clears the tab bar, which grew when labels were added. */}
      <div className="min-h-dvh pb-32">{children}</div>
      <TabBar />
      {/* Above the tab bar in z-order but invisible; see CornerTaps. */}
      <CornerTaps />
    </>
  );
}

/**
 * Listens for kart-duel invites app-wide and raises a banner. Game frames
 * are transient — if the invite only lived inside the race screen, a
 * challenge sent while you're browsing photos would evaporate unseen. The
 * invite itself is stashed in the invite bus so the race screen can pick it
 * up after navigation.
 */
function RaceInviteWatcher() {
  const navigate = useNavigate();
  const location = useLocation();
  const [banner, setBanner] = useState<{ name: string; fingerprint: string } | null>(null);
  const onRaceScreen = location.pathname === '/race';

  useEffect(() => {
    if (onRaceScreen) {
      // The race screen handles its own invites; drop any stale banner.
      setBanner(null);
      return;
    }
    return getPeerManager().onGame((fingerprint, gmsg) => {
      const parsed = parseRaceMsg(gmsg);
      if (!parsed || !parsed.ok || parsed.msg.kind !== 'invite') return;
      setPendingInvite({ fromFingerprint: fingerprint, intro: parsed.msg.intro, at: Date.now() });
      setBanner({ name: parsed.msg.intro.name, fingerprint });
    });
  }, [onRaceScreen]);

  const dismiss = useCallback(() => {
    // Tell the challenger no — otherwise they sit on "waiting…" until they
    // give up on their own.
    if (banner) {
      getPeerManager().sendGame(banner.fingerprint, encodeRaceMsg({ kind: 'decline' }));
    }
    clearPendingInvite();
    setBanner(null);
  }, [banner]);

  if (!banner || onRaceScreen) return null;
  return (
    <div className="fixed top-3 inset-x-3 z-50 glass rounded-2xl px-4 py-3 flex items-center justify-between gap-2">
      <span className="text-sm min-w-0 truncate">🏁 {banner.name} challenges you to a kart duel!</span>
      <div className="flex gap-2 shrink-0">
        <button
          type="button"
          onClick={() => { setBanner(null); navigate('/race'); }}
          className="text-sm font-semibold text-white bg-ink-900 px-3 py-1 rounded-full"
        >
          Race
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss challenge"
          className="text-sm font-semibold text-ink-700 px-2 py-1 rounded-full bg-white/70"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function SyncErrorBanner() {
  const error = useSyncError();
  if (!error) return null;
  return (
    <div className="fixed top-3 inset-x-3 z-40 glass rounded-2xl px-4 py-2.5 flex items-center justify-between gap-2">
      <span className="text-xs text-ink-700 leading-snug">{error.message}</span>
      <button
        type="button"
        onClick={() => retrySync()}
        className="shrink-0 text-xs font-semibold text-ocean px-3 py-1 rounded-full bg-white/70"
      >
        Retry
      </button>
    </div>
  );
}

function UpdateBanner({ onApply }: { onApply: () => void }) {
  return (
    <div className="fixed top-3 inset-x-3 z-50 glass rounded-2xl px-4 py-3 flex items-center justify-between">
      <span className="text-sm">A new version is available</span>
      <button
        onClick={onApply}
        className="text-sm font-semibold text-ocean px-3 py-1 rounded-full bg-white/70"
      >
        Refresh
      </button>
    </div>
  );
}

function triggerUpdate() {
  const u = (window as unknown as { __tidelineUpdate?: () => Promise<void> }).__tidelineUpdate;
  if (u) void u();
  else location.reload();
}
