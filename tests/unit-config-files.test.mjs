import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("trusted global symlinks preserve policy; rejected global files disable AskClaude and keep isolation", () => {
	const child = spawnSync(process.execPath, ["--eval", `
		import assert from "node:assert/strict";
		import { mock } from "bun:test";
		import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync, rmSync } from "node:fs";
		import { tmpdir } from "node:os";
		import { join } from "node:path";
		import { execFileSync } from "node:child_process";
		const root = mkdtempSync(join(tmpdir(), "bridge-config-files-"));
		const agent = join(root, "agent"), cwd = join(root, "project");
		mkdirSync(agent); mkdirSync(join(cwd, ".omp"), { recursive: true });
		mock.module("./src/trusted-paths.ts", () => ({ TRUSTED_AGENT_DIR: agent }));
		const { loadConfig } = await import("./src/config.ts");
		const payload = JSON.stringify({ askClaude: { enabled: false, allowFullMode: false }, provider: { includeAliases: true, settingSources: ["user"], strictMcpConfig: false } });
		const target = join(root, "valid.json"); writeFileSync(target, payload, { mode: 0o600 });
		const original = console.error, warnings = [];
		console.error = (...args) => warnings.push(args.join(" "));
		try {
			const globalPath = join(agent, "claude-bridge.json");
			const absent = loadConfig(cwd);
			assert.equal(absent.askClaude.enabled, true);
			assert.equal(warnings.length, 0);
			symlinkSync(target, globalPath);
			const linked = loadConfig(cwd);
			assert.equal(linked.askClaude.enabled, false);
			assert.equal(linked.askClaude.allowFullMode, false);
			assert.deepEqual(linked.provider.settingSources, ["user"]);
			assert.equal(linked.provider.strictMcpConfig, false);
			assert.equal(warnings.length, 0);
			rmSync(globalPath);
			for (const path of [join(agent, "claude-bridge.json"), join(cwd, ".omp", "claude-bridge.json")]) {
				for (const kind of [path === globalPath ? "symlink-bad" : "symlink", "dangling", "fifo", "device", "directory", "oversize", "malformed"]) {
					if (kind === "symlink-bad") { chmodSync(target, 0o666); symlinkSync(target, path); }
					if (kind === "symlink") symlinkSync(target, path);
					if (kind === "dangling") symlinkSync(join(root, "missing.json"), path);
					if (kind === "fifo") execFileSync("/usr/bin/mkfifo", [path]);
					if (kind === "device") symlinkSync("/dev/zero", path);
					if (kind === "directory") mkdirSync(path);
					if (kind === "oversize") writeFileSync(path, payload + " ".repeat(1024 * 1024));
					if (kind === "malformed") writeFileSync(path, "supersecret_token_from_project");
					warnings.length = 0;
					const config = loadConfig(cwd);
					assert.equal(config.provider.includeAliases, undefined, kind + ": " + path);
					assert.deepEqual(config.provider.settingSources, []);
					assert.equal(config.provider.strictMcpConfig, true);
					if (path === globalPath) {
						assert.equal(config.askClaude.enabled, false, kind);
						assert.equal(config.askClaude.allowFullMode, false, kind);
						assert.equal(warnings.length, 1, kind);
						assert.match(warnings[0], /global.*disabled/i);
					}
					assert.ok(warnings.some(line => /failed to (read|parse)/.test(line)), kind);
					assert.equal(warnings.join("\\n").includes("supersecret"), false);
					rmSync(path, { recursive: true, force: true });
					chmodSync(target, 0o600);
				}
			}
			console.log("CONFIG FILE BOUNDARY PASS");
		} finally { console.error = original; rmSync(root, { recursive: true, force: true }); }
	`], { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 10_000 });
	assert.equal(child.status, 0, child.stderr);
	assert.match(child.stdout, /CONFIG FILE BOUNDARY PASS/);
});
