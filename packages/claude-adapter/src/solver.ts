import highsLoader from 'highs';
import { createHighsSolver, setLinearSolver } from '@brick-workshop/engine';

/**
 * Switches the engine's static solver to HiGHS, many times faster than the built-in simplex on
 * real builds. Call once at startup; until it resolves, the built-in solver answers.
 */
export async function useHighsSolver(): Promise<void> {
  setLinearSolver(createHighsSolver(await highsLoader()));
}
