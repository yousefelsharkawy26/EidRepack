# Contributing

## Commit style

Use a short imperative subject in `type(scope): summary` form when practical, for example `fix(purchases): confirm edited draft values`. Keep one logical change per commit and explain user-visible behavior or migration implications in the body.

## Local verification

```sh
npm ci
npm run lint
npm run typecheck
npm test
npx vitest run
npm run check:module-cycles
npm run build
```

`npm test` runs `pretest`, which rebuilds `better-sqlite3` for the current Node runtime. Before running the Electron desktop app or packaging, use the corresponding Electron rebuild scripts (`npm run desktop` / `npm run package` already invoke their pre-scripts).

## Database and IPC rules

- Add a new numbered SQL migration; never modify a migration that may already exist in a user's database.
- Register each command/query once with a runtime schema and explicit role allowlist. Main-process session state is authoritative; never trust renderer-provided identity or role.
- Keep multi-write business operations atomic and audited. Keep retries idempotent with a client request id.
- Add tests for success, validation/permission errors, audit/idempotency, and rollback where applicable. Ensure non-owner query/command results do not expose costs.
- Regenerate `docs/COMMANDS.md` with `npm run docs:commands` after registry changes.

## UI and documentation

Keep screens registered in `src/app/screens.ts`, feature state in feature hooks, and reusable controls in `src/shared/ui`. Preserve Arabic copy and RTL behavior. Update architecture/feature documentation when the layering or workflow changes; use `docs/ADDING_A_FEATURE.md` for the end-to-end checklist.
