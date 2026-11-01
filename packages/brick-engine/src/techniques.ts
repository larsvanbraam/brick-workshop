import { COLORS, placeBrick } from './core.ts';
import type { Assembly, Brick } from './core.ts';

export const TECHNIQUE_LIBRARY_VERSION = 1;
export const BUILDING_TECHNIQUE_IDS = Object.freeze([
  'foundations',
  'staggered-walls',
  'reinforcement',
] as const);
export type BuildingTechniqueId = (typeof BUILDING_TECHNIQUE_IDS)[number];
export type BuildingTechniqueTopic = 'foundations' | 'walls' | 'reinforcement';

export interface BuildingTechnique {
  id: BuildingTechniqueId;
  version: 1;
  title: string;
  topics: readonly BuildingTechniqueTopic[];
  purpose: string;
  prerequisites: readonly string[];
  supportedConnections: readonly string[];
  requiredPartIds: readonly string[];
  steps: readonly string[];
  tradeoffs: readonly string[];
  limitations: readonly string[];
}

const commonLimitations = [
  'Compatible stud sites do not establish measured clutch strength or a universal minimum stud count.',
  'Geometry-tested examples are not physical load tests, verified construction sequences or certified builds.',
  'Adapt examples to the current board, occupancy, part/color evidence, inventory and host physical policy; never copy reference IDs as existing pieces.',
];

const techniques: readonly BuildingTechnique[] = [
  {
    id: 'foundations',
    version: 1,
    title: 'Grounded foundations',
    topics: ['foundations'],
    purpose: 'Tie adjacent ground-level modules together before extending upward.',
    prerequisites: [
      'A flat supporting floor and space for the complete reserved footprints.',
      'Grounded upright bricks with exposed top studs; use actual declared receivers and stud sites.',
    ],
    supportedConnections: ['upright-stud-to-receiver'],
    requiredPartIds: ['3001', '3020'],
    steps: [
      'Arrange adjoining grounded bricks over the intended base footprint.',
      'Bridge each seam with a plate whose underside connects to bricks on both sides.',
      'Inspect the resulting support graph and assess the actual assembly before adding upper loads.',
    ],
    tradeoffs: [
      'A wider footprint uses more pieces and space; its suitability depends on the loads and support surface.',
      'Seam ties occupy studs that may be needed for upper details.',
    ],
    limitations: [
      ...commonLimitations,
      'This rigid rectangular example does not model real baseplate flexure, uneven floors or disturbance margins.',
    ],
  },
  {
    id: 'staggered-walls',
    version: 1,
    title: 'Staggered wall joints',
    topics: ['walls'],
    purpose:
      'Connect neighboring wall sections across alternating courses instead of repeating an uninterrupted seam.',
    prerequisites: [
      'A grounded lower course with available studs.',
      'Brick lengths and end caps that fit the reserved wall footprint.',
    ],
    supportedConnections: ['upright-stud-to-receiver'],
    requiredPartIds: ['3001', '3003'],
    steps: [
      'Lay the first course with adjacent long bricks.',
      'Offset the next course joints using shorter end caps and long bricks spanning the lower seams.',
      'Alternate the course pattern and confirm each seam-spanning piece connects to both lower sections.',
    ],
    tradeoffs: [
      'End caps add piece count and may need alternative designs when inventory is constrained.',
      'Doors, corners and openings require adapting the pattern rather than blindly repeating it.',
    ],
    limitations: [
      ...commonLimitations,
      'Staggered joints are a connectivity heuristic, not a measured bending or shear capacity.',
      'The example has no openings, sideways attachment or flexible joints.',
    ],
  },
  {
    id: 'reinforcement',
    version: 1,
    title: 'Bridge existing seams',
    topics: ['walls', 'reinforcement'],
    purpose:
      'Add a reviewed upright connection across an existing seam between neighboring modules.',
    prerequisites: [
      'Adjacent supported sections with exposed studs at a matching height.',
      'Clearance for a spanning piece and known underside receiver locations.',
    ],
    supportedConnections: ['upright-stud-to-receiver'],
    requiredPartIds: ['3001', '3020'],
    steps: [
      'Inspect the pieces on each side of the seam and identify exposed matching-height studs.',
      'Choose a spanning plate that connects to both sections without collisions.',
      'Preview the complete change, inspect the new connections and recheck physical assessment; do not remove counterweights or supports based on appearance alone.',
    ],
    tradeoffs: [
      'A tie adds mass and occupies attachment sites; adding material is not automatically an improvement.',
      'Top ties can interfere with roofs or trim; use a compatible location rather than an unsupported sideways connection.',
    ],
    limitations: [
      ...commonLimitations,
      'The example demonstrates an added connection, not a quantified increase in strength or resistance to tipping.',
      'It does not prescribe a safe reinforcement sequence for an unstable real assembly.',
    ],
  },
];

export function getBuildingTechniques(
  query: { id?: BuildingTechniqueId; topic?: BuildingTechniqueTopic; limit?: number } = {},
) {
  const limit = query.limit ?? 3;
  if (!Number.isInteger(limit) || limit < 1 || limit > 3)
    throw new Error('Technique limit must be 1-3.');
  if (query.id !== undefined && !BUILDING_TECHNIQUE_IDS.includes(query.id))
    throw new Error('Unknown building technique.');
  if (query.topic !== undefined && !['foundations', 'walls', 'reinforcement'].includes(query.topic))
    throw new Error('Unknown technique topic.');
  const matches = techniques.filter(
    (technique) =>
      (query.id === undefined || technique.id === query.id) &&
      (query.topic === undefined || technique.topics.includes(query.topic)),
  );
  return structuredClone({
    version: TECHNIQUE_LIBRARY_VERSION,
    purpose: 'advisory-engine-guidance' as const,
    techniques: matches.slice(0, limit),
    totalMatches: matches.length,
    truncated: matches.length > limit,
    constructionSequence: 'not-validated' as const,
    certified: false as const,
  });
}

export interface TechniqueExampleOptions {
  sections?: number;
  courses?: number;
  color?: number;
  x?: number;
  z?: number;
}

export function createBuildingTechniqueExample(
  id: BuildingTechniqueId,
  options: TechniqueExampleOptions = {},
): Assembly {
  const technique = getBuildingTechniques({ id }).techniques[0];
  const sections = options.sections ?? 2;
  const courses = options.courses ?? 2;
  const color = options.color ?? 4;
  const x = options.x ?? 0;
  const z = options.z ?? 0;
  if (
    ![sections, courses].every((value) => Number.isInteger(value) && value >= 2 && value <= 4) ||
    ![x, z].every((value) => Number.isInteger(value * 2) && value >= 0) ||
    !COLORS.some((candidate) => candidate.id === color) ||
    (id !== 'staggered-walls' && options.courses !== undefined)
  )
    throw new Error(
      'Invalid technique example parameters: sections/courses 2-4, recognized color and nonnegative half-grid origin; courses apply only to walls.',
    );
  let assembly: Assembly = { name: `${technique.title} reference`, bricks: [] };
  function add(partId: string, y: number, offsetZ: number) {
    const brick: Brick = {
      id: `technique-${id}-${assembly.bricks.length + 1}`,
      partId,
      color,
      x,
      y,
      z: z + offsetZ,
      rotation: 0,
    };
    const result = placeBrick(assembly, brick);
    if (!result.ok) throw new Error(`Technique example rejected: ${result.issues[0].message}`);
    assembly = result.assembly;
  }
  if (id === 'staggered-walls') {
    for (let course = 0; course < courses; course++) {
      if (course % 2 === 0) {
        for (let section = 0; section < sections; section++) add('3001', course * 3, section * 4);
      } else {
        add('3003', course * 3, 0);
        for (let section = 0; section < sections - 1; section++)
          add('3001', course * 3, 2 + section * 4);
        add('3003', course * 3, sections * 4 - 2);
      }
    }
  } else {
    const levels = id === 'foundations' ? 1 : 2;
    for (let level = 0; level < levels; level++)
      for (let section = 0; section < sections; section++) add('3001', level * 3, section * 4);
    for (let section = 0; section < sections - 1; section++)
      add('3020', levels * 3, section * 4 + 2);
  }
  return assembly;
}
