# Adding a feature

This guide covers a complete backend command and renderer screen using existing architecture. Follow the same sequence for smaller changes, skipping layers that are not needed.

1. **Database, only if needed.** Add the next numbered SQL migration under `electron/migrations/`; do not edit an applied migration. Include migration/rollback or invariant coverage in `tests/migrations.test.cjs`.
2. **Backend module.** Add a feature directory under `electron/modules/<feature>/`. Define each mutation/query once in the registry with a Zod schema, explicit role allowlist, and handler. Use the shared transaction/audit helpers for mutations, and keep multi-step work atomic. Add the module to `electron/modules/index.cjs`.
3. **Backend tests.** Cover the successful operation, invalid input, denied role, idempotent replay, audit record, rollback on a failed step, and cost redaction when the result contains financial-cost data.
4. **Typed contract.** Add the command/query name and input/output types in `src/shared/api/commands.ts`. The renderer should call only this typed bridge; never pass identity or role supplied by the UI.
5. **Renderer feature.** Create `src/features/<feature>/` with a `Page.tsx`, feature-local components/hooks, and snapshot mapper/tests as needed. Use `useApp()` for shared session/snapshot/commands and `src/shared/ui` for common controls.
6. **Navigation and permissions.** Register the screen in `src/app/screens.ts`. Add/adjust backend policy roles; do not create a second renderer-side role matrix. Confirm unauthorized IPC is rejected even if a user manually invokes the bridge.
7. **Docs and generated artifacts.** Run `npm run docs:commands` when registry definitions change, then include the generated `docs/COMMANDS.md` update.
8. **Verify before handoff.** Run `npm run lint`, `npm run typecheck`, `npm test`, `npx vitest run`, `npm run check:module-cycles`, and `npm run build`. Run the applicable desktop smoke flow; mark any deferred manual role flow explicitly in `docs/SMOKE_TEST.md`.

Example reference: a new `expense:save` command normally touches a migration (if needed), `electron/modules/expenses/`, the command contract, `src/features/expenses/`, one screen registration, tests, and generated command docs.
