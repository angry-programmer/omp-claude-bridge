import test from "node:test";
import assert from "node:assert/strict";

import {
	buildConfiguredModels,
	buildVariantModels,
	claudeCodeModelId,
	projectSupportedModels,
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
	},
];

test("projects SDK values with pi-ai metadata without requiring undocumented fields", () => {
	const models = projectSupportedModels([
		{ value: "default", displayName: "Default" },
		{ value: "claude-fable-5-1[1m]", displayName: "Fable 5 (1M)", supportsEffort: true, supportedEffortLevels: ["low", "high"] },
	], PI_MODELS);
	assert.equal(models[0].id, "default");
	assert.equal(models[1].id, "claude-fable-5-1[1m]");
	assert.equal(models[1].contextWindow, 1_000_000);
	assert.equal(models[1].maxTokens, 128_000);
	assert.deepEqual(models[1].cost, PI_MODELS[0].cost);
});

test("does not infer 1M context from pi-ai for a bare SDK value", () => {
	const metadata = [{ ...PI_MODELS[0], contextWindow: 1_000_000 }];
	const [bare, explicit] = projectSupportedModels([
		{ value: "claude-fable-5", resolvedModel: "claude-fable-5" },
		{ value: "claude-fable-5[1m]", resolvedModel: "claude-fable-5" },
	], metadata);
	assert.equal(bare.contextWindow, 200_000);
	assert.equal(explicit.contextWindow, 1_000_000);
});

test("deduplicates SDK values while preserving runtime order", () => {
	const models = projectSupportedModels([
		{ value: "default", displayName: "Default" },
		{ value: "opus", displayName: "Opus" },
		{ value: "default", displayName: "Duplicate" },
		{ value: "haiku", displayName: "Haiku" },
	]);
	assert.deepEqual(models.map((model) => model.id), ["default", "opus", "haiku"]);
});

test("maps the SDK max effort onto OMP's xhigh tier", () => {
	const [model] = projectSupportedModels([
		{ value: "future-model", supportedEffortLevels: ["max"] },
	]);
	assert.deepEqual(model.thinking.efforts, ["xhigh"]);
	assert.equal(model.thinking.effortMap.xhigh, "max");
});

test("dynamic routing sends aliases and exact values unchanged", () => {
	setDynamicRuntimeCatalogActive(true);
	try {
		assert.equal(claudeCodeModelId({ id: "opus" }, SETTINGS), "opus");
		assert.equal(claudeCodeModelId({ id: "claude-fable-5-1[1m]" }, SETTINGS), "claude-fable-5-1[1m]");
	} finally {
		setDynamicRuntimeCatalogActive(false);
	}
});

test("unknown runtime entries use conservative metadata without inventing ids", () => {
	const [model] = projectSupportedModels([{ value: "future-model", displayName: "Future" }]);
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
