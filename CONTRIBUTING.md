# Contributing to omp-claude-bridge

Thanks for your interest in improving **omp-claude-bridge**. Contributions of all
sizes are welcome — bug reports, docs fixes, and features alike.

## Getting set up

```bash
git clone https://github.com/DevVig/omp-claude-bridge.git
cd omp-claude-bridge
bun install
```

Requirements:
- [Bun](https://bun.sh) (required for install and contributor checks)
- Node.js >= 20 (required by the package and Claude Code tooling)
- An Oh My Pi install for end-to-end testing ([omp.sh](https://omp.sh))

## Developing against a live Oh My Pi

Point Oh My Pi at your working copy so changes load on the next run:

```bash
pi install /absolute/path/to/omp-claude-bridge
```

Enable debug logging while iterating:

```bash
CLAUDE_BRIDGE_DEBUG=1 pi --list-models claude-bridge
# logs -> ~/.omp/agent/claude-bridge.log
```

## Checks before opening a PR

```bash
bun run typecheck   # tsc --noEmit
bun run test        # Bun test runner
```

Please make sure both pass. Bun is the required runner for local checks and CI.

## Coding guidelines

- TypeScript, ESM, tabs for indentation (match the surrounding files).
- Keep model routing changes in `src/models.ts`. It has **no runtime imports**,
  so it stays unit-testable in isolation — add a case to
  `tests/unit-context-window.test.mjs` when you touch context routing.
- Context-window behavior follows canonical OMP model metadata and the bridge's
  static defaults, not a locally measured policy. If you change a model mapping,
  explain the metadata/default rationale. Served-window debug lines
  (`result: served contextWindow=...`) remain entitlement diagnostics.

## Reporting bugs

Open an issue using the bug template. A `~/.omp/agent/claude-bridge.log` excerpt
(run with `CLAUDE_BRIDGE_DEBUG=1`) makes bugs far easier to reproduce.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
