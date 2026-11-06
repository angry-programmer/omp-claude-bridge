import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function configuredSection(global, project, section = "provider") {
	const root = mkdtempSync(join(tmpdir(), "bridge-config-"));
	const home = join(root, "home");
	const agent = join(home, ".omp", "agent");
	const cwd = join(root, "project");
	mkdirSync(agent, { recursive: true });
	mkdirSync(join(cwd, ".omp"), { recursive: true });
	writeFileSync(join(agent, "claude-bridge.json"), JSON.stringify(section === null ? global : { [section]: global }));
	writeFileSync(join(cwd, ".omp", "claude-bridge.json"), JSON.stringify(section === null ? project : { [section]: project }));
	try {
		const child = spawnSync(process.execPath, ["--eval", `
			import { mock } from "bun:test";
			const os = await import("node:os");
			const user = os.userInfo();
			mock.module("node:os", () => ({ ...os, userInfo: () => ({ ...user, homedir: ${JSON.stringify(home)} }) }));
			const cp = await import("node:child_process");
			mock.module("node:child_process", () => ({ ...cp, execFileSync: () => "test:x:" + process.getuid() + ":0::" + ${JSON.stringify(home)} + ":/bin/sh" }));
			import { setAgentDir } from "@oh-my-pi/pi-utils";
			setAgentDir(${JSON.stringify(agent)});
			const { loadConfig } = await import("./src/config.ts");
			const config = loadConfig(${JSON.stringify(cwd)});
			console.log(JSON.stringify(${JSON.stringify(section)} === null ? config : config[${JSON.stringify(section)}]));
		`], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
		assert.equal(child.status, 0, child.stderr);
		return { config: JSON.parse(child.stdout.trim()), warnings: child.stderr };
	} finally { rmSync(root, { recursive: true, force: true }); }
}

test("only global config can choose the Claude executable; other project settings still override", () => {
	for (const trusted of [undefined, "/trusted/claude"]) {
		const { config } = configuredSection({ pathToClaudeCodeExecutable: trusted, contextWindow: "1m" }, {
			pathToClaudeCodeExecutable: "/untrusted/claude", contextWindow: "200k", includeAliases: true,
		});
		assert.equal(config.pathToClaudeCodeExecutable, trusted);
		assert.equal(config.contextWindow, "200k");
		assert.equal(config.includeAliases, true);
	}
});

test("project settings cannot enable settings sources or filesystem MCP by default", () => {
	const { config, warnings } = configuredSection({}, { settingSources: ["user", "project"], strictMcpConfig: false });
	assert.deepEqual(config.settingSources, []);
	assert.equal(config.strictMcpConfig, true);
	assert.match(warnings, /settingSources.*loosen/);
	assert.match(warnings, /strictMcpConfig.*loosen/);
});

test("project settings may reduce trusted sources and enable strict MCP", () => {
	const { config, warnings } = configuredSection({ settingSources: ["user", "project"], strictMcpConfig: false }, { settingSources: ["user"], strictMcpConfig: true });
	assert.deepEqual(config.settingSources, ["user"]);
	assert.equal(config.strictMcpConfig, true);
	assert.equal(warnings, "");
});

test("adding a project source keeps only globally allowed sources and warns", () => {
	const { config, warnings } = configuredSection({ settingSources: ["user"], strictMcpConfig: true }, { settingSources: ["user", "project"], strictMcpConfig: false });
	assert.deepEqual(config.settingSources, ["user"]);
	assert.equal(config.strictMcpConfig, true);
	assert.match(warnings, /settingSources.*loosen/);
	assert.match(warnings, /strictMcpConfig.*loosen/);
});

test("Bun cwd dotenv can move OMP agent data but cannot redirect trusted bridge config", () => {
	const root = mkdtempSync(join(tmpdir(), "bridge-dotenv-"));
	const home = join(root, "trusted-home");
	const agent = join(home, ".omp", "agent");
	const malicious = join(root, "malicious-agent");
	mkdirSync(agent, { recursive: true }); mkdirSync(malicious);
	writeFileSync(join(agent, "claude-bridge.json"), JSON.stringify({ provider: { pathToClaudeCodeExecutable: "/trusted/claude", settingSources: [], strictMcpConfig: true } }));
	writeFileSync(join(malicious, "claude-bridge.json"), JSON.stringify({ provider: { pathToClaudeCodeExecutable: "/malicious/claude", settingSources: ["project"], strictMcpConfig: false } }));
	writeFileSync(join(root, ".env"), `PI_CODING_AGENT_DIR=${malicious}\nHOME=${malicious}\nPI_CONFIG_DIR=.attacker\nOMP_PROFILE=default\n`);
	const env = { ...process.env, CLAUDE_BRIDGE_DEBUG: "0" };
	for (const key of ["PI_CODING_AGENT_DIR", "OMP_PROFILE", "PI_PROFILE", "PI_CONFIG_DIR", "HOME"]) delete env[key];
	try {
		const child = spawnSync(process.execPath, ["--eval", `
			import { mock } from "bun:test";
			const os = await import("node:os");
			const user = os.userInfo();
			mock.module("node:os", () => ({ ...os, userInfo: () => ({ ...user, homedir: ${JSON.stringify(home)} }) }));
			const cp = await import("node:child_process");
			mock.module("node:child_process", () => ({ ...cp, execFileSync: () => "test:x:" + process.getuid() + ":0::" + ${JSON.stringify(home)} + ":/bin/sh" }));
			const { getAgentDir } = await import(${JSON.stringify(new URL("../node_modules/@oh-my-pi/pi-utils/src/dirs.ts", import.meta.url).pathname)});
			const { loadConfig } = await import(${JSON.stringify(new URL("../src/config.ts", import.meta.url).pathname)});
			console.log(JSON.stringify({ agent: getAgentDir(), config: loadConfig(process.cwd()).provider }));
		`], { cwd: root, env, encoding: "utf8" });
		assert.equal(child.status, 0, child.stderr);
		const result = JSON.parse(child.stdout.trim());
		assert.equal(result.agent, malicious);
		assert.equal(result.config.pathToClaudeCodeExecutable, "/trusted/claude");
		assert.deepEqual(result.config.settingSources, []);
		assert.equal(result.config.strictMcpConfig, true);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("installed Bun cannot use dotenv HOME through userInfo to choose trusted config", () => {
	const root = mkdtempSync(join(tmpdir(), "bridge-native-home-"));
	const agent = join(root, ".omp", "agent");
	const executable = join(root, "malicious-claude");
	mkdirSync(agent, { recursive: true });
	writeFileSync(join(agent, "claude-bridge.json"), JSON.stringify({ provider: { pathToClaudeCodeExecutable: executable } }));
	writeFileSync(join(root, ".env"), `HOME=${root}\nPI_CODING_AGENT_DIR=${agent}\n`);
	const env = { ...process.env, CLAUDE_BRIDGE_DEBUG: "0" };
	for (const key of ["HOME", "USERPROFILE", "PI_CODING_AGENT_DIR", "OMP_PROFILE", "PI_PROFILE"]) delete env[key];
	try {
		const child = spawnSync(process.execPath, ["--eval", `
			const { loadConfig } = await import(${JSON.stringify(new URL("../src/config.ts", import.meta.url).pathname)});
			console.log(JSON.stringify(loadConfig(process.cwd()).provider));
		`], { cwd: root, env, encoding: "utf8" });
		assert.equal(child.status, 0, child.stderr);
		assert.notEqual(JSON.parse(child.stdout.trim()).pathToClaudeCodeExecutable, executable);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("non-object config and non-array sources fail closed without disabling the bridge", () => {
	for (const value of [null, [], "project", 42]) {
		const { config } = configuredSection(value, value, null);
		assert.deepEqual(config.provider.settingSources, []);
		assert.equal(config.provider.strictMcpConfig, true);
	}
	for (const value of ["project", null, {}]) {
		const { config, warnings } = configuredSection({ settingSources: ["user"] }, { settingSources: value });
		assert.deepEqual(config.settingSources, []);
		assert.match(warnings, /settingSources.*array/);
	}
});

test("inherited HOME cannot replace the passwd home and emits a mismatch warning", () => {
	const child = spawnSync(process.execPath, ["--eval", `
		const { TRUSTED_AGENT_DIR } = await import("./src/trusted-paths.ts");
		console.log(TRUSTED_AGENT_DIR);
	`], { cwd: new URL("..", import.meta.url), encoding: "utf8", env: { ...process.env, HOME: "/untrusted-home" } });
	assert.equal(child.status, 0, child.stderr);
	assert.notEqual(child.stdout.trim(), "/untrusted-home/.omp/agent");
	assert.match(child.stderr, /home.*passwd.*using passwd/i);
});

test("AskClaude global ceilings and identity cannot be loosened by projects", () => {
	const { config } = configuredSection({ enabled: false, allowFullMode: false, name: "Trusted", description: "Trusted tool" }, {
		enabled: true, allowFullMode: true, name: "Spoofed", description: "Run everything", defaultMode: "full",
	}, "askClaude");
	assert.equal(config.enabled, false);
	assert.equal(config.allowFullMode, false);
	assert.equal(config.defaultMode, "read");
	assert.equal(config.name, "Trusted");
	assert.equal(config.description, "Trusted tool");
});

test("projects may disable AskClaude or full mode, but cannot supply global identity", () => {
	const { config } = configuredSection({}, { enabled: false, allowFullMode: false, defaultMode: "full", name: "Spoofed", description: "Spoofed" }, "askClaude");
	assert.equal(config.enabled, false);
	assert.equal(config.allowFullMode, false);
	assert.equal(config.defaultMode, "read");
	assert.equal(config.name, undefined);
	assert.equal(config.description, undefined);
	assert.equal(configuredSection({ allowFullMode: true }, { defaultMode: "full" }, "askClaude").config.defaultMode, "full");
});

test("trustedEnv is an exact global-only name list", () => {
	assert.deepEqual(configuredSection({}, { trustedEnv: ["ANTHROPIC_BASE_URL"] }).config.trustedEnv, []);
	assert.deepEqual(configuredSection({ trustedEnv: ["HTTPS_PROXY", "*", 42] }, { trustedEnv: ["BASH_ENV"] }).config.trustedEnv, ["HTTPS_PROXY"]);
});
