/**
 * The cabinet lineup.
 *
 * Twenty games, all art and mechanics, zero identity — same rule as the
 * avatar catalog. Nothing here knows who is on this trip or where they're
 * going; a game's *content* (the words in hangman, the questions in the quiz,
 * the stops in the sorting game) is derived at runtime from whatever the
 * device has synced. See `content.ts`.
 *
 * `par` is the number that makes this cabinet's rating 100 — "a genuinely
 * good run". It's what makes a leaderboard across twenty unrelated games
 * meaningful: a 6,000 in Block Tide and a 15 in Sonar Says are both a 100,
 * and neither one can bury the other by being scored on a bigger scale.
 */

export type ArcadeCategory = 'action' | 'puzzle' | 'word' | 'crew';

export interface ArcadeGame {
  /** Stable id — used in the route and in every synthetic completion id. */
  id: string;
  /** Marquee name, always shown uppercase. */
  title: string;
  tagline: string;
  glyph: string;
  /** Neon hue (0–360) for this cabinet's tile and HUD. */
  hue: number;
  category: ArcadeCategory;
  /** Score that earns a rating of 100. See the file header. */
  par: number;
  /** Raw game score per one trip point. */
  scorePerPoint: number;
  /** Ceiling on trip points from a single run, before the daily cap. */
  maxPointsPerRun: number;
  /** One line, shown on the attract screen. */
  controls: string;
}

export const GAMES: ArcadeGame[] = [
  {
    id: 'crew-invaders',
    title: 'Crew Invaders',
    tagline: 'They came from the deep. You brought a laser.',
    glyph: '👾',
    hue: 130,
    category: 'action',
    par: 2000,
    scorePerPoint: 200,
    maxPointsPerRun: 12,
    controls: 'Slide to move · tap FIRE · ← → and space on a keyboard',
  },
  {
    id: 'block-tide',
    title: 'Block Tide',
    tagline: 'The tide comes in four blocks at a time.',
    glyph: '🧱',
    hue: 200,
    category: 'puzzle',
    par: 6000,
    scorePerPoint: 500,
    maxPointsPerRun: 15,
    controls: 'Tap to rotate · swipe to move · swipe down to drop',
  },
  {
    id: 'sea-snake',
    title: 'Sea Snake',
    tagline: 'Eat the plankton. Do not eat yourself.',
    glyph: '🐍',
    hue: 90,
    category: 'action',
    par: 300,
    scorePerPoint: 30,
    maxPointsPerRun: 12,
    controls: 'Swipe or use the d-pad to turn',
  },
  {
    id: 'port-breaker',
    title: 'Port Breaker',
    tagline: 'Knock out every stop on the route.',
    glyph: '🧱',
    hue: 25,
    category: 'action',
    par: 1200,
    scorePerPoint: 120,
    maxPointsPerRun: 12,
    controls: 'Drag anywhere to steer the paddle',
  },
  {
    id: 'tide-pong',
    title: 'Tide Pong',
    tagline: 'First to eleven. The house does not go easy.',
    glyph: '🏓',
    hue: 300,
    category: 'action',
    par: 11,
    scorePerPoint: 2,
    maxPointsPerRun: 8,
    controls: 'Drag to move your paddle',
  },
  {
    id: 'asteroid-drift',
    title: 'Asteroid Drift',
    tagline: 'Ice floes, everywhere, and no brakes.',
    glyph: '🪨',
    hue: 190,
    category: 'action',
    par: 2500,
    scorePerPoint: 250,
    maxPointsPerRun: 12,
    controls: 'Turn with ← →, THRUST to move, FIRE to shoot',
  },
  {
    id: 'gangway',
    title: 'Gangway!',
    tagline: 'Cross the traffic. Then cross the water.',
    glyph: '🐸',
    hue: 105,
    category: 'action',
    par: 800,
    scorePerPoint: 100,
    maxPointsPerRun: 10,
    controls: 'Swipe or d-pad — one square per move',
  },
  {
    id: 'flappy-puffin',
    title: 'Flappy Puffin',
    tagline: 'Mind the gap. Every single gap.',
    glyph: '🐦',
    hue: 45,
    category: 'action',
    par: 30,
    scorePerPoint: 4,
    maxPointsPerRun: 10,
    controls: 'Tap anywhere to flap',
  },
  {
    id: 'maze-muncher',
    title: 'Maze Muncher',
    tagline: 'Clear the deck. Mind the crew.',
    glyph: '🟡',
    hue: 55,
    category: 'action',
    par: 3000,
    scorePerPoint: 300,
    maxPointsPerRun: 12,
    controls: 'Swipe or d-pad to change direction',
  },
  {
    id: 'whack-a-crab',
    title: 'Whack-a-Crab',
    tagline: 'Crabs get whacked. Crew does not.',
    glyph: '🦀',
    hue: 5,
    category: 'crew',
    par: 60,
    scorePerPoint: 8,
    maxPointsPerRun: 10,
    controls: 'Tap the crabs — never tap a crewmate',
  },
  {
    id: 'sonar-says',
    title: 'Sonar Says',
    tagline: 'Repeat the ping. Then the longer ping.',
    glyph: '📡',
    hue: 175,
    category: 'crew',
    par: 15,
    scorePerPoint: 2,
    maxPointsPerRun: 10,
    controls: 'Watch the sequence, then tap it back',
  },
  {
    id: 'crew-match',
    title: 'Crew Match',
    tagline: 'Find the pairs before the clock does.',
    glyph: '🃏',
    hue: 265,
    category: 'crew',
    par: 1000,
    scorePerPoint: 120,
    maxPointsPerRun: 10,
    controls: 'Tap two cards to turn them over',
  },
  {
    id: 'hangman',
    title: 'Hangman',
    tagline: 'Six wrong guesses and the anchor drops.',
    glyph: '🪢',
    hue: 30,
    category: 'word',
    par: 500,
    scorePerPoint: 60,
    maxPointsPerRun: 10,
    controls: 'Tap letters — solve it before the rope runs out',
  },
  {
    id: 'tide-search',
    title: 'Tide Search',
    tagline: 'Every word is somewhere in the grid.',
    glyph: '🔤',
    hue: 210,
    category: 'word',
    par: 600,
    scorePerPoint: 70,
    maxPointsPerRun: 10,
    controls: 'Drag across a line of letters to claim a word',
  },
  {
    id: 'scramble',
    title: 'Scramble',
    tagline: 'The letters are all there. Somewhere.',
    glyph: '🔀',
    hue: 320,
    category: 'word',
    par: 800,
    scorePerPoint: 90,
    maxPointsPerRun: 10,
    controls: 'Tap letters to build the word · UNDO to take one back',
  },
  {
    id: 'family-quiz',
    title: 'Family Quiz',
    tagline: 'How well do you know this crew?',
    glyph: '❓',
    hue: 285,
    category: 'crew',
    par: 1000,
    scorePerPoint: 100,
    maxPointsPerRun: 12,
    controls: 'Answer fast — the timer is part of the score',
  },
  {
    id: 'time-machine',
    title: 'Time Machine',
    tagline: 'Put the trip back in order.',
    glyph: '⏳',
    hue: 160,
    category: 'puzzle',
    par: 700,
    scorePerPoint: 80,
    maxPointsPerRun: 10,
    controls: 'Tap two cards to swap them, then LOCK IT IN',
  },
  {
    id: 'tide-2048',
    title: 'Tide 2048',
    tagline: 'Merge the swells. Reach the big one.',
    glyph: '🌊',
    hue: 220,
    category: 'puzzle',
    par: 12000,
    scorePerPoint: 1200,
    maxPointsPerRun: 12,
    controls: 'Swipe to slide every tile',
  },
  {
    id: 'reef-sweeper',
    title: 'Reef Sweeper',
    tagline: 'Chart the reef without hitting it.',
    glyph: '⚓',
    hue: 15,
    category: 'puzzle',
    par: 500,
    scorePerPoint: 60,
    maxPointsPerRun: 10,
    controls: 'Tap to reveal · hold to flag',
  },
  {
    id: 'ad-lib',
    title: 'Ad-Lib Machine',
    tagline: 'Feed it words. It writes the postcard.',
    glyph: '📝',
    hue: 340,
    category: 'word',
    par: 300,
    scorePerPoint: 60,
    maxPointsPerRun: 6,
    controls: 'Fill every blank, then run the machine',
  },
];

export function gameById(id: string | undefined): ArcadeGame | undefined {
  return GAMES.find((g) => g.id === id);
}

export const CATEGORY_LABEL: Record<ArcadeCategory, string> = {
  action: 'Action',
  puzzle: 'Puzzle',
  word: 'Word',
  crew: 'Crew',
};

/** Neon CSS colour for a cabinet, used by tiles, HUDs and canvases alike. */
export function hueColor(hue: number, lightness = 62, saturation = 95): string {
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}
