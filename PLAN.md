# Meal Prep App — Design & Build Plan

> **About this document:** this is the working design log I kept with Claude Code while building the app. Where it says "the user," that's me (Duncan) and the decisions I made.

> Working reference for the build. Derived from the Functionality & Design Spec (Draft v1).
> Status: **All eight phases complete and deployed (2026-09-17). In feedback-and-refinement.**

A personal-use PWA for meal planning: build reusable Components, schedule batch-cooking on a
calendar, track servings as fridge stock, and log meals to see macro + micronutrient trends.
Single user, no auth, local-first.

---

## 1. Locked decisions

| #   | Question     | Decision                                                                        |
| --- | ------------ | ------------------------------------------------------------------------------- |
| 1   | Color        | Free hex picker, 12 suggested swatches, perceptual-distinctness warning on save |
| 2   | Units        | `portion_style` discrete/bulk — drives UI only, **one math path** (§3a)         |
| 2b  | Bulk % basis | % of what is **currently left** in the fridge, not of the original batch        |
| 3   | Targets      | Custom 2500-cal plan, user-editable; RDA/DV seeds until real numbers supplied   |
| 4   | Micros       | **Full USDA panel** stored; curated pinned subset displayed by default (§4)     |
| 5   | Scheduling   | Tap-to-schedule. `dnd-kit` used only for ingredient reordering in v1            |
| 6   | Cook flow    | Manual "Mark cooked" with actual-yield **and actual-ingredient** confirmation   |
| 7   | Discard      | Yes — separate `stockAdjustments` audit trail, never counts as eaten            |
| 8   | Backup       | Yes — full JSON export/import                                                   |
| 9   | Quick Add    | Yes — saveable favorites in a separate lightweight table                        |

### Out of scope for v1

~~Multi-device sync~~ (built 2026-10-08, §10) · auth · sharing · expiration alerts · recipe photos.

> **Overturned 2026-10-07.** The user chose a Cloudflare database holding everything, built before
> the Experiment tab — see §10 "Storage". No security for now (single user); auth comes later.
> **Auth, hardening and end-to-end encryption are proposed in §11 (2026-11-04), not yet decided.**
>
> Re-confirmed 2026-10-06. The user hit this in practice — a phone shows nothing a laptop
> entered — was offered sync, and chose to stay local. The handoff is the JSON backup:
> Plan → Export a backup, then Restore from a file on the other device. It replaces rather than
> merges, which is the honest limitation of a snapshot.

> **Naming, 2026-10-06.** The UI calls them **Recipes** and the log tab **Diary**; "Component"
> was vague to the one person using it. The CODE keeps `Component` — stored snapshots carry
> `componentId`/`componentName` and renaming the model would rewrite history for no gain.

---

## 2. Architecture

```
React 19 + TypeScript + Vite 7
├── Dexie 4 + dexie-react-hooks (useLiveQuery)   ← all state; no Redux/Zustand
├── react-router-dom                              ← real back-button on mobile
├── vite-plugin-pwa (Workbox)         [Phase 8]   ← service worker, offline
├── Recharts                          [Phase 7]   ← nutrient trends
├── dnd-kit                           [Phase 3]   ← ingredient reorder only
├── date-fns                                      ← week math, timezone-safe
├── Cloudflare D1                     [2026-10]   ← sync database (§10 "Storage")
└── Cloudflare Worker + static assets              ← host + API proxy + sync, one deploy
```

**`useLiveQuery` is the core pattern.** Every screen reads Dexie reactively; a write anywhere
re-renders whatever observes it. No cache-invalidation layer and no global store — this is why
the dependency list is so short.

**Why a server-side proxy** (`worker/index.ts`):

- The USDA key would otherwise ship inside the client bundle, where it can be scraped and
  rate-limited against you.
- Open Food Facts asks callers to send an identifying `User-Agent`, which browsers forbid JS
  from setting.
- Edge caching makes repeat ingredient lookups free.

Same deploy, same repo, no separate service to run.

> Originally a Cloudflare **Pages Function**; moved to a **Worker with static assets** on
> 2026-09-17 because Cloudflare's dashboard now creates Workers by default and the Pages-shaped
> config failed at the deploy step. Same code, different shape — and the Worker's
> `not_found_handling = "single-page-application"` finally replaced the `_redirects` rule that
> wrangler had been silently rejecting as an infinite loop.

### Folder structure

```
src/
  db/          schema.ts, migrations, backup.ts, seed.dev.ts
  nutrition/   registry.ts, usda.adapter.ts, off.adapter.ts, targets.ts, units.ts
  domain/      pure fns — scaling, aggregation, coverage, portion math (unit-tested)
  features/    calendar/  components/  fridge/  log/  settings/
  ui/          Sheet, Stepper, PercentPicker, ColorPicker, NutrientTable, TabBar
  routes/      route definitions + app shell
worker/
  index.ts     the Cloudflare Worker — /api proxy, plus the ASSETS binding for dist/
```

`domain/` contains **only pure functions** — no Dexie imports, no React. All the math that can
silently be wrong (nutrient scaling, coverage, percent-of-remaining, unit conversion) is
testable without a browser. This is the single most valuable structural decision here.

---

## 3. Data model

Four refinements to the draft spec. Each prevents a class of bug rather than adding a feature.

### a. Discrete and bulk share one math path

```ts
Component {
  base_quantity: number                 // 6, or 3000
  base_unit: string                     // "serving", or "g"
  portion_style: 'discrete' | 'bulk'    // ← drives UI ONLY, never arithmetic
  nutrition_per_base: NutrientMap       // for the whole base batch
}

// per-unit nutrition = nutrition_per_base / base_quantity    ← always, both styles
```

`portion_style` selects the _control_ (stepper vs. percent picker) and the _calendar mark_
(fixed square vs. size-scaled blob). It never branches the math.

### b. Nutrition is a sparse map, not columns

```ts
type NutrientMap = Record<string, number>; // canonical key → amount in canonical unit
// { energy_kcal: 210, protein_g: 28, vitamin_d_ug: 0.4, ... }
```

A canonical **nutrient registry**, keyed off USDA nutrient numbers, defines each nutrient's key,
display name, canonical unit, group (macro / vitamin / mineral / lipid / amino acid / other),
and display precision. USDA and Open Food Facts each get an adapter that maps their field names
into canonical keys **with unit conversion applied there** — OFF reports several nutrients in
different units than FDC, and that conversion belongs in one place, not scattered at call sites.

### c. Coverage tracking — the full-panel correctness fix

Rice has no B12 _value_; it does not have zero B12. Summing sparse data as if missing means zero
silently under-reports every micronutrient. So every aggregate carries a companion map:

```ts
type Coverage = Record<string, number>; // canonical key → 0..1 fraction of
// contributing grams that HAD data
```

A day's B12 then reads `2.1 µg · 68% of intake had data` instead of a confident wrong number.
Cheap during aggregation, effectively impossible to retrofit — which is why it lands in Phase 1,
not Phase 7.

### d. History is immutable via snapshots

`Batch`, `FridgeEntry`, and every `MealLog` item **snapshot** their nutrition at creation time.
Editing a Component's recipe next month must not rewrite what you ate last month. Snapshots also
make Day Detail a pure read rather than a recomputation walk back through ingredients.

### e. Stock mutation is transactional

Logging, editing a log, deleting a log, and discarding all move `FridgeEntry.remaining` **inside
a Dexie transaction** spanning both tables. Deleting a meal log restores the stock it consumed.
Discards and manual corrections additionally write a `stockAdjustments` row
(`reason: 'discard' | 'correction' | 'spoiled'`), so the fridge always reconciles and waste never
touches nutrition totals.

### Tables

`ingredients` · `components` · `batches` · `fridgeEntries` · `stockAdjustments` · `mealLogs` ·
`quickAddFavorites` · `foodCache` · `searchCache` · `targets` · `settings` · `weightEntries` ·
`plan` · `scratchpads` (v6) — plus, since v5, three local-only sync bookkeeping tables: `syncShadow` · `syncOutbox` ·
`syncMeta`, never backed up or synced themselves.

---

## 4. Resolved UI consequences

**Cooking versus eating.** The calendar carries two kinds of fact and draws them differently: a
plan is a bar, an actual meal is a dot. The first build drew marks per scheduled _batch_ and
nothing at all for meals — so you could cook, eat, and see no trace of eating. Meal logs are the
primary content of that screen.

**The day at a glance.** The Diary leads with calories as a wide bar and the three macros as
rings that fill toward their goal (2026-10-06, after the user asked for MyFitnessPal-style
readability). Rings are meters, not charts: one value against one limit, same-ramp track,
overshoot shown by completing the ring AND changing colour rather than silently stopping at full.
The pinned micronutrient list sits below and deliberately excludes anything already in a ring —
showing calories three times on one screen was the opposite of readable.

**Where a total came from.** A meter summing several foods is drawn as segments, one per food in
that food's colour, each as long as its contribution — steak and eggs make a protein bar that is
part steak-red, part egg-amber. Status (met, over) then lives in the word below the bar and the
overshoot marker, since the fill can no longer carry it. Quick Add foods get a stable colour from
their name; items logged before colours existed stay neutral rather than being repainted.

**Amounts are their own step.** Choosing _what_ goes in a recipe and deciding _how much_ are
different jobs, so the builder has a separate "Amount of each" section below the ingredient list.

**Full panel without a wall of numbers.** Storage is complete; display is layered.

- **Specific mode** — your _pinned_ nutrients as bars (default ~10, reorderable in Settings)
- **Day Detail** — full panel, collapsed by nutrient group, with a "show nutrients with no data"
  toggle hiding the sparse tail
- Nutrients with no target render as a bare value, never as 0% of nothing

**Color picker distinctness.** Twelve curated swatches in the primary row; "Custom" opens a full
picker. On save, if the chosen color sits within a perceptual-distance threshold of an existing
Component's color, show a non-blocking `similar to 🟥 Chicken Thighs` note. Full freedom kept,
calendar stays readable.

**Portion defaults.** Picking a food defaults to **its own portion**, not 100 g — USDA knows a
Whopper weighs 291 g "per item", and making the user convert that by hand wastes data already in
hand. Falls back to 100 g only when the food genuinely carries no portion.

That data lives **only on the detail endpoint**: FDC search responses contain no `foodPortions`
whatsoever. So every screen offering a food picker fetches the detail record on selection, which
also buys full-precision nutrition since search rounds to about three significant figures.

But the detail record cannot simply replace the search result. For **Branded** foods its
nutrients arrive with no descriptor at all — an internal id and an amount, nothing else — and
adapting it produces zero nutrients where the search result had fifteen. Branded foods also lack
`foodPortions` entirely and keep their serving size in `servingSize`. So the two responses are
**merged**: portions from detail, nutrition from whichever actually knows more. A detail fetch
must never make the data worse.

**Choosing a search result.** FDC ranks short queries badly — "egg" led with a Snickers egg — and
buries the difference between results in the tail of a comma list. So the client fetches 50,
re-ranks them (a name that _is_ the query first, generic data before packaged), drops duplicates,
and shows at most 15. Each card leads with the food, then a chip for how it is prepared. USDA's
"raw" on a grain means **dry**, and the chip says so; a packaged staple with no stated state gets
a dashed "Likely dry" or "Likely cooked" inferred from its calories per 100 g.

**Derived totals.** Omega-3 and omega-6 are sums of individual fatty acids. They are computed
whenever an aggregate is shown, never stored, so they apply to meals logged before they existed
without rewriting a snapshot (§3d). Present when any part is; coverage is the best part's.

**Unit resolution.** `resolveToGrams(qty, unit, ingredient)` tries, in order:

1. Mass units → direct conversion
2. USDA `foodPortions.gramWeight` for "1 tbsp" / "1 each" → exact
3. Small builtin density table → approximate
4. Prompt once for the gram weight, cache it on the ingredient

Returns a confidence flag that feeds coverage.

---

## 5. Screens

Bottom tab bar, five tabs — **Calendar · Recipes · Fridge · Diary · Experiment** — plus a floating "+" on
Calendar and Fridge for quick logging.

| Screen              | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Calendar**        | Month grid with `‹ ›` nav (changed from a week strip 2026-09-17 — a month is what you want to look back over). Cooking is a **bar** across the top of a day, solid for still-to-cook and hollow for cooked; each thing **eaten** is a **dot** below it, one per logged item, coloured by its source. Tap a day → its panel below, eaten first, with **+ Log food** logging straight to that day. A **Meals / Trends** toggle (2026-10-06): Trends replaces the marks with the day's calories, three columns filling toward the carb/fat/protein goals, and a border — green if calories and all three macros were met, orange if only calories — and reveals the weekly charts. Today is a filled date marker; the selected day a dark outline. |
| **Day Detail**      | Every MealLog that day, full grouped nutrient table vs. target, coverage indicators, edit/delete individual entries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Recipes & foods** | Two libraries behind a segmented toggle (2026-10-06). **Recipes** are assembled and cooked in batches — card list with colour dot, category, yield; tap → detail. **Foods** are single items typed in by hand, for anything the database has never heard of, with a **+ Fridge** action for "I bought eight of them". Code calls both halves Components/Ingredients.                                                                                                                                                                                                                                                                                                                                                                            |
| **Recipe Builder**  | Name, colour, category, portion style, unit, base yield, ingredient list with search + reorder, a separate **Amount of each** section, live nutrition summary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Fridge**          | Discrete: `4 of 6 servings left`. Bulk: progress bar + `62% left · ≈1.9kg`. Actions: Log, Adjust, Discard remaining.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Diary**           | _Today_ — calories as a bar, the three macros as rings that fill toward their goal. _From Fridge_ — steppers for discrete, percent picker (of remaining) for bulk with live gram/kcal preview. _Quick Add_ — search, manual entry, favourites. Full nutrient panel below the day's content.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Experiment**      | Saved scratchpads (2026-10-08). Each: foods and recipes with amounts, a period, an **Average day** view and a **Day by day** view with drag and drop. Suggestions to come.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Settings**        | Nutrient targets editor, pinned-nutrient management, JSON export/import.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

---

## 6. Build phases

Each phase ends in something openable and usable.

### Phase 0 — Environment & scaffold

Node 22+ LTS (24 installed), `git init`, Vite + React + TS, ESLint/Prettier, Vitest, folder skeleton, app shell
with tab bar and four routes, static web manifest, Cloudflare Pages connected.

> **Done when:** the shell is live on a Pages URL and installs to your phone home screen.

### Phase 1 — Nutrition foundation & data layer

Nutrient registry, unit conversion, `NutrientMap` / `Coverage` types, every pure aggregation
function **with tests**, complete Dexie schema, JSON export/import, dev seed data.

> **Done when:** `npm test` proves scaling, aggregation, coverage and percent-of-remaining are
> correct. No UI — this is the layer everything else trusts.
>
> ✅ **Done 2026-09-10** — 125 tests across 7 files. Also added: `domain/components.ts` (rolling a
> Component up from its ingredients) and `db/init.ts` (idempotent first-run defaults).

### Phase 2 — Food lookup · needs USDA API key

Server-side proxy, USDA + OFF adapters, `foodCache` table, debounced search UI with source
badges, manual-entry fallback for anything not found.

> **Done when:** searching "chicken thigh" returns real nutrition and the second search is
> instant from cache.
>
> ✅ **Done 2026-09-15** — verified against the live API: 19,967 hits, `x-proxy-cache: HIT` on
> repeat, registry validated (74 keys, 0 unit mismatches). OFF deferred by choice, so USDA-only.
> Found that FDC search rounds and detail does not — Phase 3 must fetch detail on selection.

### Phase 3 — Component Builder & Library

Library list, builder form, ingredient search + `dnd-kit` reorder, discrete/bulk toggle, color
picker with distinctness check, live nutrition summary, detail view, delete guarded against
Components that already have cook history.

> **Done when:** Chicken Thighs, Rice and Guacamole exist with real numbers.
>
> ✅ **Built 2026-09-15** — library, builder, detail, OKLab colour distinctness, dnd-kit reorder,
> delete guarded against cook history. Write path covered by `db.test.ts` against a real
> in-memory IndexedDB. The three worked examples are still for the user to enter.

### Phase 4 — Calendar & scheduling

Week view with `‹ ›` nav, Overview/Specific toggle (Overview only for now), tap-to-schedule flow,
`Batch` creation with scale factor, planned-batch badges, past-due nudge.

> **Done when:** a week of cooking is scheduled and visible.
>
> ✅ **Built 2026-09-15** — week strip with `‹ ›`, tap-to-schedule, scale picker, past-due nudge
> offering "didn't cook it". Overview mode only, as planned. Days are local `YYYY-MM-DD` via
> `domain/dates.ts` (31 tests) — `new Date('2026-09-15')` is UTC midnight and would shift the day.
> **Superseded 2026-09-17**: the week strip became a month grid and meal logs became the primary
> content — see §9.

### Phase 5 — Cook → Fridge

"Mark cooked" sheet with actual-yield confirmation, `FridgeEntry` creation with nutrition
snapshot, fridge list (discrete counts vs. bulk progress bar), Adjust, Discard remaining.

> **Done when:** a cooked batch becomes fridge stock and can be corrected or discarded.
>
> ✅ **Built 2026-09-15** — actual-yield confirmation divides by what really came out of the pan,
> not the plan. Corrections, discards and spoilage each write their own `stockAdjustments` reason
> and never count as eaten. 23 tests against a real in-memory IndexedDB.

### Phase 6 — Logging

From-Fridge tab with steppers and percent picker, Quick Add with search + manual entry +
save-as-favorite, favorites row, barcode scan, transactional stock deduction, edit/delete a log
restoring stock.

> **Done when:** the loop closes — cook, eat, watch stock drop, correct a mistake.
>
> ✅ **Built 2026-09-15** — from-fridge stepper/percent picker, Quick Add with favourites, and
> transactional stock that returns when a log is deleted. 27 tests on those invariants.
> Barcode scanning deferred: it needs Open Food Facts, which is off until item 8 is answered.
>
> ⚠️ Barcode scanning is the one genuine unknown: the native `BarcodeDetector` API is absent on
> Safari, so iOS needs a `@zxing/browser` fallback. If it fights back, manual barcode entry ships
> and scanning follows.

### Phase 7 — Insight · needs 2500-cal plan numbers

Targets table + Settings editor, Specific mode bars, Day Detail full grouped panel with coverage
indicators, Recharts weekly trends, pinned-nutrient management.

> **Done when:** you can see how a real week measured up.
>
> ✅ **Built 2026-09-16** — an editable Plan (weight, macros, water, every micronutrient, daily and
> weekly, FDA template), direction-aware meters, Day Detail, and Recharts trends indexed to % of
> target. Targets carry a direction: sodium is a limit, not a goal to reach.

### Phase 8 — PWA polish

Icon set, `vite-plugin-pwa` with Workbox precache + runtime caching for proxy routes, offline
degradation to cached data, install prompt, iOS safe-area handling, backup reminder.

> **Done when:** it works on the subway.
>
> ✅ **Built 2026-09-16** — Workbox precache (including the chart chunk, so Specific mode works
> offline), `/api` on the navigation-fallback denylist, a generated icon set with a maskable
> variant, a platform-branched install prompt, an offline banner, and the backup export/import UI.

---

## 7. Risk register

| Risk                                       | Mitigation                                                          |
| ------------------------------------------ | ------------------------------------------------------------------- |
| Sparse micronutrient data misleads         | Coverage tracking from Phase 1                                      |
| IndexedDB wiped by browser cleanup         | JSON export in Phase 1, backup reminder in Phase 8                  |
| iOS barcode scanning unsupported           | ZXing fallback + manual barcode entry                               |
| USDA rate limits / key exposure            | Worker proxy + local `foodCache`                                    |
| Volume→gram guessing skews nutrition       | Confidence flag surfaced in UI, one-time user override cached       |
| Recipe edits corrupting history            | Snapshot-on-write at Batch / FridgeEntry / MealLog                  |
| ~~OneDrive syncing `node_modules`~~        | Resolved — project moved to `C:\Users\dncan\Projects\meal-prep-app` |
| ~~Source no longer backed up by OneDrive~~ | Resolved — pushed to GitHub 2026-09-10                              |

---

## 8. Inputs still needed

All three original blockers are resolved — the USDA key is in place, and the app is deployed as a
Cloudflare **Worker** (not a Pages project; see CLAUDE.md § Deploying).

One input remains, and it blocks nothing:

- **Your real 2500-cal targets.** The Plan screen is live and seeded with FDA Daily Values, each
  labelled "FDA default" so a number you never chose never reads as one you did. Replace them on
  the Plan screen whenever you like.

Deliberately deferred, as a decision rather than an oversight:

- **An Open Food Facts contact string**, which gates barcode scanning only (PLAN.md §6).

See **SETUP.md** for the full record.

---

## 9. What changed after the phases

The eight phases describe how it was _built_. These are the decisions that came out of actually
_using_ it, and they override the phase text where they disagree:

| Date       | Change                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| 2026-09-17 | Calendar became a **month grid**; meal logs became its primary content (the phase build showed only cooking)      |
| 2026-10-06 | UI renamed: Components → **Recipes**, Log → **Diary**. Code identifiers deliberately unchanged                    |
| 2026-10-06 | Diary leads with **macro rings**; the recipe builder gained an **Amount of each** section                         |
| 2026-10-06 | "Mark cooked" became a real confirmation — adjust each ingredient, recompute nutrition from what actually went in |
| 2026-10-06 | Recipes tab split in two, adding a **Foods** library for items you type in yourself                               |
| 2026-10-06 | Multi-device sync re-confirmed **out of scope**; the JSON backup is the handoff                                   |
| 2026-10-06 | Every food picker gained a **USDA / My foods** toggle; the Foods library gained **Eat**                           |
| 2026-10-06 | **Omega-3 / omega-6 totals**, derived at read time from the individual fatty acids (§4)                           |
| 2026-10-06 | Search results **re-ranked, capped at 15, and labelled** — raw / cooked / dry, brand, category (§4)               |
| 2026-10-06 | Every multi-food meter **split into segments by source**, each in its food's colour (§4)                          |
| 2026-10-06 | Calendar gained a **Meals / Trends** toggle; today and the selected day now marked differently (§5)               |
| 2026-10-06 | Tutorial text removed; the Diary's add button became **+ Log food** in the header                                 |
| 2026-10-07 | The calendar's day panel gained **+ Log food**, logging to the selected day rather than linking to the Diary      |
| 2026-10-08 | **Sync built**: every device keeps a local copy and swaps changes with a Cloudflare D1 database (§10 "Storage")   |
| 2026-10-08 | The D1 database is bound in `wrangler.toml`; sync goes live with the next push                                    |
| 2026-10-08 | **Experiment tab**: scratchpads with an Average day view and a drag-and-drop Day by day view (§10)                |
| 2026-10-08 | Every link-style action restyled as a button; chart points filled in colour; Trends chart above the weekly bars   |

---

## 10. The Experiment tab — scratchpads BUILT 2026-10-08; suggestions not yet

> Requested by the user 2026-10-07, with an explicit instruction: **do not build yet, and do not
> make design decisions they did not specify.** Everything under "Decided by the user" is theirs.
> Everything under "Open questions" is undecided — do not pick an answer by default.

### What it is for

The user's framing: you are **experimenting with what you might buy from the store for a week**,
and want to know the total nutrition profile of that haul _before_ buying or cooking any of it.
Then, if it holds up, it becomes a shopping list and a cooking plan.

Two features in one tab, working together:

1. **Scratchpads.** Queue up recipes and foods; see their combined nutrition.
2. **Suggestions.** Recommend foods or meals for what the diet is missing — runnable against a
   scratchpad ("this plan is short on magnesium; here is what would fix it").

### Decided by the user (2026-10-07)

| #   | Question           | Decision                                                                                                                |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | Where it lives     | A **fifth tab**, called Experiment.                                                                                     |
| 2   | What can be queued | **Anything**: USDA foods, your own Foods, and recipes.                                                                  |
| 2b  | Scaling            | There must be a way to say what period the haul is for — "this is for a week".                                          |
| 3   | A recipe's amount  | The **entire batch** you plan to cook — not servings.                                                                   |
| 4   | Judged over        | **Selectable**: weekly, day by day, monthly, and so on.                                                                 |
| 5   | How many           | **Multiple scratchpads**, each kept — effectively a reusable shopping list for later weeks.                             |
| 6   | Persistence        | **Everything saved between sessions.**                                                                                  |
| 7   | Already-eaten food | **Not counted** in a scratchpad's totals (pending the user confirming they read the question as intended — see below).  |
| 8   | Making it real     | Wanted: a scratchpad can be **saved as a shopping list**, and the "schedule these onto the Calendar" idea was welcomed. |

### Facts that bear on the remaining choices (not decisions)

- **FDC's search cannot filter or sort by nutrient.** It takes a text query, data types, page size
  and a sort by name, id, data type or date. A live "find foods high in magnesium" is not one
  request — it means searching candidate food names and ranking what comes back on the client.
- **FDC throttles rapid requests** and reports it as a 400 (CLAUDE.md). Many searches per
  suggestion run would be slow, and some would fail and be retried.
- **Coverage already exists** (§3c). A nutrient can look "missing" because the foods eaten never
  _reported_ it, not because the diet lacks it.
- **Everything a scratchpad needs to compute already exists**: recipe snapshots, per-100 g food
  data, `aggregate` with coverage, the segmented meters, `withDerivedTotals`, and weekly targets
  (daily × 7 unless set separately).

### Scratchpads — BUILT 2026-10-08

Route `/experiment` (list) and `/experiment/:id`; a fifth tab. Code: `domain/scratchpad.ts`
(placing, moving, splitting, averaging — pure), `nutrition/scratchpad.ts` (what an item contains,
default portions), `db/scratchpads.ts`, `features/experiment/`. Stored in a synced, backed-up
`scratchpads` table (Dexie v6), one row per scratchpad with its items inside.

The user's last answers (2026-10-08, multiple choice): **build scratchpads now, suggestions
later**; **one drag places one portion, then −/+ to adjust**; **food not placed waits in a tray and
counts toward no day.**

How the rest was filled in — implementation choices, flagged so they can be changed:

- A food comes in at one of its own portions (as the Quick Add picker does) and its amount is set
  in the list. **Portions default** to one per unit for counted food (20 eggs → 20), the food's own
  serving for weighed food (a gallon of milk → 16 cups), else 100 g pieces; a recipe to its
  servings, or ~250 g pieces if bulk. "Split into" changes it.
- Changing a food's amount re-splits it to the natural count; changing a recipe's batches scales
  its servings. Placements beyond the new count come off the **last** days first.
- Shortening the period sends food on dropped days **back to the tray** rather than deleting it.
- Foods are snapshotted; recipes are live by reference (see CLAUDE.md for why).
- Average view reuses the Diary's calorie bar, macro rings and full panel, all split by item.
  Day view shows each day's calories and three thin macro bars; tapping a day shows its full
  summary below.

**First round of feedback (2026-10-08), applied the same day:** item rows are now one compact line
(colour, name, amount · kcal · placed) that opens to the amount and split controls, with a second
"Nutrition breakdown" tap for every nutrient per portion and in all; tray chips are bigger; touch
drags start after 120 ms (was 180) and mouse drags after 4 px (was 6); a whole day card selects the
day, not only its header; and both summaries have an "All nutrients" expander for the full panel.

Verified 2026-10-08 in a real browser at 390 px and 1280 px: building a scratchpad through the UI,
then mouse drags tray → day, day → day, day → tray, and −/+; the saved placements matched exactly.

### Decided by the user (2026-10-08): two views of one scratchpad

The user's own description, which settles what "judged over a week or a month" means:

1. **Average view.** Build a set of foods and meals, set the amounts, then choose a period — a
   week, a month, or any number of days. The scratchpad divides the total nutrition by that many
   days: "if I ate this every day, what would my average day look like?"
2. **Day-by-day view.** The scratchpad's own simple calendar (Day 1, Day 2… — not real dates), as
   many days as the period. Instead of an even division, **drag** the food onto the days you would
   eat it and see **each day's** nutrition. Drag and drop, simple and easy.

### Decided by the user (2026-10-07, second round)

- **Amounts are what you buy; the period divides them.** 20 eggs over a week is 20 eggs'
  nutrition spread across 7 days — the scratchpad does that arithmetic.
- **Then you can move food between days by hand.** A scratchpad has its own simple run of days —
  a layout ("Day 1, Day 2…"), **not tied to calendar dates**. Bought for a week, the food can be
  dragged onto the days you would eat it: 10 eggs Monday, 2 Wednesday, 2 Thursday.
- **Recipes split quickly into servings** so the chunks can be placed on different days.
- **Drag and drop, and fast.** The whole point is drafting a period's food quickly and changing it
  freely. Speed of rearranging is a requirement, not a polish item.
- **Already-eaten food is not counted** — confirmed: a scratchpad counts only what is in it.
- **Shopping list: later.** It will have sub-items — a recipe line expands into its ingredients
  (eggs, bananas, chicken recipe → its ingredients, milk). Details to be worked out then.
- **Scratchpads are fully separate from the Calendar** for now. No scheduling onto it, no
  reuse/compare features yet.

### Open questions — awaiting the user

**Suggestions** (none answered yet)

- Prebuilt database, live USDA search, or both?
- Suggest what: single foods, your own saved recipes and foods, or new meal ideas?
- "Missing" over what window: today so far, this week, or the scratchpad?
- Which nutrients count: every one with a goal, only pinned ones, only those under some threshold?
- Low coverage: skip those nutrients, flag them, or treat them as gaps?
- Limits (sodium, saturated fat, added sugar): must suggestions avoid pushing these over?
- Should the remaining calorie budget constrain suggestions?
- Ranking: nutrient per calorie, per serving, or how many gaps one food closes at once?
- Exclusions: foods you dislike, allergies, dietary patterns?
- A food alone, or with an amount ("150 g salmon closes 80% of your vitamin D gap")?
- What you can do with one: add to a scratchpad, log it, add to the fridge?
- Experiment tab only, or also surfaced on the Diary?

### Storage — DECIDED 2026-10-07: a Cloudflare database, before anything else

The user's answers:

- **A Cloudflare database**, in this project.
- **Everything the app has now goes into it first** — diary, recipes, foods, fridge, plan, the
  lot — **before any Experiment work starts.** The Experiment tab waits for this.
- **No security for now.** The user is the only person using this address. Revisit later, when
  the app may become multi-user with logins, accounts and per-user data.

Second round (2026-10-07), via a multiple-choice prompt:

- **Offline: a local copy that syncs.** The app keeps working with no signal exactly as before;
  changes swap with the database when there is a connection. **The later edit wins** when two
  devices change the same thing.
- **Existing data: merge both devices.** Phone and laptop data both go in. Anything entered on
  both appears twice and needs tidying by hand — the user was told this when choosing.
- **Creating the database: the user does it in the Cloudflare dashboard** and passes on its id.

### Sync — LIVE, confirmed by the user 2026-10-08

How it works (code: `src/domain/sync.ts` pure rules, `src/db/sync.ts` the engine,
`worker/syncLogic.ts` server rules, `worker/index.ts` the D1 adapter):

- **One generic table on the server.** Every row of every synced table is a record keyed by
  (table, id): the row as JSON, when it changed, whether it is a tombstone, and a `rev` that only
  goes up. A device asks for "everything after rev N". The table creates itself on first use — no
  migration command to run against production.
- **Ids that cannot collide.** IndexedDB's own counter gives 1, 2, 3… on every device. New rows
  now get `creation-ms × 1000 + random 0–999`, assigned centrally by a Dexie `creating` hook so no
  write path changed. Existing rows are renumbered once per device before their first upload,
  with every reference followed — six fields, including the two inside arrays. Restoring an old
  backup reintroduces small ids, and they are renumbered the same way.
- **Changes are found by diffing, not by hooking writes.** Each row's fingerprint is compared with
  the last-synced one; differences go into an outbox stamped with when they were noticed. This
  runs offline too, so "when" is close to when the edit happened.
- **Later edit wins, on both sides.** The server keeps a write only if strictly newer; the device
  skips a download if it holds a newer un-uploaded edit of the same row.
- **First upload uses each row's own timestamp**, and 0 for rows with none — so a fresh phone's
  untouched default goals lose to goals already edited on the laptop.
- **Restore still replaces** — and now that propagates: the deletions sync to every device. The
  restore confirmation says so.
- **No database bound = local-only, as before.** `/api/sync` answers 503, the Plan screen says
  "Sync is not set up yet", and changes queue in the outbox until it is.

**First live run, 2026-10-08.** The laptop uploaded correctly (48 records, read back from the live
database), but the phone reported "Synced" with none of it, even though it could load the data by
opening the sync URL directly. Most likely a cached empty pull reply: a pull URL repeats exactly
until there is something new. Fixed by marking every sync reply never-cache on both ends, plus a
"Sync details" panel (counts on each side, download position) and "Re-download everything".

Verified 2026-10-08 against the real Worker with a local D1, two browser sessions as two devices:
12 meals and 4 batches with old-style ids renumbered and uploaded from one; the other, starting
empty, received them all; a goal edited on the second reached the first.

The original questions, kept for the record:

While answering, the user raised saving data off the device: "set up somewhere this data can all be
saved … through some sort of Cloudflare feature or just add a set of DBs to this project." Their
other app uses a Google Sheet.

This reopens §1's **local-only** decision (re-confirmed 2026-10-06). Nothing changes until the user
answers:

- **All data, or just scratchpads?** Moving everything (diary, recipes, fridge, plan) to a server
  is multi-device sync, which also ends the phone-versus-laptop split and the backup handoff.
  Moving only scratchpads and shopping lists is smaller.
- **Where.** The user named a Cloudflare feature or databases in this project. Cloudflare's
  options include D1 (SQL), KV (key–value) and Durable Objects, all reachable from the existing
  Worker. A Google Sheet is the pattern from their other app. Not chosen.
- **Who may read and write it.** The app has no login. A server database behind a public URL is
  readable and writable by anyone who finds the URL, so it needs a gate — e.g. Cloudflare Access
  (an email sign-in in front of the site), or a passphrase the app sends. Not chosen.
- **Offline.** Today the app works with no signal. A server copy means either online-only, or a
  local copy that syncs — which raises what happens when two devices edit the same thing.
- **Existing data.** Upload what is already in this browser once, at the switch?

---

## 11. Going public: accounts, hardening, end-to-end encryption — steps 1–2 BUILT 2026-11-04/05

The user wants the repository public on GitHub for recruiters, and wants the app multi-user with
security work worth showing (they are a CS cybersecurity major). **Steps 1 (accounts and
per-user isolation) and 2 (hardening) are built; encryption is not.**
The user's answers are under "Decided"; the sketch below predates them where they differ.

### Why it cannot simply be made public today

- **The live URL is the only protection.** `/api/sync` has no auth (§10, by the user's choice
  while single-user). The URL appears in CLAUDE.md in 12 commits, so publishing the history
  publishes it: anyone could `GET /api/sync?since=0` for the whole diary, or POST to overwrite it.
  Removing the line now does not remove it from history.
- **The food search is an open proxy** for the USDA key: anyone with the URL spends its quota.
- **History has no secrets** (checked all 55 commits 2026-11-04): `.dev.vars` was never committed;
  the USDA key appears only as a variable name.

So the order is: keep the repo private until accounts ship, **or** put Cloudflare Access (email
one-time code, no code changes) in front of the Worker as a stopgap.

### Decided by the user (2026-11-04)

- **The repo stays private until accounts ship.** No stopgap — "very temporary", not a concern.
- **Login: a simple login, with an admin password reset done by the user.** Few or no other
  users are expected. Passkeys / OAuth / hosted auth are not wanted.
- **Consequence for E2EE:** an admin reset that keeps a user's data working means the server can
  always reach that data — the opposite of end-to-end encryption. Resolved below.

Second round (2026-11-04), via a multiple-choice prompt:

- **E2EE: yes, with a recovery code.** An admin reset restores LOGIN only. The user then unlocks
  their data with the recovery code shown once at sign-up; with no code, their synced data is
  unreadable and they start fresh (copies already on their devices survive). The server never
  holds anything that decrypts data.
- **Open sign-up.** Anyone can create an account — so sign-up and login need rate limiting.
- **Admin actions are command line only.** A script run from the user's machine through wrangler
  against D1. No admin endpoint or screen exists on the web at all.
- **Demo account: later.**

### Order of work

1. **Accounts and per-user isolation** — login, server-side sessions, `user_id` on every D1 row,
   tests that try cross-user reads and writes (IDOR) and expect them to fail.
2. **Hardening** — security headers (strict CSP, HSTS, frame-ancestors), rate limits on login and
   USDA search, schema validation and size caps on sync uploads, Origin check on POSTs, CI with
   `npm audit` / Dependabot / CodeQL / secret scanning, `THREAT_MODEL.md` and `SECURITY.md`.
3. **End-to-end encryption** (below). Needs accounts first: wrapped keys belong to a user.

### End-to-end encryption — design sketch

**Why it fits.** The server already treats each record's `data` as opaque: it stores `tbl`, `id`,
`data`, `updated_at`, `deleted`, `rev` and only compares `updated_at` to pick a winner. Encrypting
`data` in the browser before upload leaves `worker/syncLogic.ts` essentially unchanged.

**Keys — one data key, wrapped several ways.**

- At sign-up the browser generates a random AES-256 **data key (DEK)**. It encrypts every record.
- The DEK is never uploaded bare. It is **wrapped** (encrypted) by one or more key-encryption keys,
  and only the wrapped copies are stored on the server:
  - **Passphrase** → stretched by PBKDF2-SHA256 (WebCrypto, built in) or Argon2id (WASM library).
  - **Passkey** → the WebAuthn PRF extension yields a per-credential secret. Not every
    authenticator supports PRF, so it cannot be the only wrap.
  - **Recovery code** → random, shown once at sign-up.
- A new device signs in, fetches the wrapped DEK, unwraps it locally.
- Changing the passphrase re-wraps the DEK; no record is re-encrypted.

**Records.**

- AES-256-GCM, fresh random 96-bit IV per encryption.
- **Associated data = `tbl | id | updatedAt | deleted`.** Binds each ciphertext to its slot, so a
  malicious server cannot swap ciphertexts between records or replay an old one under a new
  timestamp — decryption fails instead. This is the part not to "simplify" away.

**On the device.** The unwrapped DEK is stored as a **non-extractable `CryptoKey`** in IndexedDB:
usable by the page, never readable as bytes, so an XSS bug can misuse it while the page is open
but cannot exfiltrate it. Sign-out deletes it. Sync shows a "locked" state until unlocked.

**Code that would change.**

| Where                              | Change                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `src/domain/crypto.ts` (new, pure) | encrypt / decrypt, AAD construction, wrap / unwrap. Fully unit-tested       |
| `src/db/sync.ts`                   | encrypt on push, decrypt on pull, locked state                              |
| `worker/`                          | store and serve wrapped keys per user; cap blob sizes                       |
| UI                                 | set passphrase, show recovery code, unlock on new device, change passphrase |
| Migration                          | re-upload existing plaintext rows encrypted, then delete the plaintext      |

**What it does not protect — goes in the threat model.**

- **Metadata.** The server still sees table names, `updated_at`, sizes and ids — and ids embed the
  creation time in ms (the Dexie `creating` hook). That reveals when and how often meals are
  logged, not what. Padding / coarser timestamps could reduce it; at minimum, documented.
- **The server ships the JavaScript.** A compromised server could serve code that steals the key.
  CSP, Subresource Integrity and an open repo reduce but cannot remove this — the standing limit
  of web E2EE.
- **Old plaintext.** D1 Time Travel keeps ~30 days of history, so pre-migration plaintext persists
  that long.
- **A compromised device.**

**What it costs.**

- Lose the passphrase, every passkey and the recovery code → synced data is unrecoverable (copies
  already on devices survive). Must be said plainly in the UI.
- No server-side computation over the data (e.g. server-generated suggestions). Browser-side is fine.
- Sharing between users later needs public-key crypto (ECDH wrapping a per-item key).

**Proof.** Unit tests: round trip; one flipped byte fails; swapped ciphertexts fail (AAD); wrong
passphrase fails; re-wrap keeps data readable. Integration: sync a uniquely named food, then
search the raw D1 rows for that name and expect zero hits.

Third round (2026-11-04):

- **Log in with a username.** No email is collected: nothing ever sends one, since resets are the
  admin CLI.
- **One password does both.** The browser derives two independent values from it (Bitwarden's
  pattern): a login proof sent to the server, which hashes it again before storing, and a
  key-encryption key that never leaves the device and wraps the data key. After an admin reset
  the recovery code unwraps the data key once and it is re-wrapped under the new password.
- **Argon2id** for stretching the password — a small WASM library in the client. Not PBKDF2.

### Still open

Fourth round (2026-11-04): proposed defaults, accepted with one change —

- **Sessions last 30 days**, extended (at most once a day) whenever used; "sign out other devices"
  exists.
- **Passwords: at least 8 characters, nothing else.** No common-password list (the user's change
  from the proposed 12 + list). Enforced in the browser only — the server never sees a password.
- **Rate limits:** 5 failed sign-ins per username per minute, 20 per IP per minute, 5 sign-ups
  per IP per hour.
- **Recovery code** shown once, with an "I've saved this" tick to continue (step 3).

### Step 1 — BUILT 2026-11-04: accounts and per-user isolation

Code: `worker/authLogic.ts` (rules, no Cloudflare types), `worker/d1Stores.ts` (D1 + the
schema/migration), `worker/index.ts` (routes, cookie, Origin check), `src/auth/` (derivation,
session state, the gate and sign-in screen), `src/features/settings/AccountSection.tsx`,
`scripts/admin.mjs`.

- **Every `/api/*` route except `health` and `auth/*` needs a session**, which also closes the
  open USDA proxy.
- **The user is part of every sync key** — `user_records` is keyed (user_id, tbl, id). A push
  naming someone else's id makes a row in the pusher's own space; it cannot overwrite theirs.
- **Migration:** on first use the old `records` rows are copied once into `user_records` with
  user_id `''` (owned by nobody) and their revs kept, so device cursors stay valid. The admin
  command `claim-legacy <username>` hands them to an account and empties `records`.
- **Login proof:** Argon2id (64 MiB, 3 passes; 0.57 s on the laptop) over the password, salted
  with SHA-256 of the username, then HKDF label `login-proof`. The server stores SHA-256 of the
  proof. HKDF label `data-key-wrap` is reserved for step 3.
- **Session cookie** `__Host-session`: HttpOnly, Secure, SameSite=Strict, Path=/. The server
  keeps only the token's SHA-256. Plain `session` cookie over http on a LAN address (dev only).
- **Writes need a same-origin `Origin` header** (two loopback hosts allowed for the Vite proxy).
- **One device, one account's data.** `syncMeta.owner` records whose; sign-out uploads first,
  warns if anything could not go, then erases the device. Data from before accounts prompts
  "Keep it / Erase it"; another account's data prompts "Erase and continue / Back".
- **Admin is command-line only** (`node scripts/admin.mjs --remote|--local …`): list,
  reset-password (prints a temporary password once, ends every session), sign-out, disable,
  enable, claim-legacy. Runs through the admin's own wrangler login; nothing on the web.

Verified 2026-11-04: 41 Worker tests (4 of them cross-user attacks) and 6 derivation tests; 19
HTTP checks against a local Worker (no-session 401s, forged and replayed tokens, cross-origin and
origin-less POSTs, identical errors for unknown user and wrong password, the lock-out, isolation
over the wire); and 8 browser flows (sign-up, keep pre-accounts data, refuse another account's,
sign back in, sign out erases the device and kills the session).

### Step 2 — BUILT 2026-11-05: hardening

The user said "keep moving forward". The numbers below are mine, set far above measured real use
(largest live record 3.7 kB, whole account 59 records), and easy to change.

- **Security headers.** Static pages get theirs from `public/_headers`, which Cloudflare's asset
  server applies:
  - a strict CSP: `default-src 'self'`, with `'wasm-unsafe-eval'` only for Argon2id; no inline
    script or style;
  - `frame-ancestors 'none'`, HSTS, `nosniff`, `Referrer-Policy: no-referrer`, COOP/CORP;
  - a Permissions-Policy that turns the camera off. Barcode scanning will need `camera=(self)`.

  API replies get `default-src 'none'` from `withSecurityHeaders` in `worker/index.ts`.

- **Body caps before parsing:** 4 MB for a sync push and 16 kB for sign-in. The stream is
  counted, so a chunked body with no declared length is capped too.
- **Sync validation** in `parsePush`:
  - ids must match `[A-Za-z0-9_.:-]{1,64}`;
  - timestamps must not be negative, nor more than a day ahead of the server clock (a record
    stamped in the year 9999 would win every later edit forever);
  - each record is at most 256 kB.
- **Per-account quota** in `push`: 20,000 records and 50 MB. Deletions always pass. Refusals
  return 413.
- **USDA rate limit:** 60 lookups per account per minute (`rateLimit` in `authLogic.ts`). Old
  windows are pruned on sign-in.
- **CI** (`.github/workflows/ci.yml`):
  - runs lint, test, typecheck and build, then `npm audit --audit-level=high`, then a zero-tolerance
    audit of shipped dependencies;
  - actions are pinned to commit SHAs, and the token is read-only.
- **CodeQL** (`codeql.yml`) scans TypeScript and the workflows with the security-extended queries.
  It works only once the repo is public.
- **Dependabot** checks npm and actions weekly, with a 5-day cooldown.
- **Dependencies:** `npm audit fix`, and Vitest 3 → 5, which cleared both criticals. 12
  moderate/low remain, all inside vite-plugin-pwa's build tooling, explained in THREAT_MODEL.md.
- **`THREAT_MODEL.md`** covers assets, attackers, controls by area and ten known limits.
  **`SECURITY.md`** asks for reports through GitHub's private vulnerability reporting.

Verified 2026-11-05:

- 594 tests, 13 of them new.
- Over the wire against a local Worker, each refused with the right status:
  - a year-9999 timestamp and an id with markup in it (400);
  - a 300 kB record, a 5 MB body, the same body chunked, and a 20 kB sign-in (413);
  - the 61st USDA call in a minute (429, with Retry-After).
- In Chromium under the production CSP, at 390 and 1280 px: sign-up, every screen, a food search
  and service worker registration. Zero CSP violations, zero console errors.

### Still open

- **Demo account** — deferred by the user ("later").
- **Step 3 (encryption)** — not started.
