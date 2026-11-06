Summary: Security re-review findings addressed: **MEDIUM 2/2, LOW 3/3**. Version remains 0.8.2. Verified implementation: `b01ff14`; this report and README/changelog updates follow in a documentation-only commit. **69/69 tests**, typecheck passes, real provider probe passes, real generation returns `OK`.

## Scope and commits

Worktree: `/home/archon/Workspace/omp-claude-bridge/.worktrees/bridge-1`; branch `lane/bridge-1-model-catalog`.

| Finding | Commits | Result |
| --- | --- | --- |
| MEDIUM-A | `e632379`, `b392ff6` | Global enabled/full-mode ceilings; projects may only disable them. Unauthorized full defaults and malformed defaults become read mode. Explicit unauthorized full requests reject before SDK query. Name/description are global-only. |
| MEDIUM-B | `055f9f8`, `ddc919f` | One environment helper covers discovery, provider/continuation, AskClaude and compact summaries. Minimal discovery allowlist; generation denylist; authoritative launcher values restored; global-only exact-name trustedEnv; names-only removal logging. Missing provenance fails closed. |
| LOW-A | `75e2f8f`, `b01ff14` | Committed Bun subprocess test retains real loadConfig and drives registered provider stream plus AskClaude for both appendSystemPrompt values. Verifies settings sources, strict MCP, executable, environment filtering, identity and full-mode rejection. Test launcher removes its two synthetic attack names for determinism. |
| LOW-B | `f1c40e3` | Snapshot beside trusted config; O_NOFOLLOW + O_NONBLOCK, fstat regular-file check, bounded 1-MB read including concurrent growth. Tests reject symlink, directory, FIFO, /dev/zero and oversized files. |
| LOW-C | `ca88b48` | Non-object JSON becomes {}; non-array settingSources becomes [] and warns. POSIX account lookup uses passwd home, not HOME; native/passwd mismatch warns. |

All commits end `Refs cursedrollgames/lab#163`, without attribution trailers. All three review files remain uncommitted. No subagents, task tool, push, merge, publish, live OMP refresh, main-checkout edits, or actual ~/.omp writes. Temporary probe files/state were removed; existing symlinks remain untouched. Root REPORT-BRIDGE-1.md exposes this committed documentation file.

Previous original-review and second-review fixes remain in history; the previous acceptance report is preserved in `ce2403f`. This report supersedes its native-home and inherited-environment trust claims.

## Trusted policy and home lookup

Trusted config and snapshot are `<passwd home>/.omp/agent/{claude-bridge.json,claude-bridge-models.json}` on POSIX. OMP agent/profile overrides, cwd dotenv HOME and inherited launcher HOME cannot relocate them. Ordinary project settings still merge, but security policy only tightens:

- settingSources intersects global sources; strictMcpConfig cannot become false unless globally allowed. Loosening warns. Discovery always uses [], strict MCP, empty mcpServers and disabled cloud MCP.
- AskClaude enabled/allowFullMode are global ceilings. Default full without permission becomes read; invalid default modes also become read instead of falling through to an unrestricted tool list. Explicit full is rejected when disallowed. Tool name/description and executable are global-only.
- Non-object top-level JSON is empty config. Non-array settingSources is [] with a warning.

**Bun userInfo is not passwd-backed on the installed runtime.** Upstream Bun 1.3.10 [userInfo implementation](https://github.com/oven-sh/bun/blob/bun-v1.3.10/src/bun.js/node/node_os.zig#L930-L938) calls its [native homedir lookup](https://github.com/oven-sh/bun/blob/bun-v1.3.10/src/bun.js/node/node_os.zig#L304-L330), which considers HOME before passwd. Therefore production now uses an absolute account-lookup binary with an empty environment: Linux `/usr/bin/getent passwd <uid>` (NSS), macOS `/usr/bin/id -P <uid>`. Lookup failure fails closed; UID and absolute home are checked. Windows retains native account-home lookup. Linux was exercised; other OS paths were not run.

The actual Olympus lookup returned account home `/home/archon`. An unmocked Bun child with inherited HOME=/untrusted-home still selected `/home/archon/.omp/agent` and emitted the mismatch warning. The existing unmocked cwd-dotenv HOME guard remains. Config fixtures substitute only OS account lookup; real parsing/merging and installed OMP directory resolution run normally.

Installed OMP 18.2.11 still allows cwd dotenv to move getAgentDir(): pi-utils `src/dirs.ts:328–334,440–449` uses PI_CODING_AGENT_DIR; `src/env.ts:287–314` loads dotenv then refreshes directory state. Bun [env_loader.zig](https://github.com/oven-sh/bun/blob/bun-v1.3.10/src/env_loader.zig#L580-L605) also loads dotenv before application code. Neither trusted bridge file now uses that resolver. Custom agent/profile users must place trusted bridge policy in the passwd-home file.

## Child environment investigation and policy

Installed source inspected: `node_modules/@oh-my-pi/pi-utils/src/env.ts:110–134,153–247`.

- OMP privately captures Linux's original `/proc/self/environ`; its public filterChildShellEnv(process.env, cwd) restores launcher values overwritten by dotenv and removes project dotenv additions. The launch map itself is not exported.
- The bridge uses that public filter for discovery's baseline and the same authoritative Linux exec boundary to distinguish denied launcher names from runtime additions. Preserved launcher values are restored from the original exec environment, never from an overwritten process.env value.
- Without procfs/non-Linux, denied names fail closed unless globally trusted. A --no-env-file flag alone is not accepted as provenance: OMP can load dotenv after Bun startup. A subprocess regression exercises that branch; it is not a native macOS run.

Claude's [environment reference](https://code.claude.com/docs/en/env-vars) and installed Agent SDK bundle identify first-party auth names **ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN**. They are discovery's only auth-variable allowlist, with launcher provenance required. Olympus's current process exposed none of those names; real discovery/generation succeeded using ordinary account-file login. No credential values were printed.

Discovery allows only PATH, HOME, USER, LANG, LC_*, TMPDIR, TERM plus those launcher auth names, or exact globally trusted names. It does not implicitly enable proxies, alternative credential directories or third-party provider selection.

Generation/AskClaude/compact retain process.env minus ANTHROPIC_*_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_CONFIG_DIR, *_PROXY/*_proxy, NODE_EXTRA_CA_CERTS, NODE_OPTIONS, BASH_ENV, ENV, CLAUDE_CODE_SHELL_PREFIX and CLAUDE_CODE_USE_*. Original launcher values survive generation. Global provider.trustedEnv re-allows exact current names in all modes, including project dotenv values; project trustedEnv is ignored. HOME is pinned to passwd home unless globally listed. Removal logging contains names only.

Installed `@anthropic-ai/claude-agent-sdk/sdk.mjs` transport destructures an explicit env (defaulting to process.env only when omitted), then passes it directly to child_process.spawn. It does **not** merge removed parent keys back into the supplied environment. Real sanitized discovery confirms the account still works.

Remaining trust is explicit in SECURITY.md: this is the selected denylist, not an OS/environment sandbox. Unlisted environment variables, PATH resolution, the SDK/CLI and selected executable, Claude managed policy, OMP's own project-extension/settings loading and globally authorized hooks/tools remain trusted. Global trustedEnv and globally enabled settings are deliberate opt-ins. New upstream environment knobs require policy review.

## Snapshot integrity and OMP cache limitation

Only successful nonempty discovery atomically replaces the version-1 envelope `{version: 1, savedAt, models}` with mode 0600. Reads require a regular no-follow file, cap bytes at 1 MB, and validate version/timestamp/model entries. Accepted fallback warnings include age. Failed discovery never rewrites saved bytes; save failure warns but still returns the fresh catalog and removes temporary files. Existing mode/save-error regressions pass.

Fallback order: bridge last-good snapshot, then retained exact catalog, including retained [1m] ids. No fallback aliases unless explicitly opted in on a valid saved catalog.

OMP still caches an ordinary fallback array for 24 hours. Installed pi-coding-agent `src/config/model-registry.ts:3081–3123` configures authoritative dynamic models and the TTL; pi-catalog `src/model-manager.ts:299–372` treats a non-null callback result as success and stamps a new cache time. No bridge-facing non-cacheable fallback result exists. The protected snapshot preserves catalog contents but cannot stop OMP renewing that fallback TTL. No installed source/live cache changed.

## Final verification

Executed on Olympus with Bun 1.3.10 after the final behavioral/test changes:

```text
bun test
69 pass
0 fail
Ran 69 tests across 9 files.

bun run typecheck
$ tsc --noEmit
(exit 0)
```

New regressions failed before fixes for malformed config, inherited HOME selection, AskClaude ceilings, malformed default-mode escalation, hostile snapshot reads, and missing launcher provenance. Environment tests cover every denied pattern, first-party OAuth/API auth, preserved/restored launcher values, exact trusted-name opt-in, minimal discovery, and names-only logs. Generation coverage is now permanent rather than a deleted smoke script. Obsolete whole-warning-count assertions were removed; diagnostics are checked independently of unrelated environment-removal notices.

### Real provider/security probe

Ran `CLAUDE_BRIDGE_DEBUG=0 bun tests/.bridge-security-probe.mts` against the worktree's actual registered provider and real SDK/native executable `/home/archon/.local/bin/claude` (previously observed 2.1.317). Only trusted bridge policy/state storage was redirected to a temporary fixture; account HOME and Claude login stayed real. No OMP model manager/live refresh was instantiated.

The project requested an invalid executable, additional settings sources, non-strict MCP, full-mode default and trusted endpoint environment. Its SessionStart hook wrote a sentinel if executed. The global executable/policy won. An injected endpoint/config directory was removed, the hook never ran, and the snapshot appeared only beside trusted config, not the project-selected OMP directory.

```text
MODE dynamic: 16 exact models; snapshot trusted, mode=600; project hook not executed
MODE aliases-200k: 20 models
MODE warm-failure: 16 models; last-good bytes unchanged
MODE cold-failure: 16 retained models; explicit 1M resolvable
MODE static: 4 models; no discovery
REAL GENERATION: AskClaude default exact Opus 5.5; reply=OK; project endpoint/config rejected; hook not executed
SECURITY PROVIDER PROBE PASS; REAL GENERATION 1/1 ACCEPTED
```

The probe ran twice during this security pass; both real one-word generations returned OK (2/2 total). The final acceptance run includes one of those generations; no SDK query stub was used. The separate committed generation regression uses a query stub and makes no network request.

A final `CLAUDE_BRIDGE_DEBUG=0 bun tests/.bridge-security-catalog.mts` printed the full live catalog through actual registration/discovery. Output (`id | context | maxOut | thinking`):

```text
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
REAL CATALOG: 16 models
```

Metadata source remains installed pi-ai where available, supplemented by the installed Claude Code catalog for missing Sonnet/Haiku 5.5 metadata. SDK supported effort names project to OMP-native low/medium/high/xhigh; AskClaude separately supports max. Explicit [1m] picker rows remain labeled `(1M, explicit)`. Configured hidden aliases receive one retained-list-derived exact-target hint; unconfigured discovery aliases do not warn. Hidden aliases do not become selectable OMP role ids without includeAliases opt-in.

### Prior selector-generation evidence retained

The first review pass exercised base, -200k and [1m] for each of claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5 and claude-fable-5-1: **12/12 actual one-word generations accepted**, all replies OK. -200k translated to bare CLI selectors; explicit [1m] was passed through. All reported 1M runtime context; runtime max output was 128K except Fable's 64K default. The bridge catalog's Fable upper limit remains 128K. Full per-selector output is preserved in report commit `95a1e4b` and subsequent `ce2403f`.

Thus -200k controls OMP's compaction threshold, not a Claude Code server context cap. No million-token stress test is claimed. Legacy removed ids retain routing-only window metadata; -latest and non-retained window variants still fail clearly.

## Self-evaluation and handoff

Accuracy 5/5: actual tests, installed-source inspection and real account probes ground the claims; non-Linux limitations are explicit. Completeness 5/5: all five findings plus requested committed generation/mode/save tests and final commands covered. Clarity 4/5: policy, environment provenance and cache trust are separated. Actionability 5/5: exact commits, trusted path, migration impact and remaining risks recorded. Conciseness 4/5: full catalog output retained to satisfy the original brief. No additional worker/orchestrator actions required in this worktree.

SLICE-BOUNDARY: BRIDGE-1 omp-claude-bridge lane/bridge-1-model-catalog@b01ff14 — security fixes M 2/2 L 3/3, tests 69/69, typecheck pass yes, real generation ok yes
