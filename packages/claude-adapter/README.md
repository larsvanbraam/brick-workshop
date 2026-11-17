# Claude adapter

Lets Claude build through [`brick-engine`](../brick-engine), for the local generation CLI and
the workshop's Generate panel.

Claude builds only through engine tools (catalogue, placement candidates,
patches, inspection, physics, export); it has no shell, files or web access, and
the engine rejects anything invalid. By default it may only use part/colour
combinations with inventory evidence.

```sh
pnpm claude:build --help
pnpm claude:build "Build a small bridge" --out output/bridge
pnpm claude:build "Add a second level" --input output/bridge/assembly.json --out output/two-level
```

The output folder gets `assembly.json` (assembly, parts list, physics and tool
trace) and `assembly.ldr`; both import into the workshop. Use
`createBuilderSession` and `runClaudeBuild` from `@brick-workshop/claude-adapter`
to host it elsewhere.

## What's inside

| File                    | What it does                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session.ts`            | `createBuilderSession` and the tool definitions (`BUILDER_TOOLS`): the only way Claude touches a build.                                                     |
| `runner.ts`             | `runClaudeBuild`: runs a build through the Anthropic API (`ANTHROPIC_API_KEY`). Its system prompt loads [the build standard](../../docs/build-standard.md). |
| `claude-code-runner.ts` | `runClaudeCodeBuild`: the same build through the Claude Agent SDK, using your local Claude Code login. For personal local use only.                         |
| `render.ts`             | A small software renderer, so Claude can look at its build from any side mid-run without a browser or GPU.                                                  |
| `solver.ts`             | `useHighsSolver`: switches the engine's physics to HiGHS, much faster on real builds.                                                                       |
| `server.ts`             | `createWorkshopServer`: the local server behind the workshop's Generate panel (`pnpm workshop:server`).                                                     |
| `cli.ts`                | The `pnpm claude:build` command.                                                                                                                            |

## Tests

```sh
pnpm test    # from the repository root
```
