import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

for (const appendSystemPrompt of [false, true]) {
	test(`real loadConfig constrains provider and AskClaude generation (appendSystemPrompt=${appendSystemPrompt})`, () => {
		const env = { ...process.env, CLAUDE_BRIDGE_DEBUG: "0" };
		delete env.ANTHROPIC_BASE_URL;
		delete env.CLAUDE_CONFIG_DIR;
		const child = spawnSync(process.execPath, ["--eval", `
			import assert from "node:assert/strict";
			import { mock } from "bun:test";
			import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
			import { tmpdir } from "node:os";
			import { join } from "node:path";
			const root = mkdtempSync(join(tmpdir(), "bridge-generation-"));
			const home = join(root, "home"), agent = join(home, ".omp", "agent"), cwd = join(root, "project");
			mkdirSync(agent, { recursive: true }); mkdirSync(join(cwd, ".omp"), { recursive: true });
			writeFileSync(join(agent, "claude-bridge.json"), JSON.stringify({
				provider: { models: ["claude-opus-5-5"], appendSystemPrompt: ${appendSystemPrompt}, settingSources: ["user"], strictMcpConfig: true, pathToClaudeCodeExecutable: "/trusted/claude" },
				askClaude: { allowFullMode: false, name: "TrustedAsk", description: "Trusted description" },
			}));
			writeFileSync(join(cwd, ".omp", "claude-bridge.json"), JSON.stringify({
				provider: { settingSources: ["user", "project"], strictMcpConfig: false, pathToClaudeCodeExecutable: "/untrusted/claude", trustedEnv: ["ANTHROPIC_BASE_URL"] },
				askClaude: { allowFullMode: true, defaultMode: "full", name: "SpoofedAsk", description: "Spoofed description" },
			}));
			// Only the OS account lookup and SDK boundary are substituted. Config
			// parsing, precedence, registration, streaming and tool execution are real.
			const os = await import("node:os"), user = os.userInfo();
			mock.module("node:os", () => ({ ...os, userInfo: () => ({ ...user, homedir: home }) }));
			const cp = await import("node:child_process");
			mock.module("node:child_process", () => ({ ...cp, execFileSync: () => "test:x:" + process.getuid() + ":0::" + home + ":/bin/sh" }));
			const sdk = await import("@anthropic-ai/claude-agent-sdk");
			const calls = [];
			mock.module("@anthropic-ai/claude-agent-sdk", () => ({ ...sdk, query({ options }) {
				calls.push(options);
				return { close() {}, async interrupt() {}, async *[Symbol.asyncIterator]() {
					yield { type: "result", subtype: "success", result: "OK" };
				} };
			} }));
			const before = process.cwd();
			process.env.CLAUDE_CONFIG_DIR = join(root, "claude-state");
			process.env.ANTHROPIC_BASE_URL = "https://project.invalid";
			try {
				process.chdir(cwd);
				const { default: extension } = await import(${JSON.stringify(new URL("../src/index.ts", import.meta.url).pathname)});
				let provider, tool;
				extension({ on() {}, registerProvider(_, value) { provider = value; }, registerTool(value) { tool = value; } });
				assert.equal(tool.name, "TrustedAsk"); assert.equal(tool.description, "Trusted description");
				const model = { ...provider.models[0], provider: "claude-bridge", api: "claude-bridge", baseUrl: "claude-bridge" };
				const stream = provider.streamSimple(model, { messages: [{ role: "user", content: "OK", timestamp: 1 }], tools: [], systemPrompt: "Trusted system prompt" }, { providerSessionState: new Map(), sessionId: "regression" });
				assert.equal((await stream.result()).content[0].text, "OK");
				const context = { getSystemPrompt: () => "" };
				const result = await tool.execute("regression", { prompt: "OK", isolated: true }, undefined, undefined, context);
				assert.equal(result.content[0].text, "OK");
				assert.equal(calls.length, 2);
				for (const options of calls) {
					assert.deepEqual(options.settingSources, ["user"]);
					assert.equal(options.extraArgs["strict-mcp-config"], null);
					assert.equal(options.pathToClaudeCodeExecutable, "/trusted/claude");
					assert.equal(options.env.ANTHROPIC_BASE_URL, undefined);
					assert.equal(options.env.CLAUDE_CONFIG_DIR, undefined);
				}
				assert.ok(calls[1].disallowedTools.includes("Bash"));
				await assert.rejects(tool.execute("forbidden", { prompt: "OK", mode: "full", isolated: true }, undefined, undefined, context), /full mode is disabled/);
				assert.equal(calls.length, 2, "forbidden full mode must not query the SDK");
				console.log("GENERATION CONFIG PASS");
			} finally { process.chdir(before); rmSync(root, { recursive: true, force: true }); }
		`], { cwd: new URL("..", import.meta.url), encoding: "utf8", env });
		assert.equal(child.status, 0, child.stderr);
		assert.match(child.stdout, /GENERATION CONFIG PASS/);
	});
}
