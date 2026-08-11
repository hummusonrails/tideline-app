/**
 * The party shelf — ten card games for one phone and a table.
 *
 * These are original implementations of the *mechanics* behind the party
 * games families actually buy: judge-picks-the-funniest, one-word clue
 * giving, spectrum guessing, majority matching, social deduction, bluffed
 * definitions, hidden roles, and describe-it-before-the-timer. Every prompt,
 * answer, word list and definition in `decks.ts` is written for this app —
 * nothing is lifted from a published deck, and none of the names here is
 * anybody's trademark.
 *
 * Every one is built for the same situation: one phone, a car or a lounge,
 * nobody else's battery involved. That constraint drives the whole design —
 * the host reads aloud, the device is passed only when something has to stay
 * private, and the host is a player too rather than a referee stuck outside
 * the game.
 */

export type PartyStyle = 'judge' | 'team' | 'coop' | 'deduction' | 'race';

export interface PartyGameDef {
  id: string;
  title: string;
  tagline: string;
  glyph: string;
  hue: number;
  style: PartyStyle;
  minPlayers: number;
  maxPlayers: number;
  /** Rough length for one full game, in minutes. */
  minutes: string;
  /** Whether the phone gets handed around, and why — shown before setup. */
  passes: boolean;
  /** Read-aloud rules, in order. The host sees these before round one. */
  howTo: string[];
}

export const PARTY_GAMES: PartyGameDef[] = [
  {
    id: 'blank-sea',
    title: 'Blank Sea',
    tagline: 'One sentence, one hole in it, and whoever fills it best wins.',
    glyph: '🕳️',
    hue: 320,
    style: 'judge',
    minPlayers: 3,
    maxPlayers: 8,
    minutes: '15–25',
    passes: true,
    howTo: [
      'One player is the Judge this round — it rotates every round.',
      'The Judge reads the prompt out loud to everybody.',
      'The phone goes round: everyone except the Judge picks their answer in private.',
      'The Judge reads all the answers out, shuffled, with no names attached.',
      'The Judge picks the best one. Whoever wrote it takes the point.',
    ],
  },
  {
    id: 'like-for-like',
    title: 'Like for Like',
    tagline: "The Judge plays a word. You play whatever fits it best.",
    glyph: '🎴',
    hue: 15,
    style: 'judge',
    minPlayers: 3,
    maxPlayers: 8,
    minutes: '15–25',
    passes: true,
    howTo: [
      'The Judge turns over a describing word — SPOOKY, SOGGY, MAJESTIC.',
      'Everyone else picks the one card in their hand that best matches it.',
      'Best is whatever the Judge thinks is best. Arguing is encouraged.',
      'The Judge reads them out and picks a winner. That player takes the point.',
    ],
  },
  {
    id: 'port-codes',
    title: 'Port Codes',
    tagline: 'Two teams, twenty-five words, one word of help at a time.',
    glyph: '🔠',
    hue: 200,
    style: 'team',
    minPlayers: 4,
    maxPlayers: 10,
    minutes: '15–20',
    passes: true,
    howTo: [
      'Split into two teams. Each team picks one Signaller.',
      'Both Signallers — and only they — look at the key showing which words belong to whom.',
      'On your turn, your Signaller says ONE word and a number: "FROZEN, two".',
      'The team taps the words they think are theirs. A wrong tap ends the turn.',
      'Tap the black word and your team loses immediately. Be careful.',
    ],
  },
  {
    id: 'one-word',
    title: 'One Word',
    tagline: 'Everyone helps the guesser. Matching clues cancel each other out.',
    glyph: '💡',
    hue: 55,
    style: 'coop',
    minPlayers: 3,
    maxPlayers: 8,
    minutes: '10–20',
    passes: true,
    howTo: [
      'One player is the Guesser and looks away.',
      'Everyone else sees the secret word and writes ONE word to help.',
      'Any clue that two or more people wrote is thrown out before the Guesser sees it.',
      'The Guesser gets one attempt. You all win or lose together.',
      'Thirteen rounds. Beat your own record next time.',
    ],
  },
  {
    id: 'the-dial',
    title: 'The Dial',
    tagline: 'Hot to cold, and the exact spot only one of you can see.',
    glyph: '🎚️',
    hue: 175,
    style: 'coop',
    minPlayers: 3,
    maxPlayers: 10,
    minutes: '15–25',
    passes: true,
    howTo: [
      'One player is the Psychic. They see a spectrum and a hidden target on it.',
      'They give one clue that sits at that spot — no numbers, no left or right.',
      'Everyone else argues, then turns the dial to where they think it is.',
      'Points for how close you got. Four for a bullseye, down to nothing.',
      'The Psychic rotates every round.',
    ],
  },
  {
    id: 'herd',
    title: 'Herd',
    tagline: 'Not the best answer. The answer everybody else gave.',
    glyph: '🐑',
    hue: 105,
    style: 'race',
    minPlayers: 3,
    maxPlayers: 10,
    minutes: '10–20',
    passes: true,
    howTo: [
      'The host reads the question out to everyone.',
      'Answer with the majority, not with the truth. Being clever loses.',
      'Everybody in the biggest group scores.',
      'Answer completely alone and you take the Odd One Out card.',
    ],
  },
  {
    id: 'stowaway',
    title: 'The Stowaway',
    tagline: 'Everyone knows the word. Except one of you.',
    glyph: '🕵️',
    hue: 280,
    style: 'deduction',
    minPlayers: 4,
    maxPlayers: 10,
    minutes: '10–15',
    passes: true,
    howTo: [
      'The phone goes round. Everyone sees the grid; all but one also see the secret word.',
      'Going clockwise, each person says ONE word about the secret word.',
      'Be specific enough to prove you know it — vague enough not to hand it over.',
      'Then everybody votes for the Stowaway.',
      'Caught, the Stowaway can still steal it by naming the word.',
    ],
  },
  {
    id: 'tall-tales',
    title: 'Tall Tales',
    tagline: 'Invent a definition. Convince the table it came out of a dictionary.',
    glyph: '📖',
    hue: 35,
    style: 'judge',
    minPlayers: 3,
    maxPlayers: 8,
    minutes: '20–30',
    passes: true,
    howTo: [
      'The host reads out a word almost nobody knows.',
      'The phone goes round: everyone writes a definition that sounds real.',
      'The real one is mixed in with yours and the host reads them all out.',
      'Vote for the one you think is genuine.',
      'Two points if you find the real one. One point for every vote your fake steals.',
    ],
  },
  {
    id: 'night-watch',
    title: 'Night Watch',
    tagline: 'Somebody on this boat is lying. Probably more than one.',
    glyph: '🌙',
    hue: 245,
    style: 'deduction',
    minPlayers: 4,
    maxPlayers: 10,
    minutes: '10–15',
    passes: true,
    howTo: [
      'The phone goes round and each player sees their own secret role, then passes on.',
      'Night falls. The host reads each step out loud and the phone visits whoever it needs to.',
      'Then everybody talks. Five minutes, no rules.',
      'Vote. Catch a Stowaway and the crew wins the night.',
    ],
  },
  {
    id: 'hold-it-up',
    title: 'Hold It Up',
    tagline: 'Phone on your forehead. They describe. You guess. Clock runs.',
    glyph: '🙃',
    hue: 130,
    style: 'race',
    minPlayers: 3,
    maxPlayers: 10,
    minutes: '10–20',
    passes: true,
    howTo: [
      'Hold the phone up on your forehead, screen facing everyone else.',
      'They describe what is on it — no saying the word, no rhymes, no spelling.',
      'Got it? Tap the green side. Stuck? Tap the red side to skip.',
      'Sixty seconds. Every card you get is a point.',
      'Then pass the phone to the next player.',
    ],
  },
];

export function partyGameById(id: string | undefined): PartyGameDef | undefined {
  return PARTY_GAMES.find((g) => g.id === id);
}

export const STYLE_LABEL: Record<PartyStyle, string> = {
  judge: 'Judge picks',
  team: 'Teams',
  coop: 'Everyone together',
  deduction: 'Find the liar',
  race: 'Against the clock',
};
