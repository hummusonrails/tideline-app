import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page } from '../ui/Page';
import { GlassCard } from '../ui/GlassCard';
import { PillButton } from '../ui/PillButton';
import { Avatar } from '../ui/Avatar';
import { db } from '../lib/db';
import { useSession } from '../state/session';
import { useAvatarSrc } from '../lib/profile';
import { enqueue } from '../lib/sync';
import { awardPoints } from '../lib/award';
import { uid } from '../lib/uuid';
import { textToBase64 } from '../lib/github';
import { compressAvatar, blobToBase64 } from '../lib/compress';
import { disablePush, enablePush, getPushStatus, type PushStatus } from '../lib/push';
import { DEFAULT_CONFIG } from '../lib/points';
import { LogOut, ShieldAlert, Camera, Info, Smartphone, Bell, BellOff } from 'lucide-react';
import type { PointsConfig } from '../types';

export function Profile() {
  const session = useSession();
  const navigate = useNavigate();
  const myId = session.identity!;
  const myProfile = useLiveQuery(() => db.profiles.get(myId), [myId]);
  const myAvatar = useAvatarSrc(myId);
  const others = useLiveQuery(
    () => db.profiles.filter((p) => p.id !== myId).toArray(),
    [myId],
  ) ?? [];
  const amParent = myProfile?.role === 'parent';
  const avatarInput = useRef<HTMLInputElement>(null);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  async function onAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !myProfile) return;
    setSavingAvatar(true);
    setAvatarError(null);
    try {
      const compressed = await compressAvatar(file);
      // Store locally so it shows immediately.
      await db.avatarBlobs.put({ memberId: myId, bytes: compressed });
      // Upload the image bytes.
      const path = `avatars/${myId}.jpg`;
      await enqueue({
        id: `avatar-${myId}-bin-${uid()}`,
        enqueuedAt: new Date().toISOString(),
        op: {
          kind: 'put-file',
          path,
          contentBase64: await blobToBase64(compressed),
          commitMessage: 'update avatar',
        },
      });
      // Point the profile at it + sync the profile record.
      const updated = { ...myProfile, avatarUrl: path };
      await db.profiles.put(updated);
      await enqueue({
        id: `profile-${myId}-${uid()}`,
        enqueuedAt: new Date().toISOString(),
        op: {
          kind: 'put-file',
          path: `profiles/${myId}.json`,
          contentBase64: textToBase64(JSON.stringify(updated)),
          commitMessage: 'update profile',
        },
      });
    } catch (err) {
      console.error('avatar upload failed', err);
      setAvatarError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingAvatar(false);
      if (avatarInput.current) avatarInput.current.value = '';
    }
  }

  return (
    <Page
      eyebrow="You"
      title={myProfile?.displayName ?? 'Profile'}
      avatarSeed={myId}
      avatarDisplayName={myProfile?.displayName}
      avatarSrc={myAvatar}
    >
      {/* Avatar editor */}
      <GlassCard className="flex flex-col items-center !py-6">
        <button
          type="button"
          onClick={() => avatarInput.current?.click()}
          className="relative active:scale-95 transition"
          aria-label="Change profile photo"
        >
          <Avatar
            seed={myId}
            displayName={myProfile?.displayName}
            src={myAvatar}
            size={96}
          />
          <span className="absolute bottom-0 right-0 grid h-8 w-8 place-items-center rounded-full bg-ink-900 text-white ring-2 ring-white">
            <Camera size={15} />
          </span>
        </button>
        <div className="mt-3 font-display text-lg font-semibold">{myProfile?.displayName}</div>
        <button
          type="button"
          onClick={() => avatarInput.current?.click()}
          disabled={savingAvatar}
          className="mt-1 text-sm text-ocean"
        >
          {savingAvatar ? 'Saving…' : myAvatar ? 'Change photo' : 'Add a photo'}
        </button>
        <input
          ref={avatarInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onAvatarFile}
        />
        {avatarError && (
          <div className="mt-3 text-center">
            <div className="text-coral text-sm font-medium">Couldn&rsquo;t save that photo</div>
            <div className="text-ink-600 text-sm mt-1 break-words">{avatarError}</div>
          </div>
        )}
      </GlassCard>

      {amParent && (
        <>
          <div className="text-xs uppercase tracking-wider text-ink-600 px-1">Parent: award bonus points</div>
          {others.map((p) => (
            <BonusRow key={p.id} target={p.id} name={p.displayName} from={myId} />
          ))}
        </>
      )}

      <NotificationsCard myId={myId} />

      <GlassCard className="!p-3">
        <PillButton
          onClick={() => session.signOut()}
          icon={<LogOut size={14} />}
          className="!w-full justify-center"
        >
          Sign out (keeps local data)
        </PillButton>
      </GlassCard>

      <GlassCard className="!p-3">
        <PillButton
          onClick={() => navigate('/devices')}
          icon={<Smartphone size={14} />}
          className="!w-full justify-center"
        >
          Devices &amp; offline sync
        </PillButton>
      </GlassCard>

      <GlassCard className="!p-3">
        <PillButton
          onClick={() => navigate('/about')}
          icon={<Info size={14} />}
          className="!w-full justify-center"
        >
          About & photo credits
        </PillButton>
      </GlassCard>

      <GlassCard className="!p-3">
        <a
          href={`${import.meta.env.BASE_URL}#/panic`}
          className="inline-flex items-center justify-center gap-2 w-full rounded-full bg-coral/15 text-coral text-sm font-medium px-5 py-2.5"
        >
          <ShieldAlert size={14} /> Lost device? wipe this app
        </a>
      </GlassCard>
    </Page>
  );
}

/**
 * Notification opt-in. Every state here is reachable on a family iPhone, so
 * each one gets copy that says what to do next rather than just what's wrong.
 */
function NotificationsCard({ myId }: { myId: string }) {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void getPushStatus().then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function toggle() {
    setBusy(true);
    try {
      setStatus(status === 'on' ? await disablePush(myId) : await enablePush(myId));
    } finally {
      setBusy(false);
    }
  }

  if (status === null) return null;
  // Nothing actionable and nothing the family can fix — don't show a dead card.
  if (status === 'unconfigured' || status === 'unsupported') return null;

  return (
    <GlassCard className="!p-4 space-y-2">
      <div className="flex items-center gap-2 font-medium text-ink-800">
        {status === 'on' ? <Bell size={15} /> : <BellOff size={15} />} Notifications
      </div>

      {status === 'needs-install' && (
        <div className="text-sm text-ink-600">
          To get alerts, add Tideline to your Home Screen first: tap Share, then
          &ldquo;Add to Home Screen&rdquo;, and open it from there. iPhones only allow
          notifications for apps added this way.
        </div>
      )}

      {status === 'denied' && (
        <div className="text-sm text-ink-600">
          Notifications are blocked for Tideline. Turn them back on in iPhone
          Settings → Notifications → Tideline, then come back here.
        </div>
      )}

      {status === 'prompt' && (
        <>
          <div className="text-sm text-ink-600">
            Get a buzz for new chat messages and bonus points, even when the app is closed.
          </div>
          <PillButton onClick={toggle} disabled={busy} className="!w-full justify-center">
            {busy ? 'Turning on…' : 'Turn on notifications'}
          </PillButton>
        </>
      )}

      {status === 'on' && (
        <>
          <div className="text-sm text-ink-600">
            On for this device. You&rsquo;ll hear about new messages and bonus points.
          </div>
          <PillButton onClick={toggle} disabled={busy} className="!w-full justify-center">
            {busy ? 'Turning off…' : 'Turn off on this device'}
          </PillButton>
        </>
      )}
    </GlassCard>
  );
}

function BonusRow({ target, name, from }: { target: string; name: string; from: string }) {
  const [amount, setAmount] = useState(10);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const configRow = useLiveQuery(() => db.pointsConfig.get('config'), []);
  const bonusMax =
    (configRow?.value as PointsConfig | undefined)?.caps?.parentBonusMax
    ?? DEFAULT_CONFIG.caps.parentBonusMax;

  async function award() {
    if (!note.trim()) return;
    setBusy(true);
    setBlocked(false);
    try {
      const awarded = await awardPoints({
        to: target,
        by: from,
        amount,
        reason: 'parent-bonus',
        note: note.trim(),
      });
      if (!awarded) {
        setBlocked(true); // competition hasn't started yet
        return;
      }
      setNote('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassCard className="space-y-2">
      <div className="font-medium">{name}</div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={1}
          // From config, not hardcoded — the trip data owns this number, and a
          // slider that lets a parent award past the configured ceiling makes
          // the cap meaningless.
          max={bonusMax}
          value={Math.min(amount, bonusMax)}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="flex-1 accent-ink-900"
          aria-label={`Bonus points for ${name}`}
        />
        <div className="tabular w-12 text-right font-semibold">+{amount}</div>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="reason (required)"
        className="w-full rounded-full bg-white/70 px-4 py-2 text-sm outline-none ring-1 ring-white/80 focus:ring-ocean/40"
      />
      <button
        type="button"
        disabled={busy || !note.trim()}
        onClick={() => void award()}
        className="w-full rounded-full bg-ink-900 text-white text-sm font-medium px-4 py-2 disabled:opacity-40 active:scale-[0.98] transition"
      >
        Award
      </button>
      {blocked && (
        <div className="text-xs text-ink-500 text-center">
          Points start on day one of the trip — bonuses don't accrue yet.
        </div>
      )}
    </GlassCard>
  );
}
