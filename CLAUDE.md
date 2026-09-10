# CLAUDE.md

Auto-loaded context for Claude Code sessions in this repo. Keep it current — update the
**Current status** section at the end of any phase, and whenever an item in SETUP.md resolves.

---

## What this is

A personal-use PWA for meal planning: build reusable **Components** (batch-cookable items),
schedule batch-cooking on a **Calendar**, track servings as **Fridge** stock, and **Log** meals
to see macro + micronutrient trends. Single user, no auth, local-first (IndexedDB).

- **[PLAN.md](PLAN.md)** — architecture, data model, the 8 build phases. The source of truth.
- **[SETUP.md](SETUP.md)** — what the user still needs to provide (keys, accounts, targets).

Read PLAN.md before doing design work. Don't re-litigate its §1 locked decisions — they were
settled with the user; if one looks wrong, raise it rather than quietly changing it.

---

## Current status

**Phases 0 and 1 complete and verified (2026-09-10). Phase 2 is next, and needs the USDA key.**

Everything builds and passes: `tsc -b` clean under strict mode, `vite build` produces `dist/`,
ESLint clean, **125 tests passing** across 7 files. There is still no UI beyond the Phase 0 shell
— Phase 1 was deliberately the layer underneath it.

Installed: **Node v24.19.0, npm 11.17.0, gh 2.100.0**. Node **24**, not the 22 the original docs
assumed — 24 is the current LTS line and Vite 7 only needs ≥20.19.

### ⚠️ Unfinished handoff — GitHub push

**The source is still not backed up anywhere off this machine.** Highest-priority item.

Done: `gh` installed, everything committed to `main`, working tree clean.

Remaining — **`gh auth login` is interactive and cannot be driven from a non-interactive
terminal**, so the user must run it:

```powershell
gh auth login     # GitHub.com → HTTPS → login with a web browser
```

Then Claude finishes it in one step:

```powershell
gh repo create meal-prep-app --private --source=. --remote=origin --push
```

**Run `gh auth status` first** — if it reports a logged-in account the login is already done and
only the `repo create` line is left. SETUP.md item 4 specifies a **private** repo.

### What Phase 1 built

`src/domain/` (pure — no Dexie, no React, fully tested):

| File            | Holds                                                         |
| --------------- | ------------------------------------------------------------- |
| `types.ts`      | `NutrientMap`, `Coverage`, and every entity interface         |
| `nutrients.ts`  | scaling, per-unit, weighted `aggregate` + `combineAggregates` |
| `coverage.ts`   | reading coverage — thresholds, notes, missing keys            |
| `portions.ts`   | percent-of-remaining, stock arithmetic, actual-yield          |
| `components.ts` | rolling a Component up from its ingredients                   |
| `backup.ts`     | backup format and strict validation (the pure half)           |

`src/nutrition/`: `registry.ts` (75 canonical nutrients keyed to USDA numbers, with group, unit
and precision), `units.ts` (the PLAN.md §4 grams ladder, returning a confidence), `targets.ts`
(FDA Daily Values as `isDefault: true` placeholders).

`src/db/`: `schema.ts` (all ten tables), `init.ts` (idempotent first-run defaults), `backup.ts`
(Dexie export/import), `seed.dev.ts` (Chicken Thighs, Rice, Guacamole).

Two invariants worth not breaking:

- **Presence, not truthiness, decides whether data exists.** A measured `0` g trans fat is data;
  an absent key is not. `aggregate` is grams-weighted and every aggregate carries `Coverage`.
- **`combineAggregates` is defined via `aggregate`**, so totalling a week at once equals
  totalling it day by day. Phase 7 does both; a test pins it.

### Next — Phase 2 (blocked on the USDA key)

Pages Function proxy at `functions/api/`, USDA + OFF adapters mapping into the registry keys with
unit conversion applied **at the adapter**, `foodCache` table, debounced search UI.

Phase 2 is also where the registry's USDA nutrient numbers get validated against live API
responses — they were transcribed, not fetched, so expect to correct a few.

If the key is still missing, Phase 3 (Component Builder & Library) can be built against the dev
seed instead, and only ingredient _search_ has to wait.

### Blocked on the user

| Need                                            | Blocks                                        |
| ----------------------------------------------- | --------------------------------------------- |
| `gh auth login` (interactive)                   | GitHub push — the **only** off-machine backup |
| USDA FDC API key                                | Phase 2                                       |
| Open Food Facts contact string for `User-Agent` | Phase 2                                       |
| Cloudflare Pages project                        | Phase 0 deploy                                |
| 2500-cal plan targets                           | Phase 7 (defaults are in place meanwhile)     |

Do not use the user's Apple ID email (`dncanzano@icloud.com`) as the Open Food Facts contact
string — they were asked to nominate an address and have not yet answered.

## Environment facts

- **Project root:** `C:\Users\dncan\Projects\meal-prep-app`
- Windows 11, PowerShell 5.1. `&&`, `||`, and ternaries are **not** available — use `; if ($?) {}`.
- **Installed:** `node` v24.19.0, `npm` 11.17.0, `gh` 2.100.0 (all via `winget`).
  A terminal opened before that install will not see them on `PATH` until VS Code restarts.
- `gh` 2.100.0 is installed but **not yet authenticated**. `gh auth login` is interactive and
  must be run by the user in a real terminal — it cannot be driven from a non-interactive shell.
- **Do not move this project back under `C:\Users\dncan\OneDrive\`.** It was moved out
  deliberately: the user's Desktop is redirected into OneDrive, and syncing `node_modules`
  file-by-file caused the move. A Desktop shortcut points here.
- An empty leftover folder at `C:\Users\dncan\OneDrive\Desktop\Meal Prep App` could not be
  deleted while VS Code held it open. It is empty and harmless; delete it if the lock has
  released.

---

## Conventions

**`src/domain/` is pure.** No Dexie imports, no React, no I/O — only functions over plain data.
Every nutrition calculation lives there and has tests. This is deliberate: the math that can be
silently wrong must be verifiable without a browser. Resist putting calculations in components.

**Nutrition is sparse maps, never fixed columns.** `NutrientMap = Record<string, number>` keyed
by canonical nutrient keys from `src/nutrition/registry.ts`. The full USDA panel is stored; the
UI decides what to show.

**Missing nutrient data is not zero.** Every aggregate carries a `Coverage` map
(`Record<string, number>`, 0..1) recording what fraction of contributing grams actually had data
for that nutrient. Never sum sparse nutrients without it — see PLAN.md §3c.

**History is immutable.** `Batch`, `FridgeEntry` and `MealLog` items snapshot their nutrition at
creation. Editing a Component must never retroactively change what was already logged.

**Stock changes are transactional.** Anything moving `FridgeEntry.remaining` runs inside a Dexie
transaction spanning `fridgeEntries` and whatever else changed. Deleting a meal log restores the
stock it consumed. Discards write a `stockAdjustments` row and never count as eaten.

**Secrets never reach the client.** The USDA key lives only as a Cloudflare secret
(`USDA_API_KEY`) and in the gitignored `.dev.vars`; the browser calls the Pages Function at
`/api/...` and never sees it. **Never prefix a secret with `VITE_`** — Vite inlines every
`VITE_`-prefixed variable into the bundle as plain text, which would publish the key to every
visitor and get it deactivated (USDA deactivates keys found in public repos). Secrets are read
server-side in `functions/api/`, never through `import.meta.env`.

**`portion_style` is a UI flag, not a math branch.** Discrete and bulk share one arithmetic path:
`per-unit = nutrition_per_base / base_quantity`. It only selects the control (stepper vs. percent
picker) and the calendar mark.

**Bulk percentages are of what is currently left**, not of the original batch.

### Code style

- TypeScript strict, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` — indexing
  an array yields `T | undefined`, so handle it.
- `verbatimModuleSyntax` is on: type-only imports must use `import type`.
- `@/` aliases `src/`.
- Prettier: single quotes, semicolons, 100 cols. Run `npm run format`.
- State comes from Dexie via `useLiveQuery`. There is no global store and none is wanted.

---

## Commands

| Script            | Does                                       |
| ----------------- | ------------------------------------------ |
| `npm run dev`     | Dev server, host exposed for phone testing |
| `npm run build`   | Typecheck + production build to `dist/`    |
| `npm run preview` | Serve the production build                 |
| `npm test`        | Vitest, `src/**/*.test.ts`                 |
| `npm run lint`    | ESLint                                     |
| `npm run format`  | Prettier, write in place                   |

---

## Layout

```
src/
  db/          Dexie schema, migrations, backup (export/import), dev seed
  domain/      PURE functions — scaling, aggregation, coverage, portions. Tested.
  nutrition/   registry, usda.adapter, off.adapter, targets, units
  features/    calendar/ components/ fridge/ log/ settings/
  ui/          shared primitives (TabBar, Sheet, Stepper, PercentPicker, ColorPicker)
  routes/      router + AppShell
functions/api/ Cloudflare Pages Function proxying USDA + OFF (holds the API key server-side)
```

`src/ui/PhasePlaceholder.tsx` and its uses are Phase 0 scaffolding — delete each placeholder as
its phase lands. A visible placeholder means that screen is genuinely unbuilt.
