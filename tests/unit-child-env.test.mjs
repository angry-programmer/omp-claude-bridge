import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const modulePath = new URL("../src/child-env.ts", import.meta.url).pathname;
const denied = ["ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR", "HTTPS_PROXY", "http_proxy", "NODE_EXTRA_CA_CERTS", "NODE_OPTIONS", "BASH_ENV", "ENV", "CLAUDE_CODE_SHELL_PREFIX", "CLAUDE_CODE_USE_BEDROCK"];
function childEnv({ trustedEnv = [], launcher = {} } = {}) {
	const root = mkdtempSync(join(tmpdir(), "bridge-env-"));
	// Loader variables are set after startup, not executed by the test runner.
	writeFileSync(join(root, ".env"), "BRIDGE_PROJECT_VALUE=project\nANTHROPIC_BASE_URL=https://project.invalid\n");
	const env = { ...process.env, ...launcher };
	for (const key of denied) if (!(key in launcher)) delete env[key];
	try {
		const child = spawnSync(process.execPath, ["--eval", `
			for (const key of ${JSON.stringify(denied)}) process.env[key] = "project-secret-marker";
			const { buildClaudeEnv } = await import(${JSON.stringify(modulePath)});
			console.log(JSON.stringify({ generation: buildClaudeEnv("generation", { trustedEnv: ${JSON.stringify(trustedEnv)} }), discovery: buildClaudeEnv("discovery", { trustedEnv: ${JSON.stringify(trustedEnv)} }) }));
		`], { cwd: root, env, encoding: "utf8" });
		assert.equal(child.status, 0, child.stderr);
		return { ...JSON.parse(child.stdout), warnings: child.stderr };
	} finally { rmSync(root, { recursive: true, force: true }); }
}

test("child env removes denied project values, logging names but no values", () => {
	const { generation, discovery, warnings } = childEnv();
	for (const key of denied) {
		assert.equal(generation[key], undefined, key);
		assert.equal(discovery[key], undefined, key);
		assert.ok(warnings.includes(key), key);
	}
	assert.equal(generation.BRIDGE_PROJECT_VALUE, "project");
	assert.equal(discovery.BRIDGE_PROJECT_VALUE, undefined);
	assert.equal(discovery.ENABLE_CLAUDEAI_MCP_SERVERS, "0");
	assert.equal(warnings.includes("project-secret-marker"), false);
});

test("authoritative launcher values survive generation; discovery stays minimal", () => {
	const { generation, discovery } = childEnv({ launcher: { ANTHROPIC_API_KEY: "launcher-key", ANTHROPIC_BASE_URL: "https://launcher.invalid" } });
	assert.equal(generation.ANTHROPIC_API_KEY, "launcher-key");
	assert.equal(generation.ANTHROPIC_BASE_URL, "https://launcher.invalid");
	assert.equal(discovery.ANTHROPIC_API_KEY, "launcher-key");
	assert.equal(discovery.ANTHROPIC_BASE_URL, undefined);
});

test("explicit trusted names reallow project values, including discovery", () => {
	const { generation, discovery } = childEnv({ trustedEnv: ["ANTHROPIC_BASE_URL", "CLAUDE_CONFIG_DIR"] });
	for (const env of [generation, discovery]) {
		assert.equal(env.ANTHROPIC_BASE_URL, "project-secret-marker");
		assert.equal(env.CLAUDE_CONFIG_DIR, "project-secret-marker");
		assert.equal(env.ANTHROPIC_API_KEY, undefined);
	}
});
