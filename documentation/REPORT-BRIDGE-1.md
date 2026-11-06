# BRIDGE-1 — re-review acceptance

Re-review findings addressed: **MEDIUM 1/1, LOW 4/4**. Version remains 0.8.2. Tested implementation: `18e64f6`; this report is a subsequent documentation-only commit. Final verification: **56/56 tests**, typecheck passes, real provider probe passes, generation-option boundary smoke passes.

## Scope and commits

Worktree: `/home/archon/Workspace/omp-claude-bridge/.worktrees/bridge-1`; branch `lane/bridge-1-model-catalog`.

| Finding | Commit | Result |
| --- | --- | --- |
| MEDIUM-1 | `e2838e1` | Discovery always uses no filesystem settings. Global config defines generation settings/MCP trust ceilings; projects may tighten but cannot loosen them, and loosening warns. Provider and AskClaude honor effective settings regardless of appendSystemPrompt. SECURITY.md documents remaining trust. |
| LOW-1 + requested cache tests | `e38f8a6` | Snapshot envelope `{version: 1, savedAt, models}` checked on read; accepted fallback warns with age. Tests cover mode 0600, invalid envelopes, successful discovery despite a save failure, and temporary-file cleanup. |
| LOW-2 | `65c3249` | Explicit `[1m]` picker rows say `(1M, explicit)` in static, discovered, and fallback catalogs; ids and routing unchanged. |
| LOW-3 | `1f2f13f` | Hints only for aliases in static bridge config or configured OMP model roles. Role hints run at registration, including warm-cache startup. Family targets derive from the retained list; no literal family-version map or unconfigured SDK-alias warnings. |
| LOW-4 | `18e64f6` | Trusted global config uses native account/launch home, not dotenv-sensitive getAgentDir(). Actual Bun attack tests cover agent-dir and HOME redirection. |

All commits end `Refs cursedrollgames/lab#163`, without attribution trailers. Both review files remain uncommitted. No subagents, push, merge, publish, live OMP refresh, main-checkout edits, or deliberate writes under the actual `~/.omp` were performed. Probe configuration/state used temporary directories; probe scripts/directories were removed after smoke proof. Existing symlinks remain untouched.

The previous review's H 1/1, M 6/6, L 5/5 fixes remain: commits `f2bd8c2`, `18f7f13`, `11c2e44`, `6348685`, `bd6a53b`, `44e6142`, `a500c28`, `f4575b2`, `48466fe`, `6dbf5d3`, `d35ebee`, `e0922c6`; previous report commit `95a1e4b`.

## Settings and remaining trust

- Discovery unconditionally sets `settingSources: []`, `strictMcpConfig: true`, `mcpServers: {}`, and `ENABLE_CLAUDEAI_MCP_SERVERS=0`. There is no discovery settingSources override, even from global config.
- Generation defaults to `settingSources: []` and strict MCP. Global config may explicitly enable sources or disable provider strict MCP. A project's source list is intersected with globally allowed sources; project strict mode may only change false to true. Attempts to add sources or disable globally required strict mode warn and are ignored.
- Provider generation no longer omits settingSources when appendSystemPrompt is enabled. AskClaude uses the same effective source ceiling and always stays strict for MCP.
- The executable remains global-only. Trusted global config is `<native account/launch home>/.omp/agent/claude-bridge.json`, independent of cwd dotenv and OMP agent/config/profile overrides. Legitimate custom profile/agent-dir users must put trusted bridge settings in that home-anchored file; project config cannot select another trusted file. Catalog state still follows OMP's agent directory.
- This is a configuration boundary, not an OS sandbox. Globally enabled Claude settings authorize their hooks/environment, and globally disabled provider strict MCP authorizes filesystem MCP commands. Current process environment may itself contain cwd dotenv values; it is still inherited by SDK children. PATH-based executable resolution, OMP project extensions, the runtime/SDK/CLI, and authorized tools remain separate trust surfaces. SECURITY.md states these limits explicitly.

## LOW-4: installed OMP/Bun investigation on Olympus

Observed host: `olympus`; installed OMP package version **18.2.11**; `/home/archon/.bun/bin/bun` version **1.3.10**. Source audit used the installed OMP TypeScript and upstream Bun sources pinned to the installed version; no local Bun source checkout was found.

**A cwd .env can move getAgentDir().** Installed evidence:

1. `node_modules/@oh-my-pi/pi-utils/src/dirs.ts:328–334,440–449` reads `process.env.PI_CODING_AGENT_DIR` into the default resolver and resolves it as the agent directory. Profile/config-root selection also reads environment variables.
2. `node_modules/@oh-my-pi/pi-utils/src/env.ts:287–314` eagerly merges project dotenv values and then calls `refreshDirsFromEnv()`. Its comments at 110–125 separately explain Bun's pre-application dotenv loading and Linux's original exec-environment snapshot.
3. Bun 1.3.10 [`src/env_loader.zig:580–605,693–694`](https://github.com/oven-sh/bun/blob/bun-v1.3.10/src/env_loader.zig#L580-L605) loads default dotenv files when not disabled, including `.env`.

A real Bun child launched in a temporary project with `PI_CODING_AGENT_DIR=<malicious-agent>` in `.env` reported that exact agent directory. Before the fix, the regression read `/malicious/claude` from its supposed global config; after the fix, it reads the controlled trusted-home file and retains its no-settings/strict-MCP policy. Only the native home boundary is mocked in that fixture; dotenv loading, installed resolver, and bridge config loading are real.

**HOME requires a distinction.** Bun's [`node_os.zig:930–938`](https://github.com/oven-sh/bun/blob/bun-v1.3.10/src/bun.js/node/node_os.zig#L930-L938) implements userInfo().homedir through its native homedir lookup, whose [`lines 304–330`](https://github.com/oven-sh/bun/blob/bun-v1.3.10/src/bun.js/node/node_os.zig#L304-L330) consider native HOME before passwd fallback. Thus inherited launcher HOME remains trusted; it is not safe to describe this as ignoring every possible HOME override. However cwd dotenv values enter Bun's JS environment without changing the observed native home lookup on this installed runtime. With inherited HOME removed and a cwd `.env` defining HOME, the actual runtime printed:

```text
{"dotenvHome":"/tmp/bridge-native-env-zPUMJl","nativeHome":"/home/archon","userHome":"/home/archon","agentEnv":"/tmp/bridge-native-env-zPUMJl/agent"}
```

A separate native-Bun regression, with no OS mock, places a random malicious executable path under dotenv HOME and verifies bridge config never selects it. An inherited `HOME=/tmp/bridge-untrusted-home` probe did affect both native home APIs, confirming the launcher/cwd distinction rather than assuming Node documentation exactly describes Bun. No helper subprocess is required in production.

## Snapshot behavior and OMP cache limits

The bridge atomically replaces `claude-bridge-models.json` under OMP's agent directory only after successful nonempty discovery. The envelope has numeric `version: 1`, `savedAt` in Unix epoch milliseconds, and raw SDK `models`. Read validation rejects unsupported versions, nonnumeric/nonfinite/nonpositive/future timestamps, missing/empty model arrays, and entries lacking string ids. Projection failures also fall back safely. Old bare-array snapshots are deliberately rejected; the next successful discovery writes the new format.

On SDK failure: load and reproject a valid snapshot with current alias/window options, otherwise use retained exact metadata, including every retained 1M-capable explicit `[1m]` id. The warning names the fallback and accepted snapshot age in seconds. Failures never rewrite snapshot bytes. Save failures warn but return the freshly discovered catalog; temporary files are cleaned up. Regression verifies mode `0600` and a deterministic rename failure against a directory without relying on permissions/root behavior.

OMP still caches an ordinary fallback array for 24 hours. Installed `pi-coding-agent/src/config/model-registry.ts:3081–3123` supplies `staticModels: []`, authoritative dynamic models, and a 24-hour TTL; installed `pi-catalog/src/model-manager.ts:299–372` treats a non-null callback result as success and writes a new cache timestamp. There is no bridge-facing “fallback, do not cache” result shape. Consequently snapshot age may grow across repeated OMP TTL renewals; the warning now exposes that staleness. Before the first successful bridge snapshot, discovery-only ids from OMP's separately stored old cache cannot be recovered through this callback. No installed OMP source or live cache was changed.

## Final verification

Executed after all implementation changes:

```text
bun test
56 pass
0 fail
Ran 56 tests across 7 files.

bun run typecheck
$ tsc --noEmit
(exit 0)
```

New failures were observed before implementing project-source/MCP ceilings, unconditional discovery isolation, the snapshot envelope/age behavior, distinct picker labels, config-only/warm-cache alias hints, and trusted config's independence from getAgentDir(). Mode/save-failure tests confirm existing safety properties. An obsolete exact display-wording assertion was removed instead of repinning it; the label test checks the actual ambiguity, context and routing.

### Real provider probe

Executed `CLAUDE_BRIDGE_DEBUG=0 bun tests/.bridge-rereview-probe.mts` through actual extension registration and the real Agent SDK/executable. Temporary trusted-home configuration and OMP state were distinct directories. The native home boundary was redirected solely to avoid touching actual home configuration; merging, actual provider callback, SDK, filesystem permissions, and catalog projection remained real. No OMP model manager was instantiated.

The temporary project requested an invalid executable, extra settings sources and non-strict MCP, and contained a SessionStart hook writing a temporary sentinel. The trusted global executable won; both loosening attempts warned; the sentinel was not created. Only configured role alias `sonnet` emitted a migration hint, once; unconfigured SDK aliases did not warn. Observed output:

```text
MODE dynamic: 16 models; project hook not executed
claude-opus-5-5 | Claude Opus 5.5 (1M) | 1000000 | 128000 | low,medium,high,xhigh
claude-opus-5-5-200k | Claude Opus 5.5 (200K) | 200000 | 128000 | low,medium,high,xhigh
claude-sonnet-5-5 | Claude Sonnet 5.5 (1M) | 1000000 | 128000 | low,medium,high,xhigh
claude-sonnet-5-5-200k | Claude Sonnet 5.5 (200K) | 200000 | 128000 | low,medium,high,xhigh
claude-haiku-5-5 | Claude Haiku 5.5 (1M) | 1000000 | 128000 | low,medium,high,xhigh
claude-haiku-5-5-200k | Claude Haiku 5.5 (200K) | 200000 | 128000 | low,medium,high,xhigh
claude-fable-5-1 | Claude Fable 5.1 (1M) | 1000000 | 128000 | low,medium,high,xhigh
claude-fable-5-1-200k | Claude Fable 5.1 (200K) | 200000 | 128000 | low,medium,high,xhigh
claude-sonnet-5 | Claude Sonnet 5 (1M) | 1000000 | 128000 | low,medium,high,xhigh
claude-sonnet-5-200k | Claude Sonnet 5 (200K) | 200000 | 128000 | low,medium,high,xhigh
claude-haiku-4-5 | Claude Haiku 4.5 (200K) | 200000 | 64000 | low,medium,high,xhigh
claude-opus-5-5[1m] | Claude Opus 5.5 (1M, explicit) | 1000000 | 128000 | low,medium,high,xhigh
claude-sonnet-5-5[1m] | Claude Sonnet 5.5 (1M, explicit) | 1000000 | 128000 | low,medium,high,xhigh
claude-haiku-5-5[1m] | Claude Haiku 5.5 (1M, explicit) | 1000000 | 128000 | low,medium,high,xhigh
claude-fable-5-1[1m] | Claude Fable 5.1 (1M, explicit) | 1000000 | 128000 | low,medium,high,xhigh
claude-sonnet-5[1m] | Claude Sonnet 5 (1M, explicit) | 1000000 | 128000 | low,medium,high,xhigh
SNAPSHOT version=1; mode=600
MODE aliases-200k: 20 models
MODE warm-failure: 16 models; last-good bytes unchanged
MODE cold-failure: 16 models; explicit retained 1M resolvable
MODE static: 9 models; warnings=0
RE-REVIEW PROVIDER PROBE PASS
```

The deliberately aged snapshot produced `using last-good exact catalog (age 120s)` on executable failure; cold failure named the retained catalog. Static mode included one explicit entry to check its name against the base entry and did not run discovery.

### Generation-option smoke

Executed `CLAUDE_BRIDGE_DEBUG=0 bun tests/.bridge-rereview-generation-smoke.mts`. This exercised the registered provider stream and AskClaude tool with a query-boundary SDK stub, **not a new network generation**. Real config merging rejected project `settingSources: ["user", "project"]` and `strictMcpConfig: false` against global sources `["user"]` and strict true. Both paths passed only `["user"]` and strict MCP to the query for either appendSystemPrompt value:

```text
GENERATION BOUNDARY provider+AskClaude: appendSystemPrompt=false; sources=user; strict=true
GENERATION BOUNDARY provider+AskClaude: appendSystemPrompt=true; sources=user; strict=true
GENERATION BOUNDARY SMOKE PASS (SDK query stub; no network generation)
```

### Prior real generation evidence retained

The preceding review pass ran twelve actual one-word requests through Claude Code **2.1.317** at `/home/archon/.local/bin/claude`. All returned `OK` with matching canonical releases; these paid probes were not repeated in this re-review.

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

Bridge `-200k` variants translate to bare selectors and control OMP's compaction threshold, not a Claude Code server context cap. These were minimal requests reporting runtime metadata, not a million-token stress test. Picker maximum output is not necessarily the CLI default: Fable's catalog upper limit is 128K, observed runtime default 64K. Installed pi-ai supplies current retained metadata where available; the installed Claude Code catalog supplements missing Sonnet/Haiku 5.5 entries. SDK efforts remain exact, with OMP-native low through xhigh in the picker and separate max through AskClaude.

## Evaluation and handoff

Accuracy 4/5: tests and real probes ground the claims; Bun's native HOME distinction is runtime/version-specific and explicitly bounded. Completeness 5/5: all five findings, requested permission/save-error coverage, source investigation, and acceptance commands are covered. Clarity 4/5: the trust boundary has several layers, now separated into settings, launcher environment, and model state. Actionability 5/5: exact commits, global path change, cache behavior and trust limits are documented. Conciseness 4/5: full catalog and historical generation evidence retained for review. Overall 4.4/5. Highest-impact cautions: custom profile users must migrate trusted bridge config to the home-anchored path; do not treat these changes as sanitizing OMP/project environment or extensions. Would the user agree? The requested evidence and limits are explicit; rollout/integration remains the owner's action. No independent subagent review was dispatched because this lane forbids subagents.

The root `REPORT-BRIDGE-1.md` symlink exposes this committed report. The boundary identifies tested implementation; final chat identifies the later report commit.

SLICE-BOUNDARY: BRIDGE-1 omp-claude-bridge lane/bridge-1-model-catalog@18e64f6 — re-review fixes M 1/1 L 4/4, tests 56/56, typecheck pass yes
