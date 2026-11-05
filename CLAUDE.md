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

`tsc -b` clean across three projects, ESLint clean, **594 tests** across 30 files.

Live on Cloudflare as a **Worker with static assets** (not Pages — see Deploying below), built
from `main` on every push.

### Shipped since the phases finished

Roughly in order, all in response to using the thing:

- **Editable Plan** — weight goal with a rate and a 7-day smoothed current weight, every nutrient
  target daily and weekly, FDA template, direction-aware goals (sodium is a limit, protein a
  floor).
- **Month calendar** — paged by month. Cooking is a bar across the top of a day (solid = still to
  cook, hollow = cooked); eating is a dot per logged item below it. The dots fixed a real bug:
  the first build drew marks per scheduled _batch_, so eating left no trace at all, despite
  PLAN.md §5 always having specified "one mark per meal log".
- **Direct fridge items** — a gallon of milk or six avocados, no recipe and no cook behind them.
- **Portion-aware defaults** — picking a food defaults to its own portion ("1 item = 291 g" for a
  burger) rather than 100 g.
- **Macro rings on the Diary** — calories as a wide bar, carbs/fat/protein as rings that fill.
- **Amount of each** — its own section in the recipe builder, separate from picking ingredients.
- **A real cook sheet** — "Mark cooked" lists the ingredients, lets each amount be adjusted, and
  recomputes nutrition from what actually went in.
- **Foods library** — a second half of the Recipes tab for foods you type in yourself, with a
  "+ Fridge" action for "I bought eight of them".
- **Renamed in the UI** — Components → Recipes, Log → Diary.
- **Zoom locked**, tap delay removed, mobile calendar overlap fixed.
- **Saved foods everywhere** — every food picker (Quick Add, recipe builder, Add to fridge) has a
  **USDA database / My foods** toggle, and each food in the Foods library has an **Eat** button.
  Before this a custom food could only be stocked, never eaten or put in a recipe.
- **Omega-3 and omega-6 totals** — in Day Detail, the weekly bars, Trends' table and the Plan,
  pinned and given default goals by a v4 Dexie upgrade.
- **Search you can choose from** — results re-ranked (plain food first), capped at 15, and labelled:
  headline + details, a raw / cooked / dry chip, brand and USDA category.
- **Bars split by source** — every meter built from more than one food (Diary calorie bar, macro
  rings, nutrient meters, the week's bars) is drawn in segments, one per food, in that food's
  colour, proportional to what it contributed. The Diary puts a matching dot before each food.
- **Calendar Meals / Trends toggle** — Trends shows each day's calories, three columns filling
  toward the carb/fat/protein goals, and a border: green = calories and all three macros met,
  orange = calories only. Today is a filled marker on the date; the selected day a dark outline.
- **Tutorial text removed** — the leftover Phase 6 box on Fridge, the descriptions under the
  Fridge / Recipes / Foods headings, the cook sheet's hint; empty states cut to one line. The
  Diary's add button is now **+ Log food** in the header, beside Plan.
- **+ Log food on the calendar's day panel** — opens Quick Add in place and logs to the SELECTED
  day. It replaced an "Add something" link to the Diary, which could only ever log to today.
- **Sync (2026-10-08)** — every device keeps its local copy and swaps changes with a Cloudflare D1
  database; later edit wins; the phone's and laptop's existing data merge. Status and "Sync now"
  on the Plan screen. D1 binding added 2026-10-08; live, and confirmed by the user on both devices.
- **Accounts (2026-11-04)** — username + password sign-in, open sign-up, every API route but
  health behind a session, sync isolated per user, an Account section on the Plan screen, and an
  admin script for resets. PLAN.md §11 step 1. Hardening and encryption (steps 2–3) not built.
- **Hardening (2026-11-05)**: CSP and security headers, body caps, sync validation and a
  per-account quota, a USDA rate limit, CI + CodeQL + Dependabot, THREAT_MODEL.md and SECURITY.md.
  PLAN.md §11 step 2.
- **Experiment tab — scratchpads (2026-10-08)** — a fifth tab of saved scratchpads: queue USDA
  foods, your own Foods and recipes (whole batches), set amounts, pick a period, and see either
  the **Average day** or **Day by day** — food dragged from a "Not placed" tray onto a dateless run
  of days. Suggestions (the other half of the tab) are not built: none of their questions are
  answered yet.

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
- **A custom food is just an `Ingredient` with `source: 'manual'`.** No new table — the specific
  yoghurt drink is a food like any other, it simply has no FDC id. That is what lets it work in a
  recipe, in the fridge and in Quick Add without special cases. Entered PER SERVING because that
  is how a label reads, stored per 100 g because that is what everything downstream expects;
  `customfoods.test.ts` pins the conversion both ways.
- **The cook sheet records what ACTUALLY went in.** `markCooked` takes an optional actual
  nutrition aggregate; the Batch keeps its scheduled snapshot (that is what you _planned_, and the
  calendar still shows it) while the FridgeEntry carries what you really cooked. Do not "simplify"
  by writing actuals back onto the batch.
- **Macro ring colours are the first three VALIDATED palette slots**, not a free choice. Three
  rings side by side is an all-pairs situation. MyFitnessPal draws fat purple; this draws it blue
  because an unvalidated purple is a guess. Every ring is labelled, so hue is never the only
  signal.
- **UI names and code names differ on purpose.** The tabs read **Recipes** and **Diary**; the
  code says `Component` and `log` everywhere, and must keep doing so. Every stored snapshot —
  batches, fridge entries, meal logs — carries `componentId` / `componentName`, so renaming the
  model means a migration that rewrites history for no user-visible gain. Routes stay `/components`
  and `/log` for the same reason. Change labels freely; leave identifiers alone.
- **Sync replaced local-only (user's decision, 2026-10-07).** Design in PLAN.md §10 "Sync". The
  parts a future session must not "simplify":
  - **Ids come from a Dexie `creating` hook** in `schema.ts` (`creation-ms × 1000 + random`), so
    two devices never mint the same id. Do not go back to IndexedDB's own counter, and do not
    add an `add` path that bypasses Dexie. Anything below `LEGACY_ID_LIMIT` (2³²) is renumbered
    before upload by `rekeyLegacyIds`, which follows SIX reference fields — add a seventh
    reference anywhere and it must be added there, or merged data points at the wrong rows.
  - **Changes are found by DIFFING fingerprints, not by hooking writes.** There are dozens of
    write paths; a diff cannot miss one.
  - **Ties lose.** The server keeps a write only if strictly newer, and a device's first upload
    stamps rows with their own timestamp (0 if none). That is what stops a fresh device's default
    goals overwriting real ones. Do not "fix" it to `>=`.
  - **Since 2026-11-04 sync is per user** (PLAN.md §11). See "Accounts" below.
  - The sync bookkeeping tables (`syncShadow`, `syncOutbox`, `syncMeta`) are per-device and are
    deliberately NOT in `TABLE_NAMES`: never backed up, never synced.
  - **Every sync reply is `Cache-Control: no-store`, and the client fetches with
    `cache: 'no-store'`.** First live run (2026-10-08): the laptop uploaded fine, but the phone
    said "Synced" while having none of it — though opening `/api/sync?since=0` directly in the
    phone's browser showed the data. A pull URL repeats exactly (`?since=40` every 30 s until
    something new arrives), so a browser that kept the first empty reply never sees anything
    again. Do not remove either half.
  - **Plan → Sync → "Sync details"** shows this device's address, local counts, download cursor and
    the database's own count (`/api/sync?stats=1`). "Re-download everything" resets the cursor to
    0 — safe, since a download never overwrites a newer local edit. Ask the user to read it out
    before guessing at a sync problem.
- **Accounts (2026-11-04, PLAN.md §11) — do not "simplify" any of these:**
  - **The server never sees a password.** `src/auth/derive.ts` runs Argon2id in the browser and
    sends a 32-byte proof; the server stores its SHA-256. A fast hash is right THERE because the
    input is already a key, and Argon2id on the Worker would blow its CPU budget. Password rules
    (8 characters, the user's choice) can therefore only live in the browser.
  - **`ARGON2_PARAMS` and the salt domain are frozen.** Changing either changes every proof and
    locks every account out. `derive.test.ts` pins a real proof to catch it.
  - **`derive.ts` must stay free of `@/` imports**: `scripts/admin.mjs` imports it under Node so
    an admin reset produces exactly the browser's proof.
  - **The user is part of the sync KEY, not just a filter.** `user_records` is keyed
    (user_id, tbl, id). Keying on (tbl, id) and filtering would let one user overwrite another's
    row by reusing its id. The rev counter stays global; it only has to go up.
  - **Rows with user_id `''` are pre-accounts data**, readable by nobody until
    `node scripts/admin.mjs --remote claim-legacy <username>` assigns them. "Keep it" does NOT
    replace that step: a device uploads only rows changed since its last sync, so rows it had
    already synced reach the account only through `claim-legacy` (13 did, 2026-11-04). Admin SQL
    goes through `wrangler d1 execute --command`, never `--file`: remote `--file` is a bulk
    import that prints progress before its JSON and returns no rows.
  - **Sessions are server-side rows holding only the token's hash.** That is what makes sign-out,
    "sign out other devices" and an admin reset actually end sessions.
  - **Unknown username and wrong password give the same error**, and an unknown username still
    does a hash comparison. Sign-up must reveal a taken name; its per-IP limit slows that.
  - **Every POST needs a same-origin `Origin`.** No Origin → 403, on purpose.
  - **Signing out erases the device** (`eraseThisDevice`); `syncMeta.owner` says whose data a
    device holds. `redownloadEverything` spreads the old meta so `owner` survives — keep it so.
  - **Admin is command-line only, by the user's decision.** Never add an admin route or screen.
- **Hardening (2026-11-05, PLAN.md §11 step 2) — do not loosen without a reason:**
  - **The CSP lives in `public/_headers`**, because pages never pass through the Worker. Its
    one relaxation is `'wasm-unsafe-eval'` for Argon2id. Never add `'unsafe-inline'` or
    `'unsafe-eval'`; a new host goes into `connect-src` by name. After any change, walk the app
    in a browser with a `securitypolicyviolation` listener (the check is described in PLAN.md).
  - **`parsePush` refuses timestamps more than a day ahead** of the server clock. Without that,
    a record stamped in the year 9999 wins every later edit forever, given "later edit wins".
  - **Ids must match `[A-Za-z0-9_.:-]{1,64}`.** Every real id fits: numeric ids, all 81
    nutrient keys, dates, and `settings` / `plan`. A new table with a different id shape must
    widen it, or its pushes fail.
  - **Bodies are read through `readJson`, never `request.json()`.** It counts the stream, so
    a chunked body with no declared length cannot get past the cap.
  - **THREAT_MODEL.md must change with the code.** A control it claims and the code lacks is
    worse than no document.
  - **CodeQL only runs usefully on a public repo** (code scanning is free only there). Its
    `visibility` job asks the API and skips the analysis while private; the 2026-11-05 runs
    failed (and emailed the user) before that guard existed.
  - **npm 11 blocks install scripts by default** (esbuild, workerd). Both still work without
    them, verified 2026-11-05. If a build ever fails on a missing binary, that is the first
    suspect.
  - **Sign-ups are capped at 5 per IP per hour**, so `scripts/screenshot.mjs` clears that counter
    in the LOCAL database before each run. It must never touch `--remote`.
- **History is snapshotted, never back-filled.** Meal logs written before item colours existed
  render a neutral dot on purpose; rewriting them would be rewriting history.
- **Omega totals are DERIVED at read time, never stored.** `derivedFrom` in the registry,
  `withDerivedSums` in `domain/nutrients.ts`, applied by `withDerivedTotals` in `dayTotals`,
  `weekSeries`/`weekTotals` and the recipe summary. That is how they reach meals logged before they
  existed without rewriting a snapshot. A total is present if ANY part is; coverage is the best
  part's (a lower bound). Never let a derived key into a stored map or the custom-food form — a
  stored total would be summed alongside recomputed ones and undercount.
- **FDC splits fatty acids to different depths per dataset.** SR Legacy/Foundation report ALA as
  851 and linoleic as 675; FNDDS only the undifferentiated 619 and 618. Hence `usdaFallbacks`: the
  primary number always wins, the fallback fills in when it is absent.
- **FDC's search ranking is bad for short queries, measured 2026-10-06.** "egg" led with a Snickers
  egg; "rice" had no plain rice in the top 25 (seven Branded "RICE" first). The client asks for 50
  and `rankFoods` (`domain/foodSearch.ts`) re-orders and caps at 15. The user asked for the cap —
  "no scenario where I need 400+ egg options". Do not raise it; a better query beats a longer list.
- **"Raw" on a grain means DRY.** `describeFood` labels raw rice/pasta/lentils "Dry · uncooked",
  and for Branded staples with no stated state infers it from kcal/100 g (≥300 dry, ≤200 cooked),
  shown with a dashed "Likely" chip so it never reads as stated.
- **The Worker slims search responses** to the fields the adapter reads (347 kB → 82 kB for 25
  results). Nutrients keep number/unit/value so a registry fix can still re-map them.
- **Bar segments come from item snapshots, not a lookup.** `contributionsFor`
  (`domain/contributions.ts`) reads `MealLog.items[].nutrients`; the same food eaten twice is ONE
  segment. Quick Add items now snapshot a colour from `swatchForName` (stable per name, from the
  validated swatches) — without it every Quick Add slice was the same grey. Items logged before
  colours existed stay neutral (`--segment-neutral`): history is not back-filled.
- **With segments, status moves out of the fill.** A segmented meter cannot also be green/orange,
  so "goal met" / "over" lives in the word under it and the overshoot marker at its end. Do not
  reintroduce a status-coloured fill on top.
- **"Met" on the calendar border is `progressFor`'s** (`dayGoalState` in `domain/plan.ts`):
  calories and carbs/fat within ±10%, protein at or above. A day 28% over calories is NOT met. An
  unlogged day gets no border at all — a gap, not a failure.
- **Scratchpad rules, all the user's (2026-10-08) — do not "improve" them without asking:**
  - **One drag places ONE portion**; −/+ on a day adjusts. Portions not placed wait in the tray
    and count toward NO day. The Average view counts everything, placed or not.
  - **Foods are snapshotted, recipes are live by reference.** A food is a fact about a product; a
    recipe is what you would cook next, so editing it should update the plan. A deleted recipe
    shows "recipe deleted" and contributes nothing.
  - A scratchpad is **saved whole on every change** (one row, items inside). Sync carries it as one
    record. The screen holds the latest edit locally until the database echoes it, so drops do
    not flicker back.
  - `scratchpads.items[].componentId` is the **seventh** id reference `rekeyLegacyIds` follows.
  - Touch drags need a 120 ms press (so scrolling still works); chips use
    `touch-action: manipulation`, NOT `none`, for the same reason. The user found dragging
    finicky at 180 ms with small chips — tray chips are now 40 px tall. Do not shrink them.
  - Item rows are collapsed to one line by default (user's request); controls one tap down,
    nutrient table one more. The whole day card selects a day.
  - **Colours:** recipes draw in their CURRENT Recipes-tab colour; a food never shares a colour
    with another item in the same scratchpad (`distinctColors`). A real clash prompted this — a
    recipe and a yoghurt drink both came out orchid from `swatchForName`.
- **No link-style buttons anywhere** (user, 2026-10-08). `.linkbtn` is now drawn as a secondary
  button, and `<summary>` toggles likewise; never style an action as underlined accent text.
- **Chart points are filled in their series colour.** Recharts fills dots white by default, which
  left the Trends and Weight charts blank until hovered. The Trends chart sits directly under the
  "This week" blurb, above the weekly bars.
- **The search cache is versioned** (`SEARCH_CACHE_VERSION` in `db/foods.ts`). Bump it whenever a
  search starts returning something old cached entries lack, or the old page replays for a week.

## Where to pick up

**Sync is live and confirmed working (2026-10-08).** The user tested adding and removing things on
one device and saw them on the other, including after closing and reopening. The D1 database is
`meal-prep` (id `8f47bc0b-…`), bound as `DB` in `wrangler.toml`. The live address is
`https://meal-prep-app.dncanzano.workers.dev` — `/api/sync?stats=1` there is a read-only check of
what the database holds.

**Experiment tab: scratchpads BUILT (2026-10-08), suggestions NOT.** The user's answers are in
PLAN.md §10 "Decided". What is still open, and must be asked rather than decided:

- **Suggestions** — every question in §10 is unanswered (data source, what counts as missing,
  ranking, exclusions, where they appear).
- **Shopping list** — "later", with sub-items (a recipe line expands into its ingredients).
- **Reuse / compare** scratchpads, and any link to the real Calendar — explicitly "not now".

The user's standing instruction for new features: make no design decision they did not specify.

**Closed: "everything gets wiped every time an update is pushed"** (reported 2026-10-07). Never
pinned to a cause — no production code deletes data, so it was most likely a change of address
(each address has its own browser storage). Superseded by sync: data now lives in D1 too, so a
device that starts empty downloads everything. Reopen only if it recurs with sync on.

**Open questions the user has not answered:**

| Question                | Why it is open                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Real 2500-cal targets   | The Plan screen works but is seeded with FDA defaults, each labelled "FDA default". Only the user can supply the real numbers. Nothing is blocked meanwhile.                                                                                                                                                                                           |
| Open Food Facts contact | Deliberately deferred 2026-09-10. Gates barcode scanning only. **Do not re-ask.**                                                                                                                                                                                                                                                                      |
| Phone install           | The Worker URL works; the user had not yet added it to a home screen.                                                                                                                                                                                                                                                                                  |
| Experiment: suggestions | Every question in PLAN.md §10 still unanswered. Scratchpads are built; suggestions wait for answers.                                                                                                                                                                                                                                                   |
| Going public + security | PLAN.md §11. **Step 1 (accounts) live 2026-11-04**, confirmed by the user on phone and laptop. `claim-legacy duncan` run the same night; no ownerless rows remain. Step 2 (hardening) built 2026-11-05. Step 3 (E2EE with a recovery code) not started. Accounts are live, so the repo can go public whenever the user chooses. Demo account deferred. |

**Things that would plausibly annoy the user next**, in the order I would expect:

1. **Search ranking is a heuristic.** Plain "rice" still surfaces fried rice above plain cooked
   rice, because FDC never returned SR Legacy's "Rice, white, long-grain, cooked" in the top 50.
   Typing "white rice cooked" works. If the user complains, the next step is a second query or
   stronger data-type weighting, not a bigger page.
2. **The Plan screen is an enormous scroll on mobile** — every nutrient gets its own slider. It
   wants the same collapse-by-group treatment the Day Detail panel has. Flagged to the user
   2026-10-06; they have not asked for it yet.
3. **Barcode scanning** is still absent (PLAN.md §6). Needs the OFF contact string AND a ZXing
   fallback, since Safari has no `BarcodeDetector`.
4. **The bundle is ~570 kB** before the lazy chart chunk. Fine over a fast connection, not
   obviously fine on a phone.

**Do not start any of these without asking.** The user drives what gets built; every good change
so far came from them using it and saying what was wrong.

---

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
- **Stopping local servers on Windows needs the whole process tree.** Killing whatever holds
  port 8788 is not enough: wrangler's parent `node` process restarts `workerd` at once, and
  neither `taskkill` from Git Bash nor the agent's task-stop reliably reaches the tree. On
  2026-10-08 seven stale `wrangler dev` copies had piled up on :8788 and hung every request. What
  works, in PowerShell:
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -like '*meal-prep-app*wrangler*dev*' -or $_.CommandLine -like '*meal-prep-app*vite*' } | % { Stop-Process -Id $_.ProcessId -Force }`
  then `Get-Process workerd | Stop-Process -Force`. Check with
  `Get-NetTCPConnection -State Listen -LocalPort 8788,5173`.
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
- **Sync's D1 database is bound as `DB`** in `wrangler.toml` — database `meal-prep`, id
  `8f47bc0b-07cd-4eb0-ac0d-cbb727cf4666` (not a secret). The binding must live in `wrangler.toml`, not only in the dashboard: `wrangler
deploy` replaces the Worker's bindings with the file's on every push.
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
npm run dev:api                  # also needed: the script signs up through the real form
node scripts/screenshot.mjs      # all routes, 390px and 1280px
node scripts/screenshot.mjs /calendar
```

From the Bash tool (Git Bash), prefix route arguments with `MSYS_NO_PATHCONV=1` — otherwise
`/calendar` is rewritten to `C:/Program Files/Git/calendar` and the script fails silently under a
`grep`.

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

| Script                                 | Does                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `npm run dev`                          | Vite dev server, host exposed for phone testing                                                   |
| `npm run dev:api`                      | Wrangler on :8788 serving `worker/` + `dist/`. Vite proxies `/api` to it. Needed for food search. |
| `npm run serve:full`                   | Build, then serve app + functions together on :8788 (no hot reload)                               |
| `npm run build`                        | Typecheck + production build to `dist/`                                                           |
| `npm run preview`                      | Serve the production build                                                                        |
| `npm test`                             | Vitest, `src/**/*.test.ts`                                                                        |
| `npm run lint`                         | ESLint                                                                                            |
| `npm run format`                       | Prettier, write in place                                                                          |
| `node scripts/admin.mjs --remote list` | Accounts admin: list, reset-password, sign-out, disable, enable, claim-legacy. `--local` for dev  |

---

## Layout

```
src/
  auth/        Sign-in: derive (Argon2id → login proof), session state, AuthGate,
               LoginScreen. Nothing in the app renders until signed in.
  db/          Dexie schema + every write path. schema, batches, fridge, logs,
               components, ingredients (incl. custom foods), plan, favorites,
               insight, backup, init, seed.dev, sync (the sync engine), scratchpads
  domain/      PURE — no Dexie, no React, all tested. nutrients, coverage,
               portions, components, dates, plan, color, backup, foodSearch,
               contributions, sync, scratchpad, types
  nutrition/   registry (81 nutrients, 2 derived), usda.adapter, units, targets,
               scratchpad (what an item contains; how it splits)
  features/
    calendar/  month grid, day panel, schedule + mark-cooked sheets
    components/ recipe library (two tabs), builder, detail, amounts, ingredient rows
    foods/     USDA search + the user's own Foods library and form
    fridge/    stock list, adjust, add-direct
    log/       the Diary: today summary (rings), day detail, log sheets
    settings/  the Plan screen — targets, weight, pinned nutrients, sync, backup
    insight/   Recharts trends + weight chart (lazy-loaded)
    experiment/ the Experiment tab: scratchpad list, scratchpad screen, add sheet,
               day planner (dnd-kit drag and drop)
  ui/          TabBar, Sheet, Stepper, PercentPicker, ColorPicker, MacroRing,
               TargetBar, InstallPrompt, vizPalette
  routes/      router + AppShell
worker/
  index.ts     The Cloudflare Worker: /api/auth, the session gate, /api/usda,
               /api/sync, plus the ASSETS binding that serves dist/. Holds the API key.
               Security headers on every API reply; size-capped body reads.
  authLogic.ts Accounts, sessions, rate limits — storage-agnostic and tested.
  syncLogic.ts The server's sync rules, per user, storage-agnostic and tested.
  d1Stores.ts  The D1 versions of both stores, and the self-creating schema.
scripts/
  screenshot.mjs   visual checks at both viewports (see above)
  admin.mjs        account admin through wrangler — the only admin interface
  seed-browser.mjs browser-side seed shared by visual scripts
  make-icons.mjs   regenerates the PWA icon set from one inline SVG
```

`src/ui/PhasePlaceholder.tsx` was deleted 2026-10-06 — Fridge was still rendering a Phase 6 box
from it long after Phase 6 shipped.
