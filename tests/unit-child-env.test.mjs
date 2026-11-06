import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const modulePath = new URL("../src/child-env.ts", import.meta.url).pathname;
const denied = ["ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "HTTPS_PROXY", "http_proxy", "NODE_EXTRA_CA_CERTS", "NODE_OPTIONS", "BASH_ENV", "ENV", "CLAUDE_CODE_SHELL_PREFIX", "CLAUDE_CODE_USE_BEDROCK", "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "ZDOTDIR", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_SSH_COMMAND", "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_LOG_USER_PROMPTS", "CLAUDE_CODE_ENABLE_TELEMETRY", "NODE_TLS_REJECT_UNAUTHORIZED", "SSL_CERT_FILE"];
function childEnv({ trustedEnv = [], launcher = {}, runtime = {}, dotenv = { BRIDGE_PROJECT_VALUE: "project-secret-marker" }, dotenvFiles = {}, childDotenv, noProvenance = false, platform = noProvenance ? "darwin" : undefined, pathHelper = 'PATH="/opt/homebrew/bin:/Users/bridge/.bun/bin:/usr/bin:/bin"; export PATH;' } = {}) {
	const root = mkdtempSync(join(tmpdir(), "bridge-env-"));
	const files = { ".env": dotenv, ...dotenvFiles };
	for (const [name, values] of Object.entries(files)) writeFileSync(join(root, name), Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n"));
	const cwd = childDotenv === undefined ? root : join(root, "child");
	if (childDotenv !== undefined) {
		mkdirSync(cwd);
		writeFileSync(join(cwd, ".env"), Object.entries(childDotenv).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n"));
	}
	const env = { ...process.env, ...launcher };
	for (const key of [...denied, "BRIDGE_PROJECT_VALUE", ...Object.keys(runtime), ...Object.values(files).flatMap(Object.keys)]) if (!(key in launcher)) delete env[key];
	const selectedNames = [...new Set([...denied, ...Object.keys(launcher), ...Object.keys(runtime), ...Object.values(files).flatMap(Object.keys), ...Object.keys(childDotenv ?? {}), "ENABLE_CLAUDEAI_MCP_SERVERS"])];
	try {
		const child = spawnSync(process.execPath, ["--eval", `
			Object.assign(process.env, ${JSON.stringify(runtime)});
			${platform ? `
				await import(${JSON.stringify(import.meta.resolve("@oh-my-pi/pi-utils"))});
				await import(${JSON.stringify(new URL("../src/trusted-paths.ts", import.meta.url).pathname)});
				${platform === "darwin" ? `
					const { mock } = await import("bun:test");
					const cp = await import("node:child_process"), nativeExec = cp.execFileSync;
					mock.module("node:child_process", () => ({ ...cp, execFileSync(command, args, options) {
						if (command !== "/usr/libexec/path_helper") return nativeExec(command, args, options);
						if (JSON.stringify(args) !== '["-s"]' || JSON.stringify(options.env) !== "{}" || options.cwd !== "/") throw new Error("unsafe path_helper invocation");
						if (${JSON.stringify(pathHelper)} === null) throw new Error("path_helper unavailable; secret-helper-output");
						return ${JSON.stringify(pathHelper)};
					} }));
				` : ""}
				Object.defineProperty(process, "platform", { value: ${JSON.stringify(platform)} });
			` : ""}
			${noProvenance ? 'process.execArgv.push("--no-env-file");' : ""}
			const { buildClaudeEnv } = await import(${JSON.stringify(modulePath)});
			const selected = env => Object.fromEntries(${JSON.stringify(selectedNames)}.filter(key => env[key] !== undefined).map(key => [key, env[key]]));
			console.log(JSON.stringify(Object.fromEntries(["generation", "discovery", "summary"].map(mode => [mode, selected(buildClaudeEnv(mode, { cwd: ${JSON.stringify(cwd)}, trustedEnv: ${JSON.stringify(trustedEnv)} }))]))));
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
	assert.equal(generation.ANTHROPIC_API_KEY, process.platform === "linux" ? "launcher-key" : undefined);
	assert.equal(summary.ANTHROPIC_BASE_URL, process.platform === "linux" ? "https://launcher.invalid" : undefined);
	assert.equal(discovery.ANTHROPIC_API_KEY, process.platform === "linux" ? "launcher-key" : undefined);
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
	for (const mode of ["generation", "discovery", "summary"]) assert.equal(result[mode].ANTHROPIC_BASE_URL, process.platform === "linux" ? "https://launcher.invalid" : undefined);
});

test("without authoritative provenance a flag cannot bless runtime values", () => {
	const { generation, discovery } = childEnv({ noProvenance: true, runtime: { ANTHROPIC_API_KEY: "runtime-key", ANTHROPIC_BASE_URL: "https://runtime.invalid" } });
	assert.equal(generation.ANTHROPIC_BASE_URL, undefined);
	assert.equal(generation.ANTHROPIC_API_KEY, undefined);
	assert.equal(discovery.ANTHROPIC_API_KEY, undefined);
});

test("Windows denies mixed-case names and matches trusted names case-insensitively", () => {
	const runtime = { anthropic_base_url: "https://safe-runtime.invalid", Claude_Config_Dir: "./runtime-config", node_options: "--runtime-option", DyLd_Insert_Libraries: "./runtime-library" };
	const result = childEnv({ platform: "win32", runtime });
	for (const mode of ["generation", "discovery", "summary"]) for (const key of Object.keys(runtime)) {
		assert.equal(result[mode][key], undefined);
		assert.equal(result[mode][key.toUpperCase()], undefined);
	}
	const trusted = childEnv({ platform: "win32", runtime, trustedEnv: ["AnThRoPiC_BaSe_Url"] });
	for (const mode of ["generation", "discovery", "summary"]) {
		assert.equal(trusted[mode].ANTHROPIC_BASE_URL, "https://safe-runtime.invalid");
		assert.equal(trusted[mode].node_options, undefined);
	}
});

test("Windows dotenv-name matching cannot be bypassed with another case", () => {
	const result = childEnv({ platform: "win32", runtime: { ANTHROPIC_API_KEY: "project-key" }, dotenv: { anthropic_api_key: "project-key" }, trustedEnv: ["aNtHrOpIc_ApI_KeY"] });
	for (const mode of ["generation", "discovery", "summary"]) {
		assert.equal(result[mode].ANTHROPIC_API_KEY, undefined);
		assert.equal(result[mode].anthropic_api_key, undefined);
	}
});

test("generation preserves ordinary launcher variables and unrelated trusted proxy values", () => {
	const launcher = { PATH: "/usr/bin:/bin", USER: "bridge-user", LANG: "C.UTF-8", TMPDIR: tmpdir(), SHELL: "/bin/sh", SSH_AUTH_SOCK: "/tmp/bridge-test.sock", HTTPS_PROXY: "http://corporate.invalid:3128" };
	const result = childEnv({ launcher, trustedEnv: ["HTTPS_PROXY"], dotenv: { PROXY: launcher.HTTPS_PROXY } });
	for (const name of Object.keys(launcher)) assert.equal(result.generation[name], launcher[name], name);
});

test("PATH defined identically by dotenv gets a trusted platform fallback with a warning", () => {
	const { generation, warnings } = childEnv({ launcher: { PATH: "/usr/bin:/bin" }, dotenv: { PATH: "/usr/bin:/bin" } });
	if (process.platform === "linux") assert.equal(generation.PATH, "/usr/bin:/bin");
	else { assert.ok(generation.PATH.split(":").includes("/usr/bin")); assert.ok(generation.PATH.split(":").every(part => part.startsWith("/"))); }
	assert.match(warnings, /PATH.*fallback/i);
});

test("a different dotenv PATH is replaced by launcher or trusted system PATH", () => {
	const result = childEnv({ launcher: { PATH: "/usr/bin:/bin" }, runtime: { PATH: "./untrusted-bin" }, dotenv: { PATH: "./untrusted-bin" } });
	if (process.platform === "linux") assert.equal(result.generation.PATH, "/usr/bin:/bin");
	else { assert.ok(result.generation.PATH.split(":").includes("/usr/bin")); assert.equal(result.generation.PATH.includes("untrusted-bin"), false); }
});

test("a child cwd different from launch cwd excludes dotenv values from both", () => {
	const result = childEnv({ childDotenv: { CHILD_PROJECT_VALUE: "child-secret-marker" }, runtime: { CHILD_PROJECT_VALUE: "child-secret-marker" } });
	for (const mode of ["generation", "discovery", "summary"]) {
		assert.equal(result[mode].BRIDGE_PROJECT_VALUE, undefined, mode);
		assert.equal(result[mode].CHILD_PROJECT_VALUE, undefined, mode);
	}
});

test("Darwin preserves fail-closed auth policy and uses system path_helper entries, not dotenv PATH", () => {
	const result = childEnv({ platform: "darwin", launcher: { ANTHROPIC_API_KEY: "launcher-key", PATH: "/usr/bin:/bin" }, dotenv: { PATH: "/usr/bin:/bin", ANTHROPIC_BASE_URL: "https://project.invalid" }, runtime: { ANTHROPIC_BASE_URL: "https://project.invalid" }, trustedEnv: ["ANTHROPIC_BASE_URL"] });
	for (const mode of ["generation", "discovery", "summary"]) {
		assert.equal(result[mode].ANTHROPIC_API_KEY, undefined);
		assert.equal(result[mode].ANTHROPIC_BASE_URL, undefined);
		assert.equal(result[mode].PATH, "/opt/homebrew/bin:/Users/bridge/.bun/bin:/usr/bin:/bin");
	}
	assert.match(result.warnings, /path_helper.*PATH fallback/);
	assert.equal(result.warnings.includes("launcher-key"), false);
});

test("Darwin path_helper output is parsed as data and never evaluated as shell code", () => {
	const root = mkdtempSync(join(tmpdir(), "bridge-path-helper-")), marker = join(root, "executed");
	try {
		for (const pathHelper of [`PATH="$(touch ${marker})"; export PATH;`, 'PATH="./project-bin:/usr/bin"; export PATH;', null]) {
			assert.throws(() => childEnv({ platform: "darwin", dotenv: { PATH: "./project-bin" }, runtime: { PATH: "./project-bin" }, pathHelper }), error => {
				assert.match(error.message, /trusted macOS system PATH/);
				assert.equal(error.message.includes("secret-helper-output"), false);
				return true;
			});
			assert.equal(existsSync(marker), false);
		}
	} finally { rmSync(root, { recursive: true, force: true }); }
});
