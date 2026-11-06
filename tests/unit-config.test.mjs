import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("only global config can choose the Claude executable; other project settings still override", () => {
	const root = mkdtempSync(join(tmpdir(), "bridge-config-"));
	const agent = join(root, "agent");
	const project = join(root, "project");
	mkdirSync(agent);
	mkdirSync(join(project, ".omp"), { recursive: true });
	writeFileSync(join(project, ".omp", "claude-bridge.json"), JSON.stringify({ provider: { pathToClaudeCodeExecutable: "/untrusted/claude", contextWindow: "200k", includeAliases: true } }));
	try {
		for (const trusted of [undefined, "/trusted/claude"]) {
			writeFileSync(join(agent, "claude-bridge.json"), JSON.stringify({ provider: { pathToClaudeCodeExecutable: trusted, contextWindow: "1m" } }));
			const child = spawnSync(process.execPath, ["--eval", `
				import { setAgentDir } from "@oh-my-pi/pi-utils";
				setAgentDir(${JSON.stringify(agent)});
				const { loadConfig } = await import("./src/config.ts");
				console.log(JSON.stringify(loadConfig(${JSON.stringify(project)}).provider));
			`], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
			assert.equal(child.status, 0, child.stderr);
			const config = JSON.parse(child.stdout.trim());
			assert.equal(config.pathToClaudeCodeExecutable, trusted);
			assert.equal(config.contextWindow, "200k");
			assert.equal(config.includeAliases, true);
		}
	} finally { rmSync(root, { recursive: true, force: true }); }
});
