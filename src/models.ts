import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";

// Runtime discovery augments the retained versioned entries below. The retained
// ids stay independently selectable even when Claude Code also reports a family
// alias such as "opus" or "sonnet".
export const MODEL_IDS_IN_ORDER = ["claude-fable-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-4-5"] as const;

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

function projectSdkThinking(info: ClaudeSupportedModel): ProviderModelConfig["thinking"] | undefined {
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

// Project retained pi-ai model entries into the provider shape. These entries
// intentionally use the old explicit version order and exact ids.
export function buildModels<T extends PiAiModel>(piAiModels: T[]): ClaudeProviderModel[] {
	return buildConfiguredModels(MODEL_IDS_IN_ORDER, piAiModels);
}

export function buildConfiguredModels<T extends PiAiModel>(
	ids: readonly string[],
	piAiModels: readonly T[],
): ClaudeProviderModel[] {
	return ids.map((id) => {
		const source = findPiAiMetadata({ value: id }, piAiModels);
		return metadataModel(id, source, /\[1m\]$/i.test(id));
	});
}

const DEFAULT_DYNAMIC_CONTEXT_WINDOW = 128_000;
const DEFAULT_DYNAMIC_MAX_TOKENS = 16_384;
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function stripOneMillionSuffix(id: string): string {
	return id.replace(/\[1m\]$/i, "");
}

function findPiAiMetadata(
	info: ClaudeSupportedModel,
	piAiModels: readonly PiAiModel[],
): PiAiModel | undefined {
	const strippedValue = stripOneMillionSuffix(info.value);
	const versionParts = /\[1m\]$/i.test(info.value) ? strippedValue.match(/^(.*)-(\d+)$/) : null;
	const ids = [
		info.resolvedModel,
		stripOneMillionSuffix(info.resolvedModel ?? ""),
		strippedValue,
		info.value,
		versionParts ? `${versionParts[1]}.${versionParts[2]}` : undefined,
		versionParts?.[1],
	];
	for (const id of ids) {
		if (!id) continue;
		const match = piAiModels.find((model) => model.id === id);
		if (match) return match;
	}
	return undefined;
}

/**
 * Project the SDK's entries after the retained explicit version entries.
 * SDK values are exact selectors and are never rewritten or given inherited
 * pi-ai effort mappings. Duplicate values are dropped on first occurrence.
 */
export function projectSupportedModels(
	supportedModels: readonly ClaudeSupportedModel[],
	piAiModels: readonly PiAiModel[] = [],
): ClaudeProviderModel[] {
	const result = buildModels([...piAiModels]);
	const seen = new Set(result.map((model) => model.id));
	for (const info of supportedModels) {
		if (!info || typeof info.value !== "string" || !info.value || seen.has(info.value)) continue;
		seen.add(info.value);
		const metadata = findPiAiMetadata(info, piAiModels);
		const contextWindow = /\[1m\]$/i.test(info.value)
			? ONE_M_CONTEXT
			: metadata?.contextWindow == null
				? DEFAULT_DYNAMIC_CONTEXT_WINDOW
				: Math.min(metadata.contextWindow, TWO_HUNDRED_K_CONTEXT);
		const reasoning = info.supportsAdaptiveThinking === true
			? true
			: info.supportsEffort !== undefined
				? info.supportsEffort
				: (info.supportedEffortLevels?.length ?? 0) > 0;
		result.push({
			id: info.value,
			name: info.displayName || info.value,
			reasoning,
			input: metadata?.input ?? ["text"],
			cost: metadata?.cost ?? ZERO_COST,
			contextWindow,
			maxTokens: metadata?.maxTokens ?? DEFAULT_DYNAMIC_MAX_TOKENS,
			thinking: projectSdkThinking(info),
		});
	}
	return result;
}


// User-selectable context-window policy (see provider.contextWindow in config).
//   "auto"  - per-model default policy (measured SDK behavior).
//   "1m"    - force 1M: only register 1M-capable models, request [1m] where needed.
//   "200k"  - force 200K: only register 200K-capable models, request bare model ids.
export type ContextWindowMode = "auto" | "1m" | "200k";

export type LongContextSettings = {
	plan: "pro" | "max";
	longContextExtraUsage: boolean;
	contextWindow: ContextWindowMode;
};

export type ClaudeCodeRuntimeModel = {
	cliModelId: string;
	contextWindow: number;
};

const TWO_HUNDRED_K_CONTEXT = 200_000;
const ONE_M_CONTEXT = 1_000_000;

// Measured Claude Agent SDK subscription/OAuth behavior. Do not infer this from
// pi-ai's advertised contextWindow: bare Opus 4.7 serves 1M, bare Opus 4.8 does
// not, bare Fable 5 serves 200K while claude-fable-5[1m] serves 1M, and [1m]
// entitlement differs by model. Returns null when a model has no runtime for the
// requested forced window (that model is hidden from the picker in that mode).
export function resolveClaudeCodeRuntimeModel(modelId: string, settings: LongContextSettings): ClaudeCodeRuntimeModel | null {
	switch (settings.contextWindow) {
		case "1m":
			return resolveForcedOneMRuntimeModel(modelId);
		case "200k":
			return resolveForcedTwoHundredKRuntimeModel(modelId);
		case "auto":
			return resolveAutoRuntimeModel(modelId, settings);
	}
}

function resolveAutoRuntimeModel(modelId: string, settings: LongContextSettings): ClaudeCodeRuntimeModel {
	switch (modelId) {
		case "claude-opus-4-8":
			return { cliModelId: "claude-opus-4-8[1m]", contextWindow: ONE_M_CONTEXT };
		case "claude-opus-4-7":
			return { cliModelId: "claude-opus-4-7", contextWindow: ONE_M_CONTEXT };
		case "claude-opus-4-6": {
			const useOneM = settings.plan === "max" || settings.longContextExtraUsage;
			return {
				cliModelId: useOneM ? "claude-opus-4-6[1m]" : "claude-opus-4-6",
				contextWindow: useOneM ? ONE_M_CONTEXT : TWO_HUNDRED_K_CONTEXT,
			};
		}
		case "claude-fable-5":
			return { cliModelId: "claude-fable-5", contextWindow: TWO_HUNDRED_K_CONTEXT };
		case "claude-sonnet-5":
			return { cliModelId: "claude-sonnet-5[1m]", contextWindow: ONE_M_CONTEXT };
		case "claude-sonnet-4-6":
			return {
				cliModelId: settings.longContextExtraUsage ? "claude-sonnet-4-6[1m]" : "claude-sonnet-4-6",
				contextWindow: settings.longContextExtraUsage ? ONE_M_CONTEXT : TWO_HUNDRED_K_CONTEXT,
			};
		case "claude-haiku-4-5":
			return { cliModelId: "claude-haiku-4-5", contextWindow: TWO_HUNDRED_K_CONTEXT };
		default:
			console.error(`claude-bridge: encountered model ${modelId} with no known context size, defaulting to 200K`);
			return { cliModelId: modelId, contextWindow: TWO_HUNDRED_K_CONTEXT };
	}
}

function resolveForcedOneMRuntimeModel(modelId: string): ClaudeCodeRuntimeModel | null {
	switch (modelId) {
		case "claude-opus-4-8":
			return { cliModelId: "claude-opus-4-8[1m]", contextWindow: ONE_M_CONTEXT };
		case "claude-opus-4-7":
			return { cliModelId: "claude-opus-4-7", contextWindow: ONE_M_CONTEXT };
		case "claude-opus-4-6":
			return { cliModelId: "claude-opus-4-6[1m]", contextWindow: ONE_M_CONTEXT };
		case "claude-fable-5":
			return { cliModelId: "claude-fable-5[1m]", contextWindow: ONE_M_CONTEXT };
		case "claude-sonnet-5":
			return { cliModelId: "claude-sonnet-5[1m]", contextWindow: ONE_M_CONTEXT };
		case "claude-sonnet-4-6":
			return { cliModelId: "claude-sonnet-4-6[1m]", contextWindow: ONE_M_CONTEXT };
		case "claude-haiku-4-5":
			return null;
		default:
			console.error(`claude-bridge: encountered model ${modelId} with no known 1M runtime, hiding it`);
			return null;
	}
}

function resolveForcedTwoHundredKRuntimeModel(modelId: string): ClaudeCodeRuntimeModel | null {
	switch (modelId) {
		case "claude-opus-4-8":
			return { cliModelId: "claude-opus-4-8", contextWindow: TWO_HUNDRED_K_CONTEXT };
		case "claude-opus-4-7":
			return null;
		case "claude-opus-4-6":
			return { cliModelId: "claude-opus-4-6", contextWindow: TWO_HUNDRED_K_CONTEXT };
		case "claude-fable-5":
			return { cliModelId: "claude-fable-5", contextWindow: TWO_HUNDRED_K_CONTEXT };
		case "claude-sonnet-5":
			return { cliModelId: "claude-sonnet-5", contextWindow: TWO_HUNDRED_K_CONTEXT };
		case "claude-sonnet-4-6":
			return { cliModelId: "claude-sonnet-4-6", contextWindow: TWO_HUNDRED_K_CONTEXT };
		case "claude-haiku-4-5":
			return { cliModelId: "claude-haiku-4-5", contextWindow: TWO_HUNDRED_K_CONTEXT };
		default:
			console.error(`claude-bridge: encountered model ${modelId} with no known 200K runtime, hiding it`);
			return null;
	}
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

export function claudeCodeModelId(model: { id: string }, settings: LongContextSettings): string {
	if (dynamicRuntimeCatalogActive) return model.id;
	if (/\[1m\]$/i.test(model.id)) return model.id;
	const { baseId, forced } = parseVariantId(model.id);
	const runtimeModel = forced === "1m"
		? resolveForcedOneMRuntimeModel(baseId)
		: forced === "200k"
			? resolveForcedTwoHundredKRuntimeModel(baseId)
			: resolveClaudeCodeRuntimeModel(baseId, settings);
	if (runtimeModel == null) {
		const requested = forced ?? settings.contextWindow;
		throw new Error(`claude-bridge: model ${model.id} has no Claude Code runtime (contextWindow=${requested})`);
	}
	return runtimeModel.cliModelId;
}

export function resolveModel<T extends { id: string }>(models: T[], input: string): T | undefined {
	const lower = input.toLowerCase();
	return models.find((m) => m.id === lower || m.id.includes(lower));
}

function variantName(baseName: string, contextWindow: number): string {
	const label = contextWindow === ONE_M_CONTEXT ? "1M" : "200K";
	// Strip any window hint pi-ai already baked into the name so we don't double it.
	const base = baseName.replace(/\s*(?:\((?:1M|200K)\)|\b1M\b)\s*$/i, "").trimEnd();
	return `${base} (${label})`;
}

// Expand each model into one registered entry per context window it supports, so
// the user picks the window on demand from OMP's model picker. The unsuffixed id
// (e.g. claude-opus-4-8) maps to the config default window; every other available
// window gets a "-1m"/"-200k" suffixed id. Each entry's contextWindow must match
// the window the bridge actually requests (see claudeCodeModelId), or OMP's status
// bar and auto-compaction threshold will misreport. Both windows stay pickable
// regardless of provider.contextWindow, which only picks the default.
export function buildVariantModels<T extends { id: string; name: string; contextWindow?: number | null }>(
	models: T[],
	settings: LongContextSettings,
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
		if (!(MODEL_IDS_IN_ORDER as readonly string[]).includes(m.id)) {
			const runtimeModel = resolveClaudeCodeRuntimeModel(m.id, settings);
			if (runtimeModel != null) result.push({ ...m, contextWindow: runtimeModel.contextWindow, name: variantName(m.name, runtimeModel.contextWindow) });
			continue;
		}

		// Known models always have at least one available window.
		const available: Array<{ kind: "1m" | "200k"; contextWindow: number }> = [];
		if (resolveForcedOneMRuntimeModel(m.id) != null) available.push({ kind: "1m", contextWindow: ONE_M_CONTEXT });
		if (resolveForcedTwoHundredKRuntimeModel(m.id) != null) available.push({ kind: "200k", contextWindow: TWO_HUNDRED_K_CONTEXT });

		// The config default decides which window is unsuffixed; fall back to the sole
		// available window when the preferred one has no runtime (e.g. Haiku under
		// "1m", Opus 4.7 under "200k").
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
