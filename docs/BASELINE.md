# Baseline

Captured on 2026-10-03 before Phase 0 tooling changes.

| Command | Result |
| --- | --- |
| `npm ci` | Passed; dependencies installed from the existing lockfile. |
| `npm test` | Passed; backend migration, operations, and integration suites had no failures. |
| `npm run build` | Passed; TypeScript build and Vite production bundle completed. |

Environment: Node.js `v24.16.0`, npm `11.13.0`.

The baseline intentionally records the project before refactoring. Phase 0 adds tooling and characterization tests only; application behavior is unchanged.
