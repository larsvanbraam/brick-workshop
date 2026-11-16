import { seeded } from '@brick-workshop/audio/voice';
import type { Locale } from './locale.ts';
import type { Figure } from './npcs.ts';
import type { Biome } from './world/terrain.ts';

/**
 * What the people of Studlands say when the player talks to them. Each has a name and a manner
 * from their seed, opens with a greeting, then chats about where they live and the time of day,
 * and once they have said their piece repeats a sign-off. Lines are shown in a speech bubble and
 * voiced in Simlish babble or the device's speech.
 */

/** Names for women and for men, so a name always suits the figure. */
const NAMES: Record<Figure, readonly string[]> = {
  woman: [
    'Ada',
    'Noor',
    'Fenna',
    'Lotte',
    'Ilse',
    'Saar',
    'Mira',
    'Elin',
    'Tess',
    'Floor',
    'Juul',
    'Wren',
  ],
  man: ['Pim', 'Bram', 'Otto', 'Rik', 'Sem', 'Teun', 'Gus', 'Hugo', 'Joost', 'Kai', 'Ruben', 'Mo'],
};

/** How someone talks: a cheery one exclaims, a gruff one keeps it short, a dreamy one wonders. */
export type Manner = 'cheery' | 'gruff' | 'dreamy';

/** Everything people say in one language. */
interface Words {
  greetings: Record<Manner, readonly string[]>;
  farewells: Record<Manner, readonly string[]>;
  /** Talk about where they live. */
  local: Partial<Record<Biome, readonly string[]>>;
  /** Talk about the time. */
  day: readonly string[];
  night: readonly string[];
  /** Talk on Brick Island in particular. */
  island: readonly string[];
}

const EN: Words = {
  greetings: {
    cheery: ['Oh, hello there!', 'Hi! Lovely to see a new face!', 'Well hello! Out exploring?'],
    gruff: ['Hm. Hello.', 'Afternoon. Or whatever it is.', "Oh. It's you."],
    dreamy: [
      'Oh! I was miles away.',
      'Hello... did you hear the wind just now?',
      'Hi. Do you ever count studs?',
    ],
  },
  farewells: {
    cheery: ['Have a brilliant day!', 'Come back and chat any time!', 'Mind how you go!'],
    gruff: ["That's all I've got.", 'Off you go, then.', 'Busy, busy.'],
    dreamy: ['I think I will go and look at a cloud.', 'Bye... I think.', 'Mm. Yes. Lovely.'],
  },
  local: {
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
  },
  day: [
    'What a day for a walk.',
    'Have you seen how far the land goes? Further every time I look.',
    'You can build anything here, you know. Just takes a few bricks.',
  ],
  night: [
    "Can't sleep either?",
    'The stars are out. I like to name them after colours.',
    'Careful in the dark. You could step on a one by one.',
  ],
  island: [
    'Have you been up to the lighthouse?',
    'There is a volcano on this island. Nobody talks about it.',
    'You can borrow a car if you find one. Everyone does.',
  ],
};

const NL: Words = {
  greetings: {
    cheery: [
      'Oh, hallo daar!',
      'Hoi! Leuk om een nieuw gezicht te zien!',
      'Dag hoor! Op ontdekkingstocht?',
    ],
    gruff: ['Hm. Hallo.', 'Goedemiddag. Of hoe laat het ook is.', 'Oh. Jij bent het.'],
    dreamy: [
      'Oh! Ik was er even niet bij.',
      'Hallo... hoorde je net de wind?',
      'Hoi. Tel jij ook wel eens noppen?',
    ],
  },
  farewells: {
    cheery: ['Een fantastische dag nog!', 'Kom gerust nog eens kletsen!', 'Tot ziens, hè!'],
    gruff: ['Meer heb ik niet.', 'Ga maar door, dan.', 'Druk, druk, druk.'],
    dreamy: ['Ik ga maar eens naar een wolk kijken.', 'Dag... denk ik.', 'Mm. Ja. Heerlijk.'],
  },
  local: {
    beach: [
      'Ik vond ooit een blauw doorzichtig steentje in het zand. Dat heb ik gehouden.',
      'De zee klinkt alsof iemand een doos stenen schudt.',
      'Pas op voor krabben. Ze knijpen in noppen.',
    ],
    meadow: [
      'De bloemen klikken hier elke lente weer vast.',
      'Niets gaat boven een platte groene bouwplaat.',
      'Ik lig graag in het gras naar de lucht te kijken. Wat is hij blauw vandaag.',
    ],
    forest: [
      'Deze bomen zijn ouder dan de eerste steen.',
      'Ik ben hier ooit verdwaald. Het kostte me drie dagen om de weg terug te vinden.',
      'Luister... hoor je dat? Ik ook niet. Heerlijk stil.',
    ],
    desert: [
      'Warm vandaag. Net als elke dag.',
      'De cactus? Ga de cactus niet knuffelen.',
      'Ik heb altijd een veldfles bij me. Zand komt in elke kier.',
    ],
    snow: [
      'Brr! Mijn handen zitten vast in deze vorm van de kou.',
      'Sneeuw is eigenlijk gewoon witte platen, als je erover nadenkt.',
      'Ik heb een sneeuwpop gebouwd. En daarna een sneeuwhuis voor hem.',
    ],
    marsh: [
      'Zompig, zompig. Zo is het moeras nu eenmaal.',
      'Overal kikkers in deze tijd van het jaar.',
      'Het riet fluistert in de nacht. Of het zijn de kikkers.',
    ],
    road: [
      'Druk op straat vandaag. Nou ja, druk voor ons.',
      'Ze hebben de weg vorige week opnieuw gelegd. Tegel voor tegel.',
      'Pas op voor auto’s! Niemand gebruikt hier een knipperlicht.',
    ],
    pavement: [
      'De bakker om de hoek maakt de beste ronde steentjes.',
      'Ik maak graag een wandeling door de hoofdstraat.',
      'Iemand verplaatst steeds de lantaarnpalen. Niemand weet wie.',
    ],
    yard: [
      'Mijn tuin doet het goed, bedankt voor het vragen.',
      'Pas op voor het bloembed! Dat heeft me uren gekost.',
    ],
    field: [
      'Het gewas komt geel op. Nou ja, het zijn stenen.',
      'De koeien zijn vannacht weer ontsnapt.',
      'Boeren is vooral wachten, en een beetje schoffelen.',
    ],
  },
  day: [
    'Wat een dag voor een wandeling.',
    'Heb je gezien hoe ver het land reikt? Elke keer weer verder.',
    'Je kunt hier alles bouwen, hoor. Je hebt maar een paar steentjes nodig.',
  ],
  night: [
    'Kun jij ook niet slapen?',
    'De sterren staan aan. Ik noem ze graag naar kleuren.',
    'Voorzichtig in het donker. Je kunt op een één-bij-één stappen.',
  ],
  island: [
    'Ben je al bij de vuurtoren geweest?',
    'Op dit eiland zit een vulkaan. Daar praat niemand over.',
    'Je mag een auto lenen als je er een vindt. Dat doet iedereen.',
  ],
};

const WORDS: Record<Locale, Words> = { en: EN, nl: NL };

/** Someone to talk to, as far as talk goes. */
export interface Talker {
  seed: number;
  biome: Biome;
  figure: Figure;
}

/**
 * Who someone is: their name, to suit a woman or a man, and manner, the same every time from
 * their seed.
 */
export function personality({ seed, figure }: Pick<Talker, 'seed' | 'figure'>): {
  name: string;
  manner: Manner;
} {
  const next = seeded(seed ^ 0xa11ce);
  const names = NAMES[figure];
  const name = names[Math.floor(next() * names.length)];
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
export function conversation(
  talker: Talker,
  context: TalkContext,
  locale: Locale = 'en',
): string[] {
  const words = WORDS[locale];
  const next = seeded(talker.seed ^ 0xc4a7);
  const { manner } = personality(talker);
  const pick = (list: readonly string[]) => list[Math.floor(next() * list.length)];
  const topics = [
    ...(words.local[talker.biome] ?? words.day),
    ...(context.daytime ? words.day : words.night),
    ...(context.island ? words.island : []),
  ];
  // Three different lines, local talk most likely first.
  const chat: string[] = [];
  const local = words.local[talker.biome];
  if (local) chat.push(pick(local));
  while (chat.length < 3) {
    const line = pick(topics);
    if (!chat.includes(line)) chat.push(line);
  }
  return [pick(words.greetings[manner]), ...chat, pick(words.farewells[manner])];
}

/**
 * The line for the `count`th time the player talks to someone (from 0): through their
 * conversation, then the farewell again.
 */
export function lineFor(
  talker: Talker,
  context: TalkContext,
  count: number,
  locale: Locale = 'en',
) {
  const lines = conversation(talker, context, locale);
  return lines[Math.min(count, lines.length - 1)];
}
