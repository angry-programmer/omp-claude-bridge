import test from "node:test";
import assert from "node:assert/strict";

import {
	MODEL_IDS_IN_ORDER,
	buildConfiguredModels,
	buildVariantModels,
	claudeCodeModelId,
	projectSupportedModels,
	routeClaudeEffort,
	setDynamicRuntimeCatalogActive,
} from "../src/models.ts";
import { discoverClaudeModels } from "../src/discovery.ts";

const SETTINGS = { plan: "pro", longContextExtraUsage: false, contextWindow: "auto" };

const PI_MODELS = [
	{
		id: "claude-fable-5",
		name: "Claude Fable 5",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
		contextWindow: 200_000,
		maxTokens: 128_000,
		thinking: { mode: "anthropic-adaptive", efforts: ["low", "high", "xhigh"], effortMap: { xhigh: "max" } },
	},
	{
		id: "claude-opus-4-8",
		name: "Claude Opus 4.8",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		thinking: { mode: "anthropic-adaptive", efforts: ["low", "high", "xhigh"], effortMap: { xhigh: "max" } },
	},
	{
		id: "claude-sonnet-5",
		name: "Claude Sonnet 5",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		thinking: { mode: "anthropic-adaptive", efforts: ["low", "medium", "high", "xhigh"] },
	},
];

test("combines retained versions with exact latest-family SDK aliases", () => {
	const models = projectSupportedModels([
		{ value: "default", displayName: "Default" },
		{ value: "claude-opus-4-8", displayName: "Duplicate explicit version" },
		{ value: "opus", resolvedModel: "claude-opus-5", displayName: "Opus", supportedEffortLevels: ["low", "high", "xhigh", "max"] },
		{ value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Sonnet", supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] },
		{ value: "fable", resolvedModel: "claude-fable-5", displayName: "Fable", supportedEffortLevels: ["low", "high", "max"] },
		{ value: "claude-fable-5-1[1m]", displayName: "Fable 5.1", supportedEffortLevels: ["low", "high"] },
	], PI_MODELS);
	assert.deepEqual(models.slice(0, MODEL_IDS_IN_ORDER.length).map((model) => model.id), [...MODEL_IDS_IN_ORDER]);
	assert.deepEqual(models.slice(MODEL_IDS_IN_ORDER.length).map((model) => model.id), [
		"default",
		"opus",
		"sonnet",
		"fable",
		"claude-fable-5-1[1m]",
	]);
	assert.equal(models.find((model) => model.id === "claude-opus-4-8").name, "Claude Opus 4.8");
	assert.equal(models.find((model) => model.id === "opus").name, "Opus");
	assert.equal(models.find((model) => model.id === "claude-fable-5-1[1m]").contextWindow, 1_000_000);
});

test("caps bare SDK metadata at 200K but keeps explicit [1m] at 1M", () => {
	const metadata = [{ ...PI_MODELS[0], contextWindow: 1_000_000 }];
	const models = projectSupportedModels([
		{ value: "fable", resolvedModel: "claude-fable-5" },
		{ value: "claude-fable-5[1m]", resolvedModel: "claude-fable-5" },
	], metadata);
	assert.equal(models.find((model) => model.id === "fable").contextWindow, 200_000);
	assert.equal(models.find((model) => model.id === "claude-fable-5[1m]").contextWindow, 1_000_000);
});

test("preserves exact OMP-supported effort names without applying effort maps", () => {
	const models = projectSupportedModels([
		{ value: "opus", supportedEffortLevels: ["low", "xhigh", "max"] },
		{ value: "max-only", supportsEffort: true, supportedEffortLevels: ["max"] },
	], PI_MODELS);
	assert.deepEqual(models.find((model) => model.id === "opus").thinking.efforts, ["low", "xhigh"]);
	assert.equal(models.find((model) => model.id === "max-only").thinking, undefined);
	const retained = models.find((model) => model.id === "claude-opus-4-8");
	assert.deepEqual(retained.thinking.efforts, ["low", "high", "xhigh"]);
	assert.equal(retained.thinking.effortMap, undefined);
	assert.equal(routeClaudeEffort("xhigh"), "xhigh");
	assert.equal(routeClaudeEffort("max"), "max");
	assert.throws(() => routeClaudeEffort("minimal"), /unsupported effort level "minimal"/);
});

test("dynamic routing keeps aliases and retained versions exact", () => {
	setDynamicRuntimeCatalogActive(true);
	try {
		for (const id of ["opus", "sonnet", "fable", "claude-opus-4-8", "claude-sonnet-5", "claude-fable-5"]) {
			assert.equal(claudeCodeModelId({ id }, SETTINGS), id);
		}
	} finally {
		setDynamicRuntimeCatalogActive(false);
	}
});

test("unknown runtime entries use conservative metadata without inventing ids", () => {
	const models = projectSupportedModels([{ value: "future-model", displayName: "Future" }]);
	const model = models.find((entry) => entry.id === "future-model");
	assert.equal(model.id, "future-model");
	assert.equal(model.contextWindow, 128_000);
	assert.equal(model.maxTokens, 16_384);
	assert.deepEqual(model.input, ["text"]);
	assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test("discovery disables filesystem and cloud MCP initialization", async () => {
	let queryParams;
	let closed = false;
	const models = await discoverClaudeModels({
		queryFn: (params) => {
			queryParams = params;
			return {
				supportedModels: async () => [{ value: "default", displayName: "Default" }],
				close: () => { closed = true; },
			};
		},
	});
	assert.equal(queryParams.options.strictMcpConfig, true);
	assert.deepEqual(queryParams.options.mcpServers, {});
	assert.equal(queryParams.options.env.ENABLE_CLAUDEAI_MCP_SERVERS, "0");
	assert.equal(closed, true);
	assert.equal(models[0].value, "default");
});

test("empty SDK catalogs reject so OMP can retain its last good cache", async () => {
	let closed = false;
	await assert.rejects(
		discoverClaudeModels({
			queryFn: () => ({
				supportedModels: async () => [],
				close: () => { closed = true; },
			}),
		}),
		/empty catalog/,
	);
	assert.equal(closed, true);
});

test("initialization-only discovery closes on timeout and SDK failure", async () => {
	let timeoutClosed = false;
	const hangingQuery = {
		supportedModels: () => new Promise(() => {}),
		close: () => { timeoutClosed = true; },
	};
	await assert.rejects(
		discoverClaudeModels({ timeoutMs: 5, queryFn: () => hangingQuery }),
		/ timed out after 5ms$/,
	);
	assert.equal(timeoutClosed, true);

	let failureClosed = false;
	const failedQuery = {
		supportedModels: async () => { throw new Error("initialization failed"); },
		close: () => { failureClosed = true; },
	};
	await assert.rejects(
		discoverClaudeModels({ queryFn: () => failedQuery }),
		/initialization failed/,
	);
	assert.equal(failureClosed, true);
});

test("explicit configured ids remain a static fallback", () => {
	const [model] = buildConfiguredModels(["local-alias"], PI_MODELS);
	assert.equal(model.id, "local-alias");
	assert.equal(model.contextWindow, 200_000);
});

test("explicit configured [1m] ids keep exact routing and 1M metadata", () => {
	const [configured] = buildConfiguredModels(["claude-fable-5-1[1m]"], PI_MODELS);
	const [registered] = buildVariantModels([configured], SETTINGS);
	assert.equal(registered.id, "claude-fable-5-1[1m]");
	assert.equal(registered.contextWindow, 1_000_000);
	assert.equal(registered.maxTokens, 128_000);
	assert.equal(claudeCodeModelId(registered, SETTINGS), "claude-fable-5-1[1m]");
});
