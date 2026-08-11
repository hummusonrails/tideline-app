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

/**
 * One stop on the hand-authored route drawing, in a 0–100 viewBox.
 *
 * Lives in the private trip data so the public app ships no geography.
 */
export interface RoutePoint {
  slug: string;
  x: number;
  y: number;
  label?: string;
}

// ---------- Messages & photos ----------

/**
 * `poll` bodies encode the question and options; votes ride on Reaction
 * events. See lib/poll.ts. An older build renders one as a plain message,
 * which is an acceptable degradation rather than a break.
 */
export type MessageKind = 'message' | 'journal' | 'poll';

export interface Message {
  id: string;               // uuid
  from: MemberId;
  sentAt: string;           // ISO
  body: string;
  kind?: MessageKind;       // defaults to 'message'
  /**
   * @deprecated Legacy inline reactions, still read so messages written by
   * older builds keep rendering. New reactions are {@link Reaction} events —
   * see that type for why.
   */
  reactions?: Record<MemberId, string>;
  attachmentPhotoId?: string;
}

/**
 * A reaction as its own immutable event.
 *
 * Reactions used to be a mutable map on the Message. That shape can't survive
 * either of our sync paths: gossip dedupes by record id, so a message the peer
 * already has is skipped and the new reaction never arrives; and over Git two
 * people reacting to the same message write the same file, so the second
 * commit erases the first. Making each reaction a separate record with its own
 * id restores idempotent, conflict-free convergence.
 *
 * `emoji: null` is a retraction — tapping the same emoji again. Keeping it as
 * a record rather than a delete means the retraction propagates like anything
 * else instead of relying on a tombstone.
 */
export interface Reaction {
  id: string;               // uuid
  messageId: string;
  by: MemberId;
  emoji: string | null;
  at: string;               // ISO
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
  | 'correction'
  /**
   * A point handed from one member to another with a note. The only
   * cross-member mint besides 'parent-bonus', and deliberately tiny: it's
   * signed by the giver's device and capped per giver per day, so gossip
   * can't turn it into a duplication channel.
   */
  | 'gift';

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

// ---------- Treasure hunts ----------

/**
 * How a hunt stage is proved.
 *
 * `code` answers are stored as a SHA-256 hash of the normalized answer rather
 * than plaintext. Everyone on the trip holds a token that can read the data
 * backend, so plaintext solutions would be thirty seconds of curiosity away.
 */
export type HuntStageProof =
  | { type: 'code'; answerHash: string; placeholder?: string }
  | { type: 'photo' }
  | { type: 'checkbox' }
  | { type: 'quiz'; q: string; options: string[]; answer: number };

/**
 * Gate on when a stage becomes solvable. All present conditions must hold.
 * Absent means "as soon as the previous stage is done".
 */
export interface HuntStageUnlock {
  onOrAfterDate?: string;   // local YYYY-MM-DD
  placeSlug?: string;       // today's itinerary must reference this place
  notBeforeISO?: string;    // wall-clock gate
}

export interface HuntStage {
  clue: string;             // markdown-ish; rendered as plain paragraphs
  hint?: string;            // revealing it halves this stage's points
  proof: HuntStageProof;
  points: number;
  unlock?: HuntStageUnlock;
}

export interface Hunt {
  id: string;
  title: string;
  icon: string;             // emoji
  intro: string;
  kind: 'port' | 'ship' | 'meta';
  /** Which members play. Resolved against Profile.role; defaults to 'all'. */
  team?: 'kids' | 'parents' | 'all';
  stages: HuntStage[];
  finaleBonus: number;      // extra points for closing the last stage
  reveal?: string;          // the payoff, shown once the hunt is finished
  /** Invisible until its first stage's unlock condition passes. */
  hidden?: boolean;
  activeFrom: string;       // YYYY-MM-DD
  activeUntil: string;
}

// ---------- Avatars ----------

/**
 * A member's composed crew avatar. Part ids reference the public catalog in
 * lib/avatarCatalog.ts; the art itself ships in code, so this record carries
 * nothing but opaque choices.
 *
 * Single-writer mutable file (`avatars/<id>.avatar.json`), the same
 * convergence class as `profiles/<id>.json`: exactly one member ever writes
 * their own. Two devices signed in as the same member resolve by `updatedAt`.
 */
export interface AvatarSpec {
  memberId: MemberId;
  base: string;
  palette: string;
  eyes: string;
  mouth: string;
  hat?: string;
  accessory?: string;
  /** Date-scoped so it expires on its own instead of needing a clear. */
  mood?: { emoji: string; date: string };
  updatedAt: string;        // ISO
}

// ---------- Easter eggs ----------

/**
 * What makes an egg fire. Every variant is a generic mechanic: the engine
 * knows "a date trigger exists", only the private trip data knows which date.
 */
export type EggTrigger =
  | { kind: 'tap-seq'; anchor: string; count: number }
  | { kind: 'long-press'; anchor: string; ms: number }
  | { kind: 'corner-code'; sequence: ('tl' | 'tr' | 'bl' | 'br')[] }
  | { kind: 'date'; date: string }
  | { kind: 'place-day'; placeSlug: string }
  | { kind: 'milestone'; metric: EggMetric; atLeast: number };

/** Locally computable counters a secret achievement can watch. */
export type EggMetric =
  | 'points'
  | 'photos'
  | 'streak'
  | 'reactionsGiven'
  | 'journals'
  | 'challenges'
  | 'eggsFound';

export type EggEffect =
  | 'confetti'
  | 'aurora'
  | 'sonar'
  | 'snow'
  | 'message';

export interface EggDef {
  id: string;
  trigger: EggTrigger;
  effect: EggEffect;
  points: number;
  copy: string;
  /** Title shown in the Crew Deck once found. Falls back to the copy. */
  title?: string;
  /** Renders as "???" in the Crew Deck until earned. */
  secret?: boolean;
}

// ---------- Live moments ----------

/**
 * A window the whole family is invited into at the same time. The countdown
 * is pure clock math against fields already on the device, so it works with
 * no connectivity — which is the point, since the best ones happen at sea.
 */
export interface Moment {
  id: string;
  title: string;
  prompt: string;
  startISO: string;
  endISO: string;
  joinPoints: number;
  /** Extra for everyone once every member has checked in. */
  allBonus: number;
  icon?: string;
}

// ---------- Co-op goal ----------

export interface CrewGoal {
  id: string;
  label: string;
  target: number;
  /** Deliberately allusive — the app never names or prices a reward. */
  rewardLabel: string;
  until: string;            // YYYY-MM-DD
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
