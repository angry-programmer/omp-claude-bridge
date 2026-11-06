import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function probe(body) {
	const child = spawnSync(process.execPath, ["--eval", `
		import assert from "node:assert/strict";
		import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
		import { execFileSync } from "node:child_process";
		import { tmpdir } from "node:os";
		import { join } from "node:path";
		const { buildClaudeEnv } = await import("./src/child-env.ts");
		const root = mkdtempSync(join(tmpdir(), "bridge-dotenv-files-"));
		try { ${body} } finally { rmSync(root, { recursive: true, force: true }); }
	`], { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 5_000, env: { ...process.env, NODE_ENV: "test", CLAUDE_BRIDGE_DEBUG: "0" } });
	assert.equal(child.status, 0, child.stderr || child.error?.message);
}

test("dotenv probing rejects unsafe or overlong NODE_ENV before building child paths", () => {
	probe(`
		for (const value of ["/../../outside", "..", "", "a".repeat(33), "bad.mode"]) {
			process.env.NODE_ENV = value;
			assert.throws(() => buildClaudeEnv("generation", { cwd: root }), /NODE_ENV.*invalid/i);
		}
		process.env.NODE_ENV = "production-1_ok";
		assert.equal(buildClaudeEnv("generation", { cwd: root }).NODE_ENV, "production-1_ok");
	`);
});

test("dotenv probing rejects symlinks, FIFOs, directories and oversized files without blocking", () => {
	probe(`
		const path = join(root, ".env.local");
		for (const kind of ["symlink", "fifo", "directory", "oversize"]) {
			if (kind === "symlink") symlinkSync("/dev/zero", path);
			if (kind === "fifo") execFileSync("/usr/bin/mkfifo", [path]);
			if (kind === "directory") mkdirSync(path);
			if (kind === "oversize") writeFileSync(path, "x".repeat(1024 * 1024 + 1));
			assert.throws(() => buildClaudeEnv("generation", { cwd: root }), /safely read dotenv/i, kind);
			rmSync(path, { recursive: true, force: true });
		}
	`);
});
