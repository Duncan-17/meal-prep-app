# Meal Prep App — Design & Build Plan

> Working reference for the build. Derived from the Functionality & Design Spec (Draft v1).
> Status: **Phase 0 complete and verified (2026-09-10). Phase 1 next.**

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
| 6   | Cook flow    | Manual "Mark cooked" with actual-yield confirmation                             |
| 7   | Discard      | Yes — separate `stockAdjustments` audit trail, never counts as eaten            |
| 8   | Backup       | Yes — full JSON export/import                                                   |
| 9   | Quick Add    | Yes — saveable favorites in a separate lightweight table                        |

### Out of scope for v1

Multi-device sync / auth · sharing · expiration alerts · recipe photos.

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
└── Cloudflare Pages + one Pages Function          ← static host + API proxy
```

**`useLiveQuery` is the core pattern.** Every screen reads Dexie reactively; a write anywhere
re-renders whatever observes it. No cache-invalidation layer and no global store — this is why
the dependency list is so short.

**Why a Pages Function proxy** (`functions/api/[[route]].ts`, ~40 lines):

- The USDA key would otherwise ship inside the client bundle, where it can be scraped and
  rate-limited against you.
- Open Food Facts asks callers to send an identifying `User-Agent`, which browsers forbid JS
  from setting.
- Edge caching makes repeat ingredient lookups free.

Same deploy, same repo, no separate service to run.

### Folder structure

```
src/
  db/          schema.ts, migrations, backup.ts, seed.dev.ts
  nutrition/   registry.ts, usda.adapter.ts, off.adapter.ts, targets.ts, units.ts
  domain/      pure fns — scaling, aggregation, coverage, portion math (unit-tested)
  features/    calendar/  components/  fridge/  log/  settings/
  ui/          Sheet, Stepper, PercentPicker, ColorPicker, NutrientTable, TabBar
  routes/      route definitions + app shell
functions/
  api/         Cloudflare Pages Function (USDA + OFF proxy)
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
`quickAddFavorites` · `foodCache` · `targets` · `settings`

---

## 4. Resolved UI consequences

**Full panel without a wall of numbers.** Storage is complete; display is layered.

- **Specific mode** — your _pinned_ nutrients as bars (default ~10, reorderable in Settings)
- **Day Detail** — full panel, collapsed by nutrient group, with a "show nutrients with no data"
  toggle hiding the sparse tail
- Nutrients with no target render as a bare value, never as 0% of nothing

**Color picker distinctness.** Twelve curated swatches in the primary row; "Custom" opens a full
picker. On save, if the chosen color sits within a perceptual-distance threshold of an existing
Component's color, show a non-blocking `similar to 🟥 Chicken Thighs` note. Full freedom kept,
calendar stays readable.

**Unit resolution.** `resolveToGrams(qty, unit, ingredient)` tries, in order:

1. Mass units → direct conversion
2. USDA `foodPortions.gramWeight` for "1 tbsp" / "1 each" → exact
3. Small builtin density table → approximate
4. Prompt once for the gram weight, cache it on the ingredient

Returns a confidence flag that feeds coverage.

---

## 5. Screens

Bottom tab bar, four tabs — **Calendar · Components · Fridge · Log** — plus a floating "+" on
Calendar and Fridge for quick logging.

| Screen                | Content                                                                                                                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Calendar**          | Week strip with `‹ ›` nav. _Overview_: one mark per meal log, colored by Component — fixed squares for discrete, size-scaled blobs for bulk. _Specific_: mini bars for pinned micronutrients. Tap a day → Day Detail. |
| **Day Detail**        | Every MealLog that day, full grouped nutrient table vs. target, coverage indicators, edit/delete individual entries.                                                                                                  |
| **Component Library** | Card list with color dot, category, yield. Tap → detail (ingredients, per-unit nutrition, Edit / Schedule / Delete).                                                                                                  |
| **Component Builder** | Name, color, category, portion style, unit, base yield, ingredient list with search + reorder, live nutrition summary.                                                                                                |
| **Fridge**            | Discrete: `4 of 6 servings left`. Bulk: progress bar + `62% left · ≈1.9kg`. Actions: Log, Adjust, Discard remaining.                                                                                                  |
| **Log Meal**          | _From Fridge_ tab — steppers for discrete, percent picker (of remaining) for bulk with live gram/kcal preview. _Quick Add_ tab — search, barcode scan, manual entry, favorites row.                                   |
| **Settings**          | Nutrient targets editor, pinned-nutrient management, JSON export/import.                                                                                                                                              |

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

### Phase 2 — Food lookup · needs USDA API key

Pages Function proxy, USDA + OFF adapters, `foodCache` table, debounced search UI with source
badges, manual-entry fallback for anything not found.

> **Done when:** searching "chicken thigh" returns real nutrition and the second search is
> instant from cache.

### Phase 3 — Component Builder & Library

Library list, builder form, ingredient search + `dnd-kit` reorder, discrete/bulk toggle, color
picker with distinctness check, live nutrition summary, detail view, delete guarded against
Components that already have cook history.

> **Done when:** Chicken Thighs, Rice and Guacamole exist with real numbers.

### Phase 4 — Calendar & scheduling

Week view with `‹ ›` nav, Overview/Specific toggle (Overview only for now), tap-to-schedule flow,
`Batch` creation with scale factor, planned-batch badges, past-due nudge.

> **Done when:** a week of cooking is scheduled and visible.

### Phase 5 — Cook → Fridge

"Mark cooked" sheet with actual-yield confirmation, `FridgeEntry` creation with nutrition
snapshot, fridge list (discrete counts vs. bulk progress bar), Adjust, Discard remaining.

> **Done when:** a cooked batch becomes fridge stock and can be corrected or discarded.

### Phase 6 — Logging

From-Fridge tab with steppers and percent picker, Quick Add with search + manual entry +
save-as-favorite, favorites row, barcode scan, transactional stock deduction, edit/delete a log
restoring stock.

> **Done when:** the loop closes — cook, eat, watch stock drop, correct a mistake.
>
> ⚠️ Barcode scanning is the one genuine unknown: the native `BarcodeDetector` API is absent on
> Safari, so iOS needs a `@zxing/browser` fallback. If it fights back, manual barcode entry ships
> and scanning follows.

### Phase 7 — Insight · needs 2500-cal plan numbers

Targets table + Settings editor, Specific mode bars, Day Detail full grouped panel with coverage
indicators, Recharts weekly trends, pinned-nutrient management.

> **Done when:** you can see how a real week measured up.

### Phase 8 — PWA polish

Icon set, `vite-plugin-pwa` with Workbox precache + runtime caching for proxy routes, offline
degradation to cached data, install prompt, iOS safe-area handling, backup reminder.

> **Done when:** it works on the subway.

---

## 7. Risk register

| Risk                                   | Mitigation                                                          |
| -------------------------------------- | ------------------------------------------------------------------- |
| Sparse micronutrient data misleads     | Coverage tracking from Phase 1                                      |
| IndexedDB wiped by browser cleanup     | JSON export in Phase 1, backup reminder in Phase 8                  |
| iOS barcode scanning unsupported       | ZXing fallback + manual barcode entry                               |
| USDA rate limits / key exposure        | Pages Function proxy + local `foodCache`                            |
| Volume→gram guessing skews nutrition   | Confidence flag surfaced in UI, one-time user override cached       |
| Recipe edits corrupting history        | Snapshot-on-write at Batch / FridgeEntry / MealLog                  |
| ~~OneDrive syncing `node_modules`~~    | Resolved — project moved to `C:\Users\dncan\Projects\meal-prep-app` |
| Source no longer backed up by OneDrive | Push to GitHub early (SETUP.md item 4)                              |

---

## 8. Inputs still needed

See **SETUP.md** for the full checklist.

1. **USDA FoodData Central API key** — blocks Phase 2
2. **Your 2500-cal plan targets** (calories, macros, any micro goals) — blocks Phase 7
3. **Cloudflare Pages project** — blocks Phase 0 deploy (local dev unaffected)
