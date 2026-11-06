import test from "node:test";
import assert from "node:assert/strict";
import { buildModels, buildConfiguredModels, buildVariantModels, claudeCodeModelId, parseVariantId, setDynamicRuntimeCatalogActive } from "../src/models.ts";

const CURRENT = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"];

for (const mode of ["auto", "1m", "200k"]) {
	test(`${mode}: current releases expose both windows and route each variant`, () => {
		const settings = { contextWindow: mode };
		const models = buildVariantModels(buildConfiguredModels(CURRENT, []), settings);
		for (const id of CURRENT) {
			const base = models.find((m) => m.id === id);
			assert.equal(base.contextWindow, mode === "200k" ? 200_000 : 1_000_000);
			const alternate = models.find((m) => m.id === `${id}-${mode === "200k" ? "1m" : "200k"}`);
			assert.equal(alternate.contextWindow, mode === "200k" ? 1_000_000 : 200_000);
			for (const model of [base, alternate]) {
				assert.equal(model.maxTokens, 128_000);
				assert.equal(model.reasoning, true);
				assert.deepEqual(model.input, ["text", "image"]);
				assert.deepEqual(model.thinking.efforts, ["low", "medium", "high", "xhigh"]);
				assert.equal(claudeCodeModelId(model, settings), model.contextWindow === 1_000_000 ? `${id}[1m]` : id);
			}
		}
	});
}

test("static retained ids and explicit 1M selectors need no unknown-context warnings", () => {
	const warnings = [];
	const original = console.error;
	console.error = (...args) => warnings.push(args.join(" "));
	try {
		for (const contextWindow of ["auto", "1m", "200k"]) {
			const settings = { contextWindow };
			const models = buildVariantModels(buildConfiguredModels([...CURRENT, "claude-sonnet-5", "claude-haiku-4-5", "claude-fable-5-1[1m]"], []), settings);
			for (const model of models) claudeCodeModelId(model, settings);
			assert.equal(models.find((m) => m.id === "claude-fable-5-1[1m]").contextWindow, 1_000_000);
		}
	} finally {
		console.error = original;
	}
	assert.deepEqual(warnings, []);
});

test("default catalog retains only current releases and configured legacy versions", () => {
	assert.deepEqual(buildModels([]).map((m) => m.id), [...CURRENT, "claude-sonnet-5", "claude-haiku-4-5"]);
	const models = buildVariantModels(buildModels([]), { contextWindow: "auto" });
	assert.equal(models.find((m) => m.id === "claude-sonnet-5").contextWindow, 1_000_000);
	assert.equal(models.find((m) => m.id === "claude-haiku-4-5").contextWindow, 200_000);
	assert.equal(models.find((m) => m.id === "claude-haiku-4-5").maxTokens, 64_000);
	assert.equal(models.some((m) => m.id === "claude-haiku-4-5-1m"), false);
});

test("dynamic catalog variants are translated rather than sent as model versions", () => {
	setDynamicRuntimeCatalogActive(true);
	try {
		assert.equal(claudeCodeModelId({ id: "claude-opus-5-5-200k" }, { contextWindow: "auto" }), "claude-opus-5-5");
		assert.equal(claudeCodeModelId({ id: "claude-sonnet-5-5-1m" }, { contextWindow: "200k" }), "claude-sonnet-5-5[1m]");
		assert.equal(claudeCodeModelId({ id: "claude-future-6" }, { contextWindow: "auto" }), "claude-future-6");
	} finally {
		setDynamicRuntimeCatalogActive(false);
	}
});

test("variant suffixes override the configured default", () => {
	assert.deepEqual(parseVariantId("claude-fable-5-1"), { baseId: "claude-fable-5-1" });
	assert.deepEqual(parseVariantId("claude-fable-5-1-1m"), { baseId: "claude-fable-5-1", forced: "1m" });
	assert.deepEqual(parseVariantId("claude-opus-5-5-200k"), { baseId: "claude-opus-5-5", forced: "200k" });
	assert.equal(claudeCodeModelId({ id: "claude-opus-5-5-200k" }, { contextWindow: "1m" }), "claude-opus-5-5");
	assert.throws(() => claudeCodeModelId({ id: "claude-haiku-4-5-1m" }, { contextWindow: "auto" }), /no Claude Code runtime/);
});

test("explicit legacy models retain their historical windows without returning to defaults", () => {
	const ids = ["claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6", "claude-fable-5"];
	for (const contextWindow of ["auto", "1m", "200k"]) {
		const settings = { contextWindow };
		const models = buildVariantModels(buildConfiguredModels(ids, []), settings);
		for (const id of ids) {
			const model = models.find((m) => m.id === id);
			assert.equal(model.contextWindow, contextWindow === "200k" && id !== "claude-opus-4-7" ? 200_000 : 1_000_000);
			assert.equal(claudeCodeModelId(model, settings), id === "claude-opus-4-7" || model.contextWindow === 200_000 ? id : `${id}[1m]`);
			assert.equal(buildModels([]).some((m) => m.id === id), false);
		}
	}
});

test("an unknown static model uses conservative auto metadata and warns", () => {
	const warnings = [];
	const original = console.error;
	console.error = (...args) => warnings.push(args.join(" "));
	try {
		const [model] = buildVariantModels(buildConfiguredModels(["claude-unknown-9"], []), { contextWindow: "auto" });
		assert.equal(model.contextWindow, 200_000);
		assert.equal(claudeCodeModelId(model, { contextWindow: "auto" }), "claude-unknown-9");
		assert.ok(warnings.some((line) => line.includes("claude-unknown-9") && line.includes("no known context")));
	} finally { console.error = original; }
});
