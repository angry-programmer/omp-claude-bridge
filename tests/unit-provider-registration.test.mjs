import test from "node:test";
import assert from "node:assert/strict";

import extension from "../src/index.ts";

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
