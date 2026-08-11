import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Page } from '../ui/Page';
import { GlassCard } from '../ui/GlassCard';
import { PillButton } from '../ui/PillButton';
import { Avatar } from '../ui/Avatar';
import { Plus, X, Trash2, ChevronLeft, ChevronRight, Image as ImageIcon } from 'lucide-react';
import { db } from '../lib/db';
import { useSession } from '../state/session';
import { useMyProfile, useAvatarSrc } from '../lib/profile';
import { useObjectUrl } from '../lib/blobUrl';
import { todayYMD } from '../lib/time';
import { compressForPost, blobToBase64 } from '../lib/compress';
import { enqueue } from '../lib/sync';
import { awardPoints, EARN, CAPS } from '../lib/award';
import { uid } from '../lib/uuid';
import { photoBinaryPath, photoSidecarPath } from '../lib/paths';
import { textToBase64 } from '../lib/github';
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
  const [error, setError] = useState<string | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const today = todayYMD();
  const todayItems = useLiveQuery(() => db.itinerary.where('date').equals(today).toArray(), [today]) ?? [];
  const places = useLiveQuery(() => db.places.toArray(), []) ?? [];

  // Only offer places the family is actually at today — a full list of every
  // stop on the trip is a scroll, not a choice.
  const todayPlaces = places.filter((p) => todayItems.some((i) => i.placeSlug === p.slug));

  const visible = filter === 'all' ? photos : photos.filter((p) => p.from === filter);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    // Ask for a caption before uploading rather than after: nobody goes back
    // to annotate a photo they've already posted.
    setPending(file);
  }

  async function commitPending(caption: string, placeSlug?: string) {
    const file = pending;
    if (!file) return;
    setPending(null);
    setUploading(true);
    setError(null);
    try {
      await uploadPhoto(file, id, { caption, placeSlug });
    } catch (err) {
      // Never swallow this: a failed upload used to look identical to nothing
      // happening at all, which is indistinguishable from the picker not
      // working. Show what actually broke.
      console.error('photo upload failed', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
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

      {uploading && (
        <GlassCard className="text-ink-600 text-sm text-center">Adding your photo…</GlassCard>
      )}

      {error && (
        <GlassCard className="!border-coral/40">
          <div className="text-coral text-sm font-medium">Couldn&rsquo;t add that photo</div>
          <div className="text-ink-600 text-sm mt-1 break-words">{error}</div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-ocean text-sm mt-2"
          >
            Dismiss
          </button>
        </GlassCard>
      )}

      <div className="grid grid-cols-2 gap-3">
        {visible.map((photo, i) => (
          <PhotoTile key={photo.id} photo={photo} onClick={() => setOpenIndex(i)} />
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
        className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-ink-900 text-white shadow-[var(--shadow-pill)] active:scale-95 transition disabled:opacity-60"
        aria-label="Add photo"
      >
        <Plus />
      </button>
      {/* No `capture`: on iOS it forces the camera and hides the Photo
          Library, so photos taken before opening the app can't be added. */}
      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={onFile} />

      {pending && (
        <CaptionSheet
          file={pending}
          places={todayPlaces}
          onCancel={() => setPending(null)}
          onPost={(caption, slug) => void commitPending(caption, slug)}
        />
      )}

      {openIndex !== null && (
        <PhotoLightbox
          photos={visible}
          index={openIndex}
          myId={id}
          profiles={profiles}
          onIndex={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          onDeleted={() => setOpenIndex(null)}
        />
      )}
    </Page>
  );
}

/**
 * Caption + place prompt shown between picking a photo and posting it.
 *
 * Both are skippable in one tap — the goal is to make captions easy, not
 * mandatory. A caption gate that slows down posting would cost more photos
 * than it gains descriptions.
 */
function CaptionSheet({
  file, places, onCancel, onPost,
}: {
  file: File;
  places: { slug: string; name: string }[];
  onCancel: () => void;
  onPost: (caption: string, placeSlug?: string) => void;
}) {
  const preview = useObjectUrl(file);
  const [caption, setCaption] = useState('');
  const [slug, setSlug] = useState<string | undefined>(places[0]?.slug);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center" onClick={onCancel}>
      <div
        className="w-[min(100%,430px)] glass rounded-t-[28px] p-5 pb-8 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-3">
          {preview && (
            <img src={preview} alt="" className="h-20 w-20 rounded-2xl object-cover shrink-0" />
          )}
          <textarea
            rows={3}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Say something about this photo…"
            className="flex-1 bg-white/70 rounded-2xl px-3 py-2 text-sm outline-none resize-none ring-1 ring-white/80 focus:ring-ocean/40"
          />
        </div>

        {places.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {places.map((p) => (
              <button
                key={p.slug}
                type="button"
                onClick={() => setSlug(slug === p.slug ? undefined : p.slug)}
                aria-pressed={slug === p.slug}
                className={`rounded-full px-3 py-1.5 text-xs transition ${
                  slug === p.slug ? 'bg-ink-900 text-white' : 'bg-white/70 text-ink-700'
                }`}
              >
                📍 {p.name}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onPost('', slug)}
            className="flex-1 rounded-full bg-white/70 text-ink-700 text-sm font-medium py-2.5"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => onPost(caption, slug)}
            className="flex-1 rounded-full bg-ink-900 text-white text-sm font-medium py-2.5 active:scale-[0.98] transition"
          >
            Post
          </button>
        </div>
      </div>
    </div>
  );
}

function PhotoTile({ photo, onClick }: { photo: Photo; onClick: () => void }) {
  const blob = useLiveQuery(() => db.photoBlobs.get(photo.id), [photo.id]);
  const url = useObjectUrl(blob?.bytes);
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative aspect-square overflow-hidden rounded-2xl glass active:scale-[0.98] transition"
    >
      {url ? (
        <img src={url} alt={photo.caption ?? ''} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        // A photo whose metadata arrived over gossip before its bytes shows
        // here — pulsing, not blank, so it reads as "coming" not "broken".
        <span className="absolute inset-0 grid place-items-center animate-pulse text-ink-400">
          <ImageIcon size={20} />
        </span>
      )}
      {/* Who took it, without opening it. In a shared album of four people
          that's the first thing anyone wants to know. */}
      <span className="absolute bottom-1.5 left-1.5 drop-shadow">
        <Avatar seed={photo.from} size={22} alt="" />
      </span>
    </button>
  );
}

function PhotoLightbox({
  photos,
  index,
  myId,
  profiles,
  onIndex,
  onClose,
  onDeleted,
}: {
  photos: Photo[];
  index: number;
  myId: string;
  profiles: { id: string; displayName: string }[];
  onIndex: (i: number) => void;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const photo = photos[index];
  const blob = useLiveQuery(() => db.photoBlobs.get(photo?.id ?? ''), [photo?.id]);
  const uploaderAvatar = useAvatarSrc(photo?.from);
  const url = useObjectUrl(blob?.bytes);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset the delete confirmation when moving to a different photo, so a
  // half-confirmed delete can't carry over onto someone else's.
  useEffect(() => { setConfirming(false); }, [photo?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      if (e.key === 'ArrowRight' && index < photos.length - 1) onIndex(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, photos.length, onIndex, onClose]);

  if (!photo) return null;

  const uploaderName = profiles.find((p) => p.id === photo.from)?.displayName ?? '—';
  const canDelete = photo.from === myId;
  const hasPrev = index > 0;
  const hasNext = index < photos.length - 1;

  async function doDelete() {
    setDeleting(true);
    try {
      await deletePhoto(photo);
      onDeleted();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/90 grid place-items-center" onClick={onClose}>
      {/* Explicit handler, not bubbling: relying on the backdrop's onClick
          meant this button silently stopped working if anything between them
          ever called stopPropagation. */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute top-5 right-5 z-10 text-white/80 p-2"
        aria-label="Close"
      >
        <X />
      </button>

      {hasPrev && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onIndex(index - 1); }}
          className="absolute left-2 z-10 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white"
          aria-label="Previous photo"
        >
          <ChevronLeft />
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onIndex(index + 1); }}
          className="absolute right-2 z-10 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white"
          aria-label="Next photo"
        >
          <ChevronRight />
        </button>
      )}

      {url && (
        <img
          src={url}
          alt={photo.caption ?? ''}
          className="max-h-[78dvh] max-w-[92vw] object-contain rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <div className="absolute bottom-6 left-6 right-6 text-white" onClick={(e) => e.stopPropagation()}>
        {photo.caption && <div className="text-base mb-2">{photo.caption}</div>}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Avatar seed={photo.from} displayName={uploaderName} src={uploaderAvatar} size={28} />
            <div className="text-xs text-white/80">
              {uploaderName} · {new Date(photo.takenAt).toLocaleDateString()}
              {photos.length > 1 && ` · ${index + 1}/${photos.length}`}
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

async function uploadPhoto(
  file: File,
  by: string,
  opts: { caption?: string; placeSlug?: string } = {},
) {
  const result = await compressForPost(file);
  const now = new Date();
  const id = uid();
  const photo: Photo = {
    id,
    from: by,
    takenAt: result.takenAt,
    uploadedAt: now.toISOString(),
    // Both fields already existed on the type and the lightbox already
    // rendered captions — the upload flow just never collected them.
    caption: opts.caption?.trim() || undefined,
    placeSlug: opts.placeSlug || undefined,
    filePath: '',
    width: result.width,
    height: result.height,
    bytes: result.bytes,
    exifPresent: result.exifPresent,
  };
  const jpgPath = photoBinaryPath(photo);
  const sidecarPath = photoSidecarPath(photo);
  photo.filePath = jpgPath;

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

/**
 * Delete a photo everywhere it can reach.
 *
 * Goes through the outbox rather than calling the API directly. A direct call
 * silently does nothing when there's no connectivity — which, on this trip, is
 * most of the time — and the local row is already gone by then, so the delete
 * looked like it worked while the remote file stayed put and re-synced to
 * every other phone forever.
 *
 * Known limitation: a peer who already received this photo over P2P keeps its
 * copy until it syncs with the backend. Propagating deletes over gossip needs
 * tombstones, which is a much larger correctness surface than a rare action
 * warrants.
 */
async function deletePhoto(photo: Photo) {
  // Remove local copies immediately — the UI should respond at once.
  await db.photos.delete(photo.id);
  await db.photoBlobs.delete(photo.id);

  const jpgPath = photo.filePath;
  const sidecarPath = jpgPath.replace(/\.jpg$/i, '.json');

  // Drop anything queued that would re-create it: this device's own pending
  // upload, and any copy forwarded from a peer.
  await db.outbox.bulkDelete([
    `${photo.id}-bin`,
    `${photo.id}-meta`,
    `p2p-photos-${photo.id}`,
    `p2p-photo-bin-${photo.id}`,
  ]);

  // Clear the blob-seen markers too. Without this, `pullFile` skips these
  // paths on the next sync (it remembers the sha it already fetched), so a
  // delete that fails would leave us unable to re-pull the photo either —
  // stuck in a state where it exists remotely but never comes back locally.
  await db.meta.bulkDelete([`blob:${jpgPath}`, `blob:${sidecarPath}`]);

  // The queued sha is a placeholder: `drainOutbox` refetches the live sha
  // before deleting, and skips cleanly if the file is already gone.
  const now = new Date().toISOString();
  await enqueue({
    id: `del-${photo.id}-bin`,
    enqueuedAt: now,
    op: { kind: 'delete-file', path: jpgPath, sha: '', commitMessage: 'delete photo' },
  });
  await enqueue({
    id: `del-${photo.id}-meta`,
    enqueuedAt: now,
    op: { kind: 'delete-file', path: sidecarPath, sha: '', commitMessage: 'delete photo metadata' },
  });
}
