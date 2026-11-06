# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.2] - 2026-11-06

### Added
- Exact-only catalogs by default; `provider.includeAliases: true` opts into
  non-versioned SDK aliases, including aliases in explicit static lists.
- Hidden aliases referenced by static bridge config or OMP model roles log one
  migration hint per alias, including on warm-cache startup. Targets derive
  from the retained release list; unconfigured SDK aliases produce no warning.
- Runtime model discovery through the official Claude Agent SDK
  `supportedModels()` catalog. Exact SDK selectors join retained current
  versions; family aliases are available only with explicit opt-in.
- `provider.models` as an explicit static override for installations that
  need the legacy context-window variants.

### Changed
- Dynamic catalogs use OMP's `fetchDynamicModels` SQLite cache (24-hour TTL).
  Failed discovery logs one warning and reuses a bridge-owned last-good snapshot
  before the retained table. Only successful SDK discovery writes the snapshot.
  Retained explicit `[1m]` selectors also remain resolvable in cold fallback.
- Last-good snapshots have a checked version/timestamp envelope; discovery
  failure warnings report snapshot age. Snapshot permissions and save-error
  recovery/temporary-file cleanup have regression coverage.
- Explicit `[1m]` picker entries use `(1M, explicit)` labels, distinct from base
  1M entries without changing their exact routing.
- Claude effort levels now preserve their names end to end. In particular,
  `xhigh` is no longer rewritten to `max`; AskClaude keeps SDK-provided `max`
  separate, while the OMP model picker exposes only OMP-native exact names.
- Verified base, `-200k`, and `[1m]` selector generation for all four current
  releases. `-200k` sets OMP's compaction threshold; Claude Code 2.1.317
  still reports native 1M context for the bare runtime selector.

### Removed
- Opus 4.6/4.7/4.8, Sonnet 4.6, and Fable 5 from the default catalog.
  Explicit static configurations retain their historical routing/window policy;
  use current exact ids for new roles. Sonnet 5 and Haiku 4.5 remain retained.

### Fixed
- Discovery never loads filesystem Claude settings. Generation settings/MCP trust
  is global-only: project config may tighten but never loosen it; attempted
  loosening warns. Generation defaults to no settings sources and strict MCP.
- Executable paths are honored only from the global OMP agent config, never
  project config. Global config follows OMP's agent-directory/profile override.
- Discovery receives only its named provider options, never arbitrary project
  JSON keys such as the internal query function or timeout override.
- Moving `-latest` selectors are excluded even with alias opt-in and rejected
  by direct routing; use a versioned exact id.
- Unsupported bridge window suffixes fail clearly before reaching Claude Code,
  including unresolved selectors supplied directly to AskClaude.
- AskClaude defaults to exact `claude-opus-5-5`, not the moving `opus` alias.
- Static/AskClaude model lookup checks exact ids before substring short names,
  so selecting Sonnet 5 never selects an earlier-listed Sonnet 5.5 instead.
- Retained Opus/Sonnet/Haiku 5.5 and Fable 5.1 metadata: 1M defaults,
  200K variants, 128,000 output tokens, and native adaptive-thinking efforts.
  Static mode recognizes these ids without unknown-context warnings.
- Removed obsolete default retained ids; Sonnet 5 and Haiku 4.5 remain for
  configured legacy roles. Dynamic retained entries now share window variants.
- Dynamic SDK selectors now inherit matched OMP context metadata, including
  canonical 1M values, without an unconditional 200K cap. Unknown selectors
  remain conservative 128K, while explicit `[1m]` selectors stay at 1M.
- Upgraded the Claude Agent SDK and now expose each unique `resolvedModel` as an
  exact selector, so releases such as `claude-opus-5-5[1m]` appear without a
  hardcoded bridge model-list update. Aliases and resolved selectors inherit
  current OMP catalog metadata for context, output, image, and thinking support.
- Static `"auto"` routing now uses 1M for current Fable, Opus, and Sonnet
  entries; Haiku 4.5 remains 200K. The explicit `"200k"` mode and `-200k`
  picker variants remain available where supported.
- Removed obsolete `provider.plan` and `provider.longContextExtraUsage`
  settings; `provider.contextWindow` is the sole context-window policy control.

## [0.8.1] - 2026-07-07

### Fixed
- Spurious "Claude rate limit warning" toasts at trivial utilization. The Claude
  Agent SDK emits `allowed_warning` rate-limit events even at ~1% of the
  `seven_day` (weekly) limit; these are now surfaced only at ≥80% utilization.
  Hard-limit (`rejected`) notifications and the debug log are unchanged.

## [0.8.0] - 2026-07-07

### Added
- On-demand context-window variants in the `/model` picker: each model is now
  registered once per window it supports (1M and/or 200K) as a distinct,
  clearly-labeled entry (e.g. `Opus 4.8 (1M)` and `Opus 4.8 (200K)`). Switching
  a model's context window is a picker selection instead of a config edit plus
  reload.
- Suffixed model ids (`<model>-1m` / `<model>-200k`) that force a specific
  window regardless of the global default — usable from `modelRoles` and
  AskClaude short names. The unsuffixed id remains the config default, so
  existing `config.yml` roles keep working.

### Changed
- `provider.contextWindow` now sets the **default** window (which window the
  unsuffixed model id maps to) instead of hiding models that don't match it.
  Both windows stay pickable wherever a runtime exists.
- Each variant reports its true `contextWindow`, keeping the status bar and
  auto-compaction accurate for the selected window.

## [0.7.0] - 2026-07-06

First public release of the Oh My Pi port.

### Added
- `provider.contextWindow` setting with three modes:
  - `"auto"` (default) — per-model context policy based on measured SDK behavior.
  - `"1m"` — force the 1M context window; only 1M-capable models are registered.
  - `"200k"` — force the 200K context window; only 200K-capable models are registered.
- Models without a runtime for the selected forced window are hidden from the
  model picker instead of being misreported.
- `thinkingLevelMap` fallback so Sonnet 5 / Sonnet 4.6 expose `xhigh` (mapped to `max`).

### Changed
- Ported from Pi (`@earendil-works/*`) to Oh My Pi (`@oh-my-pi/*`): extension
  manifest (`omp.extensions`), provider registration, message conversion, and
  config directory resolution (`~/.omp/agent/claude-bridge.json`).
- Corrected the `claude-fable-5` context policy: the bare `claude-fable-5`
  runtime serves 200K (verified), while `claude-fable-5[1m]` serves 1M. In
  `"auto"` mode Fable 5 now registers at 200K.

### Credits
- Original `pi-claude-bridge` by [Eli Dickinson](https://github.com/elidickinson).
- Oh My Pi port and context-window controls by [Jonathan Borgwing](https://github.com/DevVig).
