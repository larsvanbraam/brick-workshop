import { getConnectionSites, getWorldBounds, validateAssembly } from '@brick-workshop/engine';
import type { Brick } from '@brick-workshop/engine';

/** A stud or receiver's place, keyed the way the engine keys them: `${y}:${x}:${z}`. */
const siteKey = (site: { x: number; y: number; z: number }) => `${site.y}:${site.x}:${site.z}`;

type Bounds = ReturnType<typeof getWorldBounds>;

/** The most pieces one break may bring down with it: a flower or a slope, not a whole tree. */
export const MAX_CASCADE = 24;

export type CheckResult = { ok: true } | { ok: false; reason: string };
export type BreakResult = { ok: true; removed: string[] } | { ok: false; reason: string };

function addTo(map: Map<string, Set<string>>, key: string, id: string) {
  let ids = map.get(key);
  if (!ids) map.set(key, (ids = new Set()));
  ids.add(id);
}

function removeFrom(map: Map<string, Set<string>>, key: string, id: string) {
  const ids = map.get(key);
  if (!ids) return;
  ids.delete(id);
  if (!ids.size) map.delete(key);
}

/**
 * The world's pieces indexed for quick local checks: their top studs and bottom receivers by
 * place, and which pieces cover each stud column. Placing and breaking then look only at the
 * pieces nearby instead of validating the whole world.
 *
 * It relies on what the engine guarantees for a valid world of upright pieces: every piece is
 * held from below, by the board or by studs of pieces that are held themselves. So a new piece is
 * held when one of its receivers lands on a stud already there, and taking a piece off brings
 * down exactly the pieces left with no stud under any receiver, in turn. Overlaps are left to the
 * engine, run on the new piece and its neighbours alone.
 */
export class WorldIndex {
  readonly bricks = new Map<string, Brick>();
  private readonly tops = new Map<string, Set<string>>();
  private readonly bottoms = new Map<string, Set<string>>();
  private readonly columns = new Map<string, Set<string>>();
  private readonly bounds = new Map<string, Bounds>();
  /** The board's size in studs: nothing may stand outside it. */
  readonly size: number;

  constructor(bricks: Iterable<Brick>, size: number) {
    this.size = size;
    for (const brick of bricks) this.add(brick);
  }

  add(brick: Brick) {
    const { id } = brick;
    this.bricks.set(id, brick);
    for (const site of getConnectionSites(brick, 'top')) addTo(this.tops, siteKey(site), id);
    for (const site of getConnectionSites(brick, 'bottom')) addTo(this.bottoms, siteKey(site), id);
    const bounds = getWorldBounds(brick);
    this.bounds.set(id, bounds);
    for (const column of this.columnsOf(bounds)) addTo(this.columns, column, id);
  }

  remove(id: string) {
    const brick = this.bricks.get(id);
    if (!brick) return;
    for (const site of getConnectionSites(brick, 'top')) removeFrom(this.tops, siteKey(site), id);
    for (const site of getConnectionSites(brick, 'bottom'))
      removeFrom(this.bottoms, siteKey(site), id);
    for (const column of this.columnsOf(this.bounds.get(id)!)) removeFrom(this.columns, column, id);
    this.bounds.delete(id);
    this.bricks.delete(id);
  }

  private *columnsOf(bounds: Bounds) {
    for (let x = Math.floor(bounds.minX); x < Math.ceil(bounds.maxX); x++)
      for (let z = Math.floor(bounds.minZ); z < Math.ceil(bounds.maxZ); z++) yield `${x},${z}`;
  }

  /** The pieces whose bounds come within `margin` studs of these bounds, each once. */
  near(bounds: Bounds, margin = 0): Brick[] {
    const found = new Set<string>();
    const reach = { ...bounds };
    reach.minX -= margin;
    reach.maxX += margin;
    reach.minZ -= margin;
    reach.maxZ += margin;
    for (const column of this.columnsOf(reach))
      for (const id of this.columns.get(column) ?? []) found.add(id);
    return [...found].map((id) => this.bricks.get(id)!);
  }

  /** Whether a receiver of the piece sits on a stud of a piece still standing. */
  private held(brick: Brick, gone: ReadonlySet<string> = new Set()) {
    if (brick.y === 0) return true;
    return getConnectionSites(brick, 'bottom').some((site) => {
      const owners = this.tops.get(siteKey(site));
      if (!owners) return false;
      for (const owner of owners) if (owner !== brick.id && !gone.has(owner)) return true;
      return false;
    });
  }

  /** Whether a new upright piece fits: on the board, clear of its neighbours and on studs. */
  check(brick: Brick): CheckResult {
    if (this.bricks.has(brick.id)) return { ok: false, reason: 'It does not fit there.' };
    const bounds = getWorldBounds(brick);
    if (
      bounds.minX < -1e-6 ||
      bounds.minZ < -1e-6 ||
      bounds.minY < -1e-6 ||
      bounds.maxX > this.size + 1e-6 ||
      bounds.maxZ > this.size + 1e-6
    )
      return { ok: false, reason: 'It does not fit there.' };
    const neighbours = this.near(bounds, 1);
    // The engine judges the overlaps, on the piece and its neighbours moved onto a small board.
    let minX = bounds.minX;
    let minZ = bounds.minZ;
    let maxX = bounds.maxX;
    let maxZ = bounds.maxZ;
    for (const other of neighbours) {
      const box = this.bounds.get(other.id)!;
      minX = Math.min(minX, box.minX);
      minZ = Math.min(minZ, box.minZ);
      maxX = Math.max(maxX, box.maxX);
      maxZ = Math.max(maxZ, box.maxZ);
    }
    const shiftX = 1 - Math.floor(minX);
    const shiftZ = 1 - Math.floor(minZ);
    const area = Math.max(16, Math.ceil(Math.max(maxX + shiftX, maxZ + shiftZ)) + 1);
    if (area <= 128) {
      const moved = (piece: Brick) => ({ ...piece, x: piece.x + shiftX, z: piece.z + shiftZ });
      const issues = validateAssembly({
        name: 'neighbourhood',
        bricks: [...neighbours.map(moved), moved(brick)],
        buildArea: area,
      }).filter((issue) => issue.brickId === brick.id && issue.code !== 'unsupported');
      if (issues.some((issue) => issue.code === 'collision'))
        return { ok: false, reason: 'Something is in the way.' };
      if (issues.length) return { ok: false, reason: 'It does not fit there.' };
    }
    return this.held(brick) ? { ok: true } : { ok: false, reason: 'Nothing holds it there.' };
  }

  /**
   * What taking a piece off brings down: the piece, then every piece left with no stud under any
   * of its receivers, in turn. Refused when that would be more than a handful.
   */
  breakAt(id: string): BreakResult {
    if (!this.bricks.has(id)) return { ok: false, reason: 'It does not fit there.' };
    const gone = new Set([id]);
    const frontier = [id];
    while (frontier.length) {
      const removed = this.bricks.get(frontier.pop()!)!;
      for (const site of getConnectionSites(removed, 'top'))
        for (const above of this.bottoms.get(siteKey(site)) ?? []) {
          if (gone.has(above)) continue;
          if (this.held(this.bricks.get(above)!, gone)) continue;
          gone.add(above);
          frontier.push(above);
          if (gone.size > MAX_CASCADE) return { ok: false, reason: 'Too much rests on it.' };
        }
    }
    return { ok: true, removed: [...gone] };
  }
}
