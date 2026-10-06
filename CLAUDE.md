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

**All eight phases complete and deployed. Now in feedback-and-refinement.**

`tsc -b` clean across three projects, ESLint clean, **406 tests** across 18 files.

Live on Cloudflare as a **Worker with static assets** (not Pages — see Deploying below), built
from `main` on every push.

### Shipped since the phases finished

- **Editable Plan** — weight goal with a rate, every nutrient target daily and weekly, FDA
  template, direction-aware goals (sodium is a limit, protein a floor).
- **Month calendar** — cooking drawn as a bar, eating as a dot per logged item. The dots fixed a
  real bug: the first build drew marks per scheduled _batch_, so eating left no trace at all,
  despite PLAN.md §5 always specifying "one mark per meal log".
- **Direct fridge items** — a gallon of milk or six avocados, no recipe and no cook behind them.
- **Portion-aware defaults** — picking a food defaults to its own portion ("1 item = 291 g" for a
  burger) rather than 100 g.
- **Zoom locked**, tap delay removed.

### Things a future session should not re-derive

- **`domain/dates.ts` exists for one reason.** `new Date('2026-09-15')` is UTC midnight = the
  14th in New York. Days are local `'YYYY-MM-DD'`. `addMonths` also clamps to the last real day,
  or paging from a 31st skips months.
- **USDA throttles and reports it as a 400, not a 429.** Measured: back to back, the same query
  failed ~1 in 3; spaced two seconds apart, 16 in a row passed. The Worker retries with a
  SECONDS-scale backoff — a 120 ms one did nothing. Do not "fix" this by removing the retry.
- **FDC has three response shapes, and neither endpoint is sufficient alone.**
  - Search carries no `foodPortions` at all and rounds its numbers, so a picker that uses it
    raw defaults a 291 g burger to "100 g".
  - Detail carries the portions — but for **Branded** foods its `foodNutrients` have only an
    internal id and an amount, no descriptor, and `labelNutrients` is empty. Adapting it yields
    ZERO nutrients while the search result for the same food has all fifteen.
  - Branded foods also have no `foodPortions`; their serving size is in `servingSize` /
    `householdServingFullText`.

  Hence `mergeDetail` in `features/foods/api.ts`: portions from detail, nutrition from whichever
  knows more. **A detail fetch must never make the data worse.** `portions.live.test.ts` and
  `branded.live.test.ts` pin every branch against real captured responses.

- **Batch `scale` is separate from the snapshot.** The snapshot is one base batch; scale says how
  many.
- **Colour distinctness is OKLab, not RGB**, and the chart palette was validated for
  colour-vision deficiency rather than chosen by eye.
- **UI names and code names differ on purpose.** The tabs read **Recipes** and **Diary**; the
  code says `Component` and `log` everywhere, and must keep doing so. Every stored snapshot —
  batches, fridge entries, meal logs — carries `componentId` / `componentName`, so renaming the
  model means a migration that rewrites history for no user-visible gain. Routes stay `/components`
  and `/log` for the same reason. Change labels freely; leave identifiers alone.
- **Local-only is a decision, not an oversight** (confirmed by the user 2026-10-06). Data lives in
  IndexedDB, which is per-browser and per-device, so a phone never sees what a laptop entered.
  Moving data between devices is Plan → Export a backup → Restore from a file, which REPLACES
  rather than merges. The user was offered sync and chose to keep it local. Do not build sync
  without asking again.
- **History is snapshotted, never back-filled.** Meal logs written before item colours existed
  render a neutral dot on purpose; rewriting them would be rewriting history.

## Environment facts

- **Project root:** `C:\Users\dncan\Projects\meal-prep-app`
- Windows 11, PowerShell 5.1. `&&`, `||`, and ternaries are **not** available — use `; if ($?) {}`.
- **Installed:** `node` v24.19.0, `npm` 11.17.0, `gh` 2.100.0 (all via `winget`).
  A terminal opened before that install will not see them on `PATH` until VS Code restarts.
- `gh` is installed but unauthenticated, and does not need to be — the GitHub App connection to
  Cloudflare is done and pushing happens in GitHub Desktop.
- **Do not run `npm run build` while `npm run dev:api` is running.** Wrangler watches
  `dist/` and Windows file locks deadlock `vite build` — it hangs rather than failing. Stop
  wrangler first. (Hit during Phase 2; cost ten minutes of confusion.)
- **Do not move this project back under `C:\Users\dncan\OneDrive\`.** It was moved out
  deliberately: the user's Desktop is redirected into OneDrive, and syncing `node_modules`
  file-by-file caused the move. A Desktop shortcut points here.
- An empty leftover folder at `C:\Users\dncan\OneDrive\Desktop\Meal Prep App` could not be
  deleted while VS Code held it open. It is empty and harmless; delete it if the lock has
  released.

---

## Running it locally

Two servers, two terminals — Vite cannot run the Worker:

```powershell
npm run dev:api   # wrangler on :8788, serves worker/ and dist/
npm run dev       # vite on :5173, proxies /api to it — open THIS one
```

⚠️ Stop `dev:api` before `npm run build`. Wrangler watches `dist/` and Windows file locks hang
the build silently.

## Deploying

A Cloudflare **Worker** called `meal-prep-app`, built from `main` on every push.

It is a Worker rather than a Pages project because Cloudflare's dashboard now creates Workers by
default. The first attempt made one and then failed at the _Deploy_ stage — the build was fine —
because the config was Pages-shaped with no entry point.

- `worker/index.ts` is the entry. `dist/` is bound as `ASSETS`.
- `not_found_handling = "single-page-application"` does the client-routing fallback, and
  `run_worker_first = ["/api/*"]` stops that fallback swallowing API calls. This replaced
  `public/_redirects`, which wrangler had been rejecting as an infinite loop and never applying.
- The dashboard's deploy command `npx wrangler deploy` is now the correct one.
- `USDA_API_KEY` is a **Secret** in the Worker's Settings → Variables and Secrets. Workers apply
  secrets immediately — no rebuild — and `wrangler deploy` does not wipe them.
- `.node-version` pins Node 22; Vite 7 needs ≥ 20.19.
- `npm run deploy` does the same from this machine if the Git build is ever unavailable.
- The same account hosts an unrelated `unitedclash` Pages project and `unitedclash-proxy` Worker.
  Leave both alone.

**Pushing is the user's job** — GitHub Desktop holds the credentials and this terminal has none.
Commit freely; never run a network git command. Check sync with
`git rev-list --left-right --count main...origin/main`.

---

## Checking the layout

**Standing instruction from the user (2026-10-05): check visual changes at BOTH mobile and
desktop widths**, not just whichever happens to be open.

```powershell
npm run dev                      # must be running first
node scripts/screenshot.mjs      # all routes, 390px and 1280px
node scripts/screenshot.mjs /calendar
```

Writes to `.screenshots/` (gitignored), seeds a little data per browser context so screens are
not all empty states, and flags any route that scrolls horizontally. **Read the images** — the
script catches overflow, not ugliness.

Two gotchas: `fullPage` screenshots render `position: fixed` elements mid-page, so the tab bar
appearing over content in an image is an artifact rather than a bug; and each browser context
has its own IndexedDB, so seeding has to happen per context.

This paid for itself immediately — the calendar cells were overlapping by **3.6px** at 390px wide
and measuring it found the cause in one step, where reading the CSS had not.

---

## Keeping the docs current

**Standing instruction from the user (2026-09-17): update the markdown files as part of every
change, not as a later tidy-up.** A doc that lags the code is worse than no doc, because it is
believed.

Concretely, in the same commit as the change:

| File        | Update when                                                            |
| ----------- | ---------------------------------------------------------------------- |
| `CLAUDE.md` | Status, test count, any decision a future session should not re-derive |
| `PLAN.md`   | A phase completes, or a design decision in §1–§5 actually changes      |
| `SETUP.md`  | Anything the user must do resolves, or a new thing is needed from them |
| `README.md` | The one-line status and what the app can now do                        |

If a change contradicts something PLAN.md says, fix PLAN.md in the same breath — do not leave the
two disagreeing and expect the reader to guess which won.

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
(`USDA_API_KEY`) and in the gitignored `.dev.vars`; the browser calls the Worker at
`/api/...` and never sees it. **Never prefix a secret with `VITE_`** — Vite inlines every
`VITE_`-prefixed variable into the bundle as plain text, which would publish the key to every
visitor and get it deactivated (USDA deactivates keys found in public repos). Secrets are read
server-side in `worker/index.ts`, never through `import.meta.env`.

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

| Script               | Does                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `npm run dev`        | Vite dev server, host exposed for phone testing                                                   |
| `npm run dev:api`    | Wrangler on :8788 serving `worker/` + `dist/`. Vite proxies `/api` to it. Needed for food search. |
| `npm run serve:full` | Build, then serve app + functions together on :8788 (no hot reload)                               |
| `npm run build`      | Typecheck + production build to `dist/`                                                           |
| `npm run preview`    | Serve the production build                                                                        |
| `npm test`           | Vitest, `src/**/*.test.ts`                                                                        |
| `npm run lint`       | ESLint                                                                                            |
| `npm run format`     | Prettier, write in place                                                                          |

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
worker/       The Cloudflare Worker: /api proxy for USDA, and the ASSETS binding
              that serves dist/. Holds the API key server-side.
```

All eight phases have landed, so `src/ui/PhasePlaceholder.tsx` should no longer appear on any
screen. If one does, that screen regressed.
