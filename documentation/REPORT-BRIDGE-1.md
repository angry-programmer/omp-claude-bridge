Summary: Implemented the BRIDGE-1 exact-model catalog in version 0.8.2. Default discovery exposes current exact selectors, retains required legacy versions, supplies known static metadata, and falls back to retained exact entries on discovery failure. Full tests pass 33/33; typecheck passes; an isolated real-SDK provider probe passes.

## Scope and commits

Branch: `lane/bridge-1-model-catalog` in the assigned `bridge-1` worktree. Tested implementation commit: `b34332e`.

1. `9949e84` — aliases hidden unless explicitly enabled.
2. `36feff8` — current retained metadata, window variants, and routing.
3. `25281b3` — safe discovery-failure fallback.
4. `b34332e` — version 0.8.2 and release documentation.

Each implementation commit uses a conventional message ending `Refs cursedrollgames/lab#163`, without attribution trailers. No sub-agents, push, merge, publish, live `omp models refresh`, main-checkout edits, or writes under the real `~/.omp` were performed. The existing untracked `node_modules` symlink was left untouched.

## Behavior

- `provider.includeAliases` defaults to false. SDK `value` and `resolvedModel` selectors are included only when versioned; aliases such as `opus`, `sonnet`, `haiku`, `default`, and `opus[1m]` require explicit opt-in. This filter also applies to `provider.models`.
- Retained base ids are `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`, `claude-sonnet-5`, and `claude-haiku-4-5`. Obsolete retained Opus 4.x, Sonnet 4.6, and Fable 5 defaults were removed; Opus 5 was not added.
- The four current releases default to 1M, with `-200k` alternatives. Under `contextWindow: "200k"`, base ids advertise 200K and `-1m` alternatives remain selectable. Explicit `[1m]` selectors stay exact and advertise 1M. Sonnet 5 retains both windows; Haiku 4.5 remains 200K only.
- Dynamic retained entries use the same variant rules as static entries. Routing translates picker variants rather than sending `-200k` as part of a Claude model version. Haiku 4.5 remains routable under the 1M preference because its sole available window is 200K.
- Discovery startup errors, empty results, and timeouts produce one warning per attempted discovery and return retained exact entries with metadata. OMP's callback exposes no cache-state argument, so this safe fallback also applies to attempted warm-cache refreshes; it does not restore stale aliases. A fresh OMP cache can bypass discovery until its 24-hour TTL expires.
- README, example JSON, configuration types, and CHANGELOG document the opt-in and metadata/window behavior. `package.json` is 0.8.2.

### Existing alias configurations

An OMP role such as `claude-bridge/sonnet` cannot resolve a selector hidden from the registry. Migrate the role to `claude-bridge/claude-sonnet-5-5`, or explicitly enable `provider.includeAliases: true`; a deliberately static catalog must also include `sonnet` in `provider.models`. Opted-in aliases are passed unchanged to Claude Code. AskClaude still accepts direct aliases independently of catalog visibility.

This chooses the brief's permitted documented migration behavior rather than the recommended transparent alias-to-exact routing warning. No exact resolved-id warning is emitted for alias use. An installation with an old warm OMP catalog may retain old cached entries until cache expiry or an operator-authorized refresh; no live refresh was attempted here.

## Metadata evidence

Real executable: `/home/archon/.local/bin/claude`; observed version: `2.1.317 (Claude Code)`.

Its real SDK `supportedModels()` resolved aliases to Opus/Sonnet/Haiku 5.5 and Fable 5.1. All four reported adaptive thinking and effort names `low`, `medium`, `high`, `xhigh`, `max`. The picker projects only OMP-native `low` through `xhigh` without effort remapping; AskClaude continues to support separate `max`.

Max-output metadata comes from installed pi-ai for Opus 5.5, Fable 5.1, Sonnet 5, and Haiku 4.5. Installed pi-ai has no Sonnet/Haiku 5.5 entries, and SDK `ModelInfo` does not expose output limits. For those two releases, the supplementary primary source was the installed Claude Code 2.1.317 binary's bundled model catalog: both entries specify `max_output_tokens: { default: 128000, upper: 128000 }` and native 1M context. Fable's pi-ai upper limit is 128,000 although Claude Code's baked default is 64,000; the bridge advertises maximum output, not the CLI default.

Retained fallback metadata keeps these limits and thinking capabilities available without a current pi-ai entry. Pi-ai cost metadata is used when present; absent cost metadata remains the bridge's existing zero-cost fallback.

## Verification

Executed after implementation and release changes:

```text
bun test
33 pass
0 fail
Ran 33 tests across 4 files.

bun run typecheck
$ tsc --noEmit
(exit 0)

release version: 0.8.2
```

New regression coverage exercises default/opted-in aliases, all current release windows under auto/1m/200k, static retained ids without warnings, explicit Fable 5.1[1m], dynamic variant routing, and discovery exception/empty/timeout fallback with exactly one warning. The window tests failed against the old implementation; fallback tests failed before recovery was implemented.

### Real provider probe

Executed `CLAUDE_BRIDGE_DEBUG=0 bun tests/.bridge-1-probe.mts`. The throwaway script imported the worktree's actual `src/index.ts`, captured its `registerProvider` configuration, and invoked the registered `fetchDynamicModels` callback against the real SDK/executable. It used a temporary project `.omp/claude-bridge.json` outside the live checkout, disabled AskClaude and filesystem setting sources, and removed its temporary directory in `finally`. No OMP registry/cache was instantiated. The script was removed after the smoke run.

The same script asserted metadata/routing for the current releases in four modes: real dynamic discovery, alias opt-in, an explicit static list, and an invalid executable path with no cache. Observed output:

```text
MODE dynamic: 12 models; warnings=0
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
claude-fable-5-1[1m] | 1000000 | 128000 | low,medium,high,xhigh
MODE aliases: 16 models; warnings=0
MODE static: 12 models; warnings=0
MODE failure: 11 models; warnings=1
claude-bridge: model discovery failed; using retained exact catalog: Claude Code native binary not found at /tmp/bridge-1-probe-k1Ocq3/missing-claude. Please ensure Claude Code is installed via native installer or specify a valid path with options.pathToClaudeCodeExecutable.
```

The initialization-only probe verifies advertised provider metadata and outgoing selector translation, not generation-time served context. The requested 200K variants preserve the existing bare-id convention, while 1M requests use `[1m]`. Claude Code's native-1M catalog metadata is not proof that a bare selector enforces a 200K server cap; that enforcement was not measured. No paid generation or entitlement probe was performed.

## Evaluation and handoff

Accuracy 4/5: tests and real SDK output ground the catalog claims; served-window enforcement is explicitly unmeasured. Completeness 5/5: all named changes and verification scenarios are covered, with the optional alias recommendation's alternative documented. Clarity 4/5: separate SDK capability evidence from pi-ai and bundled output-limit evidence. Actionability 4/5: commits and exact role migration are provided; deployment/cache refresh remains the owner's action. Conciseness 4/5: full probe output is retained as required. Overall 4.2/5. Highest-impact handoff cautions: migrate hidden alias roles and account for existing warm caches before evaluating a rollout. Independent review was not dispatched because this lane forbids sub-agents.

The boundary below identifies the tested implementation commit; the report itself is a later documentation-only commit. A root working copy is supplied, with the committed report under `documentation/REPORT-BRIDGE-1.md` to match the repository's documentation location.

SLICE-BOUNDARY: BRIDGE-1 omp-claude-bridge lane/bridge-1-model-catalog@b34332e — aliases hidden by default yes, 5.5 ids 1M yes, static-mode warnings 0 yes, discovery fallback yes, tests 33/33, typecheck pass yes
