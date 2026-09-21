import test from "node:test";
import assert from "node:assert/strict";

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
