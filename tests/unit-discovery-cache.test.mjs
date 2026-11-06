import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { discoverProviderModels } from "../src/discovery.ts";

const success = { queryFn: () => ({ supportedModels: async () => [{ value: "future", resolvedModel: "claude-future-6" }], close() {} }) };
const failure = { queryFn: () => { throw new Error("SDK unavailable"); } };

test("discovery failures preserve the persisted last-good catalog across calls", async () => {
	const dir = mkdtempSync(join(tmpdir(), "bridge-cache-"));
	const path = join(dir, "catalog.json");
	try {
		const good = await discoverProviderModels([], success, path);
		const saved = readFileSync(path, "utf8");
		const snapshot = JSON.parse(saved);
		assert.equal(snapshot.version, 1);
		assert.ok(snapshot.savedAt <= Date.now() && snapshot.savedAt > Date.now() - 10_000);
		assert.deepEqual(snapshot.models, [{ value: "future", resolvedModel: "claude-future-6" }]);
		assert.equal(statSync(path).mode & 0o777, 0o600);
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

test("fallback reports snapshot age and rejects unsupported envelopes", async () => {
	const dir = mkdtempSync(join(tmpdir(), "bridge-cache-"));
	const path = join(dir, "catalog.json");
	const models = [{ value: "claude-future-6" }];
	const warnings = [];
	const original = console.error;
	console.error = (...args) => warnings.push(args.join(" "));
	try {
		writeFileSync(path, JSON.stringify({ version: 1, savedAt: Date.now() - 120_000, models }));
		assert.ok((await discoverProviderModels([], failure, path)).some((m) => m.id === "claude-future-6"));
		assert.ok(warnings.some((warning) => /last-good.*age 12[0-9]s/.test(warning)));
		for (const snapshot of [
			models,
			{ version: 2, savedAt: Date.now(), models },
			{ version: 1, savedAt: "yesterday", models },
			{ version: 1, savedAt: Date.now() + 60_000, models },
			{ version: 1, savedAt: Date.now(), models: [] },
		]) {
			const bytes = JSON.stringify(snapshot);
			writeFileSync(path, bytes);
			assert.equal((await discoverProviderModels([], failure, path)).some((m) => m.id === "claude-future-6"), false);
			assert.equal(readFileSync(path, "utf8"), bytes);
		}
	} finally { console.error = original; rmSync(dir, { recursive: true, force: true }); }
});

test("a snapshot save failure preserves successful discovery and cleans its temporary file", async () => {
	const dir = mkdtempSync(join(tmpdir(), "bridge-cache-"));
	const path = join(dir, "catalog.json");
	mkdirSync(path);
	const warnings = [];
	const original = console.error;
	console.error = (...args) => warnings.push(args.join(" "));
	try {
		const models = await discoverProviderModels([], success, path);
		assert.ok(models.some((model) => model.id === "claude-future-6"));
		assert.ok(warnings.some((warning) => warning.includes("could not save last-good model catalog")));
		assert.deepEqual(readdirSync(dir), ["catalog.json"]);
		assert.equal(statSync(path).isDirectory(), true);
	} finally { console.error = original; rmSync(dir, { recursive: true, force: true }); }
});

test("snapshot reads reject symlinks, non-regular files and files over 1 MB", async () => {
	const dir = mkdtempSync(join(tmpdir(), "bridge-cache-"));
	const valid = join(dir, "valid.json");
	const link = join(dir, "link.json");
	const large = join(dir, "large.json");
	try {
		const fifo = join(dir, "fifo");
		assert.equal(spawnSync("/usr/bin/mkfifo", [fifo]).status, 0);
		const envelope = JSON.stringify({ version: 1, savedAt: Date.now(), models: [{ value: "claude-future-6" }] });
		writeFileSync(valid, envelope);
		symlinkSync(valid, link);
		writeFileSync(large, envelope + " ".repeat(1024 * 1024));
		for (const path of [link, dir, large, fifo, "/dev/zero"]) {
			const models = await discoverProviderModels([], failure, path);
			assert.equal(models.some((model) => model.id === "claude-future-6"), false);
			assert.ok(models.some((model) => model.id === "claude-opus-5-5"));
		}
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
