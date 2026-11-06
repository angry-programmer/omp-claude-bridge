# Security Policy

## Supported versions

This project follows a rolling release model. Security fixes land on the latest
`0.x` release.

| Version | Supported |
| ------- | --------- |
| 0.7.x   | Yes       |
| < 0.7   | No        |

## Reporting a vulnerability

Please **do not** open a public issue for security reports.

Instead, use GitHub's private vulnerability reporting:
**Security → Report a vulnerability** on
<https://github.com/DevVig/omp-claude-bridge>, or email the maintainer at
`jon@learnvig.com`.

Include:
- A description of the issue and its impact.
- Steps to reproduce (a redacted `~/.omp/agent/claude-bridge.log` excerpt helps).
- The version / commit you are running.

You can expect an initial acknowledgement within a few days. Please give a
reasonable window for a fix before any public disclosure.

## Scope notes

This extension bridges to the Claude Code CLI through the official
[`@anthropic-ai/claude-agent-sdk`](https://github.com/anthropics/claude-agent-sdk-typescript).
Authentication and billing are handled by Claude Code / your Anthropic
subscription — this project never stores credentials. Issues in the underlying
SDK or CLI should be reported to their respective upstream projects.

## Configuration trust boundary

The trusted global file is the account's passwd home plus
`.omp/agent/claude-bridge.json`, independent of `HOME`, cwd dotenv, and OMP
agent/config/profile overrides. POSIX uses an absolute system account lookup
with an empty environment (Linux NSS `getent passwd`, macOS `id -P`), failing
closed if the lookup fails. A mismatch with the native home logs a warning.
Windows uses its native account home. Non-object JSON becomes `{}`; malformed
`settingSources` becomes `[]` with a warning.

The last-good catalog lives beside that trusted global file. Config files
and the catalog share a regular-file-only reader capped at 1 MB, including
concurrent growth. Project config and snapshots reject final symlinks. For
dotfile managers, global config alone may use a final symlink: its resolved
target is opened no-follow, then checked to be a regular file owned by the
account uid or root and not group/world-writable. A missing global file uses
defaults; any other global read/parse failure disables AskClaude and full mode,
disables settings sources, enforces strict MCP, ignores project overrides, and
logs one content-free error. Invalid JSON errors never quote input contents.
Successful discovery alone replaces the snapshot atomically with mode 0600;
failures never rewrite it.

On win32, Node/Bun do not expose `O_NOFOLLOW`/`O_NONBLOCK`; those flags become
zero, so final symlinks are not rejected atomically there. Regular-file/size
checks still apply. Git's usual `core.symlinks=false` limits repository-created
symlinks, but is not a filesystem security boundary.

Catalog discovery is initialization-only and always uses `settingSources: []`,
`strictMcpConfig: true`, an empty MCP server map, and disabled cloud MCP.
Neither global nor project settings can enable filesystem settings, hooks, or
filesystem MCP during discovery.

Generation defaults to no filesystem settings and strict MCP. Only the trusted
global bridge config may allow Claude Code `settingSources` or set
`strictMcpConfig: false`. Project bridge config may remove allowed sources or
enable strict MCP, but cannot add sources or disable globally required strict
mode. Attempts to loosen either policy log a warning and are ignored.
`appendSystemPrompt` does not change this policy. AskClaude uses the same allowed
settings sources and always retains strict MCP.

AskClaude `enabled` and `allowFullMode` are global ceilings: projects may only
disable either. Unauthorized full defaults and unrecognized defaults become
read mode; explicit full requests are rejected before querying Claude Code.
Tool name, TUI label and description come only from trusted global config.

Enabling user/project Claude settings globally authorizes their hooks and
environment configuration; disabling strict MCP globally authorizes filesystem
MCP server commands during provider generation. Do not enable those options for
untrusted repositories. Cloud MCP remains disabled. The CLI and SDK themselves,
the selected executable, OMP extensions, and tools the user authorizes remain
trusted: this bridge is not an OS sandbox. Read-only AskClaude modes restrict
model tools, not processes authorized by globally enabled settings/hooks.

## HOME pin migration

Claude children now default to the passwd account's HOME, not an inherited
custom HOME. This affects Claude credentials as well as bridge configuration.
Users of custom HOME/profile directories must keep trusted bridge policy at
`<passwd home>/.omp/agent/claude-bridge.json`.

Move/sign in to Claude's ordinary account-home credential store, or explicitly
list `CLAUDE_CONFIG_DIR` (or `HOME`) in global `provider.trustedEnv` and set that
variable in the trusted launcher. The value must survive provenance filtering
and same-name dotenv matching under OMP's parser; project config cannot authorize it.

POSIX startup requires an account entry and the system lookup binary:
`/usr/bin/getent` on Linux, `/usr/bin/id -P` on macOS. Missing entries, missing
binaries, invalid records and lookup timeouts produce a bridge-specific error
and refuse to load trusted configuration. There is no fallback to HOME.

## Child environment policy

Every SDK query starts from OMP's `filterChildShellEnv(process.env, cwd)`.
The bridge supplies private snapshots of the bridge-initialization cwd and
the child cwd, then intersects the filtered results. This keeps launch-directory
dotenv out of children even when a summary or tool uses a different cwd.
Source files are read no-follow, regular-file-only and capped at 1 MB each.
OMP's parser/filter sees only the private, mode-0600 copies, not the mutable
source paths; the temporary directory is removed before returning the env.
Unsafe files abort environment construction. Mode filenames use only a
`NODE_ENV` matching `^[A-Za-z0-9_-]{1,32}$`; invalid values abort before probing.

Provider generation, continuation, compact summaries, AskClaude and discovery
all use that provenance-filtered base. Dotenv values are matched by the same
name under OMP's parser and its variable-expansion rules, not against values
belonging to unrelated names. A parent that preloads dotenv with different
expansion/comment rules can produce unmatched values; this is not a general
provenance guarantee for arbitrary parent parsers or dotenv locations.

Discovery further permits only `PATH`, `HOME`, `USER`, `LANG`, `LC_*`, `TMPDIR`,
`TERM` and first-party auth: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
`CLAUDE_CODE_OAUTH_TOKEN`. Standard account-file login needs no token variable.
Proxies, third-party providers and alternative credential directories require
explicit global trust rather than implicit discovery inheritance.
The Windows discovery allowlist currently omits `SYSTEMROOT`, `USERPROFILE`,
`TEMP` and `PATHEXT`; installations needing them must opt in globally or may
fall back to the last-good/retained catalog. Native macOS startup/generation
checks remain deployment prerequisites; Linux platform mocks do not cover them.

A second defence-in-depth layer denies:
`ANTHROPIC_*_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`,
`CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CONFIG_DIR`, `*_PROXY`/`*_proxy`,
`NODE_EXTRA_CA_CERTS`, `NODE_OPTIONS`, `BASH_ENV`, `ENV`,
`CLAUDE_CODE_SHELL_PREFIX`, `CLAUDE_CODE_USE_*`, `LD_PRELOAD`, `LD_LIBRARY_PATH`,
`DYLD_*`, `ZDOTDIR`, `GIT_CONFIG_*`, `GIT_SSH_COMMAND`, `OTEL_*`,
`CLAUDE_CODE_ENABLE_TELEMETRY`, `NODE_TLS_REJECT_UNAUTHORIZED` and `SSL_CERT_FILE`.

Linux's original `/proc/self/environ` checks launcher ownership. Outside the
PATH fallback below, values must already be in the provenance-filtered base;
raw launcher values are not reinserted. A denied name defined by either cwd's
dotenv is untrusted even if a parent preloaded it, unless globally listed in
`provider.trustedEnv`.

Only global `trustedEnv` may allow exact names. Its same-name raw/expanded
dotenv values are refused under OMP's parser. A safe original launcher value
restored by OMP may survive; an unrelated dotenv name with an identical value
does not invalidate it. Without authoritative launcher provenance, denied names
require that global opt-in. A Bun no-env-file flag alone is not provenance,
since OMP can load dotenv later. Rejected HOME overrides retain the passwd
account pin. Removed names are logged, never values; bridge isolation switches
remain enforced.

If filtering removes or empties PATH, the bridge warns and restores Linux's
launcher PATH, or uses a fixed system PATH when launcher provenance is absent.
This is the one deliberate raw-launcher restore, even when dotenv defines the
same PATH. Ordinary launcher `USER`, `LANG`, `TMPDIR`, `SHELL` and
`SSH_AUTH_SOCK` survive generation when no same-name project value replaces them.
On Windows, policy, dotenv and trusted names are compared case-insensitively
and child environment keys are canonicalized to uppercase.

The second denylist is defence in depth, not a complete allowlist. Inherited
non-project `GIT_SSH`, `GIT_EXEC_PATH`, `GIT_ASKPASS`, `GIT_PROXY_COMMAND`,
`PYTHONPATH`, `BUN_OPTIONS` and `SHELL` are not denied by that layer and remain
part of the trusted launcher environment. OMP also strips repository-location
variables (`GIT_DIR`, `GIT_COMMON_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`,
`GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`) from every child;
`trustedEnv` cannot restore names that OMP has already removed.

This is not an OS sandbox. A trusted launcher's non-project environment, PATH
resolution, OMP's own extension/settings loading, the SDK/CLI and selected
executable, Claude managed policy and globally authorized hooks/tools remain
trusted. Filtering a future child's environment cannot undo code already
executed in the parent. Use a trusted launcher and explicit trusted executable.
