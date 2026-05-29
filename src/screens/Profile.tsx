import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
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
import { LogOut, ShieldAlert, Camera, Info } from 'lucide-react';

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

  async function onAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !myProfile) return;
    setSavingAvatar(true);
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
      </GlassCard>

      {amParent && (
        <>
          <div className="text-xs uppercase tracking-wider text-ink-400 px-1">Parent: award bonus points</div>
          {others.map((p) => (
            <BonusRow key={p.id} target={p.id} name={p.displayName} from={myId} />
          ))}
        </>
      )}

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

function BonusRow({ target, name, from }: { target: string; name: string; from: string }) {
  const [amount, setAmount] = useState(10);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);

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
          max={100}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="flex-1 accent-ink-900"
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
