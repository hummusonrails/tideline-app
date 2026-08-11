/**
 * The card stock.
 *
 * Every prompt, answer, spectrum, question and definition below is written
 * for this app. None of it is transcribed from a published deck — the games
 * borrow well-known *mechanics*, which is all anybody borrows, and bring
 * their own words.
 *
 * House style, applied throughout: funny to a nine-year-old and to an adult
 * at the same time, never at anybody's expense, and clean enough that a
 * grandparent can read a card out at a table without checking it first.
 *
 * `{place}`, `{crew}` and `{plan}` in a prompt are filled at deal time from
 * whatever the trip has synced (see `fillTokens`). With nothing synced they
 * resolve to harmless generic stand-ins, so every deck plays on day one.
 */

import type { ArcadeContent } from '../arcade/content';
import { shortLabel } from '../arcade/content';

// ---------- Blank Sea (fill in the blank, judge picks) ----------

export const BLANK_PROMPTS: readonly string[] = [
  'The one thing I refuse to leave the house without is ______.',
  'You can tell the holiday has properly started when ______.',
  'The worst possible thing to find in your suitcase is ______.',
  'My hidden talent is ______.',
  'The hotel review said "charming". It meant ______.',
  '{crew} has been suspiciously quiet. {crew} is definitely ______.',
  'The souvenir shop had exactly one thing worth buying: ______.',
  'Nothing ruins a beautiful view quite like ______.',
  'The captain came on the tannoy to announce ______.',
  'I would walk five miles for ______.',
  'The secret ingredient is ______.',
  'Under no circumstances should you feed a seagull ______.',
  'My autobiography will be called "______".',
  'The most dangerous thing at {place} is ______.',
  'Every family holiday needs one person in charge of ______.',
  'You know it is going to be a long day when breakfast is ______.',
  'The tour guide got weirdly emotional about ______.',
  'What is in the bag that we are not talking about? ______.',
  'The one rule on this trip: absolutely no ______.',
  'I have been practising for this moment my entire life, and the moment is ______.',
  'The wifi password turned out to be ______.',
  'They should really put up a warning sign about ______.',
  'The photo that will end up framed at home is definitely of ______.',
  'This holiday would be improved enormously by ______.',
  'Do not open that door. Behind it is ______.',
  'What woke everybody up at four in the morning? ______.',
  'The gift shop was selling a mug that said "______".',
  'I have made a terrible mistake and the mistake was ______.',
  'The plan for {plan} is going to be ruined by ______.',
  'Genuinely the best thing about travelling is ______.',
  'You have one wish. Obviously you use it on ______.',
  'The strangest thing anybody has ever said to me on a boat is "______".',
  'Before we go home, we absolutely have to see ______.',
  'That noise? Do not worry about that noise. That is just ______.',
  'The postcard home simply read: "______".',
  'I regret to inform the group that I have packed ______.',
  'The queue was two hours long and entirely worth it for ______.',
  'What the local delicacy actually tastes like: ______.',
  'They named the whole town after ______.',
  'And that, children, is how I ended up covered in ______.',
];

export const BLANK_ANSWERS: readonly string[] = [
  'a single, extremely determined seagull',
  'nine kilos of snacks',
  'a hat nobody asked about',
  'crying at a lighthouse',
  'the last biscuit',
  'aggressive optimism',
  'somebody else’s sandwich',
  'a map held upside down',
  'the word "brisk"',
  'six identical grey socks',
  'a very smug otter',
  'pretending to know what a fjord is',
  'the smell of a bus at 7am',
  'a whale that never showed up',
  'unnecessary sunglasses indoors',
  'a plastic bag of wet swimming things',
  'three separate umbrellas',
  'shouting at a ferry timetable',
  'the concept of a light lunch',
  'a puffin with no respect for anyone',
  'twenty-two photographs of the same rock',
  'someone’s legendary snoring',
  'a suspiciously large ice cream',
  'the phrase "it is only a short walk"',
  'a completely flat phone',
  'an inflatable flamingo',
  'a family argument about parking',
  'the good torch',
  'salt. Just salt.',
  'a dog wearing a raincoat',
  'aggressive folk music',
  'a bin that seagulls have discovered',
  'the loudest crisp packet on earth',
  'unearned confidence',
  'a jumper knitted by somebody kind',
  'an accordion, somewhere, always',
  'a puddle deeper than it looked',
  'a bird stealing a chip in slow motion',
  'the sound of a suitcase wheel giving up',
  'a museum entirely about rope',
  'sunburn in one specific stripe',
  'the world’s smallest harbour cat',
  'a tea that is 90 per cent milk',
  'directions from a man who has never been there',
  'a coat that was definitely waterproof once',
  'somebody’s enormous camera lens',
  'a queue for a queue',
  'an unreasonable number of pebbles',
  'a boat named something rude',
  'a nap that lasted four hours',
  'the family group chat going completely feral',
  'a wasp with a personal vendetta',
  'a fridge magnet shaped like a fish',
  'the second breakfast',
  'a very serious child',
  'complimentary slippers',
  'the wrong kind of adaptor',
  'a bagpipe at close range',
  'one shoe, filling with seawater',
  'a horse that made eye contact',
];

// ---------- Like for Like (adjective on the table, best noun wins) ----------

export const LIKE_ADJECTIVES: readonly string[] = [
  'Soggy', 'Majestic', 'Suspicious', 'Overrated', 'Cosy', 'Chaotic', 'Ancient',
  'Slippery', 'Loud', 'Elegant', 'Expensive', 'Terrifying', 'Underrated',
  'Wholesome', 'Ridiculous', 'Cursed', 'Refreshing', 'Sticky', 'Dignified',
  'Unstoppable', 'Fragile', 'Smug', 'Cold', 'Chewy', 'Legendary', 'Awkward',
  'Peaceful', 'Sharp', 'Illegal-feeling', 'Overachieving',
];

export const LIKE_NOUNS: readonly string[] = [
  'A wet dog', 'The moon', 'Grandma', 'A trampoline', 'Motorway services',
  'Penguins', 'A hot bath', 'The bin men at 6am', 'A sandcastle', 'Custard',
  'A vending machine', 'Fog', 'A brass band', 'The dentist', 'Trainers',
  'A hotel corridor', 'Karaoke', 'A tortoise', 'Bubble wrap', 'The last train',
  'Fireworks', 'A revolving door', 'Cold pizza', 'A cathedral', 'Sheep',
  'An escalator', 'Homework', 'A pineapple', 'The sea at night', 'Bagpipes',
  'A pigeon', 'Melted ice cream', 'A cable car', 'Wellington boots',
  'Airport security', 'A haircut', 'Thunder', 'A library', 'Roller skates',
  'A greenhouse', 'A submarine', 'Toast', 'A garden gnome', 'The dark',
  'A trumpet', 'Seaweed', 'A wheelbarrow', 'Snow at Christmas', 'A goat',
  'Public transport', 'A magic trick', 'Hiccups', 'A waterfall', 'Slippers',
  'A traffic jam', 'The first day of school', 'A church bell', 'Marmalade',
  'A hammock', 'Lightning', 'A jigsaw with a missing piece', 'A ferry',
];

// ---------- Port Codes (grid word game) ----------

/** Generic grid words: concrete, picture-able, one clue away from lots of things. */
export const CODE_WORDS: readonly string[] = [
  'ANCHOR', 'BRIDGE', 'CROWN', 'DIVER', 'ENGINE', 'FEATHER', 'GLACIER', 'HARBOUR',
  'ICE', 'JACKET', 'KETTLE', 'LANTERN', 'MAP', 'NET', 'OCEAN', 'PIRATE',
  'QUAY', 'ROPE', 'SALT', 'TIDE', 'UMBRELLA', 'VOLCANO', 'WHALE', 'YARD',
  'BEACON', 'CABIN', 'DECK', 'EAGLE', 'FROST', 'GULL', 'HORIZON', 'ISLAND',
  'JELLY', 'KNOT', 'LIGHT', 'MOON', 'NORTH', 'OTTER', 'PORT', 'RAIN',
  'SAIL', 'STORM', 'TRAIN', 'VALLEY', 'WAVE', 'WOOD', 'BELL', 'CHART',
  'DRIFT', 'FOG', 'GLOVE', 'HOOK', 'IRON', 'LADDER', 'MARKET', 'NEEDLE',
  'PEARL', 'REEF', 'SHELL', 'STONE', 'TOWER', 'WHISTLE', 'BOOT', 'CAMERA',
  'DINNER', 'FIRE', 'GATE', 'HILL', 'KEY', 'LOG', 'MOUNTAIN', 'PATH',
  'RIVER', 'SEAL', 'SPRING', 'TRAIL', 'WINDOW', 'BLANKET', 'COMPASS', 'DOCK',
];

// ---------- One Word (co-operative clue giving) ----------

export const ONE_WORD_SECRETS: readonly string[] = [
  'LIGHTHOUSE', 'PENGUIN', 'SUITCASE', 'THUNDER', 'PANCAKE', 'TELESCOPE',
  'HAMMOCK', 'VOLCANO', 'LIBRARY', 'SNOWBALL', 'HARMONICA', 'JELLYFISH',
  'CAMPFIRE', 'ESCALATOR', 'PASSPORT', 'WINDMILL', 'SEAWEED', 'TREASURE',
  'BLANKET', 'MERMAID', 'PARACHUTE', 'CINNAMON', 'SUBMARINE', 'FIREWORK',
  'GLACIER', 'SANDWICH', 'CATHEDRAL', 'SLIPPERS', 'ICEBERG', 'PUFFIN',
  'CAROUSEL', 'MARMALADE', 'TELEPHONE', 'AVALANCHE', 'PICNIC', 'ANCHOR',
  'CHIMNEY', 'PORRIDGE', 'BINOCULARS', 'RAINBOW', 'HEDGEHOG', 'CANOE',
  'MOUSTACHE', 'FOUNTAIN', 'DUNGEON', 'PYJAMAS', 'ORCHESTRA', 'SEASHELL',
  'TOOTHBRUSH', 'WATERFALL', 'GONDOLA', 'SCARECROW', 'PEPPERMINT', 'HARBOUR',
];

// ---------- The Dial (spectrum guessing) ----------

export interface Spectrum {
  left: string;
  right: string;
}

export const SPECTRA: readonly Spectrum[] = [
  { left: 'Cold', right: 'Hot' },
  { left: 'Rubbish snack', right: 'Perfect snack' },
  { left: 'Quiet', right: 'Deafening' },
  { left: 'A chore', right: 'A treat' },
  { left: 'Underrated', right: 'Overrated' },
  { left: 'Round', right: 'Pointy' },
  { left: 'For kids', right: 'For grown-ups' },
  { left: 'Everyday', right: 'Once in a lifetime' },
  { left: 'Slow', right: 'Fast' },
  { left: 'Cheap', right: 'Expensive' },
  { left: 'Indoors', right: 'Outdoors' },
  { left: 'Boring job', right: 'Dream job' },
  { left: 'Ugly', right: 'Beautiful' },
  { left: 'Easy to pack', right: 'Impossible to pack' },
  { left: 'Forgettable', right: 'Unforgettable' },
  { left: 'A bad smell', right: 'A wonderful smell' },
  { left: 'Rainy day activity', right: 'Sunny day activity' },
  { left: 'Slightly annoying', right: 'Genuinely infuriating' },
  { left: 'Would not survive a week', right: 'Would survive anything' },
  { left: 'Rubbish superpower', right: 'Incredible superpower' },
  { left: 'Small', right: 'Enormous' },
  { left: 'Scary', right: 'Not scary at all' },
  { left: 'Healthy', right: 'Very much not healthy' },
  { left: 'Sensible', right: 'Completely unhinged' },
  { left: 'Would never get you told off', right: 'Would definitely get you told off' },
  { left: 'Bad holiday', right: 'Dream holiday' },
  { left: 'Best thing about a car journey', right: 'Worst thing about a car journey' },
  { left: 'Slightly damp', right: 'Absolutely soaked' },
];

// ---------- Herd (match the majority) ----------

export const HERD_QUESTIONS: readonly string[] = [
  'Name a colour.',
  'Name something you always forget to pack.',
  'Name a breakfast food.',
  'Name an animal you would not want in your tent.',
  'Name something that is always cold.',
  'Name a job that looks fun for one day only.',
  'Name a sound that means "holiday".',
  'Name something people take too many photos of.',
  'Name a snack for a long car journey.',
  'Name something that always goes missing in a hotel room.',
  'Name a bird.',
  'Name something you would never eat on a boat.',
  'Name a thing every family argues about.',
  'Name a smell that takes you straight back somewhere.',
  'Name the best seat in any vehicle.',
  'Name something that is worth queuing for.',
  'Name a board game.',
  'Name an excuse for being late.',
  'Name something everyone pretends to enjoy.',
  'Name a weather forecast word nobody trusts.',
  'Name something you can only buy at an airport.',
  'Name a sea creature.',
  'Name a thing you would rescue from a sinking ship.',
  'Name a song everybody in this car knows the words to.',
  'Name something that improves with butter.',
  'Name a piece of clothing that is never appropriate.',
  'Name the first thing you do in a hotel room.',
  'Name a country you could find on a map with your eyes shut.',
  'Name something that is always more expensive than it should be.',
  'Name the worst possible thing to hear a pilot say.',
];

// ---------- The Stowaway (one player does not know the word) ----------

export interface StowawayTopic {
  title: string;
  /** Exactly sixteen — a four-by-four grid. */
  words: readonly string[];
}

export const STOWAWAY_TOPICS: readonly StowawayTopic[] = [
  {
    title: 'Breakfast',
    words: ['Toast', 'Porridge', 'Pancakes', 'Eggs', 'Cereal', 'Bacon', 'Yoghurt',
            'Croissant', 'Beans', 'Coffee', 'Juice', 'Bagel', 'Waffles', 'Fruit',
            'Smoothie', 'Marmalade'],
  },
  {
    title: 'At the seaside',
    words: ['Pier', 'Sandcastle', 'Ice cream', 'Deckchair', 'Seagull', 'Rockpool',
            'Lighthouse', 'Pebbles', 'Windbreak', 'Donkey', 'Arcade', 'Bucket',
            'Jellyfish', 'Sunburn', 'Ferry', 'Fish and chips'],
  },
  {
    title: 'In a suitcase',
    words: ['Passport', 'Charger', 'Toothbrush', 'Swimming things', 'Book',
            'Sun cream', 'Socks', 'Adaptor', 'Camera', 'Hat', 'Snacks',
            'Umbrella', 'Headphones', 'Plasters', 'Jumper', 'Sunglasses'],
  },
  {
    title: 'Weather',
    words: ['Thunder', 'Drizzle', 'Blizzard', 'Heatwave', 'Fog', 'Hail',
            'Rainbow', 'Gale', 'Frost', 'Sunshine', 'Sleet', 'Breeze',
            'Downpour', 'Lightning', 'Mist', 'Humid'],
  },
  {
    title: 'School',
    words: ['Homework', 'Assembly', 'Playground', 'Register', 'Canteen',
            'Textbook', 'Whiteboard', 'Detention', 'Uniform', 'Bell',
            'Sports day', 'Trip', 'Exam', 'Ruler', 'Locker', 'Head teacher'],
  },
  {
    title: 'Animals',
    words: ['Otter', 'Eagle', 'Whale', 'Hedgehog', 'Fox', 'Penguin', 'Camel',
            'Owl', 'Seal', 'Wolf', 'Puffin', 'Bear', 'Deer', 'Tortoise',
            'Dolphin', 'Squirrel'],
  },
  {
    title: 'Music',
    words: ['Drums', 'Piano', 'Choir', 'Guitar', 'Trumpet', 'Karaoke', 'Violin',
            'Headphones', 'Concert', 'Radio', 'Whistle', 'Bagpipes', 'Harp',
            'Busker', 'Encore', 'Playlist'],
  },
  {
    title: 'In the kitchen',
    words: ['Kettle', 'Fridge', 'Whisk', 'Colander', 'Oven', 'Chopping board',
            'Tin opener', 'Rolling pin', 'Freezer', 'Toaster', 'Ladle',
            'Cupboard', 'Sink', 'Apron', 'Blender', 'Sieve'],
  },
  {
    title: 'Getting there',
    words: ['Ferry', 'Coach', 'Aeroplane', 'Bicycle', 'Taxi', 'Train', 'Tram',
            'Walking', 'Cable car', 'Motorbike', 'Canoe', 'Helicopter',
            'Camper van', 'Sledge', 'Hot air balloon', 'Underground'],
  },
  {
    title: 'Sport',
    words: ['Swimming', 'Football', 'Climbing', 'Skiing', 'Tennis', 'Rowing',
            'Cricket', 'Surfing', 'Hockey', 'Athletics', 'Cycling', 'Judo',
            'Golf', 'Netball', 'Sailing', 'Gymnastics'],
  },
];

// ---------- Tall Tales (bluffed dictionary definitions) ----------

export interface TallWord {
  word: string;
  /** The genuine meaning, written plainly. */
  truth: string;
}

/**
 * Real but obscure English words.
 *
 * Chosen so that the true definition is surprising enough to be mistaken for
 * a bluff — which is the entire game.
 */
export const TALL_WORDS: readonly TallWord[] = [
  { word: 'Petrichor', truth: 'The smell of rain falling on dry ground.' },
  { word: 'Gongoozler', truth: 'Someone who idly watches boats on a canal.' },
  { word: 'Lucubrate', truth: 'To study or write late into the night.' },
  { word: 'Widdershins', truth: 'Going anticlockwise, or the wrong way round.' },
  { word: 'Snickersnee', truth: 'A large knife, or a fight with one.' },
  { word: 'Bumbershoot', truth: 'An umbrella, in slang a century out of date.' },
  { word: 'Collywobbles', truth: 'A rumbling, nervous stomach.' },
  { word: 'Mumpsimus', truth: 'Someone who sticks to a mistake after being corrected.' },
  { word: 'Brontide', truth: 'A low rumbling like distant thunder.' },
  { word: 'Apricity', truth: 'The warmth of the sun in winter.' },
  { word: 'Zephyr', truth: 'A soft breeze, especially one from the west.' },
  { word: 'Quockerwodger', truth: 'A wooden puppet worked by strings.' },
  { word: 'Griggles', truth: 'The small apples left on the tree after picking.' },
  { word: 'Hiraeth', truth: 'A homesickness for a place you cannot return to.' },
  { word: 'Nudiustertian', truth: 'Relating to the day before yesterday.' },
  { word: 'Ultracrepidarian', truth: 'Someone who gives opinions beyond what they know.' },
  { word: 'Peloothered', truth: 'Completely worn out, with nothing left in the tank.' },
  { word: 'Cwtch', truth: 'A cuddle, or a small cosy cupboard.' },
  { word: 'Flews', truth: 'The drooping upper lip of a hound.' },
  { word: 'Wamble', truth: 'To roll about or move unsteadily.' },
  { word: 'Ructation', truth: 'A belch, in the politest possible wording.' },
  { word: 'Groke', truth: 'To stare longingly at someone eating, hoping for a bite.' },
  { word: 'Crapulence', truth: 'Feeling ill from eating or drinking far too much.' },
  { word: 'Fudgel', truth: 'Pretending to work while doing nothing at all.' },
  { word: 'Snollygoster', truth: 'A shrewd person with no principles, often a politician.' },
  { word: 'Sialoquent', truth: 'Spitting slightly while speaking.' },
  { word: 'Erf', truth: 'A plot of land, usually around a house.' },
  { word: 'Bibble', truth: 'To drink or eat noisily.' },
  { word: 'Lethologica', truth: 'The inability to remember a word you know perfectly well.' },
  { word: 'Winkle', truth: 'A small edible sea snail, or to prise something out slowly.' },
];

// ---------- Night Watch (hidden roles) ----------

export interface NightRole {
  id: string;
  name: string;
  team: 'crew' | 'stowaway';
  glyph: string;
  /** What the player is told when they see their own card. */
  brief: string;
  /**
   * Read out by the host during the night, in this order. Omitted for roles
   * with nothing to do at night.
   */
  nightStep?: string;
  nightOrder?: number;
}

export const NIGHT_ROLES: readonly NightRole[] = [
  {
    id: 'stowaway',
    name: 'Stowaway',
    team: 'stowaway',
    glyph: '🥷',
    brief: 'You snuck aboard. Survive the vote and your side wins the night.',
    nightStep: 'Stowaways, open your eyes and look at each other. Now close them.',
    nightOrder: 1,
  },
  {
    id: 'lookout',
    name: 'Lookout',
    team: 'crew',
    glyph: '🔭',
    brief: 'You may look at one other person’s card during the night.',
    nightStep: 'Lookout, the phone is coming to you. Choose one person to inspect.',
    nightOrder: 2,
  },
  {
    id: 'bosun',
    name: 'Bosun',
    team: 'crew',
    glyph: '🪢',
    brief: 'You may swap two other people’s cards. Even they will not know.',
    nightStep: 'Bosun, the phone is coming to you. You may swap two cards.',
    nightOrder: 3,
  },
  {
    id: 'cook',
    name: 'Cook',
    team: 'crew',
    glyph: '🍳',
    brief: 'You were in the galley all night and saw nothing. Talk anyway.',
  },
  {
    id: 'navigator',
    name: 'Navigator',
    team: 'crew',
    glyph: '🧭',
    brief: 'You learn how many Stowaways are aboard, but not who.',
    nightStep: 'Navigator, the phone is coming to you with a number.',
    nightOrder: 4,
  },
  {
    id: 'passenger',
    name: 'Passenger',
    team: 'crew',
    glyph: '🧳',
    brief: 'You are exactly what you appear to be. Enjoy the voyage.',
  },
];

// ---------- Hold It Up (describe it before the timer) ----------

export interface HoldCategory {
  id: string;
  title: string;
  glyph: string;
  cards: readonly string[];
}

export const HOLD_CATEGORIES: readonly HoldCategory[] = [
  {
    id: 'animals',
    title: 'Animals',
    glyph: '🦦',
    cards: ['Otter', 'Puffin', 'Blue whale', 'Hedgehog', 'Camel', 'Penguin', 'Sloth',
            'Golden eagle', 'Jellyfish', 'Tortoise', 'Arctic fox', 'Octopus',
            'Reindeer', 'Bumblebee', 'Kangaroo', 'Seal', 'Owl', 'Crab', 'Wolf',
            'Flamingo', 'Hamster', 'Dolphin', 'Peacock', 'Squirrel'],
  },
  {
    id: 'travel',
    title: 'Travel things',
    glyph: '🧳',
    cards: ['Passport', 'Boarding pass', 'Roof box', 'Motorway services', 'Ferry',
            'Sun cream', 'Travel pillow', 'Cable car', 'Hire car', 'Duty free',
            'Sleeper train', 'Lost luggage', 'Guidebook', 'Hostel', 'Seat 14B',
            'Airport queue', 'Postcard', 'Currency exchange', 'Departure board',
            'Suitcase wheel'],
  },
  {
    id: 'food',
    title: 'Food',
    glyph: '🍽️',
    cards: ['Pancakes', 'Fish and chips', 'Ice cream', 'Marmalade', 'Porridge',
            'Roast dinner', 'Croissant', 'Hot chocolate', 'Pickle', 'Waffle',
            'Cheese toastie', 'Pomegranate', 'Doughnut', 'Soup', 'Popcorn',
            'Watermelon', 'Spaghetti', 'Toast crust', 'Chewing gum', 'Birthday cake'],
  },
  {
    id: 'actions',
    title: 'Things people do',
    glyph: '🤸',
    cards: ['Snoring', 'Reversing a car', 'Whistling', 'Queueing', 'Skimming stones',
            'Falling asleep in the car', 'Losing at cards', 'Taking a selfie',
            'Getting sunburnt', 'Packing at midnight', 'Sneezing', 'Arguing about music',
            'Reading a map', 'Building a sandcastle', 'Missing a train',
            'Overtaking a caravan', 'Trying to fold a map', 'Applauding a landing'],
  },
  {
    id: 'places',
    title: 'Places',
    glyph: '🗺️',
    cards: ['Lighthouse', 'Volcano', 'Library', 'Rainforest', 'Ice rink', 'Harbour',
            'Museum', 'Desert', 'Cathedral', 'Aquarium', 'Motorway', 'Mountain top',
            'Cave', 'Ski slope', 'Farmyard', 'Rooftop', 'Waterfall', 'Underground station',
            'Campsite', 'Market'],
  },
  {
    id: 'household',
    title: 'Around the house',
    glyph: '🏠',
    cards: ['Kettle', 'Doorbell', 'Radiator', 'Washing line', 'Hoover', 'Fridge magnet',
            'Bathroom mirror', 'Wonky drawer', 'Bin day', 'The good scissors',
            'Remote control', 'Sofa cushion', 'Loft hatch', 'Front door key',
            'Smoke alarm battery', 'Junk drawer', 'Ironing board', 'Bookshelf'],
  },
];

// ---------- token filling ----------

/**
 * Swap `{place}`, `{crew}` and `{plan}` for something the family recognises.
 *
 * Cards are written so they read perfectly well with the generic stand-ins —
 * a prompt that only lands once the itinerary has synced would be a prompt
 * that's broken on the first evening of the trip.
 */
export function fillTokens(
  text: string,
  content: ArcadeContent,
  rng: () => number,
): string {
  const pickFrom = (list: readonly string[], fallback: string) =>
    list.length ? list[Math.floor(rng() * list.length) % list.length] : fallback;

  return text.replace(/\{(place|crew|plan)\}/g, (_, token: string) => {
    if (token === 'place') return pickFrom(content.labels, 'the harbour');
    if (token === 'crew') return pickFrom(content.crew.map((c) => c.name), 'Somebody');
    return pickFrom(
      content.highlights.map((h) => shortLabel(h.title, 28)),
      'the next thing on the list',
    );
  });
}

/** The grid word pool, with trip place names mixed in when they exist. */
export function codeWordPool(content: ArcadeContent): string[] {
  const fromTrip = content.labels
    .map((l) => l.toUpperCase())
    .filter((l) => /^[A-Z ]{3,12}$/.test(l));
  const seen = new Set<string>();
  return [...fromTrip, ...CODE_WORDS].filter((w) => {
    if (seen.has(w)) return false;
    seen.add(w);
    return true;
  });
}

/** Hold It Up gets an extra category built from the trip itself. */
export function holdCategories(content: ArcadeContent): HoldCategory[] {
  const tripCards = [
    ...content.highlights.map((h) => shortLabel(h.title, 34)),
    ...content.labels,
  ].filter((c, i, all) => c.length > 2 && all.indexOf(c) === i);

  if (tripCards.length < 10) return [...HOLD_CATEGORIES];
  return [
    { id: 'this-trip', title: 'This trip', glyph: '🧭', cards: tripCards },
    ...HOLD_CATEGORIES,
  ];
}
