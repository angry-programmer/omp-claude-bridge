import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverProviderModels } from "../src/discovery.ts";

const success = { queryFn: () => ({ supportedModels: async () => [{ value: "future", resolvedModel: "claude-future-6" }], close() {} }) };
const failure = { queryFn: () => { throw new Error("SDK unavailable"); } };

test("discovery failures preserve the persisted last-good catalog across calls", async () => {
	const dir = mkdtempSync(join(tmpdir(), "bridge-cache-"));
	const path = join(dir, "catalog.json");
	try {
		const good = await discoverProviderModels([], success, path);
		const saved = readFileSync(path, "utf8");
		const fallback = await discoverProviderModels([], failure, path);
		assert.deepEqual(fallback, good);
		assert.ok(fallback.some((m) => m.id === "claude-future-6"));
		assert.equal(readFileSync(path, "utf8"), saved);
		const optedIn = await discoverProviderModels([], { ...failure, includeAliases: true, contextWindow: "200k" }, path);
		assert.ok(optedIn.some((m) => m.id === "future"));
		assert.equal(optedIn.find((m) => m.id === "claude-opus-5-5").contextWindow, 200_000);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("cold or corrupt cache falls back to every retained explicit 1M selector", async () => {
	const dir = mkdtempSync(join(tmpdir(), "bridge-cache-"));
	const path = join(dir, "catalog.json");
	try {
		for (const corrupt of [false, true]) {
			if (corrupt) writeFileSync(path, "not json");
			const models = await discoverProviderModels([], failure, path);
			for (const id of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1", "claude-sonnet-5"]) {
				assert.equal(models.find((m) => m.id === `${id}[1m]`).contextWindow, 1_000_000);
			}
			if (corrupt) assert.equal(readFileSync(path, "utf8"), "not json");
		}
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
