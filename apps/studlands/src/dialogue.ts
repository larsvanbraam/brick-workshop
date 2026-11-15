import { seeded } from '@brick-workshop/audio/voice';
import type { Biome } from './world/terrain.ts';

/**
 * What the people of Studlands say when the player talks to them. Each has a name and a manner
 * from their seed, opens with a greeting, then chats about where they live and the time of day,
 * and once they have said their piece repeats a sign-off. Lines are shown in a speech bubble and
 * voiced in Simlish babble or the device's speech.
 */

const NAMES = [
  'Pim',
  'Ada',
  'Bram',
  'Noor',
  'Otto',
  'Fenna',
  'Rik',
  'Lotte',
  'Sem',
  'Juul',
  'Mo',
  'Ilse',
  'Teun',
  'Saar',
  'Gus',
  'Wren',
  'Hugo',
  'Mira',
  'Joost',
  'Elin',
  'Kai',
  'Tess',
  'Floor',
  'Ruben',
];

/** How someone talks: a cheery one exclaims, a gruff one keeps it short, a dreamy one wonders. */
export type Manner = 'cheery' | 'gruff' | 'dreamy';

const GREETINGS: Record<Manner, readonly string[]> = {
  cheery: ['Oh, hello there!', 'Hi! Lovely to see a new face!', 'Well hello! Out exploring?'],
  gruff: ['Hm. Hello.', 'Afternoon. Or whatever it is.', "Oh. It's you."],
  dreamy: [
    'Oh! I was miles away.',
    'Hello... did you hear the wind just now?',
    'Hi. Do you ever count studs?',
  ],
};

const FAREWELLS: Record<Manner, readonly string[]> = {
  cheery: ['Have a brilliant day!', 'Come back and chat any time!', 'Mind how you go!'],
  gruff: ["That's all I've got.", 'Off you go, then.', 'Busy, busy.'],
  dreamy: ['I think I will go and look at a cloud.', 'Bye... I think.', 'Mm. Yes. Lovely.'],
};

/** Talk about where they live. */
const LOCAL: Partial<Record<Biome, readonly string[]>> = {
  beach: [
    'I found a transparent blue piece in the sand once. Kept it.',
    'The sea sounds like someone shuffling a box of bricks.',
    'Watch out for crabs. They pinch studs.',
  ],
  meadow: [
    'The flowers here clip on every spring.',
    'Nothing beats a flat green baseplate.',
    'I like to lie in the grass and look at the sky. Very blue today.',
  ],
  forest: [
    'These trees are older than the first brick.',
    'I got lost in here once. Took me three days to find the way out.',
    'Listen... hear that? Me neither. Lovely and quiet.',
  ],
  desert: [
    'Hot one today. Hot one every day.',
    'The cactus? Do not hug the cactus.',
    'I keep a canteen on me. Sand gets in every gap.',
  ],
  snow: [
    'Brr! My hands are stuck in this shape from the cold.',
    'Snow is just white plates, if you think about it.',
    'I built a snowman. Then I built a snow house for him.',
  ],
  marsh: [
    'Squelch, squelch. That is the marsh for you.',
    'Frogs everywhere this time of year.',
    'The reeds whisper at night. Or it is the frogs.',
  ],
  road: [
    'Busy street today. Well, busy for us.',
    'They repaved this road last week. Tile by tile.',
    'Watch out for cars! Nobody uses indicators round here.',
  ],
  pavement: [
    'The baker round the corner does the best round bricks.',
    'I like a good stroll down the high street.',
    'Someone keeps moving the lampposts. Nobody knows who.',
  ],
  yard: [
    'My garden is coming along nicely, thank you for asking.',
    'Mind the flower bed! Took me ages.',
  ],
  field: [
    'The crops are coming up yellow. Well, they are bricks.',
    'The cows got out again last night.',
    'Farming is mostly waiting, and a bit of hoeing.',
  ],
};

/** Talk about the time. */
const DAY = [
  'What a day for a walk.',
  'Have you seen how far the land goes? Further every time I look.',
  'You can build anything here, you know. Just takes a few bricks.',
];
const NIGHT = [
  "Can't sleep either?",
  'The stars are out. I like to name them after colours.',
  'Careful in the dark. You could step on a one by one.',
];
/** Talk on Brick Island in particular. */
const ISLAND = [
  'Have you been up to the lighthouse?',
  'There is a volcano on this island. Nobody talks about it.',
  'You can borrow a car if you find one. Everyone does.',
];

/** Someone to talk to, as far as talk goes. */
export interface Talker {
  seed: number;
  biome: Biome;
}

/** Who someone is: their name and manner, the same every time from their seed. */
export function personality(seed: number): { name: string; manner: Manner } {
  const next = seeded(seed ^ 0xa11ce);
  const name = NAMES[Math.floor(next() * NAMES.length)];
  const roll = next();
  const manner: Manner = roll < 0.5 ? 'cheery' : roll < 0.75 ? 'gruff' : 'dreamy';
  return { name, manner };
}

/** Where the talk is: whether it is day, and whether on Brick Island. */
export interface TalkContext {
  daytime: boolean;
  island: boolean;
}

/**
 * Everything someone has to say, in order: a greeting, three lines of chat, a farewell. The
 * chat mixes where they live with the time of day and, on Brick Island, the island.
 */
export function conversation(talker: Talker, context: TalkContext): string[] {
  const next = seeded(talker.seed ^ 0xc4a7);
  const { manner } = personality(talker.seed);
  const pick = (list: readonly string[]) => list[Math.floor(next() * list.length)];
  const topics = [
    ...(LOCAL[talker.biome] ?? DAY),
    ...(context.daytime ? DAY : NIGHT),
    ...(context.island ? ISLAND : []),
  ];
  // Three different lines, local talk most likely first.
  const chat: string[] = [];
  const local = LOCAL[talker.biome];
  if (local) chat.push(pick(local));
  while (chat.length < 3) {
    const line = pick(topics);
    if (!chat.includes(line)) chat.push(line);
  }
  return [pick(GREETINGS[manner]), ...chat, pick(FAREWELLS[manner])];
}

/**
 * The line for the `count`th time the player talks to someone (from 0): through their
 * conversation, then the farewell again.
 */
export function lineFor(talker: Talker, context: TalkContext, count: number) {
  const lines = conversation(talker, context);
  return lines[Math.min(count, lines.length - 1)];
}
