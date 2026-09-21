# Test Runner Repair Report

## Changes

- Updated `package.json` scripts:
  - `test`: `bun test tests`
  - `test:unit`: `bun test tests`
- Removed the unused `tsx` devDependency.
- Regenerated `bun.lock`; the lockfile no longer contains `tsx` or its now-unused `esbuild` dependency tree.
- Renamed the three legacy unit tests to Bun-discoverable names:
  - `tests/unit-context-window.test.mjs`
  - `tests/unit-dynamic-models.test.mjs`
  - `tests/unit-rate-limit.test.mjs`
- Kept `tests/unit-provider-registration.test.mjs` unchanged.

## Focused verification

The requested focused Bun checks passed:

```text
$ bun test tests/unit-context-window.test.mjs
bun test v1.3.10 (30e609e0)
 10 pass
 0 fail
Ran 10 tests across 1 file. [21.00ms]

$ bun test tests/unit-provider-registration.test.mjs
bun test v1.3.10 (30e609e0)
 1 pass
 0 fail
Ran 1 test across 1 file. [598.00ms]
```

The full test suite was not run, as requested.

## Scope review

- No product source files were modified.
- No test bodies were modified; the three legacy test changes are file renames only.
- All four unit files now use the `.test.mjs` Bun naming convention.
- The focused provider-registration test imports the OMP 18 extension successfully under Bun.
