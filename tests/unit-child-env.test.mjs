import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const modulePath = new URL("../src/child-env.ts", import.meta.url).pathname;
const denied = ["ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "HTTPS_PROXY", "http_proxy", "NODE_EXTRA_CA_CERTS", "NODE_OPTIONS", "BASH_ENV", "ENV", "CLAUDE_CODE_SHELL_PREFIX", "CLAUDE_CODE_USE_BEDROCK", "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "ZDOTDIR", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_SSH_COMMAND", "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_LOG_USER_PROMPTS", "CLAUDE_CODE_ENABLE_TELEMETRY", "NODE_TLS_REJECT_UNAUTHORIZED", "SSL_CERT_FILE"];
function childEnv({ trustedEnv = [], launcher = {}, runtime = {}, dotenv = { BRIDGE_PROJECT_VALUE: "project-secret-marker" }, dotenvFiles = {}, noProvenance = false } = {}) {
	const root = mkdtempSync(join(tmpdir(), "bridge-env-"));
	const files = { ".env": dotenv, ...dotenvFiles };
	for (const [name, values] of Object.entries(files)) writeFileSync(join(root, name), Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n"));
	const env = { ...process.env, ...launcher };
	for (const key of [...denied, "BRIDGE_PROJECT_VALUE", ...Object.keys(runtime), ...Object.values(files).flatMap(Object.keys)]) if (!(key in launcher)) delete env[key];
	const selectedNames = [...new Set([...denied, ...Object.keys(launcher), ...Object.keys(runtime), ...Object.values(files).flatMap(Object.keys), "ENABLE_CLAUDEAI_MCP_SERVERS"])];
	try {
		const child = spawnSync(process.execPath, ["--eval", `
			Object.assign(process.env, ${JSON.stringify(runtime)});
			${noProvenance ? `await import(${JSON.stringify(import.meta.resolve("@oh-my-pi/pi-utils"))}); await import(${JSON.stringify(new URL("../src/trusted-paths.ts", import.meta.url).pathname)}); Object.defineProperty(process, "platform", { value: "darwin" }); process.execArgv.push("--no-env-file");` : ""}
			const { buildClaudeEnv } = await import(${JSON.stringify(modulePath)});
			const selected = env => Object.fromEntries(${JSON.stringify(selectedNames)}.filter(key => env[key] !== undefined).map(key => [key, env[key]]));
			console.log(JSON.stringify(Object.fromEntries(["generation", "discovery", "summary"].map(mode => [mode, selected(buildClaudeEnv(mode, { trustedEnv: ${JSON.stringify(trustedEnv)} }))]))));
		`], { cwd: root, env, encoding: "utf8" });
		assert.equal(child.status, 0, child.stderr);
		return { ...JSON.parse(child.stdout), warnings: child.stderr };
	} finally { rmSync(root, { recursive: true, force: true }); }
}

test("all child modes remove every project dotenv addition, whatever its name", () => {
	const runtime = Object.fromEntries(denied.map(name => [name, "runtime-secret-marker"]));
	runtime.NODE_TLS_REJECT_UNAUTHORIZED = "0";
	const { generation, discovery, summary, warnings } = childEnv({ runtime });
	for (const env of [generation, discovery, summary]) {
		for (const key of denied) assert.equal(env[key], undefined, key);
		assert.equal(env.BRIDGE_PROJECT_VALUE, undefined);
		assert.equal(env.ENABLE_CLAUDEAI_MCP_SERVERS, "0");
	}
	for (const key of denied) assert.ok(warnings.includes(key), key);
	assert.equal(warnings.includes("runtime-secret-marker"), false);
	assert.equal(warnings.includes("project-secret-marker"), false);
});

test("loader, shell and telemetry values from dotenv never reach any child", () => {
	// Use non-existent loader paths: Bun starts successfully; no library is loaded.
	const dotenv = { LD_PRELOAD: "./missing-project.so", ZDOTDIR: "./project-zsh", OTEL_EXPORTER_OTLP_ENDPOINT: "https://project.invalid", OTEL_LOG_USER_PROMPTS: "1", CLAUDE_CODE_ENABLE_TELEMETRY: "1" };
	const result = childEnv({ dotenv });
	for (const mode of ["generation", "discovery", "summary"]) for (const key of Object.keys(dotenv)) assert.equal(result[mode][key], undefined, `${mode}: ${key}`);
});

test("launcher values survive only when no cwd dotenv defines the denied name", () => {
	const { generation, discovery, summary } = childEnv({ launcher: { ANTHROPIC_API_KEY: "launcher-key", ANTHROPIC_BASE_URL: "https://launcher.invalid" } });
	assert.equal(generation.ANTHROPIC_API_KEY, "launcher-key");
	assert.equal(summary.ANTHROPIC_BASE_URL, "https://launcher.invalid");
	assert.equal(discovery.ANTHROPIC_API_KEY, "launcher-key");
	assert.equal(discovery.ANTHROPIC_BASE_URL, undefined);
});

test("trusted names cannot reallow cwd dotenv values, even from a preloaded launcher", () => {
	const dotenv = { ANTHROPIC_BASE_URL: "https://project.invalid", CLAUDE_CONFIG_DIR: "./project-claude" };
	for (const launcher of [{}, dotenv]) {
		const result = childEnv({ trustedEnv: Object.keys(dotenv), dotenv, launcher });
		for (const mode of ["generation", "discovery", "summary"]) for (const key of Object.keys(dotenv)) assert.equal(result[mode][key], undefined, `${mode}: ${key}`);
	}
});

test("a denied name defined by dotenv is untrusted even when the launcher owns it", () => {
	for (const dotenvFiles of [{ ".env.local": { ANTHROPIC_BASE_URL: "https://project.invalid" } }, { ".env.development.local": { ANTHROPIC_BASE_URL: "https://project.invalid" } }]) {
		const result = childEnv({ launcher: { ANTHROPIC_BASE_URL: "https://launcher.invalid" }, dotenvFiles });
		for (const mode of ["generation", "discovery", "summary"]) assert.equal(result[mode].ANTHROPIC_BASE_URL, undefined);
	}
});

test("trusted names may use only a safe value restored into the provenance-filtered base", () => {
	const result = childEnv({ trustedEnv: ["ANTHROPIC_BASE_URL"], launcher: { ANTHROPIC_BASE_URL: "https://launcher.invalid" }, dotenv: { ANTHROPIC_BASE_URL: "https://project.invalid" }, runtime: { ANTHROPIC_BASE_URL: "https://project.invalid" } });
	for (const mode of ["generation", "discovery", "summary"]) assert.equal(result[mode].ANTHROPIC_BASE_URL, "https://launcher.invalid");
});

test("without authoritative provenance a flag cannot bless runtime values", () => {
	const { generation, discovery } = childEnv({ noProvenance: true, runtime: { ANTHROPIC_API_KEY: "runtime-key", ANTHROPIC_BASE_URL: "https://runtime.invalid" } });
	assert.equal(generation.ANTHROPIC_BASE_URL, undefined);
	assert.equal(generation.ANTHROPIC_API_KEY, undefined);
	assert.equal(discovery.ANTHROPIC_API_KEY, undefined);
});
