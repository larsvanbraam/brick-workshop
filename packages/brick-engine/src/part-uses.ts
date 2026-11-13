import { PARTS, getPart } from './core.ts';
import type { Part } from './core.ts';

/**
 * What each part is for, in the words a builder reaches for ("sill", "ridge", "stepping
 * stone"), so the workshop's Claude can find a part by its job rather than by its name. Parts
 * without an entry take their family's uses; the build standard (docs/build-standard.md) is
 * where most of these pairings come from.
 */
const FAMILY_USES: Record<NonNullable<Part['family']> | Part['kind'], string> = {
  brick: 'walls, bulk, courses, cores',
  plate: 'floors, storey bands, layers, steps in plates, ground',
  tile: 'smooth tops, floors, paths, sills, cornices, coping',
  tall: 'pillars, chimneys, tall wall sections, posts',
  slope: 'roofs, slopes',
  round: 'round detail',
  arch: 'arches over windows and doors, arcades',
  baseplate: 'ground, base',
  cone: 'finials, spires, turret tops',
  door: 'doors, entrances',
  window: 'windows, glazing',
  detail: 'detail',
  foliage: 'plants',
};

const PART_USES: Record<string, string> = {
  // Plates and tiles worth singling out.
  '3024': 'single-stud detail, offsets, flower centres, steps in terrain',
  '3070b': 'single smooth stud, path stones, floor mosaics, coping',
  '3068b': 'floor tiles, paths, smooth landings',
  '87079': 'floors, paths, smooth roofs of flat buildings',
  '1751': 'large floor tiles, plazas',
  '10202': 'plazas, floors, smooth flat roofs',
  '91405': 'large base, ground',
  // Tall bricks.
  '14716': 'thin pillars, posts, table legs, chimney flues',
  '2453b': 'tall thin pillars, columns, posts',
  '3245c': 'wall sections between windows, piers',
  '30145': 'chimney stacks, pillars, gate piers',
  // Slopes.
  '3040b': 'roofs (45°), roof edges, buttresses, steep ground',
  '3039': 'roofs (45°), roof courses, rock slopes',
  '3038': 'roofs (45°), long roof courses',
  '3037': 'roofs (45°), long roof courses',
  '4286': 'roofs (33°), shallow roof edges',
  '3298': 'roofs (33°), shallow roof courses',
  '4161': 'roofs (33°), shallow roof courses',
  '3297': 'roofs (33°), long shallow roof courses',
  '30363': 'shallow roofs (18°), porch roofs, awnings, gentle ground',
  '4460b': 'steep roofs (75°), spires, towers tops, dormer cheeks',
  '3678b': 'steep roofs (65°), spire tops, tower caps',
  '3660a': 'cornices, corbels, overhangs, eaves undersides, balcony supports',
  '3665a': 'cornices, corbels, overhangs, jetties, eaves undersides',
  '3747b': 'cornices, overhangs under 33° roofs, corbels',
  '54200': 'smoothing steps, rock, terrain, small roof edges, nose shapes',
  '85984': 'smoothing steps, rock, terrain, shallow roof edges',
  '35464': 'roof ridge cap on 1-wide ridges, spikes, rock tips',
  '11477': 'curved roofs, rounded edges, smooth terrain, rock',
  '15068': 'curved roofs, rounded tops, bushes, smooth terrain',
  '50950': 'curved roofs, rounded edges, awnings, rock',
  '6091': 'rounded wall tops, arches, vehicle mudguards, battlements',
  '24309': 'curved roofs, rounded masses, hills',
  '61678': 'long curved edges, awnings, curved roofs',
  '93606': 'curved roofs, rounded masses, hills, domes',
  '42022': 'long curved edges, awnings, hulls',
  '44126': 'long curved roofs, hulls, rounded masses',
  '3045': 'roof outside corners (45°), hip roofs, pyramid roofs',
  '3046': 'roof inside corners (45°), valleys, L-shaped roofs',
  '3043': 'roof ridge cap (45°), ridges',
  '3048b': 'roof ridge end, hip end, ridge junction',
  '3675': 'roof outside corners (33°), hip roofs',
  '99301': 'roof inside corners (33°), valleys',
  '3676': 'cornice corners, corbel corners, overhang corners',
  '3685': 'steep roof corners, spires, tower roofs',
  '3688': 'pyramid tops, spire tips, chimney caps, gate pier caps',
  // Round parts.
  '3062b': 'columns, barrels, posts, lamps, round detail, tree trunks',
  '3941': 'barrels, wells, columns, tree trunks, towers, chimney pots',
  '6141': 'flowers on grass, lamps, studs of colour, rivets, small round detail',
  '4032a': 'round bases, tables, lily pads, well tops',
  '98138': 'stepping stones, dots, lights, round detail',
  '14769': 'stepping stones, round paving, tables, lily pads',
  '60474': 'round towers, round platforms, fountain basins',
  '4150': 'round tops, table tops, stepping stones',
  '1126': 'rounded paving, path edges, smooth rounded tops',
  '5520': 'rounded paving, rounded ends of paths and walls',
  '66857': 'rounded paving, path edges, smooth rounded tops',
  '27925': 'curved paths, rounded corners of floors and walls',
  '79393': 'curved paths, rounded corners of floors',
  '27507': 'curved paths, rounded corners of floors, ponds',
  '67095': 'round paving, table tops, well covers',
  '7212': 'round plazas, fountain floors, round roofs',
  '35480': 'rounded detail, handles, path edges, organic shapes',
  '77845': 'rounded ends, path edges, organic shapes',
  '18980': 'rounded floors, boat hulls, organic ground',
  '7904': 'rounded corners, curved ground edges, round towers',
  '30357': 'rounded corners of ground and floors, organic outlines',
  '30565': 'rounded corners of ground and floors, organic outlines',
  '6003': 'large rounded corners of ground, island outlines',
  '22888': 'half-round floors, apses, bays, ponds',
  '11213': 'round floors, towers, ponds, tables',
  '74611': 'round floors, towers, ponds',
  '85080': 'curved walls, rounded corners of walls',
  '48092': 'curved walls, round towers, rounded corners',
  '2577': 'rounded wall corners, round towers',
  '47974': 'half-round walls, apses, bay windows, turrets',
  '87081': 'round towers, tree trunks, wells, silos',
  '37352': 'rounded wall tops, battlements, hedges',
  '6191': 'rounded wall tops, arches, hedges',
  '4740': 'dishes, satellite dishes, umbrellas, lamp shades, round roofs',
  '43898': 'domes, round roofs, lamp shades, umbrellas',
  '3960': 'domes, round roofs, fountain bowls, umbrellas',
  '30367c': 'dome tops, bollards, round finials, mushroom tops',
  '43888': 'columns, pillars, porticos',
  // Detail.
  '98283': 'stone wall texture, masonry, castle walls',
  '15533': 'stone wall texture, masonry, long stone courses',
  '2877': 'grilles, vents, wall texture, shop fronts',
  '4216': 'grooved wall texture, panelling, shutters',
  '30136': 'log cabins, timber walls, wooden texture',
  '30137': 'log cabins, timber walls, wooden texture',
  '4070': 'SNOT in the wall plane, sill mounts, headlights, wall texture',
  '2357': 'wall corners, L-shaped corners',
  '87087': 'SNOT (side stud), signs, lamps, shutters, sills, ivy, stand-proud texture',
  '11211': 'SNOT (side studs), signs, sills, shutters, window boxes',
  '30414': 'SNOT (side studs), signs, sills, shopfront fascia, long side mounts',
  '22885': 'SNOT (side studs), side mounts, sills',
  '2412b': 'grilles, drains, vents, paving texture, gratings',
  '3794b': 'half-stud offsets, centring, path detail',
  '87580': 'half-stud offsets, centring a part, round detail on top',
  '25269': 'rounded corners of tiled tops, smoothing',
  '24246': 'rounded ends, path edges, small detail',
  '60581': 'thin walls, partitions, wall panels, stall sides',
  '59349': 'thin tall walls, panels, partitions',
  '3185': 'lattice railings, balconies, fences, trellises',
  '3633': 'low fences, railings, balconies',
  '33303': 'picket fences, garden fences, railings',
  '30055': 'balustrades, balcony railings, stair railings',
  '15332': 'fences, railings with studs on top',
  '18674': 'round half-stud offsets, centring, round detail',
  '14719': 'L-shaped tiled corners, path corners',
  '5091': 'angled tile edges, pointed ends',
  '5092': 'angled tile edges, pointed ends',
  '35787': 'triangular tiled corners, angled edges',
  '22385': 'angled ends, pointed tops, signs',
  '3957a': 'antennas, flagpoles, masts, bars, lamp poles',
  '30374': 'bars, rails, handles, poles, mounted level between clips',
  '87994': 'bars, rails, handles, poles',
  '2432': 'handles, bars on tiles, rails, ladder rungs',
  '2540': 'handles, bars on the side, ladder rungs',
  '4081b': 'clips for bars, holding bars level, flags',
  '60470a': 'clips for bars, holding bars level',
  '63868': 'clip on end, holding bars, hanging signs',
  '2335': 'flags on antennas, banners',
  '44676a': 'pennants, flags on antennas',
  '2039': 'lampposts, street lights',
  '4865b': 'low walls, panels, counters, balcony fronts',
  '30413': 'low walls, panels, counters, balcony fronts',
  '41769a': 'angled ground edges, wedge shapes, organic outlines',
  '41770a': 'angled ground edges, wedge shapes, organic outlines',
  '43722a': 'angled edges, wedge shapes, organic outlines',
  '43723a': 'angled edges, wedge shapes, organic outlines',
  '4733': 'SNOT (studs on four sides), lamps, cross shapes, tree branches',
  '47905': 'SNOT (studs on two sides), both-way mounts, signs',
  '99780': 'brackets, sills, signs, side mounts standing proud',
  '3937': 'hinge base for tilted roofs and panels, eaves',
  '3938': 'hinge top for tilted roofs and panels, carries plates at a tilt',
  '87620': 'faceted corners, angled walls, towers',
  u66: 'sails, triangular sails',
  // Arches.
  '3659': 'arches over windows and doors, arcades',
  '4490': 'small arches over windows and doors',
  '6182': 'tall arches, arcades, gateways',
  '3307': 'wide arches, gateways, bridges',
  '3308': 'wide arches, bridges, cloisters',
  '92950': 'shallow arches, lintels, window heads',
  '15254': 'thin arches, windows with arched tops, bridges',
  '38583': 'arcade columns, half arches on two sides',
  '38585': 'corner arcade columns, half arches on two sides',
  '6005': 'quarter arches, buttresses, brackets, corbels',
  '88292': 'ogee quarter arches, decorative brackets, gothic detail',
  // Cones.
  '4589': 'finials, turret tops, lamp tops, spikes',
  '59900': 'finials, turret tops, lamp tops',
  '3942c': 'turret roofs, spires, cone tops, tree tops',
  '3943b': 'turret roofs, spires, large cone tops',
  '6233': 'turret roofs, spires, cone tops',
  // Doors and windows.
  '3193a': 'door with left hinge, needs door frame 3579',
  '3192a': 'door with right hinge, needs door frame 3579',
  '3861c': 'door, reinforced door, castle door, needs door frame 60596 or wall opening',
  '3579': 'door frame 1 x 3 x 4, entrances',
  '60596': 'door frame 1 x 4 x 6, entrances, shop doors',
  '60616a': 'smooth door, needs door frame 60596',
  '60623': 'glazed door, shop door, needs door frame 60596',
  '60592': 'small window frame, needs glass 60601',
  '60601': 'glass for window frame 60592',
  '60593': 'window frame, needs glass 60602 or panes 60607, 60608',
  '60602': 'glass for window frame 60593',
  '4035': 'one-piece window with glazing, simple windows',
  '60594': 'wide window frame, needs glass 86210',
  '86210': 'glass for window frame 60594',
  '60607': 'latticed casement pane, cottage windows, frame 60593',
  '60608': 'barred casement pane, shutters, frame 60593',
  '57894': 'tall window frame with three lights, shop fronts, church windows',
  '57895': 'glass for window frame 57894',
  '20309': 'half-round window, fanlight over doors, arched window tops',
  '30044': 'window with rounded top, arched windows',
  '2493b': 'tall window frame, needs glass 2494',
  '2494': 'glass for window frame 2493b',
  '3853': 'window with sill, cottage windows',
  // Foliage.
  '3470': 'broadleaf tree, round tree crown',
  '3471': 'conifer, pine tree, evergreen',
  '6064': 'bushes, shrubs, hedges, undergrowth (half-stud receivers)',
  '30093': 'tall grass, reeds, cattails (half-stud receivers)',
  '2417': 'large leaves, tree canopy, ivy, jungle foliage',
  '2423': 'leaves, ivy, tree crowns, bushes',
  '32607': 'sprigs, small plants, window boxes, flower stems',
  '24866': 'flowers, flower beds, window boxes',
  '4727': 'flower stems and leaves, potted plants, flower beds',
  '30176': 'bamboo, ferns, palm fronds, reeds',
  '6255': 'ferns, large leaves, undergrowth (half-stud receivers)',
};

/** What a part is for, as a comma-separated list of builder's words. */
export function getPartUses(partId: string): string {
  const part = getPart(partId);
  return PART_USES[part.id] ?? FAMILY_USES[part.family ?? part.kind];
}

/** The part IDs with their own uses, for tests. */
export const PART_USE_IDS: readonly string[] = Object.keys(PART_USES);

export interface PartMatch {
  part: Part;
  uses: string;
  /** How many of the query's words it matched. */
  score: number;
}

/**
 * Parts whose ID, name, family or uses contain the query's words, best first: parts matching
 * more words come first, then by where they matched: ID, name, own uses, then family. Words
 * shorter than two letters are ignored; an empty query matches nothing.
 */
export function searchParts(query: string, parts: readonly Part[] = PARTS): PartMatch[] {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9°]+/)
    .filter((word) => word.length >= 2);
  if (!words.length) return [];
  const matches: (PartMatch & { weight: number; index: number })[] = [];
  parts.forEach((part, index) => {
    const uses = getPartUses(part.id);
    const id = part.id.toLowerCase();
    const name = part.name.toLowerCase();
    const own = (PART_USES[part.id] ?? '').toLowerCase();
    const family = `${part.family ?? ''} ${part.kind}`;
    let score = 0;
    let weight = 0;
    for (const word of words) {
      const stem = word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
      if (id === word) {
        score += 1;
        weight += 4;
      } else if (name.includes(stem)) {
        score += 1;
        weight += 3;
      } else if (own.includes(stem)) {
        score += 1;
        weight += 2;
      } else if (uses.toLowerCase().includes(stem) || family.includes(stem)) {
        score += 1;
        weight += 1;
      }
    }
    if (score) matches.push({ part, uses, score, weight, index });
  });
  return matches
    .sort(
      (first, second) =>
        second.score - first.score || second.weight - first.weight || first.index - second.index,
    )
    .map(({ part, uses, score }) => ({ part, uses, score }));
}
