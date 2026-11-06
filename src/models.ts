import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";

// Current releases plus the legacy versions still used by configured roles.
export const MODEL_IDS_IN_ORDER = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1", "claude-sonnet-5", "claude-haiku-4-5"] as const;

export const CLAUDE_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ClaudeEffort = (typeof CLAUDE_EFFORT_LEVELS)[number];

const OMP_CLAUDE_EFFORT_LEVELS = ["low", "medium", "high", "xhigh"] as const;
type OmpClaudeEffort = (typeof OMP_CLAUDE_EFFORT_LEVELS)[number];

/**
 * Validate and route a requested Claude effort without changing its name.
 * `undefined` means that the caller did not request an effort; every supplied
 * value must be one of Claude Code's wire names.
 */
export function routeClaudeEffort(value: string | undefined): ClaudeEffort | undefined {
	if (value == null) return undefined;
	if (!isClaudeEffort(value)) {
		throw new Error(`claude-bridge: unsupported effort level "${value}"`);
	}
	return value;
}

export type ClaudeSupportedModel = {
	value: string;
	resolvedModel?: string;
	displayName?: string;
	supportsEffort?: boolean;
	supportedEffortLevels?: readonly string[];
	supportsAdaptiveThinking?: boolean;
};

type PiAiModel = {
	id: string;
	name: string;
	reasoning?: boolean;
	input?: ("text" | "image")[];
	contextWindow?: number | null;
	maxTokens?: number | null;
	cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
	thinking?: ProviderModelConfig["thinking"];
};

export type ClaudeProviderModel = {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	thinking?: ProviderModelConfig["thinking"];
};

function projectPiAiThinking(thinking: ProviderModelConfig["thinking"]): ProviderModelConfig["thinking"] {
	if (!thinking) return undefined;
	const efforts: OmpClaudeEffort[] = [];
	for (const sourceEffort of thinking.efforts ?? []) {
		if (!isOmpClaudeEffort(sourceEffort) || efforts.includes(sourceEffort)) continue;
		efforts.push(sourceEffort);
	}
	if (efforts.length === 0) return undefined;
	const { defaultLevel, effortMap: _discardedEffortMap, ...base } = thinking;
	return {
		...base,
		efforts: efforts as NonNullable<ProviderModelConfig["thinking"]>["efforts"],
		...(defaultLevel != null && isOmpClaudeEffort(defaultLevel) && efforts.includes(defaultLevel)
			? { defaultLevel: defaultLevel as NonNullable<ProviderModelConfig["thinking"]>["defaultLevel"] }
			: {}),
	};
}

function isClaudeEffort(value: string): value is ClaudeEffort {
	return (CLAUDE_EFFORT_LEVELS as readonly string[]).includes(value);
}

function isOmpClaudeEffort(value: string): value is OmpClaudeEffort {
	return (OMP_CLAUDE_EFFORT_LEVELS as readonly string[]).includes(value);
}

function metadataModel(
	id: string,
	source: PiAiModel | undefined,
	explicitOneM: boolean,
): ClaudeProviderModel {
	return {
		id,
		name: source?.name ?? id,
		reasoning: Boolean(source?.reasoning),
		input: source?.input ?? ["text"],
		contextWindow: explicitOneM ? ONE_M_CONTEXT : source?.contextWindow ?? TWO_HUNDRED_K_CONTEXT,
		maxTokens: source?.maxTokens ?? DEFAULT_DYNAMIC_MAX_TOKENS,
		thinking: projectPiAiThinking(source?.thinking),
		cost: source?.cost ?? ZERO_COST,
	};
}

function projectSdkThinking(info: Pick<ClaudeSupportedModel, "supportedEffortLevels" | "supportsEffort" | "supportsAdaptiveThinking">): ProviderModelConfig["thinking"] | undefined {
	const reported = info.supportedEffortLevels;
	const efforts: OmpClaudeEffort[] = [];
	for (const reportedEffort of reported ?? []) {
		if (!isOmpClaudeEffort(reportedEffort) || efforts.includes(reportedEffort)) continue;
		efforts.push(reportedEffort);
	}
	if (reported !== undefined && efforts.length === 0) return undefined;
	const supportsThinking =
		info.supportsEffort === true || efforts.length > 0 || info.supportsAdaptiveThinking === true;
	if (!supportsThinking) return undefined;
	const normalizedEfforts = efforts.length > 0 ? efforts : ["low", "medium", "high"] as OmpClaudeEffort[];
	return {
		mode: info.supportsAdaptiveThinking ? "anthropic-adaptive" : "anthropic-budget-effort",
		efforts: normalizedEfforts as NonNullable<ProviderModelConfig["thinking"]>["efforts"],
	};
}

// Retained exact metadata remains available when pi-ai or discovery is stale.
export function buildModels<T extends PiAiModel>(piAiModels: T[]): ClaudeProviderModel[] {
	return buildConfiguredModels(MODEL_IDS_IN_ORDER, piAiModels);
}

const warnedHiddenAliases = new Set<string>();

function warnHiddenAlias(alias: string, resolvedModel?: string): void {
	if (warnedHiddenAliases.has(alias)) return;
	warnedHiddenAliases.add(alias);
	const family = stripOneMillionSuffix(alias);
	const known: Record<string, string> = {
		default: "claude-opus-5-5", opus: "claude-opus-5-5",
		sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5", fable: "claude-fable-5-1",
	};
	const exact = resolvedModel ?? (known[family] ? `${known[family]}${family !== alias ? "[1m]" : ""}` : undefined);
	console.error(`claude-bridge: hidden alias "${alias}" (${exact ? `resolves to ${exact}; use claude-bridge/${exact}` : "exact resolution unavailable"}); or set provider.includeAliases: true`);
}

export function buildConfiguredModels<T extends PiAiModel>(
	// Non-versioned selectors are deliberately opt-in, including static lists.
	ids: readonly string[],
	piAiModels: readonly T[],
	options: { includeAliases?: boolean } = {},
): ClaudeProviderModel[] {
	return ids.filter((id) => {
		if (options.includeAliases === true || isExactModelId(id)) return true;
		warnHiddenAlias(id);
		return false;
	}).map((id) => {
		const source = findPiAiMetadata({ value: id }, piAiModels);
		return metadataModel(id, source, /\[1m\]$/i.test(id));
	});
}

const DEFAULT_DYNAMIC_CONTEXT_WINDOW = 128_000;
const DEFAULT_DYNAMIC_MAX_TOKENS = 16_384;
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

// Efforts: Claude Code 2.1.317 supportedModels(), projected to OMP wire names.
// Output: pi-ai for Opus/Fable/Sonnet 5/Haiku 4.5; Claude Code's bundled
// model catalog for Sonnet/Haiku 5.5 (both 128000 upper output tokens).
const RETAINED_METADATA: readonly PiAiModel[] = [
	...[
		["claude-opus-5-5", "Claude Opus 5.5"],
		["claude-sonnet-5-5", "Claude Sonnet 5.5"],
		["claude-haiku-5-5", "Claude Haiku 5.5"],
		["claude-fable-5-1", "Claude Fable 5.1"],
		["claude-sonnet-5", "Claude Sonnet 5"],
	].map(([id, name]): PiAiModel => ({
		id, name, reasoning: true, input: ["text", "image"],
		contextWindow: 1_000_000, maxTokens: 128_000,
		thinking: projectSdkThinking({ supportsAdaptiveThinking: true, supportedEffortLevels: OMP_CLAUDE_EFFORT_LEVELS }),
	})),
	{
		id: "claude-haiku-4-5", name: "Claude Haiku 4.5",
		reasoning: true, input: ["text", "image"],
		contextWindow: 200_000, maxTokens: 64_000,
		thinking: { ...projectSdkThinking({ supportedEffortLevels: OMP_CLAUDE_EFFORT_LEVELS }), mode: "budget" },
	},
];

// Routing-only: explicitly configured old versions keep their prior windows,
// but these ids never enter buildModels()' default catalog.
const LEGACY_ONE_M_RUNTIMES: Record<string, string> = {
	"claude-opus-4-8": "claude-opus-4-8[1m]",
	"claude-opus-4-7": "claude-opus-4-7",
	"claude-opus-4-6": "claude-opus-4-6[1m]",
	"claude-sonnet-4-6": "claude-sonnet-4-6[1m]",
	"claude-fable-5": "claude-fable-5[1m]",
};

function hasWindowPolicy(id: string): boolean {
	return (MODEL_IDS_IN_ORDER as readonly string[]).includes(id) || Object.hasOwn(LEGACY_ONE_M_RUNTIMES, id);
}

export function isExactModelId(id: string): boolean {
	return /^claude-.+-\d/.test(id);
}

function stripOneMillionSuffix(id: string): string {
	return id.replace(/\[1m\]$/i, "");
}

function findPiAiMetadata(
	info: ClaudeSupportedModel,
	piAiModels: readonly PiAiModel[],
): PiAiModel | undefined {
	const strippedValue = stripOneMillionSuffix(info.value);
	const ids = [
		info.resolvedModel,
		stripOneMillionSuffix(info.resolvedModel ?? ""),
		strippedValue,
		info.value,
	];
	for (const id of ids) {
		if (!id) continue;
		const match = piAiModels.find((model) => model.id === id) ?? RETAINED_METADATA.find((model) => model.id === id);
		if (match) return match;
	}
	return undefined;
}

function projectDiscoveredModel(
	info: ClaudeSupportedModel,
	id: string,
	piAiModels: readonly PiAiModel[],
	canonicalName: boolean,
): ClaudeProviderModel {
	const metadata = findPiAiMetadata({ ...info, value: id }, piAiModels);
	const contextWindow = /\[1m\]$/i.test(id)
		? ONE_M_CONTEXT
		: metadata?.contextWindow ?? DEFAULT_DYNAMIC_CONTEXT_WINDOW;
	const reportsThinking =
		info.supportsAdaptiveThinking !== undefined ||
		info.supportsEffort !== undefined ||
		info.supportedEffortLevels !== undefined;
	const reasoning = reportsThinking
		? info.supportsAdaptiveThinking === true ||
			info.supportsEffort === true ||
			(info.supportedEffortLevels?.length ?? 0) > 0
		: Boolean(metadata?.reasoning);
	const sdkThinking = projectSdkThinking(info);
	return {
		id,
		name: canonicalName ? metadata?.name ?? id : info.displayName || id,
		reasoning,
		input: metadata?.input ?? ["text"],
		cost: metadata?.cost ?? ZERO_COST,
		contextWindow,
		maxTokens: metadata?.maxTokens ?? DEFAULT_DYNAMIC_MAX_TOKENS,
		thinking: reportsThinking ? sdkThinking : projectPiAiThinking(metadata?.thinking),
	};
}


/**
 * Project exact SDK selectors after the retained versions. Non-versioned aliases
 * require explicit opt-in. Duplicate selectors are dropped on first occurrence.
 */
export function projectSupportedModels(
	supportedModels: readonly ClaudeSupportedModel[],
	piAiModels: readonly PiAiModel[] = [],
	options: { includeAliases?: boolean; contextWindow?: ContextWindowMode } = {},
): ClaudeProviderModel[] {
	const explicitOneM = MODEL_IDS_IN_ORDER.filter((id) => id !== "claude-haiku-4-5").map((id) => `${id}[1m]`);
	const result = buildVariantModels([
		...buildModels([...piAiModels]),
		...buildConfiguredModels(explicitOneM, piAiModels),
	], { contextWindow: options.contextWindow ?? "auto" });
	const seen = new Set(result.map((model) => model.id));
	for (const info of supportedModels) {
		if (!info || typeof info.value !== "string" || !info.value) continue;
		if (options.includeAliases !== true && !isExactModelId(info.value)) warnHiddenAlias(info.value, info.resolvedModel);
		if ((options.includeAliases === true || isExactModelId(info.value)) && !seen.has(info.value)) {
			seen.add(info.value);
			result.push(projectDiscoveredModel(info, info.value, piAiModels, false));
		}

		const resolvedModel = info.resolvedModel;
		if (typeof resolvedModel !== "string" || !isExactModelId(resolvedModel) || seen.has(resolvedModel)) continue;
		seen.add(resolvedModel);
		result.push(projectDiscoveredModel(info, resolvedModel, piAiModels, true));
	}
	return result;
}


// User-selectable context-window policy (see provider.contextWindow in config).
//   "auto"  - canonical per-model default policy.
//   "1m"    - prefer 1M by default; models without it retain their sole window.
//   "200k"  - prefer 200K by default; 1M remains pickable as an alternate.
export type ContextWindowMode = "auto" | "1m" | "200k";

export type ContextWindowSettings = {
	contextWindow: ContextWindowMode;
};

export type ClaudeCodeRuntimeModel = {
	cliModelId: string;
	contextWindow: number;
};

const TWO_HUNDRED_K_CONTEXT = 200_000;
const ONE_M_CONTEXT = 1_000_000;

// Retained auto policy defaults to 1M except for Haiku 4.5 (200K).
export function resolveClaudeCodeRuntimeModel(modelId: string, settings: ContextWindowSettings): ClaudeCodeRuntimeModel | null {
	switch (settings.contextWindow) {
		case "1m":
			return resolveForcedOneMRuntimeModel(modelId);
		case "200k":
			return resolveForcedTwoHundredKRuntimeModel(modelId);
		case "auto":
			return resolveAutoRuntimeModel(modelId);
	}
}

function resolveAutoRuntimeModel(modelId: string): ClaudeCodeRuntimeModel {
	if (hasWindowPolicy(modelId)) {
		return modelId === "claude-haiku-4-5"
			? { cliModelId: modelId, contextWindow: TWO_HUNDRED_K_CONTEXT }
			: { cliModelId: LEGACY_ONE_M_RUNTIMES[modelId] ?? `${modelId}[1m]`, contextWindow: ONE_M_CONTEXT };
	}
	console.error(`claude-bridge: encountered model ${modelId} with no known context size, defaulting to 200K`);
	return { cliModelId: modelId, contextWindow: TWO_HUNDRED_K_CONTEXT };
}

function resolveForcedOneMRuntimeModel(modelId: string): ClaudeCodeRuntimeModel | null {
	if (hasWindowPolicy(modelId)) {
		return modelId === "claude-haiku-4-5" ? null : { cliModelId: LEGACY_ONE_M_RUNTIMES[modelId] ?? `${modelId}[1m]`, contextWindow: ONE_M_CONTEXT };
	}
	console.error(`claude-bridge: encountered model ${modelId} with no known 1M runtime, hiding it`);
	return null;
}

function resolveForcedTwoHundredKRuntimeModel(modelId: string): ClaudeCodeRuntimeModel | null {
	if (modelId === "claude-opus-4-7") return null;
	if (hasWindowPolicy(modelId)) return { cliModelId: modelId, contextWindow: TWO_HUNDRED_K_CONTEXT };
	console.error(`claude-bridge: encountered model ${modelId} with no known 200K runtime, hiding it`);
	return null;
}

// Split a registered picker id into its base model id and the forced window it
// encodes. Variant ids carry a "-1m"/"-200k" suffix (see buildVariantModels); the
// unsuffixed id maps to the config default. Base ids never end in those suffixes,
// so the split is unambiguous.
export function parseVariantId(id: string): { baseId: string; forced?: "1m" | "200k" } {
	if (id.endsWith("-1m")) return { baseId: id.slice(0, -3), forced: "1m" };
	if (id.endsWith("-200k")) return { baseId: id.slice(0, -5), forced: "200k" };
	return { baseId: id };
}

let dynamicRuntimeCatalogActive = false;

/** Mark whether provider entries came from SDK discovery rather than static config. */
export function setDynamicRuntimeCatalogActive(active: boolean): void {
	dynamicRuntimeCatalogActive = active;
}

export function claudeCodeModelId(model: { id: string }, settings: ContextWindowSettings): string {
	if (/\[1m\]$/i.test(model.id)) return model.id;
	const { baseId, forced } = parseVariantId(model.id);
	if (dynamicRuntimeCatalogActive && !hasWindowPolicy(baseId)) return model.id;
	const runtimeModel = forced === "1m"
		? resolveForcedOneMRuntimeModel(baseId)
		: forced === "200k"
			? resolveForcedTwoHundredKRuntimeModel(baseId)
			: resolveClaudeCodeRuntimeModel(baseId, settings) ?? (hasWindowPolicy(baseId) ? resolveAutoRuntimeModel(baseId) : null);
	if (runtimeModel == null) {
		const requested = forced ?? settings.contextWindow;
		throw new Error(`claude-bridge: model ${model.id} has no Claude Code runtime (contextWindow=${requested})`);
	}
	return runtimeModel.cliModelId;
}

export function resolveModel<T extends { id: string }>(models: T[], input: string): T | undefined {
	const lower = input.toLowerCase();
	return models.find((m) => m.id === lower) ?? models.find((m) => m.id.includes(lower));
}

function variantName(baseName: string, contextWindow: number): string {
	const label = contextWindow === ONE_M_CONTEXT ? "1M" : "200K";
	// Strip any window hint pi-ai already baked into the name so we don't double it.
	const base = baseName.replace(/\s*(?:\((?:1M|200K)\)|\b1M\b)\s*$/i, "").trimEnd();
	return `${base} (${label})`;
}

// Expand each model into one registered entry per context window it supports, so
// the user picks the window on demand from OMP's model picker. The unsuffixed id
// (e.g. claude-opus-5-5) maps to the config default window; every other available
// window gets a "-1m"/"-200k" suffixed id. Each entry's contextWindow must match
// the window the bridge actually requests (see claudeCodeModelId), or OMP's status
// bar and auto-compaction threshold will misreport. Both windows stay pickable
// regardless of provider.contextWindow, which only picks the default.
export function buildVariantModels<T extends { id: string; name: string; contextWindow?: number | null }>(
	models: T[],
	settings: ContextWindowSettings,
): T[] {
	const result: T[] = [];
	for (const m of models) {
		if (/\[1m\]$/i.test(m.id)) {
			result.push({ ...m, contextWindow: ONE_M_CONTEXT, name: variantName(m.name, ONE_M_CONTEXT) });
			continue;
		}
		// Unknown model (not in the model tables): keep one default-path entry.
		// Done before the forced-resolver probes below, which log "hiding it" on
		// unknown ids — misleading noise for a model we actually keep.
		if (!hasWindowPolicy(m.id)) {
			const runtimeModel = resolveClaudeCodeRuntimeModel(m.id, settings);
			if (runtimeModel != null) result.push({ ...m, contextWindow: runtimeModel.contextWindow, name: variantName(m.name, runtimeModel.contextWindow) });
			continue;
		}

		// Known models always have at least one available window.
		const available: Array<{ kind: "1m" | "200k"; contextWindow: number }> = [];
		if (resolveForcedOneMRuntimeModel(m.id) != null) available.push({ kind: "1m", contextWindow: ONE_M_CONTEXT });
		if (resolveForcedTwoHundredKRuntimeModel(m.id) != null) available.push({ kind: "200k", contextWindow: TWO_HUNDRED_K_CONTEXT });

		// The config default decides which window is unsuffixed; fall back to the sole
		// available window when the preferred one has no runtime (Haiku 4.5 under
		// "1m").
		const defaultRuntime = resolveClaudeCodeRuntimeModel(m.id, settings);
		const preferredKind: "1m" | "200k" | undefined = defaultRuntime == null
			? undefined
			: defaultRuntime.contextWindow === ONE_M_CONTEXT ? "1m" : "200k";
		const defaultKind = preferredKind != null && available.some((a) => a.kind === preferredKind)
			? preferredKind
			: available[0].kind;

		const ordered = [
			...available.filter((a) => a.kind === defaultKind),
			...available.filter((a) => a.kind !== defaultKind),
		];
		for (const { kind, contextWindow } of ordered) {
			const id = kind === defaultKind ? m.id : `${m.id}-${kind}`;
			result.push({ ...m, id, contextWindow, name: variantName(m.name, contextWindow) });
		}
	}
	return result;
}
