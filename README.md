<div align="center">

<img src="assets/banner.svg" alt="omp-claude-bridge — Run Claude Code natively inside Oh My Pi" width="100%" />

<h1>omp-claude-bridge</h1>

<p><strong>Run Claude Code as a first-class model provider inside <a href="https://omp.sh">Oh My Pi</a> — with an AskClaude delegation tool and switchable 1M / 200K context windows.</strong></p>

<p>
<a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
<img alt="Oh My Pi extension" src="https://img.shields.io/badge/Oh%20My%20Pi-extension-6E56CF">
<img alt="Claude Agent SDK" src="https://img.shields.io/badge/Claude%20Code-Agent%20SDK-D97757">
<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white">
<a href="https://github.com/DevVig/omp-claude-bridge/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/DevVig/omp-claude-bridge/actions/workflows/ci.yml/badge.svg"></a>
<img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg">
</p>

</div>

---

`omp-claude-bridge` lets you drive **Claude Code** — Opus, Sonnet, Haiku, and Fable — from inside Oh My Pi, with every tool call flowing through OMP's native TUI. It also exposes an **AskClaude** tool so any other provider can delegate a task or a second opinion to Claude Code, and it gives you **direct control over the context window** each model requests.

Authentication and billing run through Claude Code and your Anthropic subscription via the official [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) — this extension never stores credentials.

<div align="center">
<a href="assets/claude-bridge1.png"><img src="assets/claude-bridge1.png" width="49%"></a>&nbsp;
<a href="assets/claude-bridge2.png"><img src="assets/claude-bridge2.png" width="49%"></a>
</div>

## Table of contents

- [Features](#features)
- [Install](#install)
- [Quickstart](#quickstart)
- [Context window controls](#context-window-controls)
- [Models](#models)
- [AskClaude tool](#askclaude-tool)
- [Configuration reference](#configuration-reference)
- [How it works](#how-it-works)
- [Debugging](#debugging)
- [Development](#development)
- [Credits](#credits)
- [License](#license)

## Features

- **Claude Code as a provider** — pick Opus / Sonnet / Haiku / Fable from `/model`; tool calls render in OMP's TUI like any native provider.
- **AskClaude delegation tool** — from any other provider, hand a task or question to Claude Code (read-only, no-tools, or full read/write/bash), optionally in an isolated session.
- **Switchable context window** — force **1M** or **200K** globally, or use the canonical OMP metadata/static defaults. This is the headline addition in this fork.
- **Session resume & persistence** — conversations survive across turns and reconnects.
- **Skills + AGENTS.md forwarding** — your OMP skills and context files are passed into Claude Code's system prompt.
- **Thinking support** — effort levels map through to Claude Code, including `xhigh` on Sonnet models.
- **MCP tool bridging** with strict-config isolation by default.

## Install

```bash
omp plugin install git:github.com/DevVig/omp-claude-bridge
```

<details>
<summary>Other install methods</summary>

```bash
# From the full HTTPS URL
omp plugin install https://github.com/DevVig/omp-claude-bridge

# From a local checkout (great for hacking on it)
git clone https://github.com/DevVig/omp-claude-bridge.git
omp plugin install ./omp-claude-bridge
```

</details>

Requires Oh My Pi (`omp`) and a working Claude Code login.

## Quickstart

1. Install the plugin (above).
2. In OMP, run `/model` and choose a `claude-bridge/*` model — for example `claude-bridge/claude-sonnet-5`.
3. Work as usual. Tool calls run through OMP's TUI; Claude Code handles the model turn.

To delegate from another provider instead, just ask: *"Ask Claude to review this plan and poke holes in it."*

## Context window controls

The retained catalog exposes supported context windows as separate `/model`
entries in dynamic, static, and offline-fallback modes:

- `claude-bridge/claude-opus-5-5` → **Opus 5.5 (1M)**
- `claude-bridge/claude-opus-5-5-200k` → **Opus 5.5 (200K)**

Switching window is a picker selection. Retained ids use the window policy
below; newly discovered exact ids inherit OMP metadata or conservative 128K /
16,384-output-token metadata when unknown. Explicit `[1m]` selectors stay 1M.

### Default window

The **unsuffixed** id (e.g. `claude-opus-5-5`) maps to a default window; the other window gets a `-1m` / `-200k` suffixed id. `provider.contextWindow` in `~/.omp/agent/claude-bridge.json` picks that default — it only decides which window is unsuffixed:

```json
{
  "provider": {
    "contextWindow": "auto"
  }
}
```

| Mode | Default (unsuffixed) window |
| ---- | -------- |
| `"auto"` *(default)* | Opus/Sonnet/Haiku 5.5, Fable 5.1, and Sonnet 5 default to 1M; Haiku 4.5 defaults to 200K. |
| `"1m"` | 1M where the model has a 1M runtime, else its only window. |
| `"200k"` | 200K where the model has a 200K runtime, else its only window. |

Both windows stay in the picker regardless of this setting wherever supported. Exact `modelRoles` / `enabledModels` references such as `claude-bridge/claude-opus-5-5` follow the configured default.

### Windows offered per model

| Model | 200K entry | 1M entry | `auto` default |
| ----- | :--------: | :------: | :------------: |
| `claude-opus-5-5` | ✓ | ✓ | 1M |
| `claude-sonnet-5-5` | ✓ | ✓ | 1M |
| `claude-haiku-5-5` | ✓ | ✓ | 1M |
| `claude-fable-5-1` | ✓ | ✓ | 1M |
| `claude-sonnet-5` | ✓ | ✓ | 1M |
| `claude-haiku-4-5` | ✓ | — | 200K |

The suffixed alternate exists only for the window that isn't the default — under `auto` you get `claude-opus-5-5` (1M) + `claude-opus-5-5-200k`, and under `"200k"` you get `claude-opus-5-5` (200K) + `claude-opus-5-5-1m`. The bridge sends `[1m]` for 1M and the bare selector for 200K.

Claude Code 2.1.317 accepted base, bridge `-200k` (translated to bare), and
`[1m]` selectors for Opus/Sonnet/Haiku 5.5 and Fable 5.1 in twelve real
one-word generations. All reported **1M served context**: `-200k` controls
OMP's advertised context/compaction threshold, not a Claude Code context cap.
Runtime output limits were 128K for the three 5.5 releases and 64K for Fable
5.1; Fable's catalog maximum is 128K, not its current runtime default.

> Forcing 1M is a *request*: some models may still be **served** 200K by your subscription entitlement. Set `CLAUDE_BRIDGE_DEBUG=1` to log the served window as an entitlement diagnostic (see [Debugging](#debugging)).

> An invalid `contextWindow` value logs a warning and falls back to `"auto"`, so a typo never breaks startup.

## Models

The `/model` picker combines two sources:

- Current exact selectors: Opus/Sonnet/Haiku 5.5 and Fable 5.1. Sonnet 5 and
  Haiku 4.5 remain for configured legacy roles; obsolete retained 4.x Opus,
  Sonnet 4.6, and Fable 5 entries are no longer advertised by default.
- Claude Code's official Agent SDK `supportedModels()` catalog. Exact `value`
  and `resolvedModel` selectors appear automatically as new releases arrive.
  Non-versioned aliases (`opus`, `sonnet`, `haiku`, `fable`, `default`, and
  their `[1m]` forms) are hidden unless `provider.includeAliases: true`.

Alias hiding also applies to explicit `provider.models` lists. An OMP role such
as `claude-bridge/sonnet` cannot resolve a hidden selector: migrate it to an
exact id, or enable `provider.includeAliases` (and include it in your static
list if using one). Opted-in aliases route unchanged through Claude Code, so
their resolved version can change. AskClaude can still send an alias directly.

SDK display names are preserved. The model picker exposes only SDK effort names
that OMP represents natively (`low` through `xhigh`) and never translates them;
`max` remains separately available through AskClaude because OMP currently
treats its own `max` CLI spelling as an alias for `xhigh`. Cost, input, context,
and output metadata are enriched from OMP, with retained release metadata when
OMP has no entry. The four current releases have 128,000 max-output tokens and
adaptive thinking (`low`, `medium`, `high`, `xhigh` in the picker).
Duplicate aliases and resolved selectors are ignored, and explicit `[1m]` IDs
retain 1M context metadata.

If you need a deliberately static catalog, set `provider.models` to a
non-empty list of exact Claude Code ids. That explicit list bypasses discovery
and uses the same retained metadata and context-window variants:

```json
{
  "provider": {
    "models": ["claude-opus-5-5", "claude-sonnet-5-5"]
  }
}
```

Successful discovery atomically saves the SDK catalog to
`claude-bridge-models.json` under OMP's agent directory. A failed attempt never
writes this file: it logs one warning and reprojects the last-good catalog with
the current alias/window settings, or uses retained exact ids if no readable
snapshot exists. Every retained 1M-capable model includes its explicit `[1m]`
selector even in cold fallback.

OMP caches any returned discovery result, including fallback, for 24 hours.
It exposes no uncached-fallback return type. The bridge snapshot prevents a
temporary failure from replacing discovery-only ids with a reduced retained
catalog once a successful bridge discovery has saved them.
Bash commands issued by Claude Code get a 120-second default timeout (matching Claude Code's default), since OMP's bash has no timeout by default.

## AskClaude tool

Available whenever the active provider is **not** claude-bridge. Your current model can hand work to Claude Code and wait for the result:

- "Ask Claude to plan a fix."
- "If you get stuck, ask Claude for help."
- "Ask Claude to review the plan in @foo.md, implement it, then ask an `isolated=true` Claude to review the implementation."
- "Ask Claude to poke holes in this theory."
- "Find all the places in the codebase that handle auth."

You can also bake it into a skill or AGENTS.md, e.g. *"Always call AskClaude to review complicated feature implementations before considering the task complete."*

### Parameters

| Parameter | Values | Description |
| --------- | ------ | ----------- |
| `prompt` | string | The question or task for Claude Code. |
| `mode` | `read` (default), `none`, `full` | `read` = read files + web; `full` = read/write/bash. Lock `full` out with `allowFullMode: false`. |
| `model` | `claude-opus-5-5` (default), or an explicit selector | Defaults to exact Opus 5.5 even before discovery; aliases are used only when explicitly requested. |
| `thinking` | `off`, `low`, `medium`, `high`, `xhigh`, `max` | Exact Claude Code effort name. Levels are never translated by position or remapped (`xhigh` stays `xhigh`; `max` stays `max`). |
| `isolated` | boolean (default `false`) | When `true`, Claude gets a clean session with no conversation history. |

## Configuration reference

Config is read from `~/.omp/agent/claude-bridge.json` (global) and the project OMP config directory `.omp/claude-bridge.json` (project; merged over global). A starter file lives at [`claude-bridge.example.json`](claude-bridge.example.json).

```json
{
  "askClaude": {
    "enabled": true,
    "allowFullMode": true,
    "defaultIsolated": false
  },
  "provider": {
    "contextWindow": "auto",
    "includeAliases": false,
    "strictMcpConfig": true
  }
}
```

**`askClaude`**

| Key | Default | Description |
| --- | ------- | ----------- |
| `enabled` | `true` | Register the AskClaude tool. |
| `name` | `"AskClaude"` | Override the tool's OMP-side name. |
| `label` | `"Ask Claude Code"` | Override the TUI label. |
| `description` | — | Override the tool description shown to the model. |
| `defaultMode` | `"read"` | `"read"`, `"none"`, or `"full"`. |
| `defaultIsolated` | `false` | Start each call in a fresh session. |
| `allowFullMode` | `true` | Allow `mode: "full"`; set `false` to lock it out. |
| `appendSkills` | `true` | Forward OMP's skills block into the system prompt. |

**`provider`**

| Key | Default | Description |
| --- | ------- | ----------- |
| `models` | — | Non-empty exact-id list that opts out of runtime discovery and uses the static fallback path. |
| `includeAliases` | `false` | Opt into non-versioned SDK aliases. Also permits aliases in an explicit `models` list. Hidden aliases cannot resolve as OMP role selectors. |
| `contextWindow` | `"auto"` | Default window for retained models in dynamic, static, and fallback modes; both variants stay available. Unknown dynamic entries inherit OMP metadata or 128K; explicit `[1m]` selectors stay 1M. |
| `appendSystemPrompt` | `true` | Append OMP's AGENTS.md and skills. |
| `settingSources` | — | Claude Code filesystem settings to load; also used during SDK model discovery. |
| `strictMcpConfig` | `true` | Block MCP servers from `~/.claude.json` / `.mcp.json`. Cloud MCP is always blocked. |
| `pathToClaudeCodeExecutable` | — | Path to the `claude` binary, used for both discovery and requests. |

## How it works

OMP's built-in tools are bridged to Claude Code and back. Without explicit `provider.models`, OMP invokes an initialization-only Agent SDK query through `fetchDynamicModels` and caches the returned catalog for 24 hours. Exact discovered selectors enrich the retained catalog in [`src/models.ts`](src/models.ts); aliases require opt-in. Explicit static configuration bypasses discovery. Failed discovery reuses the bridge-owned last-good snapshot before the retained table.

## Debugging

Set `CLAUDE_BRIDGE_DEBUG=1` for detailed logs:

- **Bridge log** — `~/.omp/agent/claude-bridge.log`: every provider call, session-sync decision, tool-result delivery, and Claude Code stderr. Override the path with `CLAUDE_BRIDGE_DEBUG_PATH`.
- **Per-query CLI logs** — `~/.omp/agent/cc-cli-logs/<timestamp>-<tag>-<seq>.log`: the Claude Code subprocess's own debug stream, one file per query. Tags are `provider`, `continuation`, or `askclaude`.

When filing a session-resume bug (e.g. "No conversation found"), the `syncResult:` lines from the bridge log plus the matching `cc-cli-logs/` file are the most useful attachments.

## Development

```bash
git clone https://github.com/DevVig/omp-claude-bridge.git
cd omp-claude-bridge
bun install

bun run typecheck   # tsc --noEmit
bun run test        # Bun test runner
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow. CI runs typecheck and tests on every push and PR.

## Credits

- Original **[pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge)** by **[Eli Dickinson](https://github.com/elidickinson)** — the streaming provider, MCP/tool bridging, session resume, and AskClaude tool this project builds on.
- Initial inspiration from [claude-agent-sdk-pi](https://github.com/prateekmedia/claude-agent-sdk-pi) by Prateek Sunal.
- **Oh My Pi port and context-window controls** by **[Jonathan Borgwing](https://github.com/DevVig)**.

See [NOTICE](NOTICE) for full attribution.

> Anthropic [announced and then unannounced](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) a change to how Agent-SDK tool usage is billed. As of June 15, 2026 it uses your subscription quota just like Claude Code direct.

## License

[MIT](LICENSE) © 2026 Eli Dickinson (original) and Jonathan Borgwing (Oh My Pi port and context-window controls).
