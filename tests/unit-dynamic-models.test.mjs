import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildConfiguredModels, buildVariantModels, claudeCodeModelId, projectSupportedModels, routeClaudeEffort, setDynamicRuntimeCatalogActive } from "../src/models.ts";
import { discoverClaudeModels, discoverProviderModels } from "../src/discovery.ts";

const SETTINGS = { contextWindow: "auto" };
const PI_MODELS = [{
	id: "claude-future-6", name: "Claude Future 6", reasoning: true,
	input: ["text", "image"], contextWindow: 1_000_000, maxTokens: 128_000,
	cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	thinking: { mode: "anthropic-adaptive", efforts: ["low", "high", "xhigh"], effortMap: { xhigh: "max" } },
}];

test("hides aliases but exposes unique exact SDK resolutions by default", () => {
	const models = projectSupportedModels([
		{ value: "opus", resolvedModel: "claude-opus-5-5" },
		{ value: "sonnet", resolvedModel: "claude-sonnet-5-5" },
		{ value: "haiku", resolvedModel: "claude-haiku-5-5" },
		{ value: "default" },
		{ value: "opus[1m]", resolvedModel: "claude-opus-5-5[1m]" },
	]);
	for (const alias of ["opus", "sonnet", "haiku", "default", "opus[1m]"]) {
		assert.equal(models.some((model) => model.id === alias), false);
	}
	for (const id of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5[1m]"]) {
		assert.equal(models.filter((model) => model.id === id).length, 1);
	}
});

test("only includes aliases with explicit opt-in and enriches them from resolved metadata", () => {
	const models = projectSupportedModels([
		{ value: "sonnet", resolvedModel: "claude-sonnet-5-5" },
	], [], { includeAliases: true });
	const alias = models.find((model) => model.id === "sonnet");
	assert.equal(alias.contextWindow, 1_000_000);
	assert.equal(alias.maxTokens, 128_000);
	assert.ok(models.some((model) => model.id === "claude-sonnet-5-5"));
});

test("static lists hide aliases unless explicitly enabled", () => {
	assert.deepEqual(buildConfiguredModels(["sonnet", "claude-sonnet-5"], []).map((m) => m.id), ["claude-sonnet-5"]);
	assert.deepEqual(buildConfiguredModels(["sonnet"], [], { includeAliases: true }).map((m) => m.id), ["sonnet"]);
});

test("new SDK versions use canonical metadata without a retained release entry", () => {
	const models = projectSupportedModels([
		{ value: "latest", resolvedModel: "claude-future-6[1m]", supportedEffortLevels: ["low", "xhigh", "max"], supportsAdaptiveThinking: true },
		{ value: "claude-future-6[1m]", resolvedModel: "claude-future-6[1m]" },
	], PI_MODELS);
	const model = models.find((m) => m.id === "claude-future-6[1m]");
	assert.equal(models.filter((m) => m.id === model.id).length, 1);
	assert.equal(model.name, "Claude Future 6");
	assert.equal(model.contextWindow, 1_000_000);
	assert.equal(model.maxTokens, 128_000);
	assert.deepEqual(model.input, ["text", "image"]);
	assert.deepEqual(model.thinking.efforts, ["low", "xhigh"]);
	assert.equal(model.thinking.effortMap, undefined);
});

test("uses canonical thinking metadata when SDK capabilities are omitted", () => {
	const models = projectSupportedModels([{ value: "claude-future-6" }], PI_MODELS);
	const model = models.find((m) => m.id === "claude-future-6");
	assert.equal(model.reasoning, true);
	assert.deepEqual(model.thinking.efforts, ["low", "high", "xhigh"]);
	assert.equal(model.thinking.effortMap, undefined);
});

test("preserves OMP-supported effort names and respects SDK no-thinking capability", () => {
	const models = projectSupportedModels([
		{ value: "claude-future-6", supportedEffortLevels: ["low", "xhigh", "max"] },
		{ value: "claude-future-7", supportsEffort: true, supportedEffortLevels: ["max"] },
	], PI_MODELS);
	assert.deepEqual(models.find((model) => model.id === "claude-future-6").thinking.efforts, ["low", "xhigh"]);
	assert.equal(models.find((model) => model.id === "claude-future-7").thinking, undefined);
	assert.equal(routeClaudeEffort("xhigh"), "xhigh");
	assert.equal(routeClaudeEffort("max"), "max");
	assert.throws(() => routeClaudeEffort("minimal"), /unsupported effort level/);
});

test("dynamic routing preserves aliases and unknown exact selectors", () => {
	setDynamicRuntimeCatalogActive(true);
	try {
		for (const id of ["opus", "sonnet", "haiku", "claude-future-6"]) {
			assert.equal(claudeCodeModelId({ id }, SETTINGS), id);
		}
	} finally {
		setDynamicRuntimeCatalogActive(false);
	}
});

test("unknown exact runtime entries use conservative metadata", () => {
	const models = projectSupportedModels([{ value: "claude-future-7", displayName: "Future" }]);
	const model = models.find((entry) => entry.id === "claude-future-7");
	assert.equal(model.contextWindow, 128_000);
	assert.equal(model.maxTokens, 16_384);
	assert.deepEqual(model.input, ["text"]);
});

test("empty SDK catalogs reject instead of becoming a successful empty discovery", async () => {
	let closed = false;
	await assert.rejects(discoverClaudeModels({
		queryFn: () => ({ supportedModels: async () => [], close: () => { closed = true; } }),
	}), /empty catalog/);
	assert.equal(closed, true);
});

test("initialization-only discovery closes on timeout and SDK failure", async () => {
	let timeoutClosed = false;
	await assert.rejects(discoverClaudeModels({
		timeoutMs: 5,
		queryFn: () => ({ supportedModels: () => new Promise(() => {}), close: () => { timeoutClosed = true; } }),
	}), /timed out after 5ms/);
	assert.equal(timeoutClosed, true);
	let failureClosed = false;
	await assert.rejects(discoverClaudeModels({
		queryFn: () => ({ supportedModels: async () => { throw new Error("initialization failed"); }, close: () => { failureClosed = true; } }),
	}), /initialization failed/);
	assert.equal(failureClosed, true);
});

test("explicit configured 1M ids keep exact routing and canonical metadata", () => {
	const [configured] = buildConfiguredModels(["claude-fable-5-1[1m]"], []);
	const [registered] = buildVariantModels([configured], SETTINGS);
	assert.equal(registered.id, "claude-fable-5-1[1m]");
	assert.equal(registered.contextWindow, 1_000_000);
	assert.equal(registered.maxTokens, 128_000);
	assert.equal(claudeCodeModelId(registered, SETTINGS), "claude-fable-5-1[1m]");
});

test("dynamic retained releases offer context variants under each policy", () => {
	for (const contextWindow of ["auto", "1m", "200k"]) {
		const models = projectSupportedModels([], [], { contextWindow });
		const opus = models.find((model) => model.id === "claude-opus-5-5");
		assert.equal(opus.contextWindow, contextWindow === "200k" ? 200_000 : 1_000_000);
		assert.ok(models.some((model) => model.id === `claude-opus-5-5-${contextWindow === "200k" ? "1m" : "200k"}`));
	}
});

for (const failure of ["throw", "empty", "timeout"]) {
	test(`provider discovery ${failure}: returns retained exact metadata and one warning`, async () => {
		const dir = mkdtempSync(join(tmpdir(), "bridge-discovery-"));
		const warnings = [];
		const original = console.error;
		console.error = (...args) => warnings.push(args.join(" "));
		let models;
		try {
			models = await discoverProviderModels([], {
				timeoutMs: 5,
				includeAliases: true,
				queryFn: () => ({
					supportedModels: () => {
						if (failure === "throw") throw new Error("SDK unavailable");
						return failure === "empty" ? Promise.resolve([]) : new Promise(() => {});
					},
					close() {},
				}),
			}, join(dir, "catalog.json"));
		} finally {
			console.error = original;
			rmSync(dir, { recursive: true, force: true });
		}
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /retained exact catalog/);
		assert.equal(models.find((m) => m.id === "claude-opus-5-5").contextWindow, 1_000_000);
		assert.equal(models.find((m) => m.id === "claude-sonnet-5-5").maxTokens, 128_000);
		assert.ok(models.every((m) => m.id.startsWith("claude-")));
		assert.equal(models.some((m) => m.id === "claude-opus-5"), false);
	});
}
