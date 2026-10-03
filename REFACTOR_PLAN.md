# REFACTOR_PLAN.md — Repack Manager (EidRepack)

> Purpose: make the codebase clean, easy to maintain, and cheap to extend with new features.
> Audience: an AI coding agent (Claude Code, Cursor, Copilot Agent, Codex, Windsurf, etc.) working inside the repo.
> How to use: put this file in the repo root. Run the **Master Prompt**, then execute **one phase per session/branch**. Stop after each phase for human review.

---

## 0. Master Prompt (paste this first)

```
You are refactoring an existing Electron + React + SQLite desktop app (Arabic-first, RTL).
Read REFACTOR_PLAN.md fully before touching code.

Rules:
1. Execute ONLY the phase I name. Do not start the next phase.
2. Behavior must not change unless the phase explicitly says so.
3. The existing tests (`npm test`) must pass before and after every phase. If they fail before you start, report it and stop.
4. Respect every item in section 2 (Invariants). They protect financial correctness and security.
5. Never edit or rename an existing file in electron/migrations/*.sql (checksums are verified). New schema changes = new numbered migration only.
6. Preserve all Arabic UI strings exactly. Do not translate, reword, or "fix" them.
7. Prefer complete file rewrites over scattered patches when a file is being restructured.
8. Work in small commits, one per task, with message `phaseN: <task>`.
9. When done, output: (a) files added/moved/deleted, (b) commands you ran and their results, (c) anything you could not finish and why.

Start with: "Execute Phase 0".
```

---

## 1. Project snapshot

| Item | Value |
|---|---|
| Name | `repack-manager` (productName: مدير التعبئة) |
| Purpose | Buy bulk → repack/pack → credit sales → collections, reminders (WhatsApp), reports |
| Stack | Electron 44, React 18, TypeScript (strict), Vite 6, better-sqlite3, zod 4, bcryptjs, lucide-react |
| Process model | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` |
| Custom protocol | `app://renderer/index.html` in production, Vite dev server in dev |
| Roles | `owner`, `sales`, `warehouse`, `purchasing` |
| Money | integer piasters (`*Minor`); UI converts EGP ↔ minor only in `src/lib/api.ts` |
| Quantities | integer base units (`*Base`); display units via item `unitFactor` |
| Tests | `node --test tests/*.test.cjs` (backend only: migrations, operations, integration over IPC) |
| Scripts | `npm run dev`, `npm run desktop`, `npm test`, `npm run build`, `npm run package` |
| Git | No `.git` in the archive → Phase 0 initializes it |

### Current layout (before)

```
electron/
  main.cjs                 # window + DB init + legacy import + backup/restore/whatsapp/print handlers (all inline)
  preload.cjs              # hand-written list of 24 operations + 5 queries
  security.cjs  csp.cjs  app-protocol.cjs  units.cjs
  services/
    ipc.cjs                # channels map + rolePermissions + payload schema + dispatcher + query handlers
    operations.cjs         # ~920 lines: ALL business commands + shared helpers (atomic, write, audit, FIFO…)
    queries.cjs            # buildSnapshot (whole-app snapshot)
  migrations/
    001…007 *.sql  runner.cjs
    import-legacy.cjs      # ~990 lines, one-time legacy import
src/
  App.tsx                  # auth phases, global state, keyboard shortcuts, big switch(screen)
  lib/ api.ts domain.ts helpers.ts types.ts
  pages/                   # 13 flat page files, several 600–770 lines with 10–19 useState each
  components/              # 6 tiny components
  styles.css               # single 21 KB file; 89 inline style={{}} usages across src/
tests/                     # integration, migrations, operations
```

### Problems this plan fixes (verified in code)

1. **Adding one command touches ~10 places**: `operations.cjs`, `ipc.cjs` (`channels` AND `rolePermissions`), `preload.cjs`, `api.ts` (Snapshot + `mapSnapshot`), `domain.ts`, `types.ts` (`Screen`, `nav`), `helpers.ts` (`roleScreens`), `App.tsx` (`switch`).
2. **God files**: `operations.cjs` (all domains), `main.cjs` (system handlers inline), `import-legacy.cjs`.
3. **Permissions duplicated**: `rolePermissions` (backend) vs `roleScreens` (frontend).
4. **Weak typing**: ~27 `any` / `any[]`; `Snapshot` is mostly `any[]`; `callOperation(name: string, payload: Record<string, unknown>) => any`; `bridge().operations` is `Record<string, …>`.
5. **`mapSnapshot` is one ~200-line function**; every mutation reloads the whole snapshot.
6. **Prop drilling**: every page receives `state, run, busy, notify, currentUser`.
7. **Oversized pages**: `Collections` (772 lines/17 `useState`), `Inventory` (683/19), `Suppliers` (616/19), `PackingWorkspace` (614/10).
8. **Duplicated/leaked logic**: `localDateString` defined in `domain.ts`, `queries.cjs`, `operations.cjs`; client-side `creditCheck`/`allocateFromLots`/`saleStatus` re-implement backend rules; unit factors in `types.ts` (`UNIT_FACTORS`) and `electron/units.cjs` (verify overlap).
9. **Mixed responsibilities**: `types.ts` holds nav + icons; `helpers.ts` holds print HTML templates, statement math, permission checks, label maps.
10. **No lint/format/CI, no frontend tests.**

---

## 2. Invariants (never violate)

These are correctness/security rules already enforced by the code. Any refactor must keep them identical.

**Financial / data**
- All money is integer piasters in the backend. Floats only at the UI conversion boundary (`toMinor`, `toEgp`, `toBase`, `toDisplay`).
- Every state-changing command runs inside one `better-sqlite3` transaction using `.immediate()`; failure rolls back everything.
- `atomic()` + `write()` + `failController` (`failAfterStep`) fault-injection stays — tests depend on it.
- Rounding uses `roundHalfUp` (BigInt-based). Do not replace with `Math.round` in the backend.
- FIFO lot consumption (`consumeFifo`, `consumeSpecificLots`) and costing method (`FIFO`/`WAVG`) behavior unchanged.
- Every command writes an `audit_log` row via `audit()`.
- `checkInvariants(db)` stays and keeps passing.

**IPC / security**
- Identity (`userId`, `role`, `ctx`) always comes from the main-process session. The renderer must never be able to send it (current `payloadSchema` rejects `userId`, `currentUserId`, `currentUserRole`, `ctx`; `role` rejected except for `user:save`).
- Every operation payload needs `clientRequestId` (8–128 chars). Replays return the stored result; same id + different command → error.
- Replay lookup is by `(user_id, client_request_id)` in `command_log`; result is stored after success inside the same transaction.
- Payload size limit 64,000 chars JSON; print payload ≤ 4 MB; WhatsApp payload validated by zod tuple.
- `redactCosts` is applied to results for non-owner roles (keys matching cost/cogs/profit/margin/valuation/unitCost/costMinor).
- `assertTrustedFrame(event)` on every handler (main frame + trusted URL only).
- Role/active changes via `user:save` invalidate the user's session (`security.invalidate`).
- PIN elevation (`security:elevate`, scopes `inventory-adjustment`, `customer-credit`) semantics unchanged; blocked customers can never be overridden.
- Preload runs with `sandbox: true`: it may only `require('electron')`. It cannot import local project files. Keep it generic and tiny.
- CSP, `will-navigate` blocking, `setWindowOpenHandler(deny)`, custom `app://` protocol unchanged.

**Migrations**
- Existing `001…007` SQL files are immutable (checksum-verified by `runner.cjs`; `tests/migrations.test.cjs` enforces sequential numbering and tamper detection).
- New schema work = `008_*.sql`, `009_*.sql`, … only.

**UI**
- App is Arabic-first RTL (`dir="rtl"`). Preserve all strings, fonts (`src/fonts`), and keyboard shortcuts (F2 sales, F3 purchases, F4 packing, Ctrl+K search).

---

## 3. Target architecture

```
electron/
  main.cjs                         # bootstrap only (~60 lines)
  preload.cjs                      # generic bridge: invoke(command), query(name), + system calls
  system/
    backup.cjs  whatsapp.cjs  print.cjs  window.cjs  trusted-frame.cjs
  security/ (security.cjs, csp.cjs, app-protocol.cjs)
  core/
    db.cjs                         # open/close/reopen, configure
    tx.cjs                         # atomic, write, failController
    audit.cjs  ids.cjs  dates.cjs  money.cjs (roundHalfUp)  units.cjs
    inventory-fifo.cjs             # availableLots, consumeFifo, consumeSpecificLots
    registry.cjs                   # defineCommand / defineQuery / lookup
    dispatcher.cjs                 # payload validation, idempotency, permissions, redaction, tx, command_log
    policy.cjs                     # roles → commands, roles → screens (single source of truth)
  modules/
    sales/       commands.cjs  queries.cjs  rules.cjs  index.cjs
    purchases/   …
    packing/     …
    inventory/   …
    customers/   …
    suppliers/   …
    collections/ …   (collect, promise, reverse payment, write-off)
    reminders/   …
    settings/    …
    users/       …
    index.cjs                      # registers every module
  migrations/
    001…007 *.sql  runner.cjs  (+ 008+ new)
    legacy/import-legacy.cjs       # isolated, marked for removal
src/
  app/
    App.tsx  AppProvider.tsx  useApp.ts  screens.ts  shortcuts.ts  AuthGate.tsx
  shared/
    api/        bridge.ts  commands.ts (CommandMap)  queries.ts  errors.ts
    lib/        money.ts  units.ts  dates.ts
    ui/         Modal  Field  DataTable  FormModal  ConfirmDialog  StatusBadge  Money  Toast
    styles/     tokens.css  base.css  (+ per-feature css)
  features/
    dashboard/ sales/ purchases/ packing/ inventory/ customers/ suppliers/
    collections/ reminders/ reports/ settings/ auth/
      Page.tsx  hooks.ts  components/  mappers.ts  types.ts
    print/        templates + printHtmlDocument
    statements/   customerStatementEntries, supplierStatementEntries, CSV export
tests/
  backend/ (existing tests, moved)   frontend/ (vitest)
```

### Layering rules
- `features/*` may import from `shared/*` and `app/useApp`; never from another feature (use `shared` or lift up).
- `modules/*` may import from `core/*`; never from another module's internals (only its `index.cjs` exports).
- Business rules live in the backend. The frontend may pre-validate for UX but the backend is authoritative.

---

## 4. Phases

Each phase ends with: green `npm test`, green `npm run build`, `git tag phase-N-done`.

---

### Phase 0 — Safety net

**Goal:** a baseline you can always return to, plus tooling.

**Tasks**
1. `git init`, add `.gitignore` entries (`dist/`, `release/`, `out/`, `*.tsbuildinfo` already there; also remove committed `tsconfig.app.tsbuildinfo` from tracking), first commit `baseline`.
2. Run `npm ci && npm test && npm run build`. Record results in `docs/BASELINE.md`.
3. Add ESLint (flat config, `typescript-eslint`, `eslint-plugin-react-hooks`) and Prettier. Scripts: `lint`, `format`, `typecheck` (`tsc -b --noEmit` equivalent).
4. Add `vitest` + `@testing-library/react` for the renderer (config only; no tests yet except the ones below).
5. Add characterization tests (write them against CURRENT behavior before refactoring):
   - `mapSnapshot` with a minimal fixture covering items, customers, sales, purchases, packings, lots (assert unit/price/cost conversions).
   - `toMinor/toEgp/toBase/toDisplay`, `money`, `quantity`.
   - `customerStatementEntries` and supplier statement ordering/balance.
6. Add `.github/workflows/ci.yml`: install, rebuild native for node, lint, typecheck, `npm test`, `npm run build`.

**Acceptance**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npx vitest run` all pass.
- No production code changed (only config + tests + docs).

**Prompt:** `Execute Phase 0 of REFACTOR_PLAN.md.`

---

### Phase 1 — Command registry (highest ROI)

**Goal:** define each command once; remove hand-maintained lists in `ipc.cjs`, `preload.cjs`, `api.ts`, `roleScreens`.

**Current commands (24) — preserve names, handlers, and permissions exactly**

| Channel | Handler (operations.cjs) | Roles |
|---|---|---|
| `purchase:confirm` | confirmPurchase | owner, purchasing |
| `purchase:return` | returnPurchase | owner, purchasing |
| `purchase-draft:save` | savePurchaseDraft | owner, purchasing |
| `purchase-draft:delete` | deletePurchaseDraft | owner, purchasing |
| `supplier:pay` | recordSupplierPayment | owner, purchasing |
| `supplier:save` | saveSupplier | owner, purchasing |
| `packing:confirm` | confirmPacking | owner, warehouse |
| `packing:cancel` | cancelPacking | owner |
| `sale:confirm` | confirmSale | owner, sales |
| `sale:return` | returnSale | owner, sales |
| `customer:collect` | recordCollection | owner, sales |
| `customer:promise` | recordPromise | owner, sales |
| `customer:save` | saveCustomer | owner, sales |
| `customer:writeoff` | writeOffSale | owner |
| `payment:reverse` | reversePayment | owner |
| `reminder:update` | updateReminder | owner, sales |
| `reminder-rule:save` | saveReminderRule | owner |
| `reminder-template:save` | saveReminderTemplate | owner |
| `inventory:adjust` | adjustStock | owner, warehouse |
| `inventory:opening` | createOpeningStock | owner |
| `item:save` | saveItem | owner, warehouse, purchasing |
| `recipe:save` | saveRecipe | owner, warehouse |
| `user:save` | saveUser | owner |
| `settings:save` | saveSetting | owner |

Queries to preserve: `query:snapshot` (all roles, cost-redacted for non-owner), `inventory:movements` (owner, warehouse, purchasing; purchasing sees only `purchase` movements; only owner sees `cost_minor`), `audit:list` (owner), `messages:list` (owner, sales), `invoices:list` (kind `sales` → owner/sales; kind `purchase` → owner/purchasing).

**Tasks**
1. `electron/core/registry.cjs`:
   ```js
   // defineCommand({ name, roles, schema?, handler })
   // handler signature stays: (db, input, { ctx, elevation }) => result   (same as today's operations.cjs functions)
   // schema: optional zod object for the command-specific payload. Default: z.object({}).passthrough()
   //   → existing generic checks (payloadSchema, forbidden identity keys, 64 KB) still apply to ALL commands.
   // registry.list(), registry.get(name), registry.rolesFor(name)
   ```
2. `electron/core/dispatcher.cjs`: move the logic from `registerOperationHandlers` here unchanged in behavior: payload parse → role-field guard → trusted ctx → permission check → idempotent replay lookup → `db.transaction().immediate()` → `redactCosts` → `command_log` insert → session invalidation for `user:save`.
3. Replace the 24 per-channel IPC handlers with ONE handler: `ipcMain.handle('command:run', (event, { name, payload }) => …)`. Keep error messages identical (`Permission denied`, `Request id was already used for a different command`, etc.).
4. Same for queries: `defineQuery({ name, roles, schema, handler })` + one `ipcMain.handle('query:run', …)`. Keep pagination (`paginateQuery`, limit 1–200, cursor digits only).
5. `electron/core/policy.cjs`: `commandsForRole(role)` derived from the registry; `screensForRole(role)` defined here (move content of frontend `roleScreens`):
   - owner: all screens; sales: dashboard, sales, customers, collections, reminders; warehouse: dashboard, packing, inventory; purchasing: dashboard, purchases, suppliers.
6. Extend `auth:session` / `auth:login` / `auth:bootstrap` responses with `permissions: { commands: string[], screens: string[] }`.
7. `preload.cjs` becomes generic and small:
   ```js
   contextBridge.exposeInMainWorld('repack', {
     auth: { /* unchanged 5 methods */ },
     elevate, 
     command: (name, payload) => ipcRenderer.invoke('command:run', { name, payload }),
     query:   (name, payload) => ipcRenderer.invoke('query:run',   { name, payload }),
     createBackup, restoreBackup, openWhatsApp, printHtml
   })
   ```
   (No `require` of project files — sandbox constraint.)
8. Frontend typing: `src/shared/api/commands.ts` with an explicit `CommandMap`:
   ```ts
   export interface CommandMap {
     'sale:confirm':    { input: ConfirmSaleInput;    output: { id: string; totalMinor: number; creditMinor: number } }
     'customer:collect':{ input: CollectionInput;     output: CollectionResult }
     // …all 24
   }
   export function run<K extends keyof CommandMap>(name: K, input: CommandMap[K]['input']): Promise<CommandMap[K]['output']>
   ```
   Keep `callOperation(name, payload)` as a thin deprecated adapter that maps old camelCase names (`confirmSale`) to the new channel names, so pages keep working. Remove the adapter in Phase 3 when pages are migrated.
9. `helpers.ts`: `canAccess(role, screen)` now reads `session.permissions.screens` (via a small selector) instead of the local `roleScreens`. Delete `roleScreens`.
10. Update `tests/integration.test.cjs` and `tests/operations.test.cjs` to call through the registry/dispatcher. Add a **contract test**: every registered command has ≥1 role, a handler, and appears in `docs/COMMANDS.md` (generate that file from the registry via a script `npm run docs:commands`).

**Acceptance**
- Adding a new command requires editing: its module file (+ a line in `CommandMap`). No edits to `preload.cjs`, `ipc` dispatcher, or role maps outside the command definition.
- All invariants in section 2 still hold; all previous tests pass (adapted to new entry points).
- Role matrix in the table above is reproduced exactly (add a test asserting the full matrix).

**Prompt:** `Execute Phase 1 of REFACTOR_PLAN.md. Keep behavior identical; add a test asserting the full role→command matrix before moving code.`

---

### Phase 2 — Split the backend into modules

**Goal:** no file over ~300 lines; each domain owns its commands, queries, and rules.

**Tasks**
1. Create `electron/core/*` and move shared helpers out of `operations.cjs` without changing their code: `roundHalfUp`, `id`, `localDateString`/`nowDate` (**single** definition, also used by queries), `failController`, `atomic`, `write`, `one`, `assertPositiveInt`, `assertNonnegativeInt`, `requiredRow`, `contextOf`, `actorId`, `audit`, `availableLots`, `consumeFifo`, `consumeSpecificLots`, `settingValue`, `elevationFor`.
2. Create `electron/modules/<domain>/` and move commands:
   - `sales`: confirmSale, returnSale, syncSaleStatus, outstandingOfSale
   - `purchases`: confirmPurchase, returnPurchase, savePurchaseDraft, deletePurchaseDraft
   - `packing`: confirmPacking, cancelPacking
   - `inventory`: adjustStock, createOpeningStock, saveItem, saveRecipe
   - `customers`: saveCustomer
   - `suppliers`: saveSupplier, recordSupplierPayment
   - `collections`: recordCollection, recordPromise, reversePayment, writeOffSale
   - `reminders`: updateReminder, saveReminderRule, saveReminderTemplate, recordReminderRows
   - `settings`: saveSetting
   - `users`: saveUser
   Each module exports `register(registry)` which calls `defineCommand` / `defineQuery`. `modules/index.cjs` registers all.
3. Split `queries.cjs#buildSnapshot` into per-module `snapshot` contributors; `buildSnapshot` composes them (output shape identical).
4. Move `checkInvariants` to `electron/core/invariants.cjs` (still exported for tests).
5. `main.cjs` → bootstrap only. Extract: `system/backup.cjs` (create + restore with the same validation), `system/whatsapp.cjs`, `system/print.cjs`, `system/window.cjs` (createWindow + navigation guards), `system/trusted-frame.cjs`, legacy import runner → `migrations/legacy/run-legacy-import.cjs`.
6. Move `import-legacy.cjs` to `electron/migrations/legacy/` and add a header comment: "One-time legacy import. Safe to delete after all installs migrated."
7. For every command touched, add a zod `schema` **only if** you first add/confirm a test for its current accepted input. New commands (future) must always define a schema.

**Acceptance**
- `wc -l` on every file in `electron/` ≤ ~300 lines (except `import-legacy.cjs` and SQL).
- Snapshot output deep-equals the pre-refactor output for the test fixtures (add a snapshot-equality test using the Phase 0 baseline).
- No circular imports between modules (add a simple check script or `madge`).

**Prompt:** `Execute Phase 2 of REFACTOR_PLAN.md. Move code verbatim first (pure moves, tests green), then clean up in separate commits.`

---

### Phase 3 — Frontend by features

**Goal:** remove prop drilling, the giant `switch`, and flat `pages/`.

**Tasks**
1. `src/app/AppProvider.tsx` + `useApp()` exposing `{ state, refresh, run, busy, notify, currentUser, permissions }`. Move `run`, `notify`, toast timer, boot/auth phases out of `App.tsx`.
2. `src/app/screens.ts` — single registry:
   ```ts
   export const screens = [
     { key: 'sales', label: 'المبيعات', icon: ShoppingBag, group: 'العمليات', shortcut: 'F2', component: lazy(() => import('../features/sales/Page')) },
     // … 11 screens (dashboard, purchases, packing, inventory, sales, customers, suppliers, collections, reminders, reports, settings)
   ] as const
   export type Screen = typeof screens[number]['key']
   ```
   Derive from it: sidebar nav, route rendering, keyboard shortcuts (F2/F3/F4), access checks (via `permissions.screens`). Delete `nav`, `Screen`, and the `switch` from `types.ts`/`App.tsx`.
3. Move each page into `src/features/<name>/Page.tsx`. Pages call `useApp()`; remove `state, run, busy, notify, currentUser` props.
4. Split oversized pages (target ≤ ~250 lines per file):
   - `Collections` → `CollectionForm`, `OpenInvoicesTable`, `PromisesPanel`, `PaymentsHistory`, `WriteOffDialog`, hook `useCollectionDraft`.
   - `Inventory` → `StockTable`, `LotsTable`, `AdjustmentDialog` (PIN elevation), `OpeningStockForm`, `MovementsLog`, `ItemEditor`, `RecipeEditor`.
   - `Suppliers` → `SupplierList`, `SupplierForm`, `SupplierStatement`, `PaymentForm`.
   - `PackingWorkspace` → `PackingForm`, `PackingEstimate`, `PackingHistory`.
   - `Sales`: extract `useSaleDraft` (lines, payment mode, credit override flow) + `CreditOverrideModal`.
   Replace clusters of related `useState` with `useReducer` or a dedicated hook.
5. Move non-UI logic out of `helpers.ts`/`domain.ts`:
   - `features/print/` ← `printSaleInvoice`, `printCustomerStatement`, `printSupplierStatement`, `printHtmlDocument`, `escapeHtml`.
   - `features/statements/` ← `customerStatementEntries`, supplier equivalent, `exportCustomerStatement` (CSV).
   - `shared/lib/{money,units,dates}.ts` ← `money`, `quantity`, `today`, `daysFromNow`, `addDays`, `localDateString`, `UNIT_FACTORS`.
   - `shared/ui/StatusBadge.tsx` ← `statusClass`, `statusLabel`.
6. Migrate all `callOperation(...)` call sites to typed `run('<channel>', input)`; delete the Phase-1 adapter.
7. Business-rule duplication: keep client checks as UX hints only; add a comment `// UX hint — backend is authoritative` and make sure the backend error message is shown via `ipcErrorMessage` when they disagree.

**Acceptance**
- No page receives `state/run/busy/notify/currentUser` props.
- Adding a screen = create `features/<x>/Page.tsx` + one entry in `screens.ts`.
- `grep -R "callOperation" src` returns nothing.
- Largest file in `src/features` ≤ ~300 lines.
- Manual smoke test checklist in `docs/SMOKE_TEST.md` passes for all 4 roles (login, each allowed screen, one command per screen, denied screen redirects to dashboard).

**Prompt:** `Execute Phase 3 of REFACTOR_PLAN.md. Migrate one feature at a time, building after each, in the order: sales, purchases, packing, inventory, customers, suppliers, collections, reminders, reports, settings, dashboard.`

---

### Phase 4 — Typed data layer

**Goal:** remove `any`, split `mapSnapshot`, stop reloading everything after every mutation.

**Tasks**
1. Replace each `any[]` in `Snapshot` with a precise interface (`SnapshotCustomer`, `SnapshotSale`, `SnapshotSaleLine`, …) mirroring `queries.cjs` output. Put them in `src/shared/api/snapshot-types.ts`.
2. Split `mapSnapshot` into `mapItems`, `mapCustomers`, `mapSuppliers`, `mapSales`, `mapPurchases`, `mapPackings`, `mapLots`, `mapReminders`, `mapPayments`, `mapReturns`, `mapLedger`, … each in `features/<x>/mappers.ts`; `mapSnapshot` only composes them. Phase 0 characterization tests must stay green unchanged.
3. Introduce a minimal query cache: `useQuery(key, fetcher)` + `invalidate(keys)` in `shared/api/`. Keep `snapshot` as one key initially.
4. Make `run(name, input, { invalidates: [...] , message })`; each command declares which keys it affects (default: `['snapshot']` to preserve behavior).
5. Gradually split the snapshot into feature queries (customers list, items list, sales list…) **only where it measurably helps**; reuse the existing paginated pattern from `inventory:movements` / `invoices:list`. Every new query must keep role checks and `redactCosts`.
6. `strict` additions to `tsconfig.app.json`: `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes` (enable one at a time, fix, commit). ESLint rule `@typescript-eslint/no-explicit-any: error`.

**Acceptance**
- `grep -R ": any\|as any\|any\[\]" src` → 0 matches.
- `mapSnapshot` ≤ 40 lines; each mapper has a unit test.
- Measure and record (in `docs/PERF.md`) the time of `loadSnapshot` + map with a seeded DB of ≥ 5,000 sales; no regression vs baseline.

**Prompt:** `Execute Phase 4 of REFACTOR_PLAN.md.`

---

### Phase 5 — UI kit & styles

**Goal:** consistent, reusable UI; no inline styles; maintainable CSS.

**Tasks**
1. Build `shared/ui`: `Field` (label + input + error), `NumberField`, `MoneyField` (EGP ↔ minor aware), `SelectField`, `DataTable` (columns, empty state, row actions), `FormModal`, `ConfirmDialog`, `PinPrompt` (used by credit override and stock adjustment), `StatusBadge`, `Money`, `Toast`, `EmptyState`, `PageHeader`, `Metric` (existing), `Activity` (existing).
2. Replace repeated markup in all features with these components.
3. Convert the 89 `style={{…}}` usages to CSS classes (or CSS variables for dynamic values).
4. Split `styles.css` into `styles/tokens.css` (colors, spacing, radius, fonts — extracted from current values, no visual change), `base.css`, `layout.css`, `components.css`, and per-feature CSS imported by each feature.
5. Keep RTL logical properties (`margin-inline-start`, etc.) in new CSS.

**Acceptance**
- `grep -R "style={{" src` → only truly dynamic cases (documented with a comment).
- Visual parity: take before/after screenshots of every screen (list in `docs/SMOKE_TEST.md`) and attach to the PR description.

**Prompt:** `Execute Phase 5 of REFACTOR_PLAN.md.`

---

### Phase 6 — Lock in quality

**Tasks**
1. Frontend tests (vitest + Testing Library): mappers (done), `useSaleDraft`, `useCollectionDraft`, `AppProvider` (auth phases), `screens.ts` access filtering for each role, `PinPrompt`.
2. Backend contract tests (extend Phase 1): every command has a schema (new ones), a role list, an audit entry, idempotent replay behavior, and `redactCosts` safety.
3. CI gates: lint, typecheck, `npm test`, `npx vitest run`, build, `madge --circular`.
4. Documentation:
   - `docs/ARCHITECTURE.md` (the layering rules + tree from section 3)
   - `docs/ADDING_A_FEATURE.md` (see section 5)
   - `docs/COMMANDS.md` (generated)
   - `CONTRIBUTING.md` (commit style, test commands, migration rules)
5. **Optional:** convert `electron/` to TypeScript (esbuild bundle → `dist-electron/`), share zod schemas with the renderer, and generate `CommandMap` from the registry so types can never drift. Update `package.json#build.files` and `main`.

**Acceptance**
- CI green on a clean clone.
- A new engineer can add a command + screen following `ADDING_A_FEATURE.md` without reading any other file.

**Prompt:** `Execute Phase 6 of REFACTOR_PLAN.md.`

---

## 5. Adding a feature after the refactor (target workflow)

Example: **Expenses** (PRD FR-EXP-01; table `expenses` already exists in migration 001).

1. **DB (only if needed):** `electron/migrations/008_expenses_views.sql` (new numbered file; never edit old ones). Run `npm test` (migration tests verify numbering/checksums).
2. **Backend module:** `electron/modules/expenses/`
   - `commands.cjs`: `defineCommand({ name: 'expense:save', roles: ['owner'], schema: z.object({...}), handler })` using `atomic`, `write`, `audit`, and a `cash_transactions` row.
   - `queries.cjs`: `defineQuery({ name: 'expenses:list', roles: ['owner'], schema: pageSchema, handler })`.
   - Register in `modules/index.cjs`.
   - Tests: `tests/backend/expenses.test.cjs` (happy path, validation errors, permission denied, idempotent replay, rollback via `failAfterStep`).
3. **Contract:** add `'expense:save'` to `CommandMap` in `src/shared/api/commands.ts`.
4. **Frontend:** `src/features/expenses/{Page.tsx,hooks.ts,components/}` + one line in `src/app/screens.ts` (`permissions` come from the backend policy automatically).
5. `npm run docs:commands`, `npm run lint`, `npm test`, `npx vitest run`, `npm run build`.

Touch points: **1 migration + 1 backend module + 1 type entry + 1 feature folder + 1 screens line** (instead of ~10 scattered edits).

---

## 6. Verification commands (run at the end of every phase)

```bash
npm ci
npm run lint
npm run typecheck
npm test                 # runs rebuild:native:node first (pretest)
npx vitest run           # from Phase 0 onward
npm run build
npm run desktop          # manual smoke test with each role
```

Note: `npm test` rebuilds `better-sqlite3` for Node; `npm run desktop` / `start:prod` / `package` rebuild it for Electron. If you see `NODE_MODULE_VERSION` errors, run the matching `rebuild:native:*` script.

---

## 7. Definition of done (whole project)

- [ ] Every command defined once (registry); no manual channel/preload/role lists.
- [ ] Permissions (commands + screens) have a single source of truth in the backend.
- [ ] No backend or feature file > ~300 lines (except legacy import + SQL).
- [ ] Zero `any` in `src/`; strict TS options enabled.
- [ ] No prop drilling; screens registered in one file.
- [ ] Shared UI kit used everywhere; no avoidable inline styles.
- [ ] Lint + typecheck + backend tests + frontend tests + build in CI.
- [ ] `docs/ARCHITECTURE.md`, `ADDING_A_FEATURE.md`, `COMMANDS.md`, `CONTRIBUTING.md` exist.
- [ ] All invariants in section 2 verified by tests.

---

## 8. Appendix — facts for the agent

- Preload (`electron/preload.cjs`) currently exposes: `auth.{bootstrap,login,logout,session,status}`, `elevate`, `queries.{snapshot,inventoryMovements,auditLog,messageLog,invoices}`, `operations.*` (24), `createBackup`, `restoreBackup`, `openWhatsApp`, `printHtml`.
- System IPC channels in `main.cjs`: `auth:*`, `security:elevate`, `backup:create`, `backup:restore`, `whatsapp:open`, `print:html`.
- Backup restore validates the picked file contains one of `app_state`, `legacy_app_state`, `schema_version`; refuses restoring the active DB; removes `-wal`/`-shm`; then re-inits the DB.
- `command_log(id, user_id, client_request_id, command, result_json, created_at)` backs idempotency.
- Settings keys read by the snapshot: `company_name`, `company_phone`, `currency`, `costing_method` (`FIFO`|`WAVG`), `default_credit_days`.
- Display units known to the UI: كجم(1000), جرام(1), لتر(1000), مل(1), قطعة(1), عبوة(1) — base unit is the smallest (gram/ml/piece).
- PRD: `PRD_Repacking_Management_App.md` (Arabic) is the product source of truth; do not contradict its business rules (BR-CR, BR-INV, BR-PAY, BR-REM).