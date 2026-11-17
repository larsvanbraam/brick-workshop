import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { PLATE_HEIGHT } from '@brick-workshop/engine';
import { voiceFor } from '@brick-workshop/audio/voice';
import type { WandererSpec } from '@brick-workshop/npc/wanderers';
import { CLASSIC_OUTFIT } from '@brick-workshop/walk/minifig';
import type { MinifigOutfit } from '@brick-workshop/walk/minifig';
import { MINIFIG } from '@brick-workshop/walk/walk';
import type { WalkProbe } from '@brick-workshop/walk/walk-view';
import { chime } from '@brick-workshop/game/chime.ts';
import { CHUNK, chunkKey } from '@brick-workshop/game/chunks.ts';
import type { Addon, AddonHost, PeopleContext } from '@brick-workshop/game/extension.ts';
import { Key } from '@brick-workshop/game/input-hint.tsx';
import type { Locale } from '@brick-workshop/game/locale.ts';
import type { MapPin } from '@brick-workshop/game/Minimap.tsx';
import { wanderRules } from '@brick-workshop/game/npcs.ts';
import { SpeechBubble } from '@brick-workshop/game/SpeechBubble.tsx';
import { hash2 } from '@brick-workshop/game/world/noise.ts';
import { Fireworks } from './Fireworks.tsx';
import { QuestMarks } from './QuestScene.tsx';
import type { QuestView } from './QuestScene.tsx';
import { Sharks } from './Sharks.tsx';
import { TIDE_LINES, Tide } from './tide.ts';
import {
  QUESTS,
  advance,
  buildSize,
  giftOf,
  giverId,
  helperLine,
  isQuestProgress,
  questById,
  questWords,
  reminder,
  startQuest,
  takerId,
  targets,
  taskLine,
} from './quests.ts';
import type { Helper, Quest, QuestEvent, QuestProgress } from './quests.ts';

/**
 * What Brick Island adds to the game: little jobs for a young child (see `quests.ts`), the hats
 * they win, and a tide that politely keeps the player on the island (see `tide.ts`).
 */

/** What the save game keeps of the jobs: those finished, the one being done and the hat worn. */
interface Kept {
  done: string[];
  active: unknown;
  hat?: string;
}

const isKept = (value: unknown): value is Kept =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as Kept).done) &&
  (value as Kept).done.every((id) => typeof id === 'string');

/** A brick layer of ground, in scene units: three plates. */
const LAYER = 3 * PLATE_HEIGHT;
/** How far a job helper strays from their spot, in studs. */
const HELPER_LEASH = 2.5;

export function useIslandAddon(host: AddonHost): Addon {
  const { seed, frame, terrain, walk, probe, playing, locale, saved, speak, saying } = host;
  const kept = isKept(saved) ? saved : null;
  const tide = useMemo(() => {
    const created = new Tide(seed, frame);
    walk.drift = created.push;
    return created;
  }, [seed, frame, walk]);

  // Talking to a helper starts a job, and the save game keeps those finished and the one being
  // done.
  const [done, setDone] = useState<ReadonlySet<string>>(
    () => new Set((kept?.done ?? []).filter((id) => questById(id))),
  );
  const [active, setActive] = useState<QuestProgress | null>(() =>
    isQuestProgress(kept?.active) ? kept.active : null,
  );
  /** The latest of both, for handlers that outlive a render, and kept ahead of it by them. */
  const questRef = useRef({ done, active });
  useEffect(() => {
    questRef.current = { done, active };
  }, [done, active]);
  /** Where the helpers stand, written by the scene. */
  const [positions] = useState(() => new Map<string, { x: number; y: number; z: number }>());
  /** How far through asking each helper has got, so each press says the next line. */
  const [askCounts] = useState(() => new Map<string, number>());
  /** Goes up when every job is done, to set off the fireworks. */
  const [fireworks, setFireworks] = useState(0);
  /** The cheer when a job is done. */
  const [cheer, setCheer] = useState<{
    icon: string;
    name: string;
    text: string;
    gift: boolean;
  } | null>(null);
  // Each job done gives the hat its helper wears. The player wears the one just won, and H
  // changes between those won, and none. `hat` is the quest whose hat is worn, `''` for none, and
  // `undefined` before a choice, which wears the latest.
  const [hat, setHat] = useState<string | undefined>(() => kept?.hat);
  const hatRef = useRef(hat);
  useEffect(() => {
    hatRef.current = hat;
  }, [hat]);
  const hatsWon = useMemo(
    () =>
      [...done]
        .map((id) => questById(id))
        .filter((quest): quest is Quest => quest !== null && !!giftOf(quest)),
    [done],
  );
  const hatWorn =
    hat === '' ? null : (hatsWon.find((quest) => quest.id === hat) ?? hatsWon.at(-1) ?? null);
  const outfit = useMemo<MinifigOutfit | undefined>(() => {
    const headgear = hatWorn ? giftOf(hatWorn) : null;
    return headgear ? { ...CLASSIC_OUTFIT, headgear } : undefined;
  }, [hatWorn]);
  const [hatNote, setHatNote] = useState<string | null>(null);
  useEffect(() => {
    if (!hatNote) return;
    const timer = setTimeout(() => setHatNote(null), 2200);
    return () => clearTimeout(timer);
  }, [hatNote]);
  useEffect(() => {
    if (!cheer) return;
    const timer = setTimeout(() => setCheer(null), 5000);
    return () => clearTimeout(timer);
  }, [cheer]);
  const pins = useMemo(() => questPins(done, active, locale), [done, active, locale]);

  /** A job is done: a cheer, a star, and thanks from whoever it was for. */
  const finishQuest = (quest: Quest) => {
    questRef.current = { done: new Set(questRef.current.done).add(quest.id), active: null };
    setActive(null);
    setDone(questRef.current.done);
    if (giftOf(quest)) setHat(quest.id);
    const { goal } = quest;
    const who = goal.kind === 'take' && 'outfit' in goal.to ? takerId(quest) : giverId(quest);
    const name = helperName(who, locale) ?? quest.giver.name;
    const { thanks } = questWords(quest, locale);
    setCheer({ icon: quest.icon, name, text: thanks, gift: giftOf(quest) !== null });
    chime('done');
    if (QUESTS.every((each) => questRef.current.done.has(each.id)))
      setTimeout(() => setFireworks((count) => count + 1), 1800);
    const finish = quest.sounds?.done;
    if (finish) setTimeout(() => chime(finish), 900);
    speak(who, name, thanks, helperVoice(who));
  };
  /** Something happened on a job: picked up, back with it all, arrived, a brick put on. */
  const onQuestEvent = (event: QuestEvent) => {
    const current = questRef.current.active;
    const quest = current ? questById(current.id) : null;
    if (!quest || !current) return;
    const next = advance(quest, current, event);
    if (next === current) return;
    if (next === 'done') return finishQuest(quest);
    questRef.current = { ...questRef.current, active: next };
    setActive(next);
    if (next.step === 'go') return chime(quest.sounds?.pick ?? 'pick');
    if (next.step === 'back' && current.step === 'go') return chime('all');
    if (next.step === 'build' && current.step === 'back') {
      chime('all');
      return speak(
        giverId(quest),
        questWords(quest, locale).giver,
        helperLine('build', locale),
        helperVoice(giverId(quest)),
      );
    }
    chime('place');
  };
  const questEventRef = useRef(onQuestEvent);
  useEffect(() => {
    questEventRef.current = onQuestEvent;
  });
  const questEvents = useCallback((event: QuestEvent) => questEventRef.current(event), []);
  /** Talking to a job's helper: they ask, a line a press, and the job starts with the last. */
  const talkTo = (id: string) => {
    const [, questId, role] = id.split(':');
    const quest = questById(questId);
    if (!quest) return;
    const { active: now, done: finished } = questRef.current;
    const mine = now?.id === quest.id ? now : null;
    const name = helperName(id, locale) ?? quest.giver.name;
    if (role === 'to') {
      // Someone to take a thing to: arriving hands it over (see the scene), so this is a hello.
      const text = helperLine(finished.has(quest.id) ? 'thanksAgain' : 'hello', locale);
      return speak(id, name, text, helperVoice(id));
    }
    if (mine?.step === 'build') return onQuestEvent({ kind: 'place' });
    if (mine?.step === 'back') return onQuestEvent({ kind: 'giver' });
    if (mine) return speak(id, name, reminder(quest, mine, locale), helperVoice(id));
    const count = askCounts.get(quest.id) ?? 0;
    const last = count >= quest.ask.length - 1;
    askCounts.set(quest.id, last ? 0 : count + 1);
    const { ask } = questWords(quest, locale);
    speak(id, name, ask[Math.min(count, ask.length - 1)], helperVoice(id));
    if (!last) return;
    const started = startQuest(quest);
    questRef.current = { ...questRef.current, active: started };
    setActive(started);
    chime(quest.sounds?.start ?? 'start');
  };
  /** H: the next hat won, then none, then the first again. Says whether there was a hat to change. */
  const changeHat = () => {
    if (!hatsWon.length) return false;
    const options = [...hatsWon.map((quest) => quest.id), ''];
    const now = hat === undefined ? hatsWon.at(-1)!.id : hat;
    const next = options[(Math.max(0, options.indexOf(now)) + 1) % options.length];
    setHat(next);
    const quest = next ? questById(next) : null;
    setHatNote(
      quest
        ? locale === 'nl'
          ? `Hoed van ${questWords(quest, 'nl').giver}`
          : `${questWords(quest, 'en').giver}'s hat`
        : locale === 'nl'
          ? 'Geen hoed'
          : 'No hat',
    );
    return true;
  };

  // What the player says when the tide turns them round, while it is said.
  const [tideLine, setTideLine] = useState<string | null>(null);
  /** How many lines the tide has drawn, and until when the player keeps quiet after the last. */
  const tideTalk = useRef({ count: 0, quietUntil: 0 });
  const sayingRef = useRef(saying);
  useEffect(() => {
    sayingRef.current = saying;
  });
  useEffect(() => {
    if (!playing) return;
    const said = tideTalk.current;
    const timer = setInterval(() => {
      const now = performance.now();
      // Once the push is felt, and not over someone else talking or straight after the last one.
      if (tide.strength < 2 || now < said.quietUntil || sayingRef.current) return;
      const text = TIDE_LINES[said.count++ % TIDE_LINES.length];
      const reading = 1600 + text.length * 50;
      said.quietUntil = now + reading + 8000;
      setTideLine(text);
      setTimeout(() => setTideLine((current) => (current === text ? null : current)), reading);
    }, 200);
    return () => {
      clearInterval(timer);
      setTideLine(null);
    };
  }, [tide, playing]);

  const people = useMemo(() => ({ positions, specs: helperSpecs }), [positions]);
  const view: QuestView = { active, done };
  const shown = active ? questById(active.id) : null;
  return {
    outfit,
    scene: (
      <>
        <QuestMarks
          view={view}
          world={walk}
          terrain={terrain}
          buildArea={frame}
          probe={probe}
          positions={positions}
          onEvent={questEvents}
        />
        <Fireworks show={fireworks} probe={probe} />
        <Sharks terrain={terrain} probe={probe} size={frame} />
        <HeadAnchor probe={probe} tide={tide} />
      </>
    ),
    overlay: (
      <>
        {playing && tideLine && !saying && (
          <SpeechBubble key={tideLine} anchor={tide.anchor} name="You" text={tideLine} />
        )}
        {playing && shown && active && (
          <QuestCard quest={shown} progress={active} locale={locale} />
        )}
        {playing && hatNote && (
          <div className="hat-note" role="status">
            🎩 {hatNote}
          </div>
        )}
        {playing && cheer && (
          <div className="cheer" role="status">
            <div className="cheer-star" aria-hidden>
              ⭐
            </div>
            <strong>
              {cheer.icon} Well done! {cheer.icon}
            </strong>
            <span>
              {cheer.name}: {cheer.text}
            </span>
            {cheer.gift && (
              <em className="cheer-gift">
                🎩 {locale === 'nl' ? 'Je hebt een nieuwe hoed!' : 'You got a new hat!'}{' '}
                <Key k="H" pad="D-pad ▲" /> {locale === 'nl' ? 'wisselt van hoed' : 'changes hats'}
              </em>
            )}
          </div>
        )}
      </>
    ),
    status: (
      <span className="stars" title="Jobs done">
        ⭐ {done.size} of {QUESTS.length}
      </span>
    ),
    pins,
    people,
    save: () =>
      ({
        done: [...questRef.current.done],
        active: questRef.current.active,
        ...(hatRef.current !== undefined ? { hat: hatRef.current } : {}),
      }) satisfies Kept,
    owns: isHelper,
    talkTo,
    nameOf: (id) => (isHelper(id) ? helperName(id, locale) : null),
    action: (id) =>
      shown && active?.step === 'build' && id === giverId(shown) ? 'Put on a brick' : null,
    changeHat,
  };
}

/** Whether a wanderer is one of the jobs' helpers rather than someone living there. */
const isHelper = (id: string) => id.startsWith('quest:');

/** A helper's name from their wanderer ID (see `giverId`, `takerId`). */
function helperName(id: string, locale: Locale) {
  const [, questId, role] = id.split(':');
  const quest = questById(questId);
  if (!quest) return null;
  const words = questWords(quest, locale);
  if (role !== 'to') return words.giver;
  return quest.goal.kind === 'take' ? (words.to ?? quest.goal.to.name) : null;
}

/** A helper's voice, the same every time, high or low as the helper says. */
function helperVoice(id: string) {
  let hash = 7;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const [, questId, role] = id.split(':');
  const quest = questById(questId);
  const goal = quest?.goal;
  const helper =
    role === 'to' ? (goal?.kind === 'take' && 'outfit' in goal.to ? goal.to : null) : quest?.giver;
  return voiceFor(Math.abs(hash), helper?.voice);
}

/** The job helpers as people for the scene. They stay close to where they stand, to be found. */
function helperSpecs({ terrain, buildArea, keys, isLoaded }: PeopleContext): WandererSpec[] {
  const half = buildArea / 2;
  const specs: WandererSpec[] = [];
  const helper = (id: string, person: Helper): WandererSpec | null => {
    if (!keys.has(chunkKey(Math.floor(person.x / CHUNK), Math.floor(person.z / CHUNK))))
      return null;
    const ground = terrain.column(Math.floor(person.x), Math.floor(person.z)).height;
    const shared = wanderRules(terrain, buildArea, isLoaded);
    return {
      id,
      // Scene x and z, and the height to look for ground from: inside the top brick, so it
      // climbs onto the ground, not out of a cave below.
      x: person.x - half,
      z: half - person.z,
      y: ground * LAYER - LAYER / 2,
      look: { kind: 'minifig', outfit: person.outfit },
      seed: Math.floor(hash2(911, Math.floor(person.x), Math.floor(person.z)) * 2 ** 31),
      temper: 'friendly',
      pace: 0.25,
      rules: { leash: HELPER_LEASH, canWalk: shared.canWalk },
    };
  };
  for (const quest of QUESTS) {
    const giver = helper(giverId(quest), quest.giver);
    if (giver) specs.push(giver);
    const { goal } = quest;
    const taker =
      goal.kind === 'take' && 'outfit' in goal.to ? helper(takerId(quest), goal.to) : null;
    if (taker) specs.push(taker);
  }
  return specs;
}

/** Keeps a screen point over the player's head each frame, for a speech bubble of their own. */
function HeadAnchor({ probe, tide }: { probe: { current: WalkProbe | null }; tide: Tide }) {
  const { camera, size } = useThree();
  const [head] = useState(() => new Vector3());
  useFrame(() => {
    const walker = probe.current?.walker;
    if (!walker) return;
    head.set(walker.x, walker.y + MINIFIG.height + 0.6, walker.z).project(camera);
    // Behind the camera, the projection lands mirrored on screen.
    tide.placeHead(((head.x + 1) / 2) * size.width, ((1 - head.y) / 2) * size.height, head.z < 1);
  });
  return null;
}

/**
 * Pins for the map: a ❗ on each helper with a job to give, and where to go for the job being
 * done.
 */
function questPins(
  done: ReadonlySet<string>,
  active: QuestProgress | null,
  locale: Locale,
): MapPin[] {
  const pins: MapPin[] = QUESTS.filter(
    (quest) => !done.has(quest.id) && quest.id !== active?.id,
  ).map((quest) => ({
    x: quest.giver.x,
    z: quest.giver.z,
    icon: '❗',
    name: questWords(quest, locale).giver,
  }));
  const quest = active ? questById(active.id) : null;
  if (quest && active)
    for (const spot of targets(quest, active))
      pins.push({ x: spot.x, z: spot.z, icon: quest.icon, target: true });
  return pins;
}

/**
 * The job being done, at the top of the screen: its picture, what to do in a few words, and a
 * picture for each thing to find, filled in as they are found.
 */
function QuestCard({
  quest,
  progress,
  locale,
}: {
  quest: Quest;
  progress: QuestProgress;
  locale: Locale;
}) {
  const { goal } = quest;
  const things =
    goal.kind === 'find' && progress.step === 'go' && goal.spots.length > 1
      ? goal.spots.map((_, index) => progress.found.includes(index))
      : goal.kind === 'find' && progress.step === 'build' && goal.build
        ? Array.from({ length: buildSize(goal.build) }, (_, index) => index < progress.built)
        : null;
  return (
    <div className="quest-card" role="status">
      <span className="quest-icon" aria-hidden>
        {quest.icon}
      </span>
      <div>
        <strong>
          {progress.step === 'build' ? (
            <>
              Press <Key k="T" pad="B" /> to build!
            </>
          ) : (
            `${taskLine(quest, progress, locale)}!`
          )}
        </strong>
        {things && (
          <span
            className="quest-things"
            aria-label={`${things.filter(Boolean).length} of ${things.length}`}
          >
            {things.map((got, index) => (
              <span key={index} className={got ? 'got' : undefined}>
                {progress.step === 'build' ? '🧱' : quest.icon}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
