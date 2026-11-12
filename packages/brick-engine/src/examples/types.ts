import type { Facing, Rotation } from '../core.ts';
import type { SmoothOptions } from '../smoothing.ts';

export type ExampleBrickAdder = (
  partId: string,
  color: number,
  x: number,
  y: number,
  z: number,
  rotation?: Rotation,
  /** Mounts the piece on its side, on side studs pointing this way. */
  facing?: Facing,
  /** Fits a flippable piece, such as the far casement of a frame, upside down. */
  upsideDown?: boolean,
) => void;

export interface ExampleMetadata {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly expectedPieceCount: number;
  readonly buildArea?: number;
}

export interface ExampleDefinition extends ExampleMetadata {
  readonly brickIdPrefix?: string;
  readonly build: (add: ExampleBrickAdder) => void;
  /**
   * Smoothing passes run over the finished build, in order: round corners, slopes on steps,
   * tiles on open studs and optional flowers (see `smoothAssembly`). Limit each with `only` or
   * `region` to the natural parts (rocks, hills, tree roots, lawns) so walls keep their studs.
   * Their pieces count towards `expectedPieceCount`.
   */
  readonly smooth?: readonly Omit<SmoothOptions, 'nextId' | 'ids' | 'maxPieces'>[];
}
