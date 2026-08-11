/**
 * The kart duel screen — full-screen, no tab bar, like /recap.
 *
 * Flow: pick a connected phone → invite/accept → lobby (avatars + track) →
 * countdown → three laps → results → rematch or exit.
 *
 * Netcode summary (the full defence lives in lib/race/net.ts): the peer
 * whose fingerprint sorts first is the host and runs the one true
 * simulation (lib/race/engine.ts). The guest steers its own kart with the
 * same physics locally — so its controls feel instant — and takes
 * everything else (opponent kart, laps, items, hits, the finish) from host
 * snapshots. React renders the chrome; the race itself lives in refs and a
 * requestAnimationFrame loop, because setState at 60Hz is how you make a
 * phone warm instead of a game fast.
 *
 * Portrait, on purpose: the entire app is a portrait phone frame (430px
 * max), the PWA manifest locks portrait, and the camera-rotated view means
 * the road ahead uses the tall axis — landscape would fight the shell for
 * no gain.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Flag, X, RotateCcw, Zap, Swords } from 'lucide-react';
import { GlassCard } from '../ui/GlassCard';
import { PillButton } from '../ui/PillButton';
import { CrewAvatar } from '../ui/CrewAvatar';
import { Confetti } from '../ui/Confetti';
import { useSession } from '../state/session';
import { useMyProfile } from '../lib/profile';
import { useAvatarSpec } from '../lib/avatar';
import { db } from '../lib/db';
import { uid } from '../lib/uuid';
import { todayYMD } from '../lib/time';
import { completeSynthetic } from '../lib/award';
import { getPeerManager, type PeerSummary } from '../lib/p2p/manager';
import { getOrCreateIdentity } from '../lib/p2p/identity';
import type { GameMsg } from '../lib/p2p/protocol';
import {
  COUNTDOWN_TICKS,
  LAPS,
  createRace,
  makeInputs,
  placeOf,
  raceTimeMs,
  stepRace,
  type RaceEvent,
  type RaceInputs,
  type RaceState,
} from '../lib/race/engine';
import {
  DT,
  NEUTRAL_INPUT,
  collideKarts,
  collideWithWalls,
  stepKart,
  type KartInput,
  type StepEvents,
} from '../lib/race/physics';
import { hashSeed, stepRipple, ITEM_LABEL, type ItemKind } from '../lib/race/items';
import { TRACKS, buildTrack, trackById, type Track } from '../lib/race/track';
import {
  INPUT_HZ,
  RACE_TIMEOUT_MS,
  SNAPSHOT_HZ,
  electHost,
  encodeRaceMsg,
  packKart,
  packKelps,
  packRipples,
  parseRaceMsg,
  unpackKart,
  unpackKelps,
  unpackRipples,
  type RaceCfg,
  type RaceNetMsg,
  type RacerIntro,
  type Snapshot,
} from '../lib/race/net';
import { buildRacerSprite, fallbackHue, type RacerSprite } from '../lib/race/sprites';
import { ITEM_GLYPH, buildTrackLayer, drawFrame, drawMinimap } from '../lib/race/render';
import { consumePendingInvite } from '../lib/race/inviteBus';
import {
  raceRunId,
  raceWinId,
  shouldRecordRace,
  winPointsToday,
  RACE_WINS_PER_DAY,
} from '../lib/race/score';
import type { AvatarSpec } from '../types';

type DuelUi =
  | { s: 'pick' }
  | { s: 'waiting'; peerName: string }
  | { s: 'invited'; peerName: string }
  | { s: 'lobby' }
  | { s: 'racing' }
  | { s: 'results'; order: number[]; timesMs: number[] }
  | { s: 'dropped'; why: string }
  | { s: 'incompatible' };

/** Opponent view runs this far behind the newest snapshot, for smooth lerp. */
const RENDER_DELAY_MS = 90;
/** Own-kart reconciliation thresholds (world units). See onSnapshot. */
const CORRECTION_DEADBAND = 40;
const CORRECTION_SNAP = 150;

export function RaceDuel() {
  const navigate = useNavigate();
  const session = useSession();
  const myId = session.identity!;
  const myProfile = useMyProfile();
  const mySpec = useAvatarSpec(myId);

  const [ui, setUiState] = useState<DuelUi>({ s: 'pick' });
  const uiRef = useRef<DuelUi>(ui);
  const setUi = useCallback((u: DuelUi) => {
    uiRef.current = u;
    setUiState(u);
  }, []);

  const [myFp, setMyFp] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<PeerSummary[]>([]);
  const [guestReady, setGuestReady] = useState(false);
  const [trackId, setTrackId] = useState(TRACKS[0].id);
  const [rematch, setRematch] = useState({ mine: false, theirs: false });
  const [toast, setToast] = useState<string | null>(null);
  const [hud, setHud] = useState({ lap: 1, place: 1, held: null as ItemKind | null, count: -1 });

  // --- everything the 60Hz loop touches lives in refs, not state ---
  const peerFpRef = useRef<string | null>(null);
  const roleRef = useRef<'host' | 'guest' | null>(null);
  const meIdxRef = useRef<0 | 1>(0);
  const racersRef = useRef<[RacerIntro | null, RacerIntro | null]>([null, null]);
  const cfgRef = useRef<RaceCfg | null>(null);
  const trackRef = useRef<Track | null>(null);
  const layerRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<RaceState | null>(null);
  const inputsRef = useRef<RaceInputs>(makeInputs());
  const myInputRef = useRef<KartInput>({ ...NEUTRAL_INPUT });
  const itemPressedRef = useRef(false);
  const seqRef = useRef(0);
  const lastPacketAtRef = useRef(0);
  const snapPrevRef = useRef<{ snap: Snapshot; at: number } | null>(null);
  const snapCurRef = useRef<{ snap: Snapshot; at: number } | null>(null);
  const spritesRef = useRef<[RacerSprite, RacerSprite]>([
    { face: null, hue: 200 }, { face: null, hue: 20 },
  ]);
  const pendingEventsRef = useRef<RaceEvent[]>([]);
  const finSentRef = useRef(false);
  const mintedRaceRef = useRef<string | null>(null);
  const notifiedNopeRef = useRef(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniRef = useRef<HTMLCanvasElement | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 1800);
  }, []);

  const send = useCallback((msg: RaceNetMsg): boolean => {
    const fp = peerFpRef.current;
    if (!fp) return false;
    return getPeerManager().sendGame(fp, encodeRaceMsg(msg));
  }, []);

  const myIntro = useCallback((): RacerIntro => ({
    memberId: myId,
    name: myProfile?.displayName ?? 'Racer',
    avatar: mySpec ?? null,
  }), [myId, myProfile, mySpec]);

  // Identity fingerprint — needed before any host election can happen.
  useEffect(() => {
    let cancelled = false;
    void getOrCreateIdentity().then((id) => { if (!cancelled) setMyFp(id.fingerprint); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => getPeerManager().subscribe(setSummaries), []);

  const livePeers = summaries.filter((s) => s.state === 'syncing' || s.state === 'idle');

  // If our racing partner's connection dies at any stage, say so instead of
  // spinning forever. (During the race itself the packet watchdog usually
  // fires first — this catches lobby/results-stage drops.)
  useEffect(() => {
    const fp = peerFpRef.current;
    if (!fp) return;
    const engaged = ['waiting', 'invited', 'lobby', 'racing', 'results'].includes(ui.s);
    if (engaged && !summaries.some((s) => s.fingerprint === fp)) {
      setUi({ s: 'dropped', why: 'The connection to the other phone closed.' });
    }
  }, [summaries, ui.s, setUi]);

  // ---------- role/lobby plumbing ----------

  const establishRoles = useCallback((theirs: RacerIntro) => {
    const fp = peerFpRef.current;
    // Identity loads from IndexedDB in the first frames after mount; a race
    // message can't realistically beat it, but a null here must not crash.
    if (!fp || !myFp) return;
    const host = electHost(myFp, fp);
    roleRef.current = host ? 'host' : 'guest';
    meIdxRef.current = host ? 0 : 1;
    const mine = myIntro();
    racersRef.current = host ? [mine, theirs] : [theirs, mine];
    setRematch({ mine: false, theirs: false });
    setGuestReady(false);
    if (host) {
      const raceId = uid();
      const cfg: RaceCfg = { raceId, trackId, laps: LAPS };
      cfgRef.current = cfg;
      send({ kind: 'cfg', cfg });
    }
    setUi({ s: 'lobby' });
  }, [myFp, myIntro, send, setUi, trackId]);

  const startRace = useCallback(() => {
    const cfg = cfgRef.current;
    if (!cfg) return;
    const def = trackById(cfg.trackId);
    if (!def) {
      // A track id we don't ship — the other side runs a newer build.
      setUi({ s: 'incompatible' });
      return;
    }
    const track = buildTrack(def);
    trackRef.current = track;
    layerRef.current = buildTrackLayer(track);
    stateRef.current = createRace(track);
    inputsRef.current = makeInputs();
    myInputRef.current = { ...NEUTRAL_INPUT };
    itemPressedRef.current = false;
    snapPrevRef.current = null;
    snapCurRef.current = null;
    pendingEventsRef.current = [];
    finSentRef.current = false;
    lastPacketAtRef.current = Date.now();
    setHud({ lap: 1, place: 1, held: null, count: 3 });
    setUi({ s: 'racing' });
  }, [setUi]);

  const finishRace = useCallback((order: number[], timesMs: number[]) => {
    setUi({ s: 'results', order, timesMs });
  }, [setUi]);

  // ---------- incoming game frames ----------

  const applySnapshot = useCallback((snap: Snapshot) => {
    const st = stateRef.current;
    const track = trackRef.current;
    if (!st || !track) return;
    const now = performance.now();
    snapPrevRef.current = snapCurRef.current;
    snapCurRef.current = { snap, at: now };

    st.tick = snap.t;
    if (st.phase !== 'finished') st.phase = snap.ph;
    st.held = [snap.hi[0] ?? null, snap.hi[1] ?? null];
    st.kelps = unpackKelps(snap.ke);
    st.ripples = unpackRipples(snap.ri);
    st.boxReadyAt = snap.bx.slice();

    // My kart: outcomes are the host's word, position is mostly mine.
    const meIdx = meIdxRef.current;
    const me = st.karts[meIdx];
    const wire = snap.k[meIdx];
    me.lap = wire.lap;
    me.nextCp = wire.cp;
    me.spinMs = wire.sp;          // spins only ever originate on the host
    me.shieldMs = wire.sh;
    me.boostMs = Math.max(me.boostMs, wire.bo); // keep locally-predicted drift boosts
    const errX = wire.x - me.x;
    const errY = wire.y - me.y;
    const err = Math.hypot(errX, errY);
    if (err > CORRECTION_SNAP) {
      // Hopelessly divergent (e.g. we missed a spin) — take the host's view.
      me.x = wire.x; me.y = wire.y; me.heading = wire.h;
      me.vx = wire.vx; me.vy = wire.vy;
    } else if (err > CORRECTION_DEADBAND) {
      // Gentle nudge; the deadband absorbs ordinary latency skew so the kart
      // never feels like it's being dragged by a ghost.
      me.x += errX * 0.15;
      me.y += errY * 0.15;
    }

    for (const ev of snap.ev) handleRaceEvent(ev);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRaceEvent = useCallback((ev: RaceEvent) => {
    const meIdx = meIdxRef.current;
    const them = racersRef.current[1 - meIdx]?.name ?? 'They';
    switch (ev.t) {
      case 'lap':
        if (ev.kart === meIdx) showToast(`Lap ${ev.lap + 1} of ${LAPS}`);
        break;
      case 'pickup':
        if (ev.kart === meIdx) showToast(`${ITEM_GLYPH[ev.item]} ${ITEM_LABEL[ev.item]}!`);
        break;
      case 'spin':
        showToast(ev.kart === meIdx ? 'Spun out!' : `${them} spun out!`);
        break;
      case 'blocked':
        if (ev.kart === meIdx) showToast('Bubble popped — saved!');
        break;
      case 'boost':
        if (ev.kart === meIdx) showToast(ev.tier === 2 ? 'Super boost!' : 'Drift boost!');
        break;
      default:
        break;
    }
  }, [showToast]);

  const onGameMsg = useCallback((fp: string, gmsg: GameMsg) => {
    const parsed = parseRaceMsg(gmsg);
    if (parsed === null) return;
    const engagedWith = peerFpRef.current;
    if (!parsed.ok) {
      // Their game speaks a different version. Tell them once, tell the user.
      if (!notifiedNopeRef.current) {
        notifiedNopeRef.current = true;
        getPeerManager().sendGame(fp, encodeRaceMsg({ kind: 'nope', gv: gmsg.gv }));
      }
      if (!engagedWith || engagedWith === fp) setUi({ s: 'incompatible' });
      return;
    }
    const msg = parsed.msg;
    if (engagedWith && fp !== engagedWith && msg.kind !== 'invite') return;
    lastPacketAtRef.current = Date.now();

    switch (msg.kind) {
      case 'invite': {
        const st = uiRef.current.s;
        if (st === 'pick' || st === 'invited') {
          peerFpRef.current = fp;
          racersRef.current = [null, null];
          // Stash their intro; roles are established when we accept.
          racersRef.current[0] = msg.intro; // temporary slot, re-laid in accept
          setUi({ s: 'invited', peerName: msg.intro.name });
        } else if (st === 'waiting' && fp === engagedWith) {
          // Both phones tapped "invite" at once. Symmetric and harmless:
          // each side treats the crossing invite as an acceptance, and the
          // deterministic host election below agrees on who drives.
          establishRoles(msg.intro);
        }
        break;
      }
      case 'accept':
        if (uiRef.current.s === 'waiting') establishRoles(msg.intro);
        break;
      case 'decline':
        if (uiRef.current.s === 'waiting') {
          setUi({ s: 'pick' });
          showToast('They passed on the race.');
        }
        break;
      case 'cfg':
        cfgRef.current = msg.cfg;
        if (roleRef.current === 'guest') {
          if (!trackById(msg.cfg.trackId)) {
            setUi({ s: 'incompatible' });
            break;
          }
          setTrackId(msg.cfg.trackId);
          if (uiRef.current.s === 'results' || uiRef.current.s === 'lobby') {
            // A fresh cfg after results is the host setting up the rematch.
            if (uiRef.current.s === 'results') setUi({ s: 'lobby' });
            send({ kind: 'ready' });
          }
        }
        break;
      case 'ready':
        if (roleRef.current === 'host') setGuestReady(true);
        break;
      case 'go':
        if (roleRef.current === 'guest') startRace();
        break;
      case 'in':
        if (roleRef.current === 'host' && stateRef.current) {
          const guestInput = inputsRef.current.karts[1];
          guestInput.steer = msg.st;
          guestInput.throttle = msg.th;
          guestInput.drift = msg.dr === 1;
          if (msg.it === 1) inputsRef.current.useItem[1] = true;
        }
        break;
      case 'st':
        if (roleRef.current === 'guest') applySnapshot(msg.snap);
        break;
      case 'fin':
        if (roleRef.current === 'guest') finishRace(msg.order, msg.timesMs);
        break;
      case 'rematch':
        setRematch((r) => ({ ...r, theirs: true }));
        break;
      case 'leave': {
        const st = uiRef.current.s;
        if (st === 'racing') setUi({ s: 'dropped', why: 'The other kart left the race.' });
        else if (st === 'lobby' || st === 'waiting' || st === 'results') {
          setUi({ s: 'pick' });
          showToast('They left.');
        }
        break;
      }
      case 'nope':
        setUi({ s: 'incompatible' });
        break;
    }
  }, [applySnapshot, establishRoles, finishRace, send, setUi, showToast, startRace]);

  useEffect(() => getPeerManager().onGame(onGameMsg), [onGameMsg]);

  // An invite may have arrived while we were on another screen (the banner
  // in App.tsx navigated us here); pick it up exactly once.
  useEffect(() => {
    const pending = consumePendingInvite();
    if (!pending) return;
    peerFpRef.current = pending.fromFingerprint;
    racersRef.current = [pending.intro, null];
    setUi({ s: 'invited', peerName: pending.intro.name });
  }, [setUi]);

  // ---------- lobby actions ----------

  const invite = useCallback((fp: string) => {
    peerFpRef.current = fp;
    notifiedNopeRef.current = false;
    const peer = summaries.find((s) => s.fingerprint === fp);
    if (!getPeerManager().sendGame(fp, encodeRaceMsg({ kind: 'invite', intro: myIntro() }))) {
      showToast("Couldn't reach that phone.");
      return;
    }
    setUi({ s: 'waiting', peerName: peer?.displayName ?? 'them' });
  }, [myIntro, setUi, showToast, summaries]);

  const acceptInvite = useCallback(() => {
    const theirs = racersRef.current[0];
    if (!theirs || !myFp) return;
    send({ kind: 'accept', intro: myIntro() });
    establishRoles(theirs);
  }, [establishRoles, myFp, myIntro, send]);

  const declineInvite = useCallback(() => {
    send({ kind: 'decline' });
    peerFpRef.current = null;
    setUi({ s: 'pick' });
  }, [send, setUi]);

  const pickTrack = useCallback((id: string) => {
    setTrackId(id);
    if (roleRef.current === 'host' && cfgRef.current) {
      cfgRef.current = { ...cfgRef.current, trackId: id };
      send({ kind: 'cfg', cfg: cfgRef.current });
    }
  }, [send]);

  const hostStart = useCallback(() => {
    if (roleRef.current !== 'host' || !guestReady) return;
    send({ kind: 'go' });
    startRace();
  }, [guestReady, send, startRace]);

  const requestRematch = useCallback(() => {
    setRematch((r) => ({ ...r, mine: true }));
    send({ kind: 'rematch' });
  }, [send]);

  // Both want a rematch → the host mints a fresh race id (fresh points
  // dedup key, fresh item seed) and everyone returns to the lobby.
  useEffect(() => {
    if (!rematch.mine || !rematch.theirs) return;
    setRematch({ mine: false, theirs: false });
    setGuestReady(false);
    mintedRaceRef.current = null;
    if (roleRef.current === 'host') {
      const cfg: RaceCfg = { raceId: uid(), trackId, laps: LAPS };
      cfgRef.current = cfg;
      send({ kind: 'cfg', cfg });
    }
    setUi({ s: 'lobby' });
  }, [rematch, send, setUi, trackId]);

  const exit = useCallback(() => {
    send({ kind: 'leave' });
    navigate('/devices');
  }, [navigate, send]);

  // Tell the other side we're gone if this screen unmounts mid-anything.
  useEffect(() => () => {
    const st = uiRef.current.s;
    if (st !== 'pick') {
      const fp = peerFpRef.current;
      if (fp) getPeerManager().sendGame(fp, encodeRaceMsg({ kind: 'leave' }));
    }
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  // ---------- sprites (avatars → offscreen canvases) ----------

  const theirMemberId = racersRef.current[1 - meIdxRef.current]?.memberId ?? null;
  const dbTheirSpec = useLiveQuery(
    async () => (theirMemberId ? ((await db.avatarSpecs.get(theirMemberId)) ?? null) : null),
    [theirMemberId],
  );

  useEffect(() => {
    if (ui.s !== 'lobby') return;
    let cancelled = false;
    const racers = racersRef.current;
    void (async () => {
      const built = await Promise.all([0, 1].map(async (i) => {
        const intro = racers[i];
        if (!intro) return { face: null, hue: 200 } as RacerSprite;
        // Handshake spec first (fresh from the other phone), then whatever
        // git sync already delivered, then the plain-kart fallback.
        const spec: AvatarSpec | null =
          intro.avatar ?? (intro.memberId === theirMemberId ? dbTheirSpec ?? null : null);
        const sprite = await buildRacerSprite(spec, intro.memberId, 64);
        if (!spec) sprite.hue = fallbackHue(intro.memberId);
        return sprite;
      }));
      if (!cancelled) spritesRef.current = [built[0], built[1]];
    })();
    return () => { cancelled = true; };
  }, [ui.s, dbTheirSpec, theirMemberId]);

  // ---------- the race loop ----------

  useEffect(() => {
    if (ui.s !== 'racing') return;
    const role = roleRef.current;
    const meIdx = meIdxRef.current;
    const track = trackRef.current;
    const state = stateRef.current;
    const layer = layerRef.current;
    const cfg = cfgRef.current;
    if (!role || !track || !state || !layer || !cfg) return;

    const canvas = canvasRef.current;
    const mini = miniRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const miniCtx = mini?.getContext('2d') ?? null;
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const raceConfig = { seed: hashSeed(cfg.raceId), laps: cfg.laps };
    const scratch: RaceEvent[] = [];
    const stepEv: StepEvents = { driftBoost: 0, wallHit: false };
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let snapAcc = 0;
    const STEP_MS = DT * 1000;
    const SNAP_EVERY_MS = 1000 / SNAPSHOT_HZ;

    const stepHostTick = () => {
      inputsRef.current.karts[0].steer = myInputRef.current.steer;
      inputsRef.current.karts[0].throttle = myInputRef.current.throttle;
      inputsRef.current.karts[0].drift = myInputRef.current.drift;
      if (itemPressedRef.current) {
        inputsRef.current.useItem[0] = true;
        itemPressedRef.current = false;
      }
      stepRace(state, track, inputsRef.current, raceConfig, scratch);
      for (const ev of scratch) {
        handleRaceEvent(ev);
        pendingEventsRef.current.push(ev);
      }
      if (state.phase === 'finished' && !finSentRef.current) {
        finSentRef.current = true;
        const timesMs = [raceTimeMs(state, 0), raceTimeMs(state, 1)];
        send({ kind: 'fin', order: state.finishOrder.slice(), timesMs });
        finishRace(state.finishOrder.slice(), timesMs);
      }
    };

    const stepGuestTick = () => {
      state.tick++;
      if (state.phase === 'countdown' && state.tick >= COUNTDOWN_TICKS) state.phase = 'racing';
      if (state.phase !== 'racing') return;
      const me = state.karts[meIdx];
      stepKart(me, myInputRef.current, stepEv);
      if (stepEv.driftBoost) {
        handleRaceEvent({ t: 'boost', kart: meIdx, tier: stepEv.driftBoost });
      }
      collideWithWalls(me, track);
      // Bump against the opponent's *displayed* kart. Clone it so only our
      // kart reacts — the real resolution happens on the host.
      const oppGhost = { ...state.karts[1 - meIdx] };
      collideKarts(meIdx === 0 ? me : oppGhost, meIdx === 0 ? oppGhost : me);
      // Ripples advance cosmetically between snapshots; hits stay host-side.
      for (const r of state.ripples) {
        stepRipple(r, track, state.karts[r.target].progress);
      }
    };

    const sendSnapshot = () => {
      const snap: Snapshot = {
        t: state.tick,
        ph: state.phase,
        k: [packKart(state.karts[0]), packKart(state.karts[1])],
        hi: state.held.slice(),
        ke: packKelps(state.kelps),
        ri: packRipples(state.ripples),
        ev: pendingEventsRef.current.splice(0),
        bx: state.boxReadyAt.slice(),
      };
      send({ kind: 'st', snap });
    };

    const lerpOpponent = (now: number) => {
      const cur = snapCurRef.current;
      if (!cur) return;
      const prev = snapPrevRef.current;
      const oppIdx = 1 - meIdx;
      const target = state.karts[oppIdx];
      const curWire = cur.snap.k[oppIdx];
      if (!prev || cur.at - prev.at < 1) {
        unpackKart(curWire, target);
        return;
      }
      const prevWire = prev.snap.k[oppIdx];
      const t = Math.max(0, Math.min(1.25, (now - RENDER_DELAY_MS - prev.at) / (cur.at - prev.at)));
      target.x = prevWire.x + (curWire.x - prevWire.x) * t;
      target.y = prevWire.y + (curWire.y - prevWire.y) * t;
      let dh = curWire.h - prevWire.h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      target.heading = prevWire.h + dh * t;
      target.boostMs = curWire.bo;
      target.spinMs = curWire.sp;
      target.shieldMs = curWire.sh;
      target.driftDir = curWire.dd;
      target.driftCharge = curWire.dc;
      target.lap = curWire.lap;
      target.nextCp = curWire.cp;
      target.progress = curWire.pr / 10000;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      let elapsed = now - last;
      last = now;
      // A backgrounded tab hands us a huge gap on resume. Simulating through
      // it would fast-forward the world; the watchdog below will end the
      // race anyway, so just clamp and stay smooth.
      if (elapsed > 250) elapsed = 250;
      acc += elapsed;
      while (acc >= STEP_MS) {
        acc -= STEP_MS;
        if (role === 'host') stepHostTick();
        else stepGuestTick();
      }
      if (role === 'host') {
        snapAcc += elapsed;
        if (snapAcc >= SNAP_EVERY_MS && state.phase !== 'finished') {
          snapAcc = 0;
          sendSnapshot();
        }
      } else {
        lerpOpponent(now);
      }

      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.save();
      ctx.scale(dpr, dpr);
      drawFrame(ctx, {
        state, track, layer,
        sprites: spritesRef.current,
        meIdx, width: w, height: h, nowMs: now,
      });
      ctx.restore();
      if (miniCtx && mini) {
        miniCtx.clearRect(0, 0, mini.width, mini.height);
        drawMinimap(miniCtx, track, state, meIdx, mini.width);
      }

      // HUD state updates only when a value actually changes — React is for
      // chrome, not for the 60Hz path.
      const me = state.karts[meIdx];
      const count = state.phase === 'countdown'
        ? Math.ceil((COUNTDOWN_TICKS - state.tick) / 60)
        : state.tick - COUNTDOWN_TICKS < 60 ? 0 : -1;
      const lap = Math.min(me.lap + 1, LAPS);
      const place = placeOf(state, track, meIdx) + 1;
      const held = state.held[meIdx];
      setHud((prev) => (
        prev.lap === lap && prev.place === place && prev.held === held && prev.count === count
          ? prev
          : { lap, place, held, count }
      ));
    };
    raf = requestAnimationFrame(frame);

    // Guest → host input stream.
    let inputTimer: ReturnType<typeof setInterval> | null = null;
    if (role === 'guest') {
      inputTimer = setInterval(() => {
        const inp = myInputRef.current;
        const it = itemPressedRef.current ? 1 : 0;
        itemPressedRef.current = false;
        send({
          kind: 'in', seq: seqRef.current++,
          st: Math.round(inp.steer * 100) / 100,
          th: inp.throttle,
          dr: inp.drift ? 1 : 0,
          it: it as 0 | 1,
        });
      }, 1000 / INPUT_HZ);
    }

    // Watchdog: silence mid-race means a dead peer or a suspended PWA.
    const watchdog = setInterval(() => {
      if (Date.now() - lastPacketAtRef.current > RACE_TIMEOUT_MS) {
        setUi({ s: 'dropped', why: 'Lost the other kart — the race is called off.' });
      }
    }, 500);

    // If *we* get backgrounded mid-race, iOS freezes us without warning.
    // Bow out loudly so the other phone gets a clean ending, not a timeout.
    const onHide = () => {
      if (document.visibilityState === 'hidden' && uiRef.current.s === 'racing') {
        send({ kind: 'leave' });
        setUi({ s: 'dropped', why: 'The race ended when the app went to the background.' });
      }
    };
    document.addEventListener('visibilitychange', onHide);

    return () => {
      cancelAnimationFrame(raf);
      if (inputTimer) clearInterval(inputTimer);
      clearInterval(watchdog);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [ui.s, finishRace, handleRaceEvent, send, setUi]);

  // ---------- points (results phase) ----------

  useEffect(() => {
    if (ui.s !== 'results') return;
    const cfg = cfgRef.current;
    if (!cfg || mintedRaceRef.current === cfg.raceId) return;
    mintedRaceRef.current = cfg.raceId;
    const meIdx = meIdxRef.current;
    const won = ui.order[0] === meIdx;
    const myTimeMs = ui.timesMs[meIdx] ?? 0;
    void (async () => {
      const completions = await db.completions.toArray();
      const today = todayYMD();
      // Record cap: past N races a day we stop writing records entirely —
      // every completion is also a commit to the family repo.
      if (!shouldRecordRace(completions, myId, today)) return;
      const points = won ? winPointsToday(completions, myId, today) : 0;
      await completeSynthetic({
        challengeId: won ? raceWinId(cfg.raceId) : raceRunId(cfg.raceId),
        by: myId,
        points,
        commitMessage: won ? 'race: win' : 'race: finish',
        // Deci-seconds keep the mark a small int; the recap can say how fast.
        marks: [Math.round(myTimeMs / 100)],
      });
    })();
  }, [ui, myId]);

  // ---------- render ----------

  const meIdx = meIdxRef.current;
  const racers = racersRef.current;

  if (ui.s === 'racing') {
    return (
      <div className="fixed inset-0 bg-ink-900 select-none touch-none">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {/* HUD top row */}
        <div className="absolute top-[max(env(safe-area-inset-top),0.75rem)] inset-x-3 flex items-start justify-between pointer-events-none">
          <div className="glass-dark rounded-2xl px-3 py-1.5 text-sm font-semibold tabular">
            Lap {hud.lap}/{LAPS}
          </div>
          <div className="glass-dark rounded-2xl px-3 py-1.5 text-sm font-semibold">
            {hud.place === 1 ? '1st' : '2nd'}
          </div>
          <canvas ref={miniRef} width={96} height={96} className="rounded-2xl glass-dark" />
        </div>
        {toast && (
          <div className="absolute top-24 inset-x-0 text-center pointer-events-none">
            <span className="glass-dark rounded-full px-4 py-1.5 text-sm font-medium">{toast}</span>
          </div>
        )}
        {hud.count > 0 && <CountOverlay label={String(hud.count)} racers={racers} />}
        {hud.count === 0 && <CountOverlay label="GO!" racers={null} />}
        <RaceControls
          inputRef={myInputRef}
          onItem={() => { itemPressedRef.current = true; }}
          heldItem={hud.held}
        />
      </div>
    );
  }

  return (
    <div className="min-h-dvh pt-[max(env(safe-area-inset-top),1rem)] px-4 pb-8 space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-600 font-medium">Two phones, one winner</div>
          <h1 className="font-display text-2xl font-semibold leading-tight">Kart Duel</h1>
        </div>
        <button
          type="button"
          onClick={exit}
          aria-label="Leave the duel"
          className="grid h-10 w-10 place-items-center rounded-full glass"
        >
          <X size={18} />
        </button>
      </header>

      {ui.s === 'pick' && (
        <>
          <GlassCard className="space-y-2">
            <div className="flex items-center gap-2 font-medium"><Swords size={16} /> How it works</div>
            <div className="text-xs text-ink-600">
              Race a family member, crew avatar vs. crew avatar — three laps,
              drift boosts, items. Your phones talk directly to each other, so
              you must be <strong>paired and in the same room</strong>. No
              internet needed.
            </div>
          </GlassCard>
          {livePeers.length === 0 ? (
            <GlassCard className="space-y-3">
              <div className="text-sm">No phone connected right now.</div>
              <div className="text-xs text-ink-600">
                Connect on the Devices screen first (Sync with another phone),
                then come back here.
              </div>
              <PillButton onClick={() => navigate('/devices')} className="w-full justify-center">
                Open Devices
              </PillButton>
            </GlassCard>
          ) : (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-ink-600 px-1">Challenge</div>
              {livePeers.map((p) => (
                <GlassCard key={p.fingerprint} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0 font-medium truncate">{p.displayName || p.memberId}</div>
                  <PillButton variant="solid" icon={<Flag size={14} />} onClick={() => invite(p.fingerprint)}>
                    Race
                  </PillButton>
                </GlassCard>
              ))}
            </div>
          )}
        </>
      )}

      {ui.s === 'waiting' && (
        <GlassCard className="space-y-3 text-center">
          <div className="font-medium">Challenge sent to {ui.peerName}</div>
          <div className="text-xs text-ink-600">
            Waiting for them to accept… If nothing happens, their app may need
            an update before it can race.
          </div>
          <PillButton onClick={() => { send({ kind: 'leave' }); setUi({ s: 'pick' }); }} className="justify-center">
            Cancel
          </PillButton>
        </GlassCard>
      )}

      {ui.s === 'invited' && (
        <GlassCard className="space-y-3 text-center ring-2 ring-ocean/40">
          <div className="text-xs uppercase tracking-wider text-ocean">Challenge!</div>
          <div className="font-medium">{ui.peerName} wants to race you</div>
          <div className="flex gap-2">
            <PillButton variant="solid" onClick={acceptInvite} className="flex-1 justify-center" disabled={!myFp}>
              Let&apos;s go
            </PillButton>
            <PillButton onClick={declineInvite} className="flex-1 justify-center">
              Not now
            </PillButton>
          </div>
        </GlassCard>
      )}

      {ui.s === 'lobby' && (
        <>
          <VersusCard racers={racers} meIdx={meIdx} subline="Best driver takes the flag" />
          <GlassCard className="space-y-3">
            <div className="text-xs uppercase tracking-wider text-ink-600">Track</div>
            {TRACKS.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={roleRef.current !== 'host'}
                onClick={() => pickTrack(t.id)}
                aria-pressed={trackId === t.id}
                className={`w-full text-left rounded-2xl px-4 py-3 transition ${
                  trackId === t.id ? 'bg-ink-900 text-white' : 'bg-white/70 text-ink-700'
                } disabled:opacity-70`}
              >
                <div className="font-medium text-sm">{t.name}</div>
                <div className={`text-xs ${trackId === t.id ? 'text-white/70' : 'text-ink-600'}`}>{t.vibe}</div>
              </button>
            ))}
            {roleRef.current !== 'host' && (
              <div className="text-xs text-ink-600">
                {racers[0]?.name ?? 'The host'} picks the track.
              </div>
            )}
          </GlassCard>
          {roleRef.current === 'host' ? (
            <PillButton
              variant="solid"
              onClick={hostStart}
              disabled={!guestReady}
              icon={<Flag size={14} />}
              className="w-full justify-center"
            >
              {guestReady ? 'Start race' : 'Waiting for them…'}
            </PillButton>
          ) : (
            <GlassCard className="text-center text-sm text-ink-600">
              Ready — waiting for {racers[0]?.name ?? 'the host'} to start.
            </GlassCard>
          )}
          <GlassCard className="text-xs text-ink-600">
            <strong>Drive:</strong> steer with the slider, hold <strong>Drift</strong> in
            corners and release for a boost, tap the item bubble to use what
            you grabbed. 3 laps. Walls hurt your speed, not your feelings.
          </GlassCard>
        </>
      )}

      {ui.s === 'results' && (
        <ResultsView
          ui={ui}
          racers={racers}
          meIdx={meIdx}
          rematch={rematch}
          onRematch={requestRematch}
          onExit={exit}
        />
      )}

      {ui.s === 'dropped' && (
        <GlassCard className="space-y-3 text-center">
          <div className="font-medium">Race called off</div>
          <div className="text-xs text-ink-600">{ui.why} No points either way — rematch when you&apos;re both back.</div>
          <PillButton onClick={() => { peerFpRef.current = null; setUi({ s: 'pick' }); }} className="justify-center w-full">
            Back
          </PillButton>
        </GlassCard>
      )}

      {ui.s === 'incompatible' && (
        <GlassCard className="space-y-3 text-center">
          <div className="font-medium">Different app versions</div>
          <div className="text-xs text-ink-600">
            One of the phones is running an older build that can&apos;t play this
            game. Photos and messages still sync fine — update the app on both
            phones to race.
          </div>
          <PillButton onClick={() => { peerFpRef.current = null; setUi({ s: 'pick' }); }} className="justify-center w-full">
            Back
          </PillButton>
        </GlassCard>
      )}
    </div>
  );
}

// ---------- subcomponents ----------

function RacerFace({ intro, size }: { intro: RacerIntro | null; size: number }) {
  if (intro?.avatar) return <CrewAvatar spec={intro.avatar} size={size} alt={intro.name} />;
  const hue = intro ? fallbackHue(intro.memberId) : 200;
  return (
    <span
      role="img"
      aria-label={intro?.name ?? 'Racer'}
      className="inline-block rounded-full shadow-md"
      style={{ width: size, height: size, background: `hsl(${hue} 45% 70%)` }}
    />
  );
}

function VersusCard({
  racers, meIdx, subline,
}: {
  racers: [RacerIntro | null, RacerIntro | null];
  meIdx: number;
  subline: string;
}) {
  return (
    <GlassCard className="relative flex items-center justify-around !py-6">
      {[meIdx, 1 - meIdx].map((idx, col) => (
        <div key={idx} className="flex flex-col items-center gap-2 min-w-0">
          <RacerFace intro={racers[idx]} size={72} />
          <div className="text-sm font-medium truncate max-w-28">
            {col === 0 ? 'You' : racers[idx]?.name ?? '…'}
          </div>
        </div>
      ))}
      <div className="absolute inset-x-0 text-center pointer-events-none">
        <div className="font-display text-2xl font-semibold text-ink-900/70">VS</div>
        <div className="text-[10px] uppercase tracking-wider text-ink-600 mt-1">{subline}</div>
      </div>
    </GlassCard>
  );
}

function CountOverlay({
  label, racers,
}: {
  label: string;
  racers: [RacerIntro | null, RacerIntro | null] | null;
}) {
  return (
    <div className="absolute inset-0 grid place-items-center pointer-events-none">
      <div className="flex flex-col items-center gap-4">
        {racers && (
          <div className="flex items-center gap-6">
            <RacerFace intro={racers[0]} size={56} />
            <span className="text-white/80 font-display font-semibold">VS</span>
            <RacerFace intro={racers[1]} size={56} />
          </div>
        )}
        <div className="font-display text-7xl font-semibold text-white drop-shadow-lg animate-pulse">
          {label}
        </div>
      </div>
    </div>
  );
}

function ResultsView({
  ui, racers, meIdx, rematch, onRematch, onExit,
}: {
  ui: Extract<DuelUi, { s: 'results' }>;
  racers: [RacerIntro | null, RacerIntro | null];
  meIdx: number;
  rematch: { mine: boolean; theirs: boolean };
  onRematch: () => void;
  onExit: () => void;
}) {
  const iWon = ui.order[0] === meIdx;
  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;
  };
  const [capNote, setCapNote] = useState(false);
  const myId = useSession((s) => s.identity);
  useEffect(() => {
    if (!iWon || !myId) return;
    let cancelled = false;
    void db.completions.toArray().then((cs) => {
      if (!cancelled) setCapNote(winPointsToday(cs, myId, todayYMD()) === 0);
    });
    return () => { cancelled = true; };
  }, [iWon, myId]);

  return (
    <>
      {iWon && <Confetti />}
      <GlassCard className="space-y-4 text-center !py-8">
        <div className="text-xs uppercase tracking-wider text-ink-600">
          {iWon ? 'Victory' : 'So close'}
        </div>
        <div className="flex items-center justify-center gap-3">
          <RacerFace intro={racers[ui.order[0]]} size={84} />
        </div>
        <div className="font-display text-2xl font-semibold">
          {iWon ? 'You take the flag!' : `${racers[ui.order[0]]?.name ?? 'They'} takes the flag`}
        </div>
        <div className="space-y-1">
          {ui.order.map((idx, place) => (
            <div key={idx} className="flex items-center justify-center gap-2 text-sm">
              <span className="font-semibold">{place === 0 ? '🏁 1st' : '2nd'}</span>
              <span>{idx === meIdx ? 'You' : racers[idx]?.name ?? '…'}</span>
              <span className="tabular text-ink-600">{fmt(ui.timesMs[idx] ?? 0)}</span>
            </div>
          ))}
        </div>
        {iWon && (
          <div className="text-xs text-ink-600">
            {capNote
              ? `Raced for glory — you've already banked your ${RACE_WINS_PER_DAY} winning races today.`
              : 'Points added to your tally.'}
          </div>
        )}
      </GlassCard>
      <div className="flex gap-2">
        <PillButton
          variant="solid"
          icon={<RotateCcw size={14} />}
          onClick={onRematch}
          disabled={rematch.mine}
          className="flex-1 justify-center"
        >
          {rematch.mine ? 'Waiting for them…' : rematch.theirs ? 'They want a rematch!' : 'Rematch'}
        </PillButton>
        <PillButton onClick={onExit} icon={<X size={14} />} className="flex-1 justify-center">
          Done
        </PillButton>
      </div>
    </>
  );
}

/**
 * Touch controls. Left two-thirds is an analog steering strip (thumb
 * position maps to steering angle — big target, no precision required);
 * right side stacks DRIFT (hold) over the item bubble (tap). Keyboard mirrors
 * everything for desktop testing: ←/→ or A/D steer, Shift drifts, Space uses
 * the item, ↓ brakes. Throttle is automatic — a phone screen has no spare
 * thumb for a gas pedal, and holding "go" adds fatigue, not depth.
 */
function RaceControls({
  inputRef, onItem, heldItem,
}: {
  inputRef: React.MutableRefObject<KartInput>;
  onItem: () => void;
  heldItem: ItemKind | null;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const steerPointerRef = useRef<number | null>(null);
  const [steerPos, setSteerPos] = useState<number | null>(null);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const setSteer = (clientX: number) => {
      const rect = strip.getBoundingClientRect();
      const frac = (clientX - rect.left) / rect.width; // 0..1
      const steer = Math.max(-1, Math.min(1, (frac - 0.5) * 2.4)); // slight overdrive near edges
      inputRef.current.steer = steer;
      setSteerPos(frac);
    };
    const down = (e: PointerEvent) => {
      if (steerPointerRef.current !== null) return;
      steerPointerRef.current = e.pointerId;
      strip.setPointerCapture(e.pointerId);
      setSteer(e.clientX);
    };
    const move = (e: PointerEvent) => {
      if (steerPointerRef.current !== e.pointerId) return;
      setSteer(e.clientX);
    };
    const up = (e: PointerEvent) => {
      if (steerPointerRef.current !== e.pointerId) return;
      steerPointerRef.current = null;
      inputRef.current.steer = 0;
      setSteerPos(null);
    };
    strip.addEventListener('pointerdown', down);
    strip.addEventListener('pointermove', move);
    strip.addEventListener('pointerup', up);
    strip.addEventListener('pointercancel', up);
    return () => {
      strip.removeEventListener('pointerdown', down);
      strip.removeEventListener('pointermove', move);
      strip.removeEventListener('pointerup', up);
      strip.removeEventListener('pointercancel', up);
    };
  }, [inputRef]);

  // Keyboard for desktop testing.
  useEffect(() => {
    const keys = new Set<string>();
    const apply = () => {
      const left = keys.has('ArrowLeft') || keys.has('a');
      const right = keys.has('ArrowRight') || keys.has('d');
      inputRef.current.steer = left && !right ? -1 : right && !left ? 1 : 0;
      inputRef.current.drift = keys.has('Shift') || keys.has('s');
      inputRef.current.throttle = keys.has('ArrowDown') ? -1 : 1;
    };
    const downK = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); onItem(); return; }
      keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      apply();
    };
    const upK = (e: KeyboardEvent) => {
      keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      apply();
    };
    window.addEventListener('keydown', downK);
    window.addEventListener('keyup', upK);
    return () => {
      window.removeEventListener('keydown', downK);
      window.removeEventListener('keyup', upK);
    };
  }, [inputRef, onItem]);

  return (
    <div className="absolute bottom-0 inset-x-0 pb-[max(env(safe-area-inset-bottom),0.75rem)] px-3 flex items-end gap-3">
      {/* Steering strip */}
      <div
        ref={stripRef}
        className="flex-1 h-24 rounded-3xl glass-dark relative touch-none"
        role="slider"
        aria-label="Steering"
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={Math.round(inputRef.current.steer * 10) / 10}
      >
        <div className="absolute inset-y-3 left-1/2 w-px bg-white/30" />
        <div className="absolute inset-y-0 left-3 grid place-items-center text-white/50 text-xl">‹</div>
        <div className="absolute inset-y-0 right-3 grid place-items-center text-white/50 text-xl">›</div>
        {steerPos !== null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-16 w-16 rounded-full bg-white/30 ring-2 ring-white/60"
            style={{ left: `${steerPos * 100}%` }}
          />
        )}
      </div>
      {/* Drift + item */}
      <div className="flex flex-col gap-2 items-center">
        <button
          type="button"
          aria-label={heldItem ? `Use ${ITEM_LABEL[heldItem]}` : 'No item held'}
          onPointerDown={(e) => { e.preventDefault(); if (heldItem) onItem(); }}
          className={`h-14 w-14 rounded-full glass-dark grid place-items-center text-2xl transition ${
            heldItem ? 'ring-2 ring-[#e5b842] scale-105' : 'opacity-60'
          }`}
        >
          {heldItem ? ITEM_GLYPH[heldItem] : '·'}
        </button>
        <button
          type="button"
          aria-label="Drift (hold)"
          onPointerDown={(e) => { e.preventDefault(); inputRef.current.drift = true; }}
          onPointerUp={() => { inputRef.current.drift = false; }}
          onPointerCancel={() => { inputRef.current.drift = false; }}
          onPointerLeave={() => { inputRef.current.drift = false; }}
          className="h-24 w-24 rounded-full glass-dark grid place-items-center touch-none active:bg-white/20"
        >
          <span className="flex flex-col items-center text-white">
            <Zap size={22} />
            <span className="text-[10px] uppercase tracking-wider mt-0.5">Drift</span>
          </span>
        </button>
      </div>
    </div>
  );
}
