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
disable either. An unauthorized full default becomes read mode; explicit full
requests are rejected before querying Claude Code. Tool name and description
come only from trusted global config.

Enabling user/project Claude settings globally authorizes their hooks and
environment configuration; disabling strict MCP globally authorizes filesystem
MCP server commands during provider generation. Do not enable those options for
untrusted repositories. Cloud MCP remains disabled. The CLI and SDK themselves,
the selected executable, OMP extensions, and tools the user authorizes remain
trusted: this bridge is not an OS sandbox. Discovery and generation still inherit
OMP's current process environment, which may contain cwd dotenv values loaded
by Bun/OMP. This change does not sanitize that environment, secure executable
resolution through `PATH`, or prevent OMP's own project extensions from loading.
Use a trusted launcher environment and explicit trusted executable for untrusted
repositories. Read-only AskClaude modes restrict model tools, not processes
authorized by globally enabled settings/hooks.
