import type { MinifigOutfit } from '@brick-workshop/walk/minifig';
import type { VoiceRegister } from '@brick-workshop/audio/voice';
import type { Locale } from './locale.ts';

/**
 * Brick Island's little jobs: one helper in each part of the island asks for a hand with
 * something easy, for a young child to do on their own. Every job is one of three kinds:
 *
 * - **Find**: things lie about near the helper (eggs, shells, bricks); walk into each to pick it
 *   up, then (for most) bring them back to the helper.
 * - **Take**: carry something to someone (flowers to the harbour) or somewhere (a flag up the
 *   mountain); just walking up to them hands it over.
 * - **Build**: a find job whose bricks then go on a little model next to the helper, one press
 *   of the talk key per brick.
 *
 * Lines are short and plain, and the screen always says what to do next in a few words with a
 * picture. Positions are world studs on Brick Island.
 */

/**
 * A piece of a look: a part in a colour, placed the way the engine places bricks (studs across,
 * plates up, a turn in degrees), round the look's middle.
 */
export interface LookPiece {
  part: string;
  color: number;
  x?: number;
  y?: number;
  z?: number;
  rotation?: 0 | 90 | 180 | 270;
}
export type Look = readonly LookPiece[];

/** Someone in a job: who they are, where they stand and what they wear. */
export interface Helper {
  name: string;
  x: number;
  z: number;
  outfit: MinifigOutfit;
  /** A high or a low voice. */
  voice: VoiceRegister;
}

export interface Spot {
  x: number;
  z: number;
}

export type Goal =
  | {
      kind: 'find';
      /** What is found, in the plural, for the screen: "eggs". */
      things: string;
      look: Look;
      spots: readonly Spot[];
      /** Whether they go back to the helper; else the job is done with the last one. */
      back: boolean;
      /** How close to come to pick one up, in studs, where it is more than a step (in a car). */
      reach?: number;
      /** For a build job: the model the found bricks make by the helper, a piece each. */
      build?: { x: number; z: number; pieces: Look };
    }
  | {
      kind: 'take';
      /** What is carried, for the screen: "the flowers". */
      thing: string;
      /** Who to take it to, or where. */
      to: Helper | (Spot & { name: string });
      /** What is left there once it arrives (a flag on the top). */
      leave?: Look;
    };

export interface Quest {
  id: string;
  /** The landmark it belongs to. */
  area: string;
  /** A picture for the job, on the screen and the map. */
  icon: string;
  giver: Helper;
  /** What the helper says to ask, a line a press; the job starts with the last line. */
  ask: readonly string[];
  /** What to do, in a few words, while doing it. */
  task: string;
  goal: Goal;
  /** What the helper says when it is done. */
  thanks: string;
}

const outfit = (
  torso: number,
  legs: number,
  headgear: { part: string; color: number },
  head = '3626cp01',
): MinifigOutfit => ({ head, skin: 14, torso, arms: torso, hips: legs, legs, headgear });

/** A duck: a yellow body, a round head and an orange beak. */
const DUCK: Look = [
  { part: '3004', color: 14, x: -1 },
  { part: '3062b', color: 14, x: 0, y: 3 },
  { part: '3024', color: 25, x: 1, y: 4 },
];

/** A flag on a pole. */
const FLAG: Look = [
  { part: '3957a', color: 0 },
  { part: '2335', color: 4, y: 6, rotation: 90 },
];

export const QUESTS: readonly Quest[] = [
  {
    id: 'eggs',
    area: 'Farm',
    icon: '🥚',
    giver: {
      name: 'Farmer Fien',
      voice: 'high',
      x: 148.5,
      z: 319.5,
      outfit: outfit(2, 1, { part: '3629', color: 19 }),
    },
    ask: [
      'Hello! I am Farmer Fien.',
      'Oh no! My hens lost their eggs.',
      'Can you find 5 eggs for me?',
    ],
    task: 'Find the eggs',
    goal: {
      kind: 'find',
      things: 'eggs',
      look: [{ part: '3062b', color: 15 }],
      spots: [
        { x: 130.5, z: 300.5 },
        { x: 175.5, z: 308.5 },
        { x: 158.5, z: 331.5 },
        { x: 145.5, z: 345.5 },
        { x: 112.5, z: 326.5 },
      ],
      back: true,
    },
    thanks: 'Thank you! The hens are so happy!',
  },
  {
    id: 'flowers',
    area: 'Flower Stall',
    icon: '💐',
    giver: {
      name: 'Rosa',
      voice: 'high',
      x: 336.5,
      z: 431.5,
      outfit: outfit(13, 15, { part: '62696', color: 25 }, '3626bp03'),
    },
    ask: [
      'Hi! I sell flowers.',
      'Grandpa Ben at the harbour wants some.',
      'Can you take them to him?',
    ],
    task: 'Take the flowers to Ben',
    goal: {
      kind: 'take',
      thing: 'the flowers',
      to: {
        name: 'Grandpa Ben',
        voice: 'low',
        x: 297.5,
        z: 469.5,
        outfit: outfit(1, 272, { part: '86035', color: 15 }),
      },
    },
    thanks: 'Flowers! For me? Thank you!',
  },
  {
    id: 'tower',
    area: 'Harbour Town',
    icon: '🧱',
    giver: {
      name: 'Builder Max',
      voice: 'low',
      x: 291.5,
      z: 365.5,
      outfit: outfit(25, 1, { part: '3833', color: 14 }),
    },
    ask: ["Hi! I'm Builder Max.", "Let's build a tower together!", 'First, find 4 bricks for me.'],
    task: 'Find the bricks',
    goal: {
      kind: 'find',
      things: 'bricks',
      look: [{ part: '3003', color: 4, x: -1, z: -1 }],
      spots: [
        { x: 278.5, z: 360.5 },
        { x: 330.5, z: 360.5 },
        { x: 285.5, z: 386.5 },
        { x: 305.5, z: 349.5 },
      ],
      back: true,
      build: {
        x: 285,
        z: 364,
        pieces: [
          { part: '3003', color: 4, x: -1, y: 0, z: -1 },
          { part: '3003', color: 14, x: -1, y: 3, z: -1 },
          { part: '3003', color: 1, x: -1, y: 6, z: -1 },
          { part: '3003', color: 2, x: -1, y: 9, z: -1 },
        ],
      },
    },
    thanks: 'What a great tower! You are a builder!',
  },
  {
    id: 'race',
    area: 'Speedway',
    icon: '🏁',
    giver: {
      name: 'Racer Zoe',
      voice: 'high',
      x: 524.5,
      z: 208.5,
      outfit: outfit(4, 0, { part: '86035', color: 4 }, '3626bp04'),
    },
    ask: ['Vroom! I am Racer Zoe.', 'Jump in the race car!', 'Drive through all 4 flags!'],
    task: 'Drive through the flags',
    goal: {
      kind: 'find',
      things: 'flags',
      look: FLAG,
      spots: [
        { x: 508, z: 196 },
        { x: 586, z: 232 },
        { x: 508, z: 268 },
        { x: 430, z: 232 },
      ],
      back: false,
      reach: 8,
    },
    thanks: 'You did it! Super fast!',
  },
  {
    id: 'shells',
    area: 'Sunset Bay',
    icon: '🐚',
    giver: {
      name: 'Pim',
      voice: 'high',
      x: 192.5,
      z: 418.5,
      outfit: outfit(73, 15, { part: '86035', color: 25 }, '3626bp05'),
    },
    ask: ['Hi! I love the beach.', 'Can you find 4 shells in the sand?'],
    task: 'Find the shells',
    goal: {
      kind: 'find',
      things: 'shells',
      look: [{ part: '15068', color: 13, x: -1, z: -1 }],
      spots: [
        { x: 170.5, z: 408.5 },
        { x: 186.5, z: 432.5 },
        { x: 200.5, z: 425.5 },
        { x: 196.5, z: 448.5 },
      ],
      back: true,
    },
    thanks: 'So pretty! Thank you!',
  },
  {
    id: 'ducks',
    area: 'Mirror Lake',
    icon: '🦆',
    giver: {
      name: 'Ada',
      voice: 'high',
      x: 226.5,
      z: 200.5,
      outfit: outfit(5, 15, { part: '3901', color: 70 }, '3626bp02'),
    },
    ask: ['Quack quack! Hello!', 'My 3 little ducks ran off.', 'Can you find them for me?'],
    task: 'Find the ducks',
    goal: {
      kind: 'find',
      things: 'ducks',
      look: DUCK,
      spots: [
        { x: 200.5, z: 229.5 },
        { x: 222.5, z: 180.5 },
        { x: 160.5, z: 225.5 },
      ],
      back: true,
    },
    thanks: 'My ducks are home! Quack!',
  },
  {
    id: 'lamp',
    area: 'Lighthouse Point',
    icon: '💡',
    giver: {
      name: 'Keeper Lou',
      voice: 'low',
      x: 528.5,
      z: 446.5,
      outfit: outfit(15, 1, { part: '86035', color: 1 }),
    },
    ask: [
      'Hello! I keep the lighthouse.',
      'Oh dear, my lamp broke!',
      'A new lamp is at the harbour.',
      'Can you get it for me?',
    ],
    task: 'Get the lamp',
    goal: {
      kind: 'find',
      things: 'lamp',
      look: [
        { part: '3062b', color: 46 },
        { part: '3062b', color: 46, y: 3 },
      ],
      spots: [{ x: 345.5, z: 470.5 }],
      back: true,
    },
    thanks: 'Hooray! My light can shine again!',
  },
  {
    id: 'summit',
    area: 'Summit Peak',
    icon: '⛰️',
    giver: {
      name: 'Hiker Hugo',
      voice: 'low',
      x: 312.5,
      z: 177.5,
      outfit: outfit(2, 28, { part: '86035', color: 2 }, '3626bp04'),
    },
    ask: [
      'Hi! I love to climb.',
      'Can you put my flag on the mountain top?',
      'Follow the road up!',
    ],
    task: 'Take the flag to the top',
    goal: {
      kind: 'take',
      thing: 'the flag',
      to: { name: 'the top', x: 331, z: 82 },
      leave: FLAG,
    },
    thanks: 'You made it to the top! Hooray!',
  },
];

export const questById = (id: string) => QUESTS.find((quest) => quest.id === id) ?? null;

/** Wanderer IDs for the helpers: a giver's is `quest:<id>`, someone to take a thing to `quest:<id>:to`. */
export const giverId = (quest: Quest) => `quest:${quest.id}`;
export const takerId = (quest: Quest) => `quest:${quest.id}:to`;

/** The job being done, and how far along. */
export interface QuestProgress {
  id: string;
  /**
   * `go`: finding or carrying; `back`: everything found, back to the helper; `build`: back,
   * putting the bricks on.
   */
  step: 'go' | 'back' | 'build';
  /** Which spots have been picked up, by index. */
  found: readonly number[];
  /** Bricks put on the model so far. */
  built: number;
}

export const startQuest = (quest: Quest): QuestProgress => ({
  id: quest.id,
  step: 'go',
  found: [],
  built: 0,
});

/** What happens on the way, from the scene. */
export type QuestEvent =
  | { kind: 'pick'; index: number }
  | { kind: 'arrive' }
  | { kind: 'giver' }
  | { kind: 'place' };

/** The progress after an event, `'done'` once the job is finished, or the same when nothing changes. */
export function advance(
  quest: Quest,
  progress: QuestProgress,
  event: QuestEvent,
): QuestProgress | 'done' {
  const { goal } = quest;
  if (goal.kind === 'take')
    return event.kind === 'arrive' && progress.step === 'go' ? 'done' : progress;
  if (event.kind === 'pick' && progress.step === 'go') {
    if (progress.found.includes(event.index) || !goal.spots[event.index]) return progress;
    const found = [...progress.found, event.index];
    if (found.length < goal.spots.length) return { ...progress, found };
    return goal.back ? { ...progress, found, step: 'back' } : 'done';
  }
  if (event.kind === 'giver' && progress.step === 'back')
    return goal.build ? { ...progress, step: 'build' } : 'done';
  if (event.kind === 'place' && progress.step === 'build' && goal.build) {
    const built = progress.built + 1;
    return built >= goal.build.pieces.length ? 'done' : { ...progress, built };
  }
  return progress;
}

/** What a job's people say, in a language other than the English written on the quest. */
interface QuestWords {
  giver: string;
  ask: readonly string[];
  task: string;
  thanks: string;
  /** For a job of taking something: what is carried and who or where it goes to. */
  thing?: string;
  to?: string;
  /** For a job of finding: what is left to find, as in "Find 3 more eggs!". */
  things?: string;
}

const DUTCH: Record<string, QuestWords> = {
  eggs: {
    giver: 'Boer Fien',
    ask: [
      'Hallo! Ik ben Boer Fien.',
      'Oh nee! Mijn kippen zijn hun eieren kwijt.',
      'Vind jij 5 eieren voor me?',
    ],
    task: 'Vind de eieren',
    thanks: 'Dank je! De kippen zijn zo blij!',
    things: 'eieren',
  },
  flowers: {
    giver: 'Rosa',
    ask: [
      'Hoi! Ik verkoop bloemen.',
      'Opa Ben in de haven wil er een paar.',
      'Breng jij ze naar hem?',
    ],
    task: 'Breng de bloemen naar Ben',
    thanks: 'Bloemen! Voor mij? Dank je!',
    thing: 'de bloemen',
    to: 'Opa Ben',
  },
  tower: {
    giver: 'Bouwer Max',
    ask: [
      'Hoi! Ik ben Bouwer Max.',
      'Laten we samen een toren bouwen!',
      'Zoek eerst 4 stenen voor me.',
    ],
    task: 'Vind de stenen',
    thanks: 'Wat een mooie toren! Jij bent een bouwer!',
    things: 'stenen',
  },
  race: {
    giver: 'Racer Zoë',
    ask: ['Vroem! Ik ben Racer Zoë.', 'Spring in de racewagen!', 'Rij door alle 4 de vlaggen!'],
    task: 'Rij door de vlaggen',
    thanks: 'Gelukt! Supersnel!',
    things: 'vlaggen',
  },
  shells: {
    giver: 'Pim',
    ask: ['Hoi! Ik ben dol op het strand.', 'Vind jij 4 schelpen in het zand?'],
    task: 'Vind de schelpen',
    thanks: 'Zo mooi! Dank je!',
    things: 'schelpen',
  },
  ducks: {
    giver: 'Ada',
    ask: ['Kwak kwak! Hallo!', 'Mijn 3 kleine eendjes zijn weg.', 'Kun jij ze voor me zoeken?'],
    task: 'Vind de eendjes',
    thanks: 'Mijn eendjes zijn thuis! Kwak!',
    things: 'eendjes',
  },
  lamp: {
    giver: 'Wachter Lou',
    ask: [
      'Hallo! Ik pas op de vuurtoren.',
      'Oei, mijn lamp is kapot!',
      'Een nieuwe lamp ligt in de haven.',
      'Kun jij hem voor me halen?',
    ],
    task: 'Haal de lamp',
    thanks: 'Hoera! Mijn licht kan weer schijnen!',
    things: 'lamp',
  },
  summit: {
    giver: 'Wandelaar Hugo',
    ask: ['Hoi! Ik hou van klimmen.', 'Zet jij mijn vlag op de bergtop?', 'Volg de weg omhoog!'],
    task: 'Breng de vlag naar de top',
    thanks: 'Je hebt de top gehaald! Hoera!',
    thing: 'de vlag',
    to: 'de top',
  },
};

/** Small lines the helpers say that are not part of a quest's own words. */
const HELPER_LINES: Record<
  Locale,
  Record<'hello' | 'thanksAgain' | 'build' | 'pressToBuild' | 'oneMore', string>
> = {
  en: {
    hello: 'Hello there!',
    thanksAgain: 'Thank you again!',
    build: 'Yay! Now we build!',
    pressToBuild: 'Press again to put on a brick!',
    oneMore: 'Just 1 more to find!',
  },
  nl: {
    hello: 'Hallo daar!',
    thanksAgain: 'Nog bedankt!',
    build: 'Hoera! Nu gaan we bouwen!',
    pressToBuild: 'Druk nog eens om een steen te plaatsen!',
    oneMore: 'Nog maar 1 te vinden!',
  },
};

/** One of the small lines helpers say, in a language. */
export const helperLine = (key: keyof (typeof HELPER_LINES)['en'], locale: Locale) =>
  HELPER_LINES[locale][key];

/** What a job's people say and show in a language. English is what is written on the quest. */
export function questWords(quest: Quest, locale: Locale): QuestWords {
  const dutch = locale === 'nl' ? DUTCH[quest.id] : undefined;
  if (dutch) return dutch;
  const { goal } = quest;
  return {
    giver: quest.giver.name,
    ask: quest.ask,
    task: quest.task,
    thanks: quest.thanks,
    thing: goal.kind === 'take' ? goal.thing : undefined,
    to: goal.kind === 'take' ? goal.to.name : undefined,
    things: goal.kind === 'find' ? goal.things : undefined,
  };
}

/** What to do now, in a few words, for the screen. */
export function taskLine(quest: Quest, progress: QuestProgress, locale: Locale = 'en'): string {
  const { goal } = quest;
  const words = questWords(quest, locale);
  if (goal.kind === 'take') return words.task;
  if (progress.step === 'back')
    return locale === 'nl' ? `Ga terug naar ${words.giver}` : `Go back to ${words.giver}`;
  if (progress.step === 'build')
    return locale === 'nl' ? 'Druk om een steen te plaatsen' : 'Press to put a brick on';
  return words.task;
}

/** The count to show, as "2 / 5", or null where there is nothing to count. */
export function taskCount(quest: Quest, progress: QuestProgress): string | null {
  const { goal } = quest;
  if (goal.kind === 'take') return null;
  if (progress.step === 'build' && goal.build)
    return `${progress.built} / ${goal.build.pieces.length}`;
  if (progress.step === 'go' && goal.spots.length > 1)
    return `${progress.found.length} / ${goal.spots.length}`;
  return null;
}

/** What a helper says when talked to again while their job is on. */
export function reminder(quest: Quest, progress: QuestProgress, locale: Locale = 'en'): string {
  const { goal } = quest;
  const words = questWords(quest, locale);
  if (goal.kind === 'take')
    return locale === 'nl'
      ? `Breng ${words.thing} alsjeblieft naar ${words.to}!`
      : `Please take ${words.thing} to ${words.to}!`;
  if (progress.step === 'build') return helperLine('pressToBuild', locale);
  const left = goal.spots.length - progress.found.length;
  if (left === 1) return helperLine('oneMore', locale);
  return locale === 'nl'
    ? `Vind nog ${left} ${words.things}!`
    : `Find ${left} more ${words.things}!`;
}

/** Where to go next, in world studs: what is left to find, the helper, or where to take it. */
export function targets(quest: Quest, progress: QuestProgress): Spot[] {
  const { goal } = quest;
  if (goal.kind === 'take') return [goal.to];
  if (progress.step !== 'go') return [quest.giver];
  return goal.spots.filter((_, index) => !progress.found.includes(index));
}

export const isQuestProgress = (value: unknown): value is QuestProgress => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    questById(v.id) !== null &&
    (v.step === 'go' || v.step === 'back' || v.step === 'build') &&
    Array.isArray(v.found) &&
    v.found.every((index) => Number.isInteger(index)) &&
    typeof v.built === 'number'
  );
};
