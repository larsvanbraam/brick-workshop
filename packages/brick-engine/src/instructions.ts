import {
  INSERT_FRAME_PARTS,
  PLATE_HEIGHT,
  footprint,
  isMatchingInsertFrame,
  validateAssembly,
} from './core.ts';
import type { Assembly, Brick } from './core.ts';

export interface InstructionOptions {
  /** Most pieces added in one step. */
  maxPiecesPerStep?: number;
  /** Most different part/color combinations in one step's parts callout. */
  maxKindsPerStep?: number;
  /** Farthest, in studs, a piece may sit from the rest of its step. */
  maxStepSpread?: number;
}

export interface InstructionPart {
  partId: string;
  color: number;
  quantity: number;
}

export interface InstructionStep {
  /** 1-based, as printed. */
  number: number;
  /** Bricks added in this step, in placing order. */
  brickIds: string[];
  /** The step's parts callout, most numerous first. */
  parts: InstructionPart[];
}

export const DEFAULT_INSTRUCTION_OPTIONS: Readonly<Required<InstructionOptions>> = Object.freeze({
  maxPiecesPerStep: 6,
  maxKindsPerStep: 4,
  maxStepSpread: 4,
});

interface Node {
  brick: Brick;
  index: number;
  cx: number;
  cz: number;
  width: number;
  depth: number;
  /** Pieces that must be in place first: everything this piece rests on, and its frame. */
  blockers: number;
  dependants: number[];
}

/**
 * For each piece, the pieces directly beneath it that it touches, plus the frame an insert
 * sits in. Placing every piece after these keeps each one pressable: nothing has to be slid
 * under a piece that is already there.
 */
function buildNodes(bricks: readonly Brick[]): Node[] {
  const nodes = bricks.map((brick, index): Node => {
    const size = footprint(brick);
    return {
      brick,
      index,
      cx: brick.x + size.width / 2,
      cz: brick.z + size.depth / 2,
      width: size.width,
      depth: size.depth,
      blockers: 0,
      dependants: [],
    };
  });
  // Bricks indexed by the height of their top and each whole stud cell they cover.
  const tops = new Map<string, number[]>();
  const cellsOf = (node: Node) => {
    const keys: string[] = [];
    for (let x = Math.floor(node.brick.x); x < Math.ceil(node.brick.x + node.width); x++)
      for (let z = Math.floor(node.brick.z); z < Math.ceil(node.brick.z + node.depth); z++)
        keys.push(`${x}:${z}`);
    return keys;
  };
  for (const node of nodes) {
    const top = node.brick.y + footprint(node.brick).height;
    for (const cell of cellsOf(node)) {
      const key = `${top}:${cell}`;
      const list = tops.get(key);
      if (list) list.push(node.index);
      else tops.set(key, [node.index]);
    }
  }
  const frames = new Map<string, Node[]>();
  for (const node of nodes) {
    if (!Object.values(INSERT_FRAME_PARTS).includes(node.brick.partId)) continue;
    const list = frames.get(node.brick.partId);
    if (list) list.push(node);
    else frames.set(node.brick.partId, [node]);
  }
  for (const node of nodes) {
    const below = new Set<number>();
    for (const cell of cellsOf(node))
      for (const other of tops.get(`${node.brick.y}:${cell}`) ?? []) {
        const lower = nodes[other];
        // Whole cells can touch at a half-stud offset without overlapping; check the real boxes.
        if (
          node.brick.x < lower.brick.x + lower.width &&
          lower.brick.x < node.brick.x + node.width &&
          node.brick.z < lower.brick.z + lower.depth &&
          lower.brick.z < node.brick.z + node.depth
        )
          below.add(other);
      }
    const framePartId = INSERT_FRAME_PARTS[node.brick.partId];
    if (framePartId) {
      const frame = frames
        .get(framePartId)
        ?.find((candidate) => isMatchingInsertFrame(node.brick, candidate.brick));
      if (frame) below.add(frame.index);
    }
    below.delete(node.index);
    node.blockers = below.size;
    for (const other of below) nodes[other].dependants.push(node.index);
  }
  return nodes;
}

const kindOf = (brick: Brick) => `${brick.partId}:${brick.color}`;

/** Horizontal gap in studs between two footprints; 0 when they touch or overlap. */
function gap(first: Node, second: Node) {
  const dx = Math.max(0, Math.abs(first.cx - second.cx) - (first.width + second.width) / 2);
  const dz = Math.max(0, Math.abs(first.cz - second.cz) - (first.depth + second.depth) / 2);
  return Math.hypot(dx, dz);
}

/**
 * Splits a valid assembly into small building steps. Pieces go bottom-up with each one placed
 * after everything it rests on, the next step starts close to where the last one ended, and
 * a step only gathers nearby pieces at the same height, so freestanding sections (a tree, a
 * lamp post) are finished before the build moves on.
 */
export function planInstructionSteps(
  assembly: Assembly,
  options: InstructionOptions = {},
): InstructionStep[] {
  if (validateAssembly(assembly).length)
    throw new Error('Building instructions need a valid assembly.');
  const { maxPiecesPerStep, maxKindsPerStep, maxStepSpread } = {
    ...DEFAULT_INSTRUCTION_OPTIONS,
    ...options,
  };
  if (![maxPiecesPerStep, maxKindsPerStep].every((value) => Number.isInteger(value) && value > 0))
    throw new Error('Step limits must be positive whole numbers.');
  const nodes = buildNodes(assembly.bricks);
  const ready = new Set(nodes.filter((node) => node.blockers === 0).map((node) => node.index));
  const steps: InstructionStep[] = [];
  // Start where a builder would: a corner of the board.
  let anchor = { x: 0, y: 0, z: 0 };
  while (ready.size) {
    let lowest = Infinity;
    for (const index of ready) lowest = Math.min(lowest, nodes[index].brick.y);
    // Nearest ready piece in 3D, with height in studs and a pull back towards the lowest layer.
    let seed = -1;
    let best = Infinity;
    for (const index of ready) {
      const { brick, cx, cz } = nodes[index];
      const score =
        Math.hypot(cx - anchor.x, cz - anchor.z, (brick.y - anchor.y) * PLATE_HEIGHT) +
        (brick.y - lowest) * PLATE_HEIGHT * 1.5;
      if (score < best || (score === best && index < seed)) {
        best = score;
        seed = index;
      }
    }
    const members = [nodes[seed]];
    const kinds = new Set([kindOf(nodes[seed].brick)]);
    const candidates = [...ready].filter(
      (index) => index !== seed && nodes[index].brick.y === nodes[seed].brick.y,
    );
    while (members.length < maxPiecesPerStep) {
      let pick = -1;
      let pickScore = Infinity;
      for (const index of candidates) {
        const node = nodes[index];
        const known = kinds.has(kindOf(node.brick));
        if (!known && kinds.size >= maxKindsPerStep) continue;
        const distance = Math.min(...members.map((member) => gap(member, node)));
        if (distance > maxStepSpread) continue;
        // Repeating a part already in the callout costs less than introducing a new one.
        const score = distance + (known ? 0 : 1.5);
        if (score < pickScore) {
          pickScore = score;
          pick = index;
        }
      }
      if (pick === -1) break;
      members.push(nodes[pick]);
      kinds.add(kindOf(nodes[pick].brick));
      candidates.splice(candidates.indexOf(pick), 1);
    }
    const parts = new Map<string, InstructionPart>();
    for (const { brick, index } of members) {
      ready.delete(index);
      const key = kindOf(brick);
      const entry = parts.get(key);
      if (entry) entry.quantity += 1;
      else parts.set(key, { partId: brick.partId, color: brick.color, quantity: 1 });
    }
    // Unlock what rests on this step only afterwards, so a step never hides its own pieces.
    for (const member of members)
      for (const dependant of member.dependants)
        if (--nodes[dependant].blockers === 0) ready.add(dependant);
    anchor = {
      x: members.reduce((sum, node) => sum + node.cx, 0) / members.length,
      y: members[0].brick.y,
      z: members.reduce((sum, node) => sum + node.cz, 0) / members.length,
    };
    steps.push({
      number: steps.length + 1,
      brickIds: members.map((node) => node.brick.id),
      parts: [...parts.values()].sort((first, second) => second.quantity - first.quantity),
    });
  }
  const placed = steps.reduce((sum, step) => sum + step.brickIds.length, 0);
  if (placed !== nodes.length)
    throw new Error('Some pieces could not be ordered into steps; the assembly has a cycle.');
  return steps;
}
