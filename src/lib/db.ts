import Dexie, { type Table } from 'dexie';
import type {
  Message,
  Photo,
  PointEvent,
  ChallengeCompletion,
  HabitCheckIn,
  OutboxEntry,
  Profile,
  Challenge,
  Place,
  ItineraryItem,
  PointsConfig,
} from '../types';

/**
 * Local IndexedDB mirror of the data backend. Every record persisted
 * remotely also lives here, indexed for cheap querying. The sync engine
 * keeps these tables in step with the remote.
 */

interface MetaRow {
  key: string;
  value: unknown;
}

interface TreeEtagRow {
  /** Top-level folder we tracked (e.g. "messages", "photos/YYYY-MM-DD"). */
  prefix: string;
  treeSha: string;
  etag: string | null;
  syncedAt: string;
}

interface PhotoBlobRow {
  photoId: string;
  bytes: Blob;
}

interface AvatarBlobRow {
  memberId: string;
  bytes: Blob;
}

interface PlaceBlobRow {
  slug: string;
  bytes: Blob;
}

/**
 * A paired peer — another device we've trusted via QR-code exchange.
 * `memberId` is the MemberId that peer claims; it's still required to
 * match a known profile before we accept their data.
 */
export interface PeerRow {
  fingerprint: string;       // short hash of publicKeyB64 — primary key
  publicKeyB64: string;      // raw P-256 public key, base64
  memberId: string;          // MemberId the peer authenticated as
  displayName: string;       // captured at pairing for the devices list
  pairedAt: string;          // ISO
  lastSeenAt: string | null; // ISO, updated on each successful connection
}

class TidelineDB extends Dexie {
  meta!: Table<MetaRow, string>;
  treeEtags!: Table<TreeEtagRow, string>;
  outbox!: Table<OutboxEntry, string>;

  profiles!: Table<Profile, string>;
  itinerary!: Table<ItineraryItem, string>;
  places!: Table<Place, string>;
  challenges!: Table<Challenge, string>;
  pointsConfig!: Table<MetaRow, string>;

  messages!: Table<Message, string>;
  photos!: Table<Photo, string>;
  photoBlobs!: Table<PhotoBlobRow, string>;
  avatarBlobs!: Table<AvatarBlobRow, string>;
  placeBlobs!: Table<PlaceBlobRow, string>;
  pointEvents!: Table<PointEvent, string>;
  completions!: Table<ChallengeCompletion, string>;
  habits!: Table<HabitCheckIn, string>;

  peers!: Table<PeerRow, string>;

  constructor() {
    super('tideline');
    this.version(1).stores({
      meta: '&key',
      treeEtags: '&prefix',
      outbox: '&id, enqueuedAt',
      profiles: '&id',
      itinerary: '&id, date',
      places: '&slug',
      challenges: '&id, kind, placeSlug, activeFrom, activeUntil',
      pointsConfig: '&key',
      messages: '&id, from, sentAt',
      photos: '&id, from, takenAt, placeSlug',
      photoBlobs: '&photoId',
      pointEvents: '&id, to, by, at, reason',
      completions: '&id, challengeId, by, completedAt',
      habits: '&id, by, date',
    });
    this.version(2).stores({
      avatarBlobs: '&memberId',
    });
    this.version(3).stores({
      placeBlobs: '&slug',
    });
    this.version(4).stores({
      peers: '&fingerprint, memberId',
    });
  }
}

export const db = new TidelineDB();

export async function loadPointsConfig(): Promise<PointsConfig | null> {
  const row = await db.pointsConfig.get('config');
  return (row?.value as PointsConfig) ?? null;
}

export async function savePointsConfig(cfg: PointsConfig): Promise<void> {
  await db.pointsConfig.put({ key: 'config', value: cfg });
}
