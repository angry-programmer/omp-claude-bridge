import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";

// Model metadata helpers. Runtime discovery is authoritative when the provider
// has no explicitly configured model list; this table is retained only for the
// legacy/static fallback path.
export const MODEL_IDS_IN_ORDER = ["claude-fable-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-4-5"];

// Workaround for models that ship without a thinkingLevelMap. Sonnet 5 and
// Sonnet 4.6 have no map, so getSupportedThinkingLevels hides xhigh (it's
// opt-in). Both models' top effort tier is "max" with no real xhigh (verified
// via Claude Code's supportedModels API), so xhigh->max matches opus-4-6.
const DEFAULT_THINKING_LEVEL_MAPS: Record<string, Record<string, string>> = {
	"claude-sonnet-5": { xhigh: "max" },
	"claude-sonnet-4-6": { xhigh: "max" },
};

export type ClaudeSupportedModel = {
	value: string;
	resolvedModel?: string;
	displayName?: string;
	supportsEffort?: boolean;
	supportedEffortLevels?: readonly string[];
	supportsAdaptiveThinking?: boolean;
};

type ClaudeEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

type PiAiModel = {
	id: string;
	name: string;
	reasoning?: boolean;
	input?: ("text" | "image")[];
	contextWindow?: number | null;
	maxTokens?: number | null;
	cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
	thinking?: ProviderModelConfig["thinking"];
	thinkingLevelMap?: Record<string, string>;
}

export type ClaudeProviderModel = {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	thinking?: ProviderModelConfig["thinking"];
	thinkingLevelMap?: Record<string, string>;
};


// Project pi-ai's model entries down to the fields OMP's static registration
// expects, and keep the legacy display order. This function is intentionally
// not used as the dynamic provider's authoritative catalog.
export function buildModels<T extends PiAiModel>(piAiModels: T[]): ClaudeProviderModel[] {
	return MODEL_IDS_IN_ORDER
		.map((id) => piAiModels.find((m) => m.id === id))
		.filter((m) => m != null)
		// Forward thinkingLevelMap so per-model overrides (e.g. opus-4-7 mapping
		// xhigh->xhigh instead of xhigh->max) are visible to the effort lookup.
		.map(({ id, name, reasoning, input, contextWindow, maxTokens, thinkingLevelMap, thinking }) => ({
			id,
			name,
			reasoning: reasoning ?? false,
			input: input ?? ["text"],
			contextWindow: contextWindow ?? TWO_HUNDRED_K_CONTEXT,
			maxTokens: maxTokens ?? DEFAULT_DYNAMIC_MAX_TOKENS,
			thinking,
			thinkingLevelMap: thinkingLevelMap ?? DEFAULT_THINKING_LEVEL_MAPS[id],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		}));
}

export function buildConfiguredModels<T extends PiAiModel>(
	ids: readonly string[],
	piAiModels: T[],
): ClaudeProviderModel[] {
	return ids.map((id) => {
		const source = findPiAiMetadata({ value: id }, piAiModels);
		const explicitOneM = /\[1m\]$/i.test(id);
		if (!source) {
			return {
				id,
				name: id,
				reasoning: false,
				input: ["text"] as ("text" | "image")[],
				contextWindow: explicitOneM ? ONE_M_CONTEXT : TWO_HUNDRED_K_CONTEXT,
				maxTokens: 16_384,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			};
		}
		return {
			id,
			name: source.name ?? id,
			reasoning: Boolean(source.reasoning),
			input: source.input ?? ["text"],
			contextWindow: explicitOneM ? ONE_M_CONTEXT : source.contextWindow ?? TWO_HUNDRED_K_CONTEXT,
			maxTokens: source.maxTokens ?? 16_384,
			thinking: source.thinking,
			thinkingLevelMap: source.thinkingLevelMap,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		};
	});
}

const DEFAULT_DYNAMIC_CONTEXT_WINDOW = 128_000;
const DEFAULT_DYNAMIC_MAX_TOKENS = 16_384;
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const SUPPORTED_EFFORTS: Record<ClaudeEffort, true> = {
	minimal: true,
	low: true,
	medium: true,
	high: true,
	xhigh: true,
};

function isClaudeEffort(value: string): value is ClaudeEffort {
	return Object.hasOwn(SUPPORTED_EFFORTS, value);
}

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
function dynamicThinking(
	info: ClaudeSupportedModel,
	fallback: PiAiModel | undefined,
): ProviderModelConfig["thinking"] | undefined {
	const supportedEffortLevels = info.supportedEffortLevels ?? [];
	const efforts = supportedEffortLevels.filter(isClaudeEffort);
	const hasMaxEffort = supportedEffortLevels.includes("max");
	if (hasMaxEffort && !efforts.includes("xhigh")) efforts.push("xhigh");
	const supportsThinking =
		info.supportsEffort === true || efforts.length > 0 || info.supportsAdaptiveThinking === true;
	if (!supportsThinking) return info.supportsEffort === undefined && fallback?.thinking ? fallback.thinking : undefined;
	const normalizedEfforts: ClaudeEffort[] = efforts.length > 0 ? efforts : ["low", "medium", "high"];
	const effortMap = hasMaxEffort
		? { ...fallback?.thinking?.effortMap, xhigh: "max" }
		: fallback?.thinking?.effortMap;
	return {
		mode: info.supportsAdaptiveThinking ? "anthropic-adaptive" : "anthropic-budget-effort",
		efforts: normalizedEfforts as NonNullable<ProviderModelConfig["thinking"]>["efforts"],
		...(effortMap ? {
			effortMap: effortMap as NonNullable<ProviderModelConfig["thinking"]>["effortMap"],
		} : {}),
		...(fallback?.thinking?.supportsDisplay ? { supportsDisplay: true } : {}),
	};
}

/**
 * Project the SDK's supportedModels() response into OMP provider model
 * definitions. SDK order is preserved and duplicate values are dropped on
 * first occurrence. The id is never normalized: aliases and [1m] values are
 * the exact strings Claude Code must receive.
 */
export function projectSupportedModels(
	supportedModels: readonly ClaudeSupportedModel[],
	piAiModels: readonly PiAiModel[] = [],
): ClaudeProviderModel[] {
	const seen = new Set<string>();
	const result: ClaudeProviderModel[] = [];
	for (const info of supportedModels) {
		if (!info || typeof info.value !== "string" || !info.value || seen.has(info.value)) continue;
		seen.add(info.value);
		const reportedEffortLevels = info.supportedEffortLevels ?? [];
		const metadata = findPiAiMetadata(info, piAiModels);
		const reasoning = info.supportsAdaptiveThinking === true
			? true
			: info.supportsEffort !== undefined
				? info.supportsEffort
				: reportedEffortLevels.length > 0
					? true
					: Boolean(metadata?.reasoning);
		const contextWindow = /\[1m\]$/i.test(info.value)
			? 1_000_000
			: metadata?.contextWindow == null
				? DEFAULT_DYNAMIC_CONTEXT_WINDOW
				: Math.min(metadata.contextWindow, 200_000);
		const model: ClaudeProviderModel = {
			id: info.value,
			name: info.displayName || info.value,
			reasoning,
			input: metadata?.input ?? ["text"],
			cost: metadata?.cost ?? ZERO_COST,
			contextWindow,
			maxTokens: metadata?.maxTokens ?? DEFAULT_DYNAMIC_MAX_TOKENS,
			thinking: dynamicThinking(info, metadata),
			thinkingLevelMap: metadata?.thinkingLevelMap,
		};
		result.push(model);
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
		if (!MODEL_IDS_IN_ORDER.includes(m.id)) {
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
