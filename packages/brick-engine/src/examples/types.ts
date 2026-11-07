import type { Facing, Rotation } from '../core.ts';

export type ExampleBrickAdder = (
  partId: string,
  color: number,
  x: number,
  y: number,
  z: number,
  rotation?: Rotation,
  /** Mounts the piece on its side, on side studs pointing this way. */
  facing?: Facing,
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
}
