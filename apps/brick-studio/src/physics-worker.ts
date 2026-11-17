/**
 * Runs the engine's physical assessment off the main thread, on HiGHS once it has loaded, so a
 * big build's static solve never freezes the editor.
 */
import highsLoader from 'highs';
import wasmUrl from 'highs/runtime?url';
import {
  assessPhysicalFeasibility,
  createHighsSolver,
  registerPart,
  setLinearSolver,
} from '@brick-workshop/engine';
import type { PhysicsRequest, PhysicsResponse } from './physics-client';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PhysicsRequest>) => void) | null;
  postMessage(message: PhysicsResponse): void;
};

// Without HiGHS the engine's own simplex still answers, only more slowly.
const ready = highsLoader({ locateFile: () => wasmUrl }).then(
  (highs) => setLinearSolver(createHighsSolver(highs)),
  () => {},
);

scope.onmessage = async ({ data }) => {
  await ready;
  try {
    for (const part of data.parts) registerPart(part);
    scope.postMessage({
      id: data.id,
      report: assessPhysicalFeasibility(data.assembly, data.options),
    });
  } catch (error) {
    scope.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : 'The physical check failed.',
    });
  }
};
