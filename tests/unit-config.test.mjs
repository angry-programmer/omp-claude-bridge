import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function configuredProvider(global, project) {
	const root = mkdtempSync(join(tmpdir(), "bridge-config-"));
	const agent = join(root, "agent");
	const cwd = join(root, "project");
	mkdirSync(agent);
	mkdirSync(join(cwd, ".omp"), { recursive: true });
	writeFileSync(join(agent, "claude-bridge.json"), JSON.stringify({ provider: global }));
	writeFileSync(join(cwd, ".omp", "claude-bridge.json"), JSON.stringify({ provider: project }));
	try {
		const child = spawnSync(process.execPath, ["--eval", `
			import { setAgentDir } from "@oh-my-pi/pi-utils";
			setAgentDir(${JSON.stringify(agent)});
			const { loadConfig } = await import("./src/config.ts");
			console.log(JSON.stringify(loadConfig(${JSON.stringify(cwd)}).provider));
		`], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
		assert.equal(child.status, 0, child.stderr);
		return { config: JSON.parse(child.stdout.trim()), warnings: child.stderr };
	} finally { rmSync(root, { recursive: true, force: true }); }
}

test("only global config can choose the Claude executable; other project settings still override", () => {
	for (const trusted of [undefined, "/trusted/claude"]) {
		const { config } = configuredProvider({ pathToClaudeCodeExecutable: trusted, contextWindow: "1m" }, {
			pathToClaudeCodeExecutable: "/untrusted/claude", contextWindow: "200k", includeAliases: true,
		});
		assert.equal(config.pathToClaudeCodeExecutable, trusted);
		assert.equal(config.contextWindow, "200k");
		assert.equal(config.includeAliases, true);
	}
});

test("project settings cannot enable settings sources or filesystem MCP by default", () => {
	const { config, warnings } = configuredProvider({}, { settingSources: ["user", "project"], strictMcpConfig: false });
	assert.deepEqual(config.settingSources, []);
	assert.equal(config.strictMcpConfig, true);
	assert.match(warnings, /settingSources.*loosen/);
	assert.match(warnings, /strictMcpConfig.*loosen/);
});

test("project settings may reduce trusted sources and enable strict MCP", () => {
	const { config, warnings } = configuredProvider({ settingSources: ["user", "project"], strictMcpConfig: false }, { settingSources: ["user"], strictMcpConfig: true });
	assert.deepEqual(config.settingSources, ["user"]);
	assert.equal(config.strictMcpConfig, true);
	assert.equal(warnings, "");
});

test("adding a project source keeps only globally allowed sources and warns", () => {
	const { config, warnings } = configuredProvider({ settingSources: ["user"], strictMcpConfig: true }, { settingSources: ["user", "project"], strictMcpConfig: false });
	assert.deepEqual(config.settingSources, ["user"]);
	assert.equal(config.strictMcpConfig, true);
	assert.match(warnings, /settingSources.*loosen/);
	assert.match(warnings, /strictMcpConfig.*loosen/);
});
