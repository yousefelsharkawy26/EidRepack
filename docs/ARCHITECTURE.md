# Architecture

## Runtime and trust boundaries

EidRepack is an Electron desktop application. The renderer is a React/Vite UI and is treated as untrusted: it receives a narrow preload bridge, never a database handle. Electron main owns authentication, the active user context, authorization, SQLite access, file dialogs, printing, and external links.

```text
src/App.tsx
  └─ app/AppProvider.tsx ── shared/api (typed commands, query cache)
       └─ app/screens.ts ── features/<feature>/Page.tsx
                              └─ feature components, hooks, mappers

electron/main.cjs ── services/ipc.cjs ── core/dispatcher.cjs
                                          ├─ core/registry.cjs + policy.cjs
                                          ├─ modules/<feature>/
                                          ├─ services/operations.cjs
                                          └─ migrations/ + SQLite
electron/preload.cjs exposes the allowlisted bridge to the renderer.
```

## Layering rules

- Renderer features call registered commands/queries through the typed shared API; they do not import Electron or SQL modules.
- The main-process dispatcher derives user identity from the authenticated session, validates command payloads, checks registry roles, runs mutations transactionally, records idempotency, and applies cost redaction to non-owner results.
- Feature modules own their command/query schemas and domain handlers. Shared infrastructure (transactions, registry, policy, audit, database) stays in `electron/core` and `electron/services`.
- SQLite changes are append-only numbered migrations. Never edit an applied migration; add a new migration and cover it with migration tests.
- `AppProvider` owns session/snapshot state and command feedback. Feature hooks own local drafts; feature mappers convert the typed backend snapshot into renderer domain models.
- Screen navigation is declared in `src/app/screens.ts`; the backend session permission response determines the visible screens. UI filtering is convenience, not an authorization boundary.
- Shared visual primitives belong in `src/shared/ui`; feature-specific presentation belongs beside the feature.

## Verification

Use `npm run lint`, `npm run typecheck`, `npm test`, `npx vitest run`, `npm run check:module-cycles`, and `npm run build`. `npm test` rebuilds `better-sqlite3` for Node before running backend tests.
