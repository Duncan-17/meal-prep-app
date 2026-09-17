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

**All eight phases complete. The app is feature-complete and installable; what remains is deployment.**

`tsc -b` clean across three projects, ESLint clean, **392 tests** across 17 files.

| Phase               | State                                                           |
| ------------------- | --------------------------------------------------------------- |
| 0 scaffold          | ✅ verified                                                     |
| 1 nutrition + Dexie | ✅ 125 tests                                                    |
| 2 food lookup       | ✅ verified against the live USDA API 2026-09-15                |
| 3 Component Builder | ✅ built; DB write path covered by integration tests            |
| 4 Calendar          | ✅ week view, tap-to-schedule, scale, past-due nudge            |
| 5 Cook → Fridge     | ✅ mark cooked, fridge list, adjust, discard                    |
| 6 Logging           | ✅ from-fridge + Quick Add, favourites, stock restore on delete |
| 7 Insight           | ✅ meters, Day Detail, weekly trends, editable Plan             |
| 8 PWA polish        | ✅ service worker, offline, icons, install prompt, backup UI    |

### The only thing left: deploy

Everything is built and tested locally. To reach a phone it needs **SETUP.md item 5** — a
Cloudflare Pages project connected to the GitHub repo, with `USDA_API_KEY` added as an encrypted
secret. Build command `npm run build`, output directory `dist`.

Two things to check on that first deploy, both recorded as unknowns rather than assumptions:

1. **`_redirects` SPA fallback.** Wrangler warns the `/*  /index.html  200` rule is an infinite
   loop and ignores it; fallback worked locally anyway, so something else served the shell.
   Hard-refresh `/calendar` on the deployed site before assuming it works.
2. **Service worker + Pages Functions together.** `/api` is on the navigation-fallback denylist
   and was verified locally against a production build under wrangler, but the deployed edge is
   the real test.

### Not yet confirmed by the user

Phases 3 and 4 are verified by tests and by the screens rendering, but the user
has **not** yet built the three worked-example Components (Chicken Thighs, Rice,
Guacamole), which is PLAN.md's stated done-when for Phase 3. The write path is
covered by `db.test.ts` and `batches.test.ts` against a real in-memory
IndexedDB, so the risk is UI ergonomics rather than correctness.

### Testing locally

Two servers, two terminals — Vite cannot run Pages Functions:

```powershell
npm run dev:api   # wrangler on :8788, serves functions/
npm run dev       # vite on :5173, proxies /api to it — open THIS one
```

⚠️ Stop `dev:api` before `npm run build`. Wrangler watches `dist/` and Windows
file locks hang the build silently.

### Things a future session should not re-derive

- **`domain/dates.ts` exists for one reason.** `new Date('2026-09-15')` is UTC
  midnight = the 14th in New York. Days are local, stored `'YYYY-MM-DD'`, and
  every conversion goes through local components. 31 tests pin it.
- **Batch `scale` is separate from the snapshot.** The snapshot is one base
  batch; scale says how many. Do not multiply at schedule time.
- **FDC search rounds, detail does not.** The builder re-fetches
  `/api/usda/food/{id}` on selection. Do not "simplify" that away — a test pins
  both values.
- **Colour distinctness is OKLab, not RGB.** The suggested palette's closest
  pair is 0.122 against a 0.12 threshold; `color.test.ts` fails if a swatch
  moves.
- **The JS bundle is 517 kB** (166 kB gzipped) and Vite warns about it.
  Code-splitting belongs in Phase 8.

### Registry validated against real data

A real SR Legacy payload with 126 nutrient entries mapped **74 registry keys with zero unit
mismatches**. `usda.live.test.ts` pins this against captured fixtures in
`src/nutrition/__fixtures__/`, so an FDC renumbering fails loudly instead of silently dropping a
nutrient.

Three entries stay UNCONFIRMED — no sampled food reported them: `starch_g` (209),
`fluoride_ug` (313), `iodine_ug` (314). Plausible but unproven.

### ⚠️ FDC search rounds; detail does not

Found while validating: `/foods/search` returns ~3 significant figures while `/food/{id}` returns
full precision. 15 of 126 values differed — fat 44.2 vs 44.23, monounsaturated 19 vs 18.975.

**Consequence for Phase 3:** a Component built straight from search results carries search-grade
precision. When the user actually picks a food, fetch `/api/usda/food/{fdcId}` and store that.
The proxy route already exists. A test pins both values so this cannot be "simplified" away.

### Next — Phase 3, Component Builder & Library

Nothing blocks it. Food lookup works, the dev seed exists, and `domain/components.ts` already
rolls a Component up from its ingredients with coverage.

Also still open, and now the only real gap before a deploy: **Cloudflare Pages project**
(SETUP.md item 5) — needed to reach the app from a phone, and where `USDA_API_KEY` must be added
as an encrypted secret.

### Known unknown — `_redirects` in production

Wrangler warns the `/*  /index.html  200` rule is an infinite loop and **ignores it** ("Parsed 0
valid redirect rules"). SPA fallback still worked locally, so something else served `index.html`.
Whether deployed Pages behaves the same is **unverified** — check that a hard refresh on
`/calendar` works on the first deploy before assuming it does.

### Pushing — the user does it from GitHub Desktop

The repo is live at <https://github.com/Duncan-17/meal-prep-app> (private) and `origin/main` is
in sync as of 2026-09-10.

**Claude cannot push from this terminal.** GitHub Desktop holds its credentials in its own store,
so git here has none — any network git command (`fetch`, `push`, `ls-remote`) either fails with
`could not read Username for 'https://github.com'` or **hangs on a credential prompt** that a
non-interactive shell can never answer.

So: **commit freely, never run a network git command.** Tell the user what is ready and they hit
**Push origin** in GitHub Desktop. To check sync state without the network, use the local
remote-tracking ref:

```powershell
git rev-list --left-right --count main...origin/main   # left = unpushed commits
```

That ref only updates when the user fetches or pushes, so treat it as "as of their last sync".

If terminal pushes ever become worth it, `gh auth login` (interactive, user-run) would configure
git's credential helper as a side effect.

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

| Need                               | Blocks                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| ~~USDA FDC API key~~               | ✅ Supplied; lives in gitignored `.dev.vars`. **Never read that file.**                                         |
| ~~Open Food Facts contact string~~ | ⏸️ Deferred by choice 2026-09-10 — Phase 2 ships USDA-only; blocks only Phase 6 barcode lookups. Do not re-ask. |
| Cloudflare Pages project           | Phase 0 deploy                                                                                                  |
| 2500-cal plan targets              | Phase 7 (defaults are in place meanwhile)                                                                       |

The USDA key is in `.dev.vars` (gitignored). **Never open that file** — nothing needs to; the
Pages Function reads it at runtime. To confirm it is populated, test that the line is non-empty
without printing the value, and say so.

The Open Food Facts contact string was deliberately left blank on 2026-09-10 when the user was
asked. Do not re-ask, and never substitute their Apple ID (`dncanzano@icloud.com`).

## Environment facts

- **Project root:** `C:\Users\dncan\Projects\meal-prep-app`
- Windows 11, PowerShell 5.1. `&&`, `||`, and ternaries are **not** available — use `; if ($?) {}`.
- **Installed:** `node` v24.19.0, `npm` 11.17.0, `gh` 2.100.0 (all via `winget`).
  A terminal opened before that install will not see them on `PATH` until VS Code restarts.
- `gh` 2.100.0 is installed but **not yet authenticated**. `gh auth login` is interactive and
  must be run by the user in a real terminal — it cannot be driven from a non-interactive shell.
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

## Deploying

Cloudflare Pages, project **meal-prep-app**, built from the GitHub repo's `main` branch.

- Build command `npm run build`, output directory `dist` (also declared in `wrangler.toml`).
- `.node-version` pins Node 22. Without it Pages may pick a default older than the 20.19 that
  Vite 7 requires, and the build fails on a machine that is not this one.
- `USDA_API_KEY` is a **Secret** under Settings → Variables and Secrets. Not an environment
  variable, and never in the repo.
- The same Cloudflare account hosts an unrelated `unitedclash` Pages project and an
  `unitedclash-proxy` Worker. Never rename this project into their namespace or connect Git to
  theirs — `unitedclash` is deliberately "No Git connection".

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

| Script               | Does                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `npm run dev`        | Vite dev server, host exposed for phone testing                                            |
| `npm run dev:api`    | Wrangler on :8788 serving `functions/`. Vite proxies `/api` to it. Needed for food search. |
| `npm run serve:full` | Build, then serve app + functions together on :8788 (no hot reload)                        |
| `npm run build`      | Typecheck + production build to `dist/`                                                    |
| `npm run preview`    | Serve the production build                                                                 |
| `npm test`           | Vitest, `src/**/*.test.ts`                                                                 |
| `npm run lint`       | ESLint                                                                                     |
| `npm run format`     | Prettier, write in place                                                                   |

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
