/**
 * Where the arcade gets its words, its questions and its scenery.
 *
 * Every game in the lineup is a generic mechanic. What makes it *this
 * family's* arcade is derived here, at runtime, from records the device has
 * already synced: place names become the hangman word bank, itinerary stops
 * become the bricks in Port Breaker and the cards in Time Machine, and the
 * quiz is generated from what the crew has actually done on the trip.
 *
 * The privacy rule is the same one the avatar catalog follows, and it's why
 * this file exists at all: the public source ships *mechanism* and a bank of
 * deliberately generic seaside fallback words. It contains no place, no date,
 * no name and no fact about anyone. All of that arrives from the private
 * backend after an unlock, and if it never arrives the arcade still boots and
 * plays — which is also exactly what happens on the first day, offline, at
 * the airport.
 *
 * Everything below is pure: `buildArcadeContent` takes the records and
 * returns the content, so it's testable without a database. The hook at the
 * bottom is the only part that touches Dexie.
 */

import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { todayYMD } from '../time';
import { totalPoints, streakLength } from '../points';
import { foundEggIds } from '../eggs';
import { BASES, findPart } from '../avatarCatalog';
import type {
  AvatarSpec,
  ChallengeCompletion,
  HabitCheckIn,
  ItineraryItem,
  MemberId,
  Message,
  Photo,
  Place,
  PointEvent,
  Profile,
  Reaction,
} from '../../types';
import { shuffle } from './rng';

// ---------- shapes ----------

export interface WordEntry {
  word: string;
  hint: string;
}

export type QuizSource = 'place' | 'trip' | 'crew' | 'general';

export interface QuizQuestion {
  id: string;
  q: string;
  options: string[];
  answer: number;
  /** Shown after answering. */
  note?: string;
  source: QuizSource;
}

export interface Highlight {
  id: string;
  title: string;
  date: string;
  time?: string;
  glyph: string;
  /** Sort key: date plus time, so two items on one day stay in order. */
  sortKey: string;
}

export interface CrewMember {
  id: MemberId;
  name: string;
  spec: AvatarSpec | null;
}

export interface ArcadeContent {
  /** True once anything trip-specific made it in. Drives the "generic" note. */
  personalised: boolean;
  words: WordEntry[];
  quiz: QuizQuestion[];
  highlights: Highlight[];
  crew: CrewMember[];
  /** Short labels for brick rows, maze pellets, invader ranks. */
  labels: string[];
  tripName: string | null;
}

// ---------- the generic fallback bank ----------

/**
 * Seaside words that ship in the public repo.
 *
 * Chosen to be evocative and completely uninformative: none of them names a
 * destination, a date or a person, so the word bank gives nothing away if
 * somebody reads the source, and the arcade is still fun before the first
 * sync lands.
 */
const FALLBACK_WORDS: readonly WordEntry[] = [
  { word: 'ANCHOR', hint: 'It keeps you where you meant to stay' },
  { word: 'HARBOUR', hint: 'Somewhere to tie up' },
  { word: 'LANTERN', hint: 'Light you can carry' },
  { word: 'COMPASS', hint: 'It only ever points one way' },
  { word: 'VOYAGE', hint: 'The long way round' },
  { word: 'PLANKTON', hint: 'Very small, very important' },
  { word: 'DRIFTWOOD', hint: 'It got here on its own' },
  { word: 'PORTHOLE', hint: 'A round window with a view' },
  { word: 'HORIZON', hint: 'Always the same distance away' },
  { word: 'GLACIER', hint: 'Slow, blue and enormous' },
  { word: 'BEACON', hint: 'It warns and it welcomes' },
  { word: 'CAPTAIN', hint: 'Last off the ship' },
  { word: 'JOURNAL', hint: 'Where the day gets written down' },
  { word: 'POSTCARD', hint: 'A short letter with a picture' },
  { word: 'SOUVENIR', hint: 'You will find it in a drawer in a year' },
  { word: 'TIDEPOOL', hint: 'A whole world, twice a day' },
  { word: 'STARBOARD', hint: 'The right-hand side' },
  { word: 'FATHOM', hint: 'Six feet down, or to understand' },
  { word: 'SEXTANT', hint: 'Navigation by the stars' },
  { word: 'KRAKEN', hint: 'Probably not real' },
  { word: 'MARMALADE', hint: 'Breakfast, but bitter' },
  { word: 'SUITCASE', hint: 'It is always slightly too small' },
  { word: 'PASSPORT', hint: 'Do not lose this one' },
  { word: 'SUNRISE', hint: 'Worth setting an alarm for' },
  { word: 'SEAGULL', hint: 'It wants your chips' },
  { word: 'WHISTLE', hint: 'Loud, and very small' },
  { word: 'GALLEY', hint: 'Where the food happens' },
  { word: 'RIGGING', hint: 'Ropes with opinions' },
];

const GENERIC_QUIZ: readonly QuizQuestion[] = [
  {
    id: 'g-knots',
    q: 'How fast is one knot?',
    options: ['One sea mile an hour', 'One metre a second', 'Ten miles an hour', 'It depends on the rope'],
    answer: 0,
    note: 'A knot is one nautical mile per hour — about 1.15 ordinary miles.',
    source: 'general',
  },
  {
    id: 'g-port',
    q: 'Which side of a ship is port?',
    options: ['Left, facing forward', 'Right, facing forward', 'The back', 'Whichever faces the dock'],
    answer: 0,
    note: 'Port is left, and both words are shorter than their opposites.',
    source: 'general',
  },
  {
    id: 'g-tide',
    q: 'What causes the tides?',
    options: ['The moon, mostly', 'Wind', 'Ocean currents', 'The earth spinning'],
    answer: 0,
    note: 'The moon does most of it; the sun adds a smaller pull.',
    source: 'general',
  },
  {
    id: 'g-otter',
    q: 'Why do sea otters hold hands?',
    options: ['So they do not drift apart', 'To stay warm', 'To share food', 'They are showing off'],
    answer: 0,
    note: 'Rafting otters hold on so the group stays together while they sleep.',
    source: 'general',
  },
  {
    id: 'g-glacier',
    q: 'Why does glacier ice look blue?',
    options: ['Dense ice absorbs red light', 'It reflects the sky', 'Trapped minerals', 'It is very cold'],
    answer: 0,
    note: 'Compressed ice soaks up the red end of the spectrum and leaves blue.',
    source: 'general',
  },
  {
    id: 'g-arcade',
    q: 'Roughly when did arcade cabinets take over?',
    options: ['The 1980s', 'The 1960s', 'The 2000s', 'The 1940s'],
    answer: 0,
    note: 'The golden age ran from about 1978 to the mid-eighties.',
    source: 'general',
  },
];

// ---------- text helpers ----------

const WORD_OK = /^[A-Z]{4,11}$/;

/**
 * Turn free text into puzzle-safe words.
 *
 * Accents get folded rather than dropped: a place name written with a
 * diacritic should still be guessable on an A–Z keyboard instead of
 * vanishing from the bank entirely.
 */
export function toWords(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((w) => WORD_OK.test(w));
}

const STOPWORDS = new Set([
  'THIS', 'THAT', 'WITH', 'FROM', 'INTO', 'OVER', 'THEN', 'THAN', 'THEY', 'THEM',
  'HAVE', 'WILL', 'BEEN', 'WHEN', 'WHAT', 'YOUR', 'OURS', 'SOME', 'MORE', 'MOST',
  'ONLY', 'JUST', 'ALSO', 'VERY', 'EACH', 'BOTH', 'AFTER', 'BEFORE', 'ABOUT',
  'THERE', 'THEIR', 'WHICH', 'WOULD', 'COULD', 'SHOULD', 'BEING', 'DOING',
]);

function dedupeWords(entries: readonly WordEntry[]): WordEntry[] {
  const seen = new Set<string>();
  const out: WordEntry[] = [];
  for (const e of entries) {
    if (STOPWORDS.has(e.word) || seen.has(e.word)) continue;
    seen.add(e.word);
    out.push(e);
  }
  return out;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Trim a title down to something that fits on a brick or a card. */
export function shortLabel(text: string, max = 18): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

const KIND_GLYPH: Record<string, string> = {
  flight: '✈️',
  drive: '🚗',
  'lodging-checkin': '🛏️',
  'lodging-checkout': '🧳',
  activity: '🎟️',
  stop: '📍',
  'transit-start': '🚢',
  'transit-segment': '🌊',
  'transit-end': '⚓',
  'rest-day': '😴',
  note: '📝',
};

// ---------- builders ----------

export interface ContentInput {
  places: readonly Place[];
  itinerary: readonly ItineraryItem[];
  profiles: readonly Profile[];
  avatarSpecs: readonly AvatarSpec[];
  photos: readonly Photo[];
  messages: readonly Message[];
  reactions: readonly Reaction[];
  pointEvents: readonly PointEvent[];
  habits: readonly HabitCheckIn[];
  completions: readonly ChallengeCompletion[];
  tripName?: string | null;
  today?: string;
}

/** The word bank: place names first, then things to look for, then fallbacks. */
export function buildWords(input: ContentInput): WordEntry[] {
  const out: WordEntry[] = [];

  for (const place of input.places) {
    for (const w of toWords(place.name)) {
      out.push({ word: w, hint: 'Somewhere on this trip' });
    }
    for (const item of place.huntFor) {
      for (const w of toWords(item)) {
        out.push({ word: w, hint: `Something to look for in ${place.name}` });
      }
    }
    for (const tag of place.tags) {
      for (const w of toWords(tag)) out.push({ word: w, hint: 'A theme of this trip' });
    }
  }

  for (const item of input.itinerary) {
    for (const w of toWords(item.title)) {
      out.push({ word: w, hint: 'It is on the itinerary' });
    }
  }

  // Fallbacks go last so trip words win the dedupe and their better hints
  // survive — but the bank is never allowed to be thin enough to repeat.
  return dedupeWords([...out, ...FALLBACK_WORDS]);
}

/** Itinerary items as sortable, drawable cards. */
export function buildHighlights(input: ContentInput): Highlight[] {
  return input.itinerary
    .filter((i) => i.title.trim().length > 0)
    .map((i) => ({
      id: i.id,
      title: i.title,
      date: i.date,
      time: i.startTime,
      glyph: KIND_GLYPH[i.kind] ?? '📍',
      sortKey: `${i.date}T${i.startTime ?? '99:99'}`,
    }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

/**
 * Crew list.
 *
 * Names come from synced profiles and exist only at runtime. Members with no
 * profile yet are dropped rather than shown as an opaque id — an option in a
 * quiz reading `a3f91c` helps nobody.
 */
export function buildCrew(input: ContentInput): CrewMember[] {
  const specs = new Map(input.avatarSpecs.map((s) => [s.memberId, s]));
  return input.profiles
    .filter((p) => p.displayName.trim().length > 0)
    .map((p) => ({ id: p.id, name: p.displayName, spec: specs.get(p.id) ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * A "who did the most X" question, if there's a clear winner.
 *
 * Returns null on a tie — a quiz question with two right answers is worse
 * than one fewer question — and null when there aren't enough crew members to
 * make a plausible wrong answer.
 */
function whoQuestion(
  id: string,
  q: string,
  crew: readonly CrewMember[],
  metric: (member: MemberId) => number,
  note: (winner: string, value: number) => string,
): QuizQuestion | null {
  if (crew.length < 3) return null;
  const scored = crew.map((c) => ({ c, value: metric(c.id) }));
  const ranked = [...scored].sort((a, b) => b.value - a.value);
  if (ranked[0].value <= 0) return null;
  if (ranked[0].value === ranked[1].value) return null;

  const winner = ranked[0].c;
  const distractors = shuffle(
    crew.filter((c) => c.id !== winner.id),
    seededRng(id),
  ).slice(0, 3);
  const options = shuffle([winner, ...distractors], seededRng(`${id}-opt`));
  return {
    id,
    q,
    options: options.map((o) => o.name),
    answer: options.findIndex((o) => o.id === winner.id),
    note: note(winner.name, ranked[0].value),
    source: 'crew',
  };
}

/**
 * A fixed shuffle per question id.
 *
 * Deterministic on purpose: the correct answer must not drift to a different
 * slot between two renders of the same question, and every device should lay
 * the same question out the same way when they compare notes afterwards.
 */
function seededRng(key: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build one multiple-choice question from a correct answer plus distractors. */
function choiceQuestion(
  id: string,
  q: string,
  correct: string,
  pool: readonly string[],
  source: QuizSource,
  note?: string,
): QuizQuestion | null {
  const distractors = shuffle(
    pool.filter((p) => p !== correct),
    seededRng(id),
  ).slice(0, 3);
  if (distractors.length < 2) return null;
  const options = shuffle([correct, ...distractors], seededRng(`${id}-opt`));
  return { id, q, options, answer: options.indexOf(correct), note, source };
}

export function buildQuiz(input: ContentInput): QuizQuestion[] {
  const today = input.today ?? todayYMD();
  const crew = buildCrew(input);
  const out: QuizQuestion[] = [];

  // 1. Authored place trivia — the best questions available, written by hand
  //    in the private backend.
  for (const place of input.places) {
    place.trivia.forEach((t, i) => {
      if (t.options.length < 2) return;
      out.push({
        id: `pt-${place.slug}-${i}`,
        q: t.q,
        options: t.options,
        answer: t.answer,
        note: t.explanation,
        source: 'place',
      });
    });
  }

  // 2. Facts turned into questions: which place is this true of?
  const placeNames = input.places.map((p) => p.name);
  for (const place of input.places) {
    place.didYouKnow.slice(0, 2).forEach((fact, i) => {
      const question = choiceQuestion(
        `pf-${place.slug}-${i}`,
        `Where is this true? "${fact.fact}"`,
        place.name,
        placeNames,
        'place',
      );
      if (question) out.push(question);
    });
  }

  // 3. Itinerary questions, both directions: what happens on a day, and what
  //    day a thing happens on.
  const highlights = buildHighlights(input);
  const allDates = [...new Set(highlights.map((h) => h.date))];
  const allTitles = highlights.map((h) => h.title);
  for (const h of highlights.slice(0, 14)) {
    const whenQ = choiceQuestion(
      `iw-${h.id}`,
      `Which day is "${shortLabel(h.title, 40)}"?`,
      prettyShort(h.date),
      allDates.map(prettyShort),
      'trip',
    );
    if (whenQ) out.push(whenQ);

    const whatQ = choiceQuestion(
      `it-${h.id}`,
      `What is on the plan for ${prettyShort(h.date)}?`,
      shortLabel(h.title, 40),
      allTitles.map((t) => shortLabel(t, 40)),
      'trip',
    );
    if (whatQ) out.push(whatQ);
  }

  // 4. Where do we go first?
  if (highlights.length > 2 && placeNames.length > 2) {
    const firstPlaceSlug = input.itinerary
      .slice()
      .sort((a, b) => `${a.date}${a.startTime ?? ''}`.localeCompare(`${b.date}${b.startTime ?? ''}`))
      .find((i) => i.placeSlug)?.placeSlug;
    const firstPlace = input.places.find((p) => p.slug === firstPlaceSlug);
    if (firstPlace) {
      const q = choiceQuestion(
        'first-stop',
        'Which stop comes first on this trip?',
        firstPlace.name,
        placeNames,
        'trip',
      );
      if (q) out.push(q);
    }
  }

  // 5. Crew questions, computed from what people have actually done.
  const photoCount = (m: MemberId) => input.photos.filter((p) => p.from === m).length;
  const journalCount = (m: MemberId) =>
    input.messages.filter((x) => x.from === m && x.kind === 'journal').length;
  const reactionCount = (m: MemberId) =>
    new Set(input.reactions.filter((r) => r.by === m).map((r) => r.messageId)).size;

  const crewQs = [
    whoQuestion('c-photos', 'Who has posted the most photos?', crew, photoCount,
      (n, v) => `${n}, with ${v}.`),
    whoQuestion('c-journal', 'Who has written the most journal entries?', crew, journalCount,
      (n, v) => `${n} — ${v} of them.`),
    whoQuestion('c-react', 'Who reacts to the most messages?', crew, reactionCount,
      (n, v) => `${n}, on ${v} messages.`),
    whoQuestion('c-points', 'Who is leading the points table?', crew,
      (m) => totalPoints(input.pointEvents as PointEvent[], m),
      (n, v) => `${n}, on ${v} points.`),
    whoQuestion('c-streak', 'Who has the longest check-in streak?', crew,
      (m) => streakLength(input.habits as HabitCheckIn[], m, today),
      (n, v) => `${n} — ${v} day${v === 1 ? '' : 's'} running.`),
    whoQuestion('c-eggs', 'Who has found the most hidden secrets?', crew,
      (m) => foundEggIds(input.completions, m).size,
      (n, v) => `${n}, with ${v} found.`),
  ];
  for (const q of crewQs) if (q) out.push(q);

  // 6. Avatar questions — "whose crewmate is the otter?"
  for (const member of crew) {
    if (!member.spec) continue;
    const baseLabel = findPart(BASES, member.spec.base).label.toLowerCase();
    // Only ask when the answer is unique, otherwise two people are both right.
    const sameBase = crew.filter(
      (c) => c.spec && findPart(BASES, c.spec.base).id === member.spec!.base,
    );
    if (sameBase.length !== 1) continue;
    const q = choiceQuestion(
      `av-${member.id}`,
      `Whose crew avatar is the ${baseLabel}?`,
      member.name,
      crew.map((c) => c.name),
      'crew',
    );
    if (q) out.push(q);
  }

  // 7. Habits people set for themselves.
  for (const p of input.profiles) {
    if (!p.habit?.label) continue;
    const q = choiceQuestion(
      `hb-${p.id}`,
      `Whose daily habit is "${p.habit.label}"?`,
      p.displayName,
      crew.map((c) => c.name),
      'crew',
    );
    if (q) out.push(q);
  }

  // Generic questions always ride along at the end, so a first-day quiz with
  // nothing synced is still a quiz.
  return [...out, ...GENERIC_QUIZ];
}

function prettyShort(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Short strings for brick rows, invader ranks and maze decoration. */
export function buildLabels(input: ContentInput): string[] {
  const fromPlaces = input.places.map((p) => shortLabel(p.name, 12));
  const fromItinerary = buildHighlights(input).map((h) => shortLabel(h.title, 12));
  const generic = ['HARBOUR', 'GALLEY', 'DECK', 'BRIDGE', 'CABIN', 'PIER', 'BAY', 'REEF'];
  const seen = new Set<string>();
  return [...fromPlaces, ...fromItinerary, ...generic].filter((l) => {
    const key = l.toUpperCase();
    if (!l || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildArcadeContent(input: ContentInput): ArcadeContent {
  const words = buildWords(input);
  const quiz = buildQuiz(input);
  const highlights = buildHighlights(input);
  const crew = buildCrew(input);
  return {
    personalised:
      input.places.length > 0 || input.itinerary.length > 0 || crew.length > 0,
    words,
    quiz,
    highlights,
    crew,
    labels: buildLabels(input),
    tripName: input.tripName ?? null,
  };
}

// ---------- the hook ----------

/**
 * Live arcade content.
 *
 * One `useLiveQuery` per table rather than one big transaction: Dexie
 * re-runs only the queries whose tables changed, so posting a photo doesn't
 * rebuild the word bank. The whole thing is memoised on the arrays, so a
 * game holding this object across a run isn't rebuilding a quiz every frame.
 */
export function useArcadeContent(): ArcadeContent {
  const places = useLiveQuery(() => db.places.toArray(), []) ?? [];
  const itinerary = useLiveQuery(() => db.itinerary.toArray(), []) ?? [];
  const profiles = useLiveQuery(() => db.profiles.toArray(), []) ?? [];
  const avatarSpecs = useLiveQuery(() => db.avatarSpecs.toArray(), []) ?? [];
  const photos = useLiveQuery(() => db.photos.toArray(), []) ?? [];
  const messages = useLiveQuery(() => db.messages.toArray(), []) ?? [];
  const reactions = useLiveQuery(() => db.reactions.toArray(), []) ?? [];
  const pointEvents = useLiveQuery(() => db.pointEvents.toArray(), []) ?? [];
  const habits = useLiveQuery(() => db.habits.toArray(), []) ?? [];
  const completions = useLiveQuery(() => db.completions.toArray(), []) ?? [];
  const tripMeta = useLiveQuery(() => db.meta.get('trip-meta'), []);
  const today = todayYMD();

  return useMemo(
    () =>
      buildArcadeContent({
        places,
        itinerary,
        profiles,
        avatarSpecs,
        photos,
        messages,
        reactions,
        pointEvents,
        habits,
        completions,
        tripName: (tripMeta?.value as { name?: string } | undefined)?.name ?? null,
        today,
      }),
    [
      places, itinerary, profiles, avatarSpecs, photos, messages,
      reactions, pointEvents, habits, completions, tripMeta, today,
    ],
  );
}

// ---------- ad-lib stories ----------

export interface AdLibSlot {
  key: string;
  /** What to ask for: "a plural noun", "an adjective". */
  prompt: string;
  example: string;
}

export interface AdLibStory {
  id: string;
  title: string;
  slots: AdLibSlot[];
  /** Rendered with `{key}` placeholders, plus `{place}` and `{crew}`. */
  template: string;
}

/**
 * Postcard templates.
 *
 * `{place}`, `{crew}` and `{plan}` are filled from synced trip data when it
 * exists and from harmless generic stand-ins when it doesn't — so the joke
 * lands on day one and lands better on day six.
 */
export const AD_LIB_STORIES: readonly AdLibStory[] = [
  {
    id: 'postcard',
    title: 'The Postcard Home',
    slots: [
      { key: 'adj1', prompt: 'An adjective', example: 'soggy' },
      { key: 'noun1', prompt: 'A plural noun', example: 'penguins' },
      { key: 'verb1', prompt: 'A verb ending in -ing', example: 'sprinting' },
      { key: 'food', prompt: 'A food', example: 'waffles' },
      { key: 'number', prompt: 'A number', example: 'forty-one' },
      { key: 'adj2', prompt: 'Another adjective', example: 'majestic' },
    ],
    template:
      'Greetings from {place}!\n\nToday was completely {adj1}. We got up at dawn and found {number} {noun1} just standing there, {verb1}, like it was nothing. {crew} said it was the most {adj2} thing they had ever seen.\n\nThen we ate our own weight in {food} and agreed never to speak of it again.\n\nWish you were here (mostly).',
  },
  {
    id: 'log',
    title: "The Captain's Log",
    slots: [
      { key: 'adj1', prompt: 'An adjective', example: 'suspicious' },
      { key: 'animal', prompt: 'An animal', example: 'walrus' },
      { key: 'verb1', prompt: 'A verb (past tense)', example: 'yodelled' },
      { key: 'object', prompt: 'An object', example: 'a kettle' },
      { key: 'adverb', prompt: 'An adverb', example: 'loudly' },
    ],
    template:
      "Captain's log.\n\nConditions: {adj1}. Morale: holding.\n\nAt 0600 a {animal} appeared off the bow and {verb1} {adverb} for eleven minutes. The crew responded by producing {object}, which nobody has explained.\n\nWe are due at {plan} and I have decided not to ask any further questions.",
  },
  {
    id: 'review',
    title: 'The Five-Star Review',
    slots: [
      { key: 'adj1', prompt: 'An adjective', example: 'thunderous' },
      { key: 'noun1', prompt: 'A noun', example: 'sandwich' },
      { key: 'verb1', prompt: 'A verb', example: 'juggle' },
      { key: 'bodypart', prompt: 'A body part', example: 'elbow' },
      { key: 'adj2', prompt: 'Another adjective', example: 'damp' },
    ],
    template:
      '★★★★★ — "Would {verb1} again"\n\nWe visited {place} expecting a quiet morning and instead received a {adj1} {noun1} experience.\n\nOne member of our party ({crew}) injured an {bodypart} attempting to take a photograph. Staff were {adj2} throughout and did not laugh where we could see them.\n\nTen out of ten. No notes.',
  },
  {
    id: 'news',
    title: 'Breaking News',
    slots: [
      { key: 'adj1', prompt: 'An adjective', example: 'unprecedented' },
      { key: 'noun1', prompt: 'A plural noun', example: 'umbrellas' },
      { key: 'verb1', prompt: 'A verb ending in -ing', example: 'negotiating' },
      { key: 'place2', prompt: 'A room in a house', example: 'the bathroom' },
      { key: 'number', prompt: 'A number', example: 'nine' },
    ],
    template:
      'BREAKING: {adj1} scenes at {place} this morning.\n\nEyewitnesses report {number} {noun1} {verb1} on the promenade for over an hour. A family holidaying nearby said they first noticed something was wrong from {place2}.\n\n"{crew} knew," said one source. "{crew} always knows."\n\nMore on this as we get it.',
  },
];

/** Fill `{place}`, `{crew}` and `{plan}` from whatever the trip knows. */
export function adLibContext(content: ArcadeContent, rng: () => number): {
  place: string;
  crew: string;
  plan: string;
} {
  const places = content.labels.length ? content.labels : ['the harbour'];
  const crewNames = content.crew.map((c) => c.name);
  const plans = content.highlights.map((h) => shortLabel(h.title, 30));
  const at = <T,>(list: readonly T[], fallback: T): T =>
    list.length ? list[Math.floor(rng() * list.length) % list.length] : fallback;
  return {
    place: titleCase(String(at(places, 'the harbour'))),
    crew: at(crewNames, 'Somebody'),
    plan: at(plans, 'the next thing on the list'),
  };
}

/** Render a template with the player's answers plus the trip context. */
export function renderAdLib(
  story: AdLibStory,
  answers: Record<string, string>,
  ctx: { place: string; crew: string; plan: string },
): string {
  return story.template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (key === 'place') return ctx.place;
    if (key === 'crew') return ctx.crew;
    if (key === 'plan') return ctx.plan;
    const value = answers[key];
    return value && value.trim() ? value.trim() : whole;
  });
}

