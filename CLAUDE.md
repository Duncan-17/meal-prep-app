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

**Phase 0 (scaffold) — built and verified 2026-09-10. Phase 1 is next.**

Node was installed and the scaffold ran for the first time. `tsc -b` passes clean under strict
mode, `vite build` produces `dist/`, ESLint is clean, and the dev server serves the shell. The
best-guess dependency versions in `package.json` all resolved without conflict — the anticipated
version friction never materialised.

`npm test` currently **fails by design**: no `src/**/*.test.ts` files exist yet, so Vitest exits 1
with "No test files found". This is not a broken setup — Phase 1 fixes it by existing.

Installed: **Node v24.19.0, npm 11.17.0, gh 2.100.0**. Note Node **24**, not the 22 earlier docs
assumed — 24 is the current LTS line, 22 has moved to maintenance, and Vite 7 only needs ≥20.19.

### ⚠️ Unfinished handoff — GitHub push

**The source is still not backed up anywhere off this machine.** This was in progress when the
session ended and is the highest-priority item.

Done already:

- `gh` 2.100.0 installed via winget.
- Everything committed to `main`, working tree clean. `package-lock.json` is tracked.

Remaining — **`gh auth login` is interactive and cannot be run from a non-interactive terminal**,
so the user must run it themselves:

```powershell
gh auth login     # user runs this: GitHub.com → HTTPS → login with a web browser
```

Then Claude can finish it in one step:

```powershell
gh repo create meal-prep-app --private --source=. --remote=origin --push
```

Check `gh auth status` first — if it reports a logged-in account, the login is done and only the
`repo create` line is left. SETUP.md item 4 specifies a **private** repo.

### After that — Phase 1

**Nutrition foundation + Dexie schema.** Nutrient registry, unit conversion, `NutrientMap` /
`Coverage` types, the pure aggregation functions with tests, complete Dexie schema, JSON
export/import, dev seed. Needs none of the outstanding API keys — pure logic and tests, and the
right place to spend real effort.

### Blocked on the user

| Need                                            | Blocks                                        |
| ----------------------------------------------- | --------------------------------------------- |
| `gh auth login` (interactive)                   | GitHub push — the **only** off-machine backup |
| Cloudflare Pages project                        | Phase 0 deploy                                |
| USDA FDC API key                                | Phase 2                                       |
| Open Food Facts contact string for `User-Agent` | Phase 2                                       |
| 2500-cal plan targets                           | Phase 7                                       |

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
