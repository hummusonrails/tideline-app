import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { Page } from '../ui/Page';
import { GlassCard } from '../ui/GlassCard';
import { PillButton } from '../ui/PillButton';
import { Avatar } from '../ui/Avatar';
import { Plus, X, Trash2 } from 'lucide-react';
import { db } from '../lib/db';
import { useSession } from '../state/session';
import { useMyProfile, useAvatarSrc } from '../lib/profile';
import { compressForPost, blobToBase64 } from '../lib/compress';
import { enqueue } from '../lib/sync';
import { awardPoints, EARN, CAPS } from '../lib/award';
import { uid, eventFilename, dateFolder } from '../lib/uuid';
import { textToBase64 } from '../lib/github';
import { getFile, deleteFile, type GHCtx } from '../lib/github';
import type { Photo } from '../types';

export function Photos() {
  const session = useSession();
  const id = session.identity!;
  const myProfile = useMyProfile();
  const myAvatar = useAvatarSrc(id);
  const photos = useLiveQuery(() => db.photos.orderBy('takenAt').reverse().toArray()) ?? [];
  const profiles = useLiveQuery(() => db.profiles.toArray()) ?? [];
  const [filter, setFilter] = useState<string | 'all'>('all');
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState<Photo | null>(null);

  const visible = filter === 'all' ? photos : photos.filter((p) => p.from === filter);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadPhoto(file, id);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <Page eyebrow="Album" title="Photos" avatarSeed={id} avatarDisplayName={myProfile?.displayName} avatarSrc={myAvatar}>
      <div className="flex gap-2 overflow-x-auto scroll-clean -mx-4 px-4">
        <PillButton active={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </PillButton>
        {profiles.map((p) => (
          <PillButton key={p.id} active={filter === p.id} onClick={() => setFilter(p.id)}>
            {p.displayName}
          </PillButton>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {visible.map((photo) => (
          <PhotoTile key={photo.id} photo={photo} onClick={() => setOpen(photo)} />
        ))}
      </div>

      {visible.length === 0 && (
        <GlassCard className="text-ink-600 text-sm text-center">
          No photos yet. Tap + to add one.
        </GlassCard>
      )}

      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        disabled={uploading}
        className="fixed bottom-24 right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-ink-900 text-white shadow-[var(--shadow-pill)] active:scale-95 transition disabled:opacity-60"
        aria-label="Add photo"
      >
        <Plus />
      </button>
      <input ref={fileInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />

      {open && (
        <PhotoLightbox
          photo={open}
          canDelete={open.from === id}
          uploaderName={profiles.find((p) => p.id === open.from)?.displayName ?? '—'}
          uploaderAvatarSeed={open.from}
          onClose={() => setOpen(null)}
          onDeleted={() => setOpen(null)}
          ctx={{ owner: session.dataOwner!, repo: session.dataRepo!, token: session.pat!, branch: 'main' }}
        />
      )}
    </Page>
  );
}

function PhotoTile({ photo, onClick }: { photo: Photo; onClick: () => void }) {
  const blob = useLiveQuery(() => db.photoBlobs.get(photo.id), [photo.id]);
  const [url, setUrl] = useState<string | null>(null);
  if (blob && !url) setUrl(URL.createObjectURL(blob.bytes));
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative aspect-square overflow-hidden rounded-2xl glass active:scale-[0.98] transition"
    >
      {url && <img src={url} alt={photo.caption ?? ''} className="absolute inset-0 h-full w-full object-cover" />}
    </button>
  );
}

function PhotoLightbox({
  photo,
  canDelete,
  uploaderName,
  uploaderAvatarSeed,
  onClose,
  onDeleted,
  ctx,
}: {
  photo: Photo;
  canDelete: boolean;
  uploaderName: string;
  uploaderAvatarSeed: string;
  onClose: () => void;
  onDeleted: () => void;
  ctx: GHCtx;
}) {
  const blob = useLiveQuery(() => db.photoBlobs.get(photo.id), [photo.id]);
  const uploaderAvatar = useAvatarSrc(photo.from);
  const url = blob ? URL.createObjectURL(blob.bytes) : null;
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function doDelete() {
    setDeleting(true);
    try {
      await deletePhoto(photo, ctx);
      onDeleted();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/90 grid place-items-center" onClick={onClose}>
      <button type="button" className="absolute top-5 right-5 text-white/80 p-2" aria-label="Close">
        <X />
      </button>
      {url && (
        <img
          src={url}
          alt=""
          className="max-h-[78dvh] max-w-[92vw] object-contain rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <div className="absolute bottom-6 left-6 right-6 text-white" onClick={(e) => e.stopPropagation()}>
        {photo.caption && <div className="text-base mb-2">{photo.caption}</div>}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Avatar seed={uploaderAvatarSeed} displayName={uploaderName} src={uploaderAvatar} size={28} />
            <div className="text-xs text-white/80">
              {uploaderName} · {new Date(photo.takenAt).toLocaleDateString()}
            </div>
          </div>
          {canDelete && (
            confirming ? (
              <button
                type="button"
                onClick={() => void doDelete()}
                disabled={deleting}
                className="text-xs rounded-full bg-coral px-3 py-1.5 font-medium"
              >
                {deleting ? 'Deleting…' : 'Confirm delete'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white"
                aria-label="Delete photo"
              >
                <Trash2 size={16} />
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

async function uploadPhoto(file: File, by: string) {
  const result = await compressForPost(file);
  const now = new Date();
  const id = uid();
  const folder = dateFolder(now);
  const jpgPath = `photos/${folder}/${eventFilename(now, by, id, '.jpg')}`;
  const sidecarPath = `photos/${folder}/${eventFilename(now, by, id, '.json')}`;

  const photo: Photo = {
    id,
    from: by,
    takenAt: result.takenAt,
    uploadedAt: now.toISOString(),
    filePath: jpgPath,
    width: result.width,
    height: result.height,
    bytes: result.bytes,
    exifPresent: result.exifPresent,
  };

  await db.photos.put(photo);
  await db.photoBlobs.put({ photoId: id, bytes: result.file });

  await enqueue({
    id: `${id}-bin`,
    enqueuedAt: now.toISOString(),
    op: { kind: 'put-file', path: jpgPath, contentBase64: await blobToBase64(result.file), commitMessage: 'add photo' },
  });
  await enqueue({
    id: `${id}-meta`,
    enqueuedAt: now.toISOString(),
    op: { kind: 'put-file', path: sidecarPath, contentBase64: textToBase64(JSON.stringify(photo)), commitMessage: 'add photo metadata' },
  });

  // Earn points (capped per day).
  await awardPoints({ to: by, by, amount: EARN.photo, reason: 'photo', refId: id, dailyCap: CAPS.photoPerDay });
}

async function deletePhoto(photo: Photo, ctx: GHCtx) {
  // Remove local copies immediately.
  await db.photos.delete(photo.id);
  await db.photoBlobs.delete(photo.id);
  // Drop any still-pending uploads for this photo so it isn't re-created.
  await db.outbox.bulkDelete([`${photo.id}-bin`, `${photo.id}-meta`]);

  // Best-effort remote delete: the Contents API delete requires the file
  // sha, so fetch then delete both the jpg and its sidecar.
  const jpgPath = photo.filePath;
  const sidecarPath = jpgPath.replace(/\.jpg$/i, '.json');
  try {
    const jpg = await getFile(ctx, jpgPath);
    if (jpg) await deleteFile(ctx, jpgPath, jpg.sha, 'delete photo');
    const sidecar = await getFile(ctx, sidecarPath);
    if (sidecar) await deleteFile(ctx, sidecarPath, sidecar.sha, 'delete photo metadata');
  } catch {
    // If offline, the local copy is gone; the remote files will reappear on
    // next sync. Acceptable — delete is a best-effort online action.
  }
}
