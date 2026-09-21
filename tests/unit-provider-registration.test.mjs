import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import extension, { __test } from "../src/index.ts";

function fakeRuntime() {
	const providers = [];
	const events = new Map();
	return {
		providers,
		events,
		on(event, handler) {
			events.set(event, handler);
		},
		registerProvider(id, provider) {
			providers.push({ id, provider });
		},
		registerTool() {},
	};
}

test("factory registers one provider in each runtime with the shared stream function", () => {
	const firstRuntime = fakeRuntime();
	const secondRuntime = fakeRuntime();

	extension(firstRuntime);
	extension(secondRuntime);

	assert.equal(firstRuntime.providers.length, 1);
	assert.equal(secondRuntime.providers.length, 1);
	assert.equal(firstRuntime.providers[0].provider.streamSimple, secondRuntime.providers[0].provider.streamSimple);
});

test("isolates Claude resume state across interleaved provider session maps", () => {
	const firstStates = new Map();
	const secondStates = new Map();
	const cwd = process.cwd();
	const context = [
		{ role: "user", content: "first prompt", timestamp: 1 },
		{ role: "assistant", content: [{ type: "text", text: "first reply" }], timestamp: 2 },
		{ role: "user", content: "second prompt", timestamp: 3 },
	];

	const first = __test.getSessionState(firstStates, "runtime-a", cwd);
	Object.assign(first, { sessionId: "claude-a", cursor: 2, cwd });
	const second = __test.getSessionState(secondStates, "runtime-b", cwd);
	Object.assign(second, { sessionId: "claude-b", cursor: 2, cwd });
	const moved = __test.getSessionState(firstStates, "runtime-a", `${cwd}-moved`);
	assert.notEqual(moved, first);

	assert.equal(__test.syncSharedSession(context, cwd, undefined, "claude-sonnet", first).sessionId, "claude-a");
	assert.equal(__test.syncSharedSession(context, cwd, undefined, "claude-sonnet", second).sessionId, "claude-b");
	first.cursor = context.length - 1;
	assert.equal(__test.syncSharedSession(context, cwd, undefined, "claude-sonnet", first).sessionId, "claude-a");
	assert.equal(second.sessionId, "claude-b");
	assert.notEqual(first.sessionId, second.sessionId);
	assert.notEqual(firstStates, secondStates);
});

test("preserves the later tool-result cursor after stale query completion", () => {
	const cwd = process.cwd();
	const originalContext = [
		{ role: "user", content: "prompt", timestamp: 1 },
		{ role: "assistant", content: [{ type: "text", text: "tool call" }], timestamp: 2 },
	];
	const laterContext = [
		...originalContext,
		{ role: "toolResult", toolCallId: "tool-1", content: [{ type: "text", text: "done" }], timestamp: 3 },
	];
	const nextContext = [...laterContext, { role: "user", content: "next", timestamp: 4 }];
	const state = __test.createSessionState();

	__test.recordSessionCompletion(state, "claude-a", originalContext.length, cwd, originalContext);
	__test.recordToolResultCursor(state, laterContext);
	__test.recordSessionCompletion(state, "claude-a", laterContext.length, cwd, originalContext);

	assert.equal(
		__test.syncSharedSession(nextContext, cwd, undefined, "claude-sonnet", state).sessionId,
		"claude-a",
	);
	assert.equal(state.cursor, laterContext.length);
});

test("rebuilds after a shortened rewritten history instead of preserving stale Claude state", () => {
	const cwd = process.cwd();
	const configDir = mkdtempSync(join(tmpdir(), "omp-claude-bridge-"));
	const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
	process.env.CLAUDE_CONFIG_DIR = configDir;
	try {
		const state = __test.createSessionState();
		Object.assign(state, { sessionId: "claude-old", cursor: 3, cwd });
		const rewrittenContext = [
			{ role: "user", content: "compacted summary", timestamp: 1 },
			{ role: "user", content: "next prompt", timestamp: 2 },
		];

		const result = __test.syncSharedSession(rewrittenContext, cwd, undefined, "claude-sonnet", state);

		assert.equal(result.sessionId, "claude-old");
		assert.equal(result.preserveSharedSession, undefined);
		assert.equal(state.cursor, 1);
	} finally {
		if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
		else process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
		rmSync(configDir, { recursive: true, force: true });
	}
});
