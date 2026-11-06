# BRIDGE-1 — review fixes

All findings addressed: H 1/1, M 6/6, L 5/5. Version remains 0.8.2. Final implementation commit: `e0922c6`; this report is a subsequent documentation-only commit. Verification: **47/47 tests**, typecheck passes, actual provider probe passes, **12/12 real generations accepted**.

## Scope and commits

Assigned worktree: `/home/archon/Workspace/omp-claude-bridge/.worktrees/bridge-1`; branch `lane/bridge-1-model-catalog`.

| Finding | Commit | Change and evidence |
| --- | --- | --- |
| H1 | `f2bd8c2` | Successful SDK catalogs are atomically saved in a bridge-owned last-good file. Failure reads it first, then retained metadata; explicit retained `[1m]` ids survive cold fallback. Regression covers a discovery-only future id and unchanged snapshot bytes. |
| M1 | `18f7f13` | One process-local log per hidden alias, naming its exact SDK resolution or known family target. Repeated discovery does not repeat the hint. |
| M2 | `11c2e44` | AskClaude defaults to exact `claude-opus-5-5`, including before discovery. |
| M3 | `6348685` | Exact match precedes substring lookup. Regression selects `claude-sonnet-5` when `claude-sonnet-5-5` appears first. |
| M4 | `bd6a53b` | Routing-only legacy window table for Opus 4.6/4.7/4.8, Sonnet 4.6, Fable 5; no default catalog restoration. CHANGELOG has a Removed entry. |
| M5 | `44e6142` | Restored discovery isolation assertions: `strictMcpConfig: true`, empty `mcpServers`, `ENABLE_CLAUDEAI_MCP_SERVERS=0`. |
| M6 | `a500c28` | Twelve actual one-word generations; documented native 1M serving despite bridge 200K selectors. |
| L1 | `f4575b2` | Unsupported bridge `-200k`/`-1m` variants fail before Claude Code in static/dynamic mode and unresolved AskClaude requests. Known legacy routing policies remain supported. |
| L2 | `48466fe` | `-latest` ids excluded even with alias opt-in; direct routing errors request an exact id. |
| L3 | `6dbf5d3` | Explicit discovery option allowlist; arbitrary provider JSON cannot supply internal timeout/query function options. |
| L4 | `d35ebee` | Executable path accepted only from trusted global config. Global config uses OMP's agent-directory resolver. Temporary config tests prove project paths cannot override or supply it. |
| L5 | `e0922c6` | Actual registered callback forwards alias/window settings; test observes aliases and 200K/1M projected entries, plus default exact-only/auto behavior. |

Each commit ends `Refs cursedrollgames/lab#163`, with no attribution trailers. Earlier implementation commits remain on this branch (`9949e84`, `36feff8`, `25281b3`, `b34332e`, `b8d1274`). No subagents, push, merge, publish, live `omp models refresh`, main-checkout edits, or deliberate writes under the real `~/.omp` were performed. Execution redirected bridge configuration/cache to temporary directories. The untracked review file was not committed; existing symlinks were left intact. Throwaway probe scripts and their temporary directories were removed after verification.

## Discovery failure and OMP caching

Default bridge snapshot: `<OMP agent dir>/claude-bridge-models.json`. It stores raw successful SDK model information, not a particular alias/window projection. A successful, nonempty discovery atomically writes it using a mode-0600 temporary file; a discovery failure never writes it. Current options are reapplied when loading last-good data. If no readable usable snapshot exists, retained exact metadata supplies the fallback, including `claude-fable-5-1[1m]` and the other retained 1M-capable explicit ids. A snapshot write failure is logged and does not discard the freshly discovered result.

**OMP does cache a fallback array.** Installed source evidence:

- `node_modules/@oh-my-pi/pi-coding-agent/src/config/model-registry.ts:3081–3123`: provider callback is wrapped by a manager with `staticModels: []`, a 24-hour TTL, and `dynamicModelsAuthoritative: true`; it receives only an API key, and returns ordinary model rows.
- `node_modules/@oh-my-pi/pi-catalog/src/model-manager.ts:299–372`: any non-null fetched result counts as a successful dynamic fetch; authoritative discovery replaces cached contributions and calls `writeModelCache` with the new timestamp.

There is no bridge-facing “fallback, do not cache” return shape. Last-good data prevents a temporary SDK failure from shrinking a previously saved bridge catalog, but **OMP still renews its TTL when it caches that fallback**. Before the first successful bridge snapshot, only the retained table is available; OMP's separately stored preexisting discovery-only ids cannot be recovered through this callback. No installed OMP files or live registry/cache were modified or refreshed.

## Migration and trust boundaries

Hidden aliases log their exact migration target, for example:

```text
claude-bridge: hidden alias "sonnet" (resolves to claude-sonnet-5-5; use claude-bridge/claude-sonnet-5-5); or set provider.includeAliases: true
```

Migrate roles such as `claude-bridge/sonnet` to the exact id, or explicitly opt into aliases and include them in a static list if applicable. Unknown SDK aliases without resolution cannot truthfully name an exact target; their hint says “exact resolution unavailable.” Opted-in aliases remain moving selectors. `-latest` is rejected independently of alias opt-in. AskClaude accepts explicitly requested family aliases, but never uses bare `opus` as its default.

Removed legacy ids remain available only when explicitly configured or rediscovered, with their historical runtime/window policy. Opus 4.7 remains native-1M-only; Haiku 4.5 remains 200K-only. No obsolete retained defaults or compatibility exports were reintroduced.

Discovery receives only `pathToClaudeCodeExecutable`, `settingSources`, `includeAliases`, normalized `contextWindow`, and current `cwd`. The executable comes exclusively from global config; project values are ignored for discovery and generation alike. MCP isolation is enforced during discovery regardless of provider settings. This does not claim that all filesystem Claude settings/hooks are sandboxed: configured `settingSources` remain a separate trust surface.

## Verification

Executed after all implementation changes:

```text
bun test
47 pass
0 fail
Ran 47 tests across 7 files.

bun run typecheck
$ tsc --noEmit
(exit 0)
```

Regressions were observed failing before fixes for unsupported variants, `-latest`, arbitrary discovery option injection, and project executable override. Earlier focused checks cover last-good retention, exact-first resolution, alias migration hints, legacy policies, and MCP isolation. New tests use isolated temporary directories or separate Bun processes for module mocks; no test writes the default bridge snapshot under the actual agent directory.

### Real provider probe

Executed `CLAUDE_BRIDGE_DEBUG=0 bun tests/.bridge-review-provider.mts` against the worktree's actual extension registration and the real SDK/Claude executable. A temporary global agent config supplied the trusted executable and `settingSources: []`; a deliberately invalid project executable was ignored. No OMP model manager was instantiated.

Observed output:

```text
MODE dynamic: 16 models
claude-opus-5-5 | 1000000 | 128000 | low,medium,high,xhigh
claude-opus-5-5-200k | 200000 | 128000 | low,medium,high,xhigh
claude-sonnet-5-5 | 1000000 | 128000 | low,medium,high,xhigh
claude-sonnet-5-5-200k | 200000 | 128000 | low,medium,high,xhigh
claude-haiku-5-5 | 1000000 | 128000 | low,medium,high,xhigh
claude-haiku-5-5-200k | 200000 | 128000 | low,medium,high,xhigh
claude-fable-5-1 | 1000000 | 128000 | low,medium,high,xhigh
claude-fable-5-1-200k | 200000 | 128000 | low,medium,high,xhigh
claude-sonnet-5 | 1000000 | 128000 | low,medium,high,xhigh
claude-sonnet-5-200k | 200000 | 128000 | low,medium,high,xhigh
claude-haiku-4-5 | 200000 | 64000 | low,medium,high,xhigh
claude-opus-5-5[1m] | 1000000 | 128000 | low,medium,high,xhigh
claude-sonnet-5-5[1m] | 1000000 | 128000 | low,medium,high,xhigh
claude-haiku-5-5[1m] | 1000000 | 128000 | low,medium,high,xhigh
claude-fable-5-1[1m] | 1000000 | 128000 | low,medium,high,xhigh
claude-sonnet-5[1m] | 1000000 | 128000 | low,medium,high,xhigh
MODE aliases-200k: 20 models
MODE warm-failure: 16 models; last-good bytes unchanged
MODE cold-failure: 16 models; explicit retained 1M resolvable
MODE static: 8 models; warnings=0
PROVIDER PROBE PASS
```

Hidden aliases `default`, `opus`, `sonnet`, `haiku` each logged one exact migration hint. Invalid trusted executable produced one failure warning per attempt, first naming last-good, then retained fallback after removal of the temporary snapshot. The warm-failure probe asserted full catalog equality and byte-for-byte snapshot preservation. Static mode did not run discovery.

### Real generations — Claude Code 2.1.317

Executed `CLAUDE_BRIDGE_DEBUG=0 bun tests/.bridge-review-generations.mts`. Executable: `/home/archon/.local/bin/claude`. Each query requested exactly `OK`, one turn, low effort, no tools, no filesystem setting sources, no session persistence, strict empty MCP, cloud MCP disabled, and a temporary working directory. The base-form probe sent the literal bare selector; bridge `-200k` forms were translated through production routing, and explicit `[1m]` was passed unchanged.

| Requested form | Claude Code selector | Reply | Reported context | Runtime max output |
| --- | --- | --- | ---: | ---: |
| `claude-opus-5-5` | `claude-opus-5-5` | OK | 1000000 | 128000 |
| `claude-opus-5-5-200k` | `claude-opus-5-5` | OK | 1000000 | 128000 |
| `claude-opus-5-5[1m]` | `claude-opus-5-5[1m]` | OK | 1000000 | 128000 |
| `claude-sonnet-5-5` | `claude-sonnet-5-5` | OK | 1000000 | 128000 |
| `claude-sonnet-5-5-200k` | `claude-sonnet-5-5` | OK | 1000000 | 128000 |
| `claude-sonnet-5-5[1m]` | `claude-sonnet-5-5[1m]` | OK | 1000000 | 128000 |
| `claude-haiku-5-5` | `claude-haiku-5-5` | OK | 1000000 | 128000 |
| `claude-haiku-5-5-200k` | `claude-haiku-5-5` | OK | 1000000 | 128000 |
| `claude-haiku-5-5[1m]` | `claude-haiku-5-5[1m]` | OK | 1000000 | 128000 |
| `claude-fable-5-1` | `claude-fable-5-1` | OK | 1000000 | 64000 |
| `claude-fable-5-1-200k` | `claude-fable-5-1` | OK | 1000000 | 64000 |
| `claude-fable-5-1[1m]` | `claude-fable-5-1[1m]` | OK | 1000000 | 64000 |

All returned success and canonical served models matching the requested release. Claude Code did **not** receive literal `-200k` selectors; these are OMP-facing bridge variants. All twelve reported 1M in `result.modelUsage.contextWindow`, so `-200k` changes OMP's context/compaction threshold, **not** a Claude Code server cap. This is runtime metadata from minimal real requests, not a million-token capacity stress test.

The picker advertises maximum output, not necessarily Claude Code's runtime default. Installed pi-ai supplies Opus/Fable/Sonnet 5/Haiku 4.5 metadata; installed Claude Code's bundled catalog supplements missing Sonnet/Haiku 5.5 entries. Fable's catalog upper limit is 128K while the observed runtime default is 64K. SDK discovery reported adaptive thinking with `low`, `medium`, `high`, `xhigh`, `max`; the picker exposes OMP-native low through xhigh without remapping, while AskClaude preserves separate max.

## Evaluation and handoff

Accuracy 5/5: full tests, actual callback probe, installed OMP cache source, and generation results ground the claims; metadata-versus-capacity limits are explicit. Completeness 5/5: every named finding has a commit and evidence. Clarity 4/5: served context and OMP compaction policy are distinct. Actionability 5/5: exact alias targets, global-only executable policy, and remaining cache TTL behavior are documented. Conciseness 4/5: full catalog and generation evidence retained for review. No independent agent review was dispatched because this worker forbids subagents.

The root `REPORT-BRIDGE-1.md` symlink exposes this committed report. The boundary uses the tested implementation sha; final chat identifies the later report commit.

SLICE-BOUNDARY: BRIDGE-1 omp-claude-bridge lane/bridge-1-model-catalog@e0922c6 — review fixes H 1/1 M 6/6 L 5/5, tests 47/47, typecheck pass yes, real generations 12/12 accepted
