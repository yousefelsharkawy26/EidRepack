# Snapshot performance

Measured with the in-memory SQLite schema, 5,000 seeded confirmed sales and one line per sale. Timing includes the backend `buildSnapshot` SQL reads and renderer `mapSnapshot` conversion; Electron IPC transport/serialization is excluded.

| Environment | Sales | Query + mapping |
| --- | ---: | ---: |
| Node.js 24.16.0, 2026-10-03 | 5,000 | 54.3 ms |

The Phase 0 baseline did not include a seeded snapshot benchmark, so this is a post-refactor reference measurement rather than a before/after comparison. The fixture and measurement are repeatable with `npx vitest run tests/frontend/snapshot-performance.test.ts`.

Feature-specific database queries were not introduced: at this measured size the composed snapshot query/mapping is inexpensive, and splitting it would add permission/redaction and invalidation complexity without demonstrated benefit.
