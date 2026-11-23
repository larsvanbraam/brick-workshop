# Brick Workshop

A LEGO assembly playground: a UI-free engine (`packages/brick-engine`), a Claude adapter
(`packages/claude-adapter`), the workshop app (`apps/brick-studio`) and Brick World (`apps/brick-world`), a
game where a minifigure explores and builds in an endless generated world. The game core lives in
`packages/brick-game`, which knows no game by name; `apps/brick-world` and `apps/brick-island` each hold their
game (world, map, extras) and pass it a `GameConfig`. Both apps draw with
`packages/brick-render` (LDraw loading, batched drawing, the cinematic look, the loading card
and the LDraw library's Vite plugin) and walk with `packages/brick-walk` (the minifigure
controller). The [engine README](packages/brick-engine/README.md) cover the engine's rules (coordinates, parts, connections,
physics); read it before placing pieces.

```sh
pnpm dev:studio  # workshop on http://localhost:5173
pnpm dev:world   # Brick World on http://localhost:5173 (or the next free port)
pnpm test        # Vitest
pnpm check       # format, lint and typecheck; run before every commit
pnpm fmt         # format the workspace
```

Commit straight to `main`; this repo has no feature branches. Commit only when asked.

When a feature built in a worktree is done, land it on `main` and sync the main checkout:

1. Commit in the worktree, then rebase on the latest `main` (`git fetch origin && git rebase
   origin/main`).
2. Merge it into `main` and push: `git push origin HEAD:main`.
3. Pull `main` in the main checkout so it has the work: `git -C <repo root> pull --ff-only
   origin main`.

## Example builds

Most work here is making example builds: TypeScript files in
`packages/brick-engine/src/examples/` registered in `registry.ts`. **Use the `build-example`
skill** (`.claude/skills/build-example/`) when making or reworking one: it holds the workflow,
the helpers and the checklist. The standard every build is held to is
[docs/build-standard.md](docs/build-standard.md), and [docs/techniques/](docs/techniques/README.md) says how to
reach it per subject (walls, facades, roofs, flora and terrain, vehicles, fauna, city props).

Rules the registry and the tests enforce, whoever edits an example:

- **Build order.** Every piece comes after whatever holds it up; the registry names the first
  failing piece by replaying the list. Wrap the adder in `bottomUp` (`layout.ts`) and call
  `flush()` at the end of `build`.
- **Piece count.** `expectedPieceCount` must match; a wrong count throws in the app and the
  workshop hangs on "Preparing build…".
- **The demo build.** `courtyard-house` is also `createDemoAssembly`; `index.test.ts` describes it
  in detail (piece count, board size, windows, roof profile, brick IDs). Update those tests when
  you change it.
- **Physics and instructions.** The full gravity solve runs up to `MAX_PHYSICS_PIECES` (1,000
  pieces); above that only tipping is checked. Examples under 2,500 pieces also run through the
  building instructions tests.
