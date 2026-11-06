import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

for (const failure of ["missing-binary", "timeout", "missing-entry", "invalid-record", "native-lookup-fails"]) {
	test(`passwd ${failure} fails closed with a bridge diagnostic, never raw lookup output`, () => {
		const child = spawnSync(process.execPath, ["--eval", `
			import { mock } from "bun:test";
			const cp = await import("node:child_process");
			const failure = ${JSON.stringify(failure)};
			mock.module("node:child_process", () => ({ ...cp, execFileSync() {
				if (failure === "invalid-record") return "sensitive_lookup_output";
				throw Object.assign(new Error("sensitive_lookup_output"), failure === "missing-binary" ? { code: "ENOENT" } : failure === "timeout" ? { code: "ETIMEDOUT" } : { status: 2 });
			} }));
			if (failure === "native-lookup-fails") {
				const os = await import("node:os");
				mock.module("node:os", () => ({ ...os, userInfo() { throw new Error("sensitive_lookup_output"); } }));
			}
			try { await import("./src/trusted-paths.ts"); }
			catch (error) { console.error(error.message); process.exitCode = 1; }
		`], { cwd: new URL("..", import.meta.url), encoding: "utf8", env: { ...process.env, HOME: "/untrusted-home" } });
		assert.equal(child.status, 1);
		assert.match(child.stderr, /claude-bridge: passwd home lookup failed/);
		assert.match(child.stderr, /refusing to load trusted configuration/);
		assert.doesNotMatch(child.stderr, /sensitive_lookup_output/);
	});
}
