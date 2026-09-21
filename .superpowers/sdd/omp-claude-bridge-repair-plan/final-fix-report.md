# Final fix report

## Session-state isolation

- Claude resume state now lives in a `SessionState` record stored in the caller-owned `SimpleStreamOptions.providerSessionState` map.
- The state key is namespaced by the OMP `sessionId` and working directory, so the shared module-level `streamClaudeAgentSdk` function cannot select another runtime's Claude UUID or cursor.
- `SessionState` implements OMP's `ProviderSessionState.close()` contract. Closed records are replaced rather than reused.
- History fingerprints supplement the cursor guard. Compaction, tree navigation, same-length rewrites, and working-directory changes take the rebuild path instead of reusing an unrelated Claude JSONL session.
- Tool-result cursor updates, abort/force-rotate handling, continuation resumes, completion capture, and error cleanup all update only the resolved session record.
- Lifecycle handlers no longer clear or mark module-global resume state. Provider maps remain owned and disposed by OMP; the only lifecycle-local record is the runtime closure used for non-isolated AskClaude calls.
- AskClaude shared-mode continuity remains available within one extension runtime, while isolated calls remain non-persistent. It does not consult the shared stream callback's module state.
- Provider registration remains unchanged: each runtime registers the same `streamClaudeAgentSdk` function identity.

## TDD evidence

### RED

Command:

```bash
bun test tests/unit-provider-registration.test.mjs
```

Result before the implementation:

```text
TypeError: __test.getSessionState is not a function
1 pass
1 fail
Ran 2 tests across 1 file.
```

The failure was the missing session-owned state seam exercised by the new interleaved-runtime regression.

### GREEN

Command:

```bash
bun test tests/unit-provider-registration.test.mjs
```

Result after the implementation:

```text
2 pass
0 fail
Ran 2 tests across 1 file.
```

The regression creates two provider state maps with distinct OMP session IDs, interleaves synchronization and cursor updates, and verifies each call resumes its own Claude UUID.

## Documentation and runner guidance

- README context-window language now points to canonical OMP metadata/static defaults rather than a measured policy.
- README, CONTRIBUTING, and the PR template explicitly identify served-window logs as entitlement diagnostics.
- Bun is required for contributor installation/checks, and the documented runner is Bun rather than Node's test runner.
- Test filename references use `.test.mjs` (`tests/unit-context-window.test.mjs`).

## Compatibility fallback

Callers that omit `providerSessionState` receive a fresh, call-local session record. This deliberately avoids reintroducing module-global mutable Claude resume state; those legacy calls do not persist Claude resume/cursor state between independent calls. Active tool-result delivery and reentrant query handling continue to use their existing per-query context while a call is active. Callers that provide a map (the OMP 18 path) retain resume continuity across turns.

## Commands run

```bash
bun install --frozen-lockfile
# 238 packages installed

bun test tests/unit-provider-registration.test.mjs
# 2 pass, 0 fail
```

Per the fix-wave constraints, formatters, linters, typecheck, and the project-wide test suite were not run.
