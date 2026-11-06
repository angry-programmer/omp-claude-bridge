import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function registeredDiscovery(provider) {
	// Separate Bun process prevents module mocks leaking into the rest of the suite.
	const child = spawnSync(process.execPath, ["--eval", `
		import { mock } from "bun:test";
		const provider = ${JSON.stringify(provider)};
		let captured;
		mock.module("./src/config.ts", () => ({ loadConfig: () => ({ provider }) }));
		const { projectSupportedModels } = await import("./src/models.ts");
		mock.module("./src/discovery.ts", () => ({ discoverProviderModels: async (_, options) => {
			captured = options;
			return projectSupportedModels([{ value: "sonnet", resolvedModel: "claude-sonnet-5-5" }], [], options);
		} }));
		const { default: extension } = await import("./src/index.ts");
		let registration;
		extension({ on() {}, registerTool() {}, registerProvider(_, config) { registration = config; } });
		const catalog = await registration.fetchDynamicModels(undefined);
		console.log(JSON.stringify({ options: captured, catalog }));
	`], { cwd: new URL("..", import.meta.url), encoding: "utf8", env: { ...process.env, CLAUDE_BRIDGE_DEBUG: "0" } });
	assert.equal(child.status, 0, child.stderr);
	return JSON.parse(child.stdout.trim());
}

test("discovery ignores arbitrary provider JSON keys", () => {
	const { options } = registeredDiscovery({ timeoutMs: 1, queryFn: "untrusted", strictMcpConfig: false, models: [], appendSystemPrompt: true });
	assert.deepEqual(Object.keys(options).sort(), ["contextWindow", "cwd"]);
	assert.equal(options.cwd, new URL("..", import.meta.url).pathname.replace(/\/$/, ""));
});

test("registered discovery receives alias opt-in and preferred window policy", () => {
	const { options, catalog } = registeredDiscovery({ includeAliases: true, contextWindow: "200k" });
	assert.equal(options.includeAliases, true);
	assert.equal(options.contextWindow, "200k");
	assert.equal(catalog.find((model) => model.id === "sonnet").id, "sonnet");
	assert.equal(catalog.find((model) => model.id === "claude-sonnet-5-5").contextWindow, 200_000);
	assert.equal(catalog.find((model) => model.id === "claude-sonnet-5-5-1m").contextWindow, 1_000_000);
	const defaults = registeredDiscovery({});
	assert.equal(defaults.options.contextWindow, "auto");
	assert.equal(defaults.catalog.some((model) => model.id === "sonnet"), false);
	assert.equal(defaults.catalog.find((model) => model.id === "claude-sonnet-5-5").contextWindow, 1_000_000);
});

test("configured OMP role aliases get startup hints even without a discovery refresh", () => {
	const child = spawnSync(process.execPath, ["--eval", `
		import { mock } from "bun:test";
		import { mkdtempSync, rmSync } from "node:fs";
		import { tmpdir } from "node:os";
		import { join } from "node:path";
		const root = mkdtempSync(join(tmpdir(), "bridge-role-"));
		try {
			const { Settings } = await import("@oh-my-pi/pi-coding-agent");
			await Settings.init({ cwd: root, agentDir: root, inMemory: true, overrides: { modelRoles: { default: "claude-bridge/sonnet", slow: "anthropic/opus" } } });
			mock.module("./src/config.ts", () => ({ loadConfig: () => ({ provider: {} }) }));
			const { default: extension } = await import("./src/index.ts");
			// A warm OMP cache never invokes this callback.
			extension({ on() {}, registerTool() {}, registerProvider() {} });
		} finally { rmSync(root, { recursive: true, force: true }); }
	`], { cwd: new URL("..", import.meta.url), encoding: "utf8", env: { ...process.env, CLAUDE_BRIDGE_DEBUG: "0" } });
	assert.equal(child.status, 0, child.stderr);
	assert.match(child.stderr, /hidden alias "sonnet".*claude-sonnet-5-5/);
	assert.doesNotMatch(child.stderr, /hidden alias "opus"/);
});
