/**
 * Core domain types. All persisted records share these shapes — both in
 * the private data backend (canonical) and in the local IndexedDB mirror.
 */

/**
 * Opaque member identifier. Concrete values are random tokens minted by
 * the setup script (never hardcoded). The public source code knows
 * nothing about who is who or how many members exist — that mapping
 * only materializes after a successful passphrase unlock.
 */
export type MemberId = string;
export type Role = 'parent' | 'kid';

export interface Profile {
  id: MemberId;
  displayName: string;
  role: Role;
  avatarUrl?: string;       // optional photo committed under profiles/
  habit?: { label: string; emoji: string };
  createdAt: string;        // ISO
}

/**
 * Public manifest shape (served from /users/manifest.json) — just enumerates
 * the opaque slot IDs the app knows about so onboarding can show a picker.
 * Carries NO names, ages, or roles.
 */
export interface MemberManifest {
  slots: { id: MemberId; avatarSeed: string; emoji?: string }[];
}

// ---------- Itinerary ----------

/**
 * Generic item kinds — chosen to fit any trip shape (flights, drives,
 * hotels, activities, stops, multi-day transit segments, rest days).
 * The app makes no assumption about transit mode or destination type;
 * concrete values come from the private data backend.
 */
export type ItineraryItemKind =
  | 'flight'
  | 'drive'
  | 'lodging-checkin'
  | 'lodging-checkout'
  | 'activity'
  | 'stop'
  | 'transit-start'
  | 'transit-segment'
  | 'transit-end'
  | 'rest-day'
  | 'note';

export interface ItineraryItem {
  id: string;
  date: string;             // YYYY-MM-DD (local-to-the-place)
  kind: ItineraryItemKind;
  title: string;
  subtitle?: string;
  startTime?: string;       // HH:MM (24h, local)
  endTime?: string;
  placeSlug?: string;       // links to a place discovery card
  confirmation?: string;
  body?: string;            // markdown OK
}

export interface ItineraryDoc {
  meta: { name: string; startDate: string; endDate: string };
  items: ItineraryItem[];
}

// ---------- Place discovery ----------

export interface Trivia {
  q: string;
  options: string[];
  answer: number;
  explanation: string;
}

export interface PlaceFact {
  icon: string;
  fact: string;
}

export interface Place {
  slug: string;
  name: string;
  subtitle: string;
  /** Hero photo is synced from the private backend as places/<slug>.jpg. */
  heroCredit: string;
  arriveISO?: string;
  departISO?: string;
  intro: string;
  didYouKnow: PlaceFact[];
  huntFor: string[];
  trivia: Trivia[];
  /**
   * Per-member tailored note, keyed by opaque MemberId. The string values
   * never appear in the public source; they're authored in the private
   * data backend by you and only loaded once unlocked.
   */
  kidsCorner?: Record<MemberId, string>;
  tags: string[];
}

// ---------- Messages & photos ----------

export type MessageKind = 'message' | 'journal';

export interface Message {
  id: string;               // uuid
  from: MemberId;
  sentAt: string;           // ISO
  body: string;
  kind?: MessageKind;       // defaults to 'message'
  reactions?: Record<MemberId, string>;  // memberId -> emoji
  attachmentPhotoId?: string;
}

export interface Photo {
  id: string;
  from: MemberId;
  takenAt: string;          // ISO (EXIF DateTimeOriginal if present, else upload time)
  uploadedAt: string;
  caption?: string;
  placeSlug?: string;
  filePath: string;         // path in the data backend (jpg)
  width: number;
  height: number;
  bytes: number;
  exifPresent: boolean;
}

// ---------- Points & challenges ----------

export type PointReason =
  | 'photo'
  | 'journal'
  | 'reaction'
  | 'challenge'
  | 'trivia'
  | 'parent-bonus'
  | 'streak'
  | 'correction';

export interface PointEvent {
  id: string;
  to: MemberId;
  by: MemberId;             // self for auto-earned; parent id for bonuses
  at: string;               // ISO
  amount: number;           // negative allowed only for 'correction' by parent
  reason: PointReason;
  refId?: string;           // challenge id / message id / photo id, depending
  note?: string;            // free-text reason (required for parent-bonus)
}

export type ChallengeProof = 'photo' | 'trivia' | 'checkbox';
export type ChallengeKind = 'daily' | 'place-specific' | 'trip-wide' | 'excursion-locked';

export interface Challenge {
  id: string;
  title: string;
  description: string;
  icon: string;             // emoji
  kind: ChallengeKind;
  placeSlug?: string;
  points: number;
  bonusPoints?: number;     // extra unlocked by meta-condition
  proofType: ChallengeProof;
  activeFrom: string;       // YYYY-MM-DD
  activeUntil: string;
  /**
   * For excursion-locked: require EXIF timestamp within
   * [excursionStart, excursionEnd]. For place-specific: just the day window.
   */
  excursionStartISO?: string;
  excursionEndISO?: string;
  /** For trivia: id of question set in the place doc. */
  triviaPlaceSlug?: string;
}

export interface ChallengeCompletion {
  id: string;               // uuid
  challengeId: string;
  by: MemberId;
  completedAt: string;
  proofPhotoId?: string;
  triviaAnswers?: number[];
  triviaCorrect?: number;
  awardedPoints: number;
}

export interface HabitCheckIn {
  id: string;
  by: MemberId;
  date: string;             // YYYY-MM-DD
  at: string;               // ISO
}

// ---------- Tiers & prizes ----------

export type Tier = 'none' | 'bronze' | 'silver' | 'gold' | 'platinum';

export interface PointsConfig {
  tiers: { tier: Exclude<Tier, 'none'>; threshold: number; rewardLabel: string }[];
  earn: {
    photo: number;
    journal: number;
    reaction: number;
    streakBonus: number;
  };
  caps: {
    photoPerDay: number;
    journalPerDay: number;
    reactionPerDay: number;
    parentBonusMax: number;
  };
}

// ---------- Outbox (local-only) ----------

export type OutboxOp =
  | { kind: 'put-file'; path: string; contentBase64: string; commitMessage: string }
  | { kind: 'delete-file'; path: string; sha: string; commitMessage: string };

export interface OutboxEntry {
  id: string;
  op: OutboxOp;
  enqueuedAt: string;
  attempts: number;
  lastError?: string;
}
