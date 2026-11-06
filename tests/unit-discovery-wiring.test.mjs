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
		mock.module("./src/discovery.ts", () => ({ discoverProviderModels: async (_, options) => { captured = options; return []; } }));
		const { default: extension } = await import("./src/index.ts");
		let registration;
		extension({ on() {}, registerTool() {}, registerProvider(_, config) { registration = config; } });
		await registration.fetchDynamicModels(undefined);
		console.log(JSON.stringify(captured));
	`], { cwd: new URL("..", import.meta.url), encoding: "utf8", env: { ...process.env, CLAUDE_BRIDGE_DEBUG: "0" } });
	assert.equal(child.status, 0, child.stderr);
	return JSON.parse(child.stdout.trim());
}

test("discovery ignores arbitrary provider JSON keys", () => {
	const options = registeredDiscovery({ timeoutMs: 1, queryFn: "untrusted", strictMcpConfig: false, models: [], appendSystemPrompt: true });
	assert.deepEqual(Object.keys(options).sort(), ["contextWindow", "cwd"]);
	assert.equal(options.cwd, new URL("..", import.meta.url).pathname.replace(/\/$/, ""));
});
