import { db } from './db';
import {
  type GHCtx,
  getBranch,
  getTreeRecursive,
  getFile,
  getFileText,
  getFileBytes,
  putFile,
  deleteFile,
  GHError,
} from './github';
import type {
  MemberId,
  Message,
  Photo,
  PointEvent,
  ChallengeCompletion,
  HabitCheckIn,
  OutboxEntry,
  Profile,
  Challenge,
  Place,
  ItineraryDoc,
  PointsConfig,
} from '../types';

/**
 * Sync engine: pulls new content from the data backend into IndexedDB
 * (incremental via tree ETag) and drains the local outbox of pending writes.
 *
 * Pull frequency: every 90s when focused + online, plus on visibilitychange.
 * Drain attempts: opportunistic — every loop tick and whenever an item is
 * enqueued.
 */

const PULL_INTERVAL_MS = 90_000;

export interface SyncOptions {
  owner: string;
  repo: string;
  token: string;
  identity: MemberId;
}

export function startSyncLoop(opts: SyncOptions): () => void {
  const ctx: GHCtx = { owner: opts.owner, repo: opts.repo, token: opts.token, branch: 'main' };
  let stopped = false;

  const tick = () => {
    if (stopped || document.hidden || !navigator.onLine) return;
    void Promise.allSettled([pullAll(ctx), drainOutbox(ctx, opts.identity)]);
  };

  const onVis = () => {
    if (!document.hidden) tick();
  };
  const onOnline = () => tick();
  const onEnqueue = () => {
    if (navigator.onLine) void drainOutbox(ctx, opts.identity);
  };

  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('online', onOnline);
  window.addEventListener('tideline:outbox-enqueued', onEnqueue);
  const interval = window.setInterval(tick, PULL_INTERVAL_MS);
  tick();

  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('tideline:outbox-enqueued', onEnqueue);
    window.clearInterval(interval);
  };
}

export async function enqueue(entry: Omit<OutboxEntry, 'attempts'>): Promise<void> {
  await db.outbox.put({ ...entry, attempts: 0 });
  window.dispatchEvent(new CustomEvent('tideline:outbox-enqueued'));
}

/**
 * Create a file, or update it if it already exists. The Contents API needs
 * the existing blob sha to update; we optimistically PUT as a create and,
 * on the 422 that signals "file exists / sha required", refetch the sha and
 * retry. New event-sourced files (unique UUID paths) take the fast path.
 */
async function putFileCreateOrUpdate(
  ctx: GHCtx,
  path: string,
  contentBase64: string,
  commitMessage: string,
): Promise<void> {
  try {
    await putFile(ctx, path, contentBase64, commitMessage);
  } catch (err) {
    if (err instanceof GHError && err.status === 422) {
      const existing = await getFile(ctx, path);
      await putFile(ctx, path, contentBase64, commitMessage, { sha: existing?.sha });
    } else {
      throw err;
    }
  }
}

async function drainOutbox(ctx: GHCtx, _identity: MemberId): Promise<void> {
  const items = await db.outbox.orderBy('enqueuedAt').toArray();
  for (const item of items) {
    try {
      if (item.op.kind === 'put-file') {
        await putFileCreateOrUpdate(ctx, item.op.path, item.op.contentBase64, item.op.commitMessage);
      } else if (item.op.kind === 'delete-file') {
        // sha may be stale; refetch to be safe.
        const existing = await getFile(ctx, item.op.path);
        if (existing) await deleteFile(ctx, item.op.path, existing.sha, item.op.commitMessage);
      }
      await db.outbox.delete(item.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.outbox.update(item.id, { attempts: item.attempts + 1, lastError: msg });
      if (err instanceof GHError && err.status === 401) {
        window.dispatchEvent(new CustomEvent('tideline:auth-expired'));
        return;
      }
      // Network / 5xx — break and retry next tick rather than burning the queue.
      if (err instanceof GHError && err.status >= 500) return;
      if (!(err instanceof GHError)) return;
    }
  }
}

/**
 * For collections that live as flat `<prefix>/<slug>.json` files, return the
 * set of slugs the backend currently has. Used by pullAll to delete any
 * locally-cached rows whose source file no longer exists.
 */
function expectedSlugs(paths: string[], prefix: string): Set<string> {
  const out = new Set<string>();
  for (const p of paths) {
    if (!p.startsWith(prefix) || !p.endsWith('.json')) continue;
    const rest = p.slice(prefix.length, -'.json'.length);
    if (rest.includes('/')) continue;
    if (rest === 'README') continue;
    out.add(rest);
  }
  return out;
}

async function pullAll(ctx: GHCtx): Promise<void> {
  try {
    const branch = await getBranch(ctx);
    const rootTreeSha = branch.commit.commit.tree.sha;
    const prior = await db.treeEtags.get('root');
    const out = await getTreeRecursive(ctx, rootTreeSha, prior?.etag ?? undefined);
    if (!out) return; // 304 — nothing changed.
    await db.treeEtags.put({
      prefix: 'root',
      treeSha: out.tree.sha,
      etag: out.etag,
      syncedAt: new Date().toISOString(),
    });

    // Pull files in parallel, chunked to stay polite with the API.
    const blobs = out.tree.tree.filter((e) => e.type === 'blob');
    const CHUNK = 8;
    for (let i = 0; i < blobs.length; i += CHUNK) {
      await Promise.all(
        blobs.slice(i, i + CHUNK).map((e) => pullFile(ctx, e.path, e.sha)),
      );
    }

    // Reconcile enumerable collections: when a source file is removed from
    // the backend, delete the corresponding local row. Without this, locally
    // cached rows from earlier syncs (or short-lived placeholder files) stay
    // forever.
    const paths = blobs.map((b) => b.path);
    const expectedProfileIds = expectedSlugs(paths, 'profiles/');
    const expectedPlaceSlugs = expectedSlugs(paths, 'places/');
    const localProfiles = await db.profiles.toArray();
    const staleProfileIds = localProfiles
      .filter((p) => !expectedProfileIds.has(p.id))
      .map((p) => p.id);
    if (staleProfileIds.length > 0) await db.profiles.bulkDelete(staleProfileIds);
    const localPlaces = await db.places.toArray();
    const stalePlaceSlugs = localPlaces
      .filter((p) => !expectedPlaceSlugs.has(p.slug))
      .map((p) => p.slug);
    if (stalePlaceSlugs.length > 0) await db.places.bulkDelete(stalePlaceSlugs);
  } catch (err) {
    if (err instanceof GHError && err.status === 401) {
      window.dispatchEvent(new CustomEvent('tideline:auth-expired'));
    }
  }
}

/** Pull a single file if we haven't already seen this blob sha. */
async function pullFile(ctx: GHCtx, path: string, sha: string): Promise<void> {
  const key = `blob:${path}`;
  const seen = await db.meta.get(key);
  if (seen?.value === sha) return;

  const route = routeFor(path);
  if (!route) return;

  if (route.kind === 'json') {
    const text = await getFileText(ctx, path);
    if (text === null) return;
    try {
      const parsed = JSON.parse(text);
      await route.upsert(parsed, path);
    } catch {
      // Skip malformed — log only.
      console.warn('skipping malformed file', path);
    }
  } else if (route.kind === 'photo-blob') {
    const bytes = await getFileBytes(ctx, path);
    if (!bytes) return;
    const blob = new Blob([bytes as BlobPart], { type: 'image/jpeg' });
    await route.upsert(blob, path);
  }

  await db.meta.put({ key, value: sha });
}

interface JsonRoute {
  kind: 'json';
  upsert: (parsed: unknown, path: string) => Promise<void>;
}
interface PhotoBlobRoute {
  kind: 'photo-blob';
  upsert: (blob: Blob, path: string) => Promise<void>;
}
type Route = JsonRoute | PhotoBlobRoute;

function routeFor(path: string): Route | null {
  // Profiles
  if (path.startsWith('profiles/') && path.endsWith('.json')) {
    return {
      kind: 'json',
      upsert: async (p) => { await db.profiles.put(p as Profile); },
    };
  }
  // Itinerary single doc
  if (path === 'itinerary.json') {
    return {
      kind: 'json',
      upsert: async (p) => {
        const doc = p as ItineraryDoc;
        await db.itinerary.bulkPut(doc.items);
        await db.meta.put({ key: 'trip-meta', value: doc.meta });
      },
    };
  }
  // Places (data)
  if (path.startsWith('places/') && path.endsWith('.json')) {
    return {
      kind: 'json',
      upsert: async (p) => { await db.places.put(p as Place); },
    };
  }
  // Place hero photos: places/<slug>.jpg (private — fetched as blobs)
  if (path.startsWith('places/') && /\.(jpe?g)$/i.test(path)) {
    return {
      kind: 'photo-blob',
      upsert: async (blob, p) => {
        const slug = p.split('/').pop()!.replace(/\.jpe?g$/i, '');
        await db.placeBlobs.put({ slug, bytes: blob });
      },
    };
  }
  // Challenges — accept either a single Challenge object or an array.
  if (path.startsWith('challenges/') && path.endsWith('.json')) {
    return {
      kind: 'json',
      upsert: async (p) => {
        const arr = Array.isArray(p) ? (p as Challenge[]) : [p as Challenge];
        await db.challenges.bulkPut(arr);
      },
    };
  }
  // Points config
  if (path === 'config/points.json') {
    return {
      kind: 'json',
      upsert: async (p) => { await db.pointsConfig.put({ key: 'config', value: p as PointsConfig }); },
    };
  }
  // Shabbat times
  if (path === 'config/shabbat-times.json') {
    return {
      kind: 'json',
      upsert: async (p) => { await db.meta.put({ key: 'shabbat-times', value: p }); },
    };
  }
  // Messages: messages/<YYYY-MM-DD>/<file>.json
  if (path.startsWith('messages/') && path.endsWith('.json')) {
    return {
      kind: 'json',
      upsert: async (p) => { await db.messages.put(p as Message); },
    };
  }
  // Photo sidecars: photos/<YYYY-MM-DD>/<file>.json
  if (path.startsWith('photos/') && path.endsWith('.json')) {
    return {
      kind: 'json',
      upsert: async (p) => { await db.photos.put(p as Photo); },
    };
  }
  // Photo bytes: photos/<YYYY-MM-DD>/<file>.jpg
  if (path.startsWith('photos/') && /\.(jpe?g)$/i.test(path)) {
    return {
      kind: 'photo-blob',
      upsert: async (blob, p) => {
        const id = p.split('/').pop()!.replace(/\.jpe?g$/i, '');
        await db.photoBlobs.put({ photoId: id, bytes: blob });
      },
    };
  }
  // Avatar bytes: avatars/<memberId>.jpg
  if (path.startsWith('avatars/') && /\.(jpe?g)$/i.test(path)) {
    return {
      kind: 'photo-blob',
      upsert: async (blob, p) => {
        const memberId = p.split('/').pop()!.replace(/\.jpe?g$/i, '');
        await db.avatarBlobs.put({ memberId, bytes: blob });
      },
    };
  }
  // Point events
  if (path.startsWith('points/') && path.endsWith('.json')) {
    return {
      kind: 'json',
      upsert: async (p) => { await db.pointEvents.put(p as PointEvent); },
    };
  }
  // Challenge completions
  if (path.startsWith('challenges-completed/') && path.endsWith('.json')) {
    return {
      kind: 'json',
      upsert: async (p) => { await db.completions.put(p as ChallengeCompletion); },
    };
  }
  // Habit check-ins
  if (path.startsWith('habits/') && path.endsWith('.json')) {
    return {
      kind: 'json',
      upsert: async (p) => { await db.habits.put(p as HabitCheckIn); },
    };
  }
  return null;
}
