import { describe, expect, it } from 'vite-plus/test';
import { getPart } from '@brick-workshop/engine';
import { createTerrain } from './world/worlds.ts';
import { islandStructures } from './world/island/structures.ts';
import { LANDMARKS } from './world/island/map.ts';
import { BRICK_ISLAND } from './game.ts';
import {
  QUESTS,
  advance,
  giftOf,
  isQuestProgress,
  questById,
  questWords,
  reminder,
  startQuest,
  targets,
  taskLine,
} from './quests.ts';
import type { QuestProgress, Spot } from './quests.ts';

const terrain = createTerrain(BRICK_ISLAND.seed!, 'island');
const structures = islandStructures(BRICK_ISLAND.seed!);

/** Dry ground, with no building on it unless it is a room helpers work in (the police office). */
function open(spot: Spot, indoors = false) {
  const column = terrain.column(Math.floor(spot.x), Math.floor(spot.z));
  const built = structures.some(
    ({ bounds }) =>
      spot.x >= bounds.x0 && spot.x < bounds.x1 && spot.z >= bounds.z0 && spot.z < bounds.z1,
  );
  return column.water === 0 && (indoors || !built);
}

describe('Brick Island jobs', () => {
  it('has one job in each of its own places, every one at a landmark', () => {
    const areas = QUESTS.map((quest) => quest.area);
    expect(new Set(areas).size).toBe(areas.length);
    for (const area of areas) expect(LANDMARKS.map((landmark) => landmark.name)).toContain(area);
    expect(new Set(QUESTS.map((quest) => quest.id)).size).toBe(QUESTS.length);
  });

  it('puts helpers, things to find and places to go on dry, open ground', () => {
    for (const quest of QUESTS) {
      const { goal } = quest;
      const indoors = quest.id === 'thief';
      const spots: Spot[] = [quest.giver];
      if (goal.kind === 'find') spots.push(...goal.spots);
      else spots.push(goal.to);
      for (const spot of spots)
        expect(
          open(spot, spot === quest.giver && indoors),
          `${quest.id} at ${spot.x},${spot.z}`,
        ).toBe(true);
      if (goal.kind === 'find' && goal.build)
        expect(open(goal.build, indoors), `${quest.id} build`).toBe(true);
    }
  });

  it('uses only parts the catalogue has', () => {
    for (const quest of QUESTS) {
      const { goal } = quest;
      const looks =
        goal.kind === 'find' ? [goal.look, goal.build?.pieces ?? []] : [goal.leave ?? []];
      for (const piece of looks.flat()) expect(() => getPart(piece.part)).not.toThrow();
    }
  });

  it('gives every job a hat, and the fire and police jobs their own sounds', () => {
    for (const quest of QUESTS) expect(giftOf(quest), quest.id).not.toBeNull();
    expect(questById('fire')!.sounds).toEqual({ start: 'siren', pick: 'splash', done: 'siren' });
    expect(questById('thief')!.sounds?.done).toBe('clang');
  });

  it('keeps what helpers say short enough for a young child', () => {
    for (const quest of QUESTS)
      for (const line of [...quest.ask, quest.thanks, quest.task])
        expect(line.split(/\s+/).length, line).toBeLessThanOrEqual(9);
  });

  it('has the words of every job in Dutch, as short as the English', () => {
    for (const quest of QUESTS) {
      const words = questWords(quest, 'nl');
      expect(words.giver).not.toBe('');
      expect(words.ask).toHaveLength(quest.ask.length);
      for (const line of [...words.ask, words.thanks, words.task])
        expect(line.split(/\s+/).length, line).toBeLessThanOrEqual(9);
      if (quest.goal.kind === 'take') expect(words.to && words.thing).toBeTruthy();
    }
    const eggs = QUESTS[0];
    expect(taskLine(eggs, { id: eggs.id, step: 'go', found: [], built: 0 }, 'nl')).toBe(
      'Vind de eieren',
    );
  });

  it('finds things, goes back and is done', () => {
    const eggs = questById('eggs')!;
    let progress: QuestProgress | 'done' = startQuest(eggs);
    expect(taskLine(eggs, progress)).toBe('Find the eggs');
    for (const index of [0, 1, 2, 3])
      progress = advance(eggs, progress as QuestProgress, { kind: 'pick', index });
    expect(reminder(eggs, progress as QuestProgress)).toBe('Just 1 more to find!');
    // Picking the same one again changes nothing.
    expect(advance(eggs, progress as QuestProgress, { kind: 'pick', index: 0 })).toBe(progress);
    progress = advance(eggs, progress as QuestProgress, { kind: 'pick', index: 4 });
    expect(progress).toMatchObject({ step: 'back' });
    expect(targets(eggs, progress as QuestProgress)).toEqual([eggs.giver]);
    expect(advance(eggs, progress as QuestProgress, { kind: 'giver' })).toBe('done');
  });

  it('builds the tower a brick a press once the bricks are back', () => {
    const tower = questById('tower')!;
    let progress: QuestProgress | 'done' = startQuest(tower);
    for (const index of [0, 1, 2, 3])
      progress = advance(tower, progress as QuestProgress, { kind: 'pick', index });
    progress = advance(tower, progress as QuestProgress, { kind: 'giver' });
    expect(progress).toMatchObject({ step: 'build', built: 0 });
    for (let press = 0; press < 3; press++)
      progress = advance(tower, progress as QuestProgress, { kind: 'place' });
    expect(progress).toMatchObject({ built: 3 });
    expect(advance(tower, progress as QuestProgress, { kind: 'place' })).toBe('done');
  });

  it('finishes the race at the last flag, with no going back', () => {
    const race = questById('race')!;
    let progress: QuestProgress | 'done' = startQuest(race);
    for (const index of [2, 0, 3])
      progress = advance(race, progress as QuestProgress, { kind: 'pick', index });
    expect(advance(race, progress as QuestProgress, { kind: 'pick', index: 1 })).toBe('done');
  });

  it('delivers on arriving', () => {
    const flowers = questById('flowers')!;
    const progress = startQuest(flowers);
    expect(advance(flowers, progress, { kind: 'pick', index: 0 })).toBe(progress);
    expect(advance(flowers, progress, { kind: 'arrive' })).toBe('done');
  });

  it('reads saved progress back, and nothing else', () => {
    expect(isQuestProgress(startQuest(QUESTS[0]))).toBe(true);
    expect(isQuestProgress({ id: 'nope', step: 'go', found: [], built: 0 })).toBe(false);
    expect(isQuestProgress({ id: 'eggs', step: 'fly', found: [], built: 0 })).toBe(false);
    expect(isQuestProgress(null)).toBe(false);
  });
});
