# Meal Prep

A personal-use PWA for meal planning. Build reusable **recipes**, schedule batch-cooking on a
calendar, track what you cooked as **fridge** stock, and log what you eat against an editable
plan — with the full USDA nutrient panel behind it, not just calories.

> **Status: live and in use.** All eight build phases complete, **522 tests** passing, deployed to
> Cloudflare as a Worker and installable on a phone. Now being refined against real use.

- **[CLAUDE.md](CLAUDE.md)** — current status, conventions, and where to pick up. Start here.
- **[PLAN.md](PLAN.md)** — architecture, data model, the decisions and why
- **[SETUP.md](SETUP.md)** — accounts and keys, and the two things still waiting on the user

## What it does

1. **Recipes** — build something you cook a batch of from USDA-sourced ingredients, with live
   nutrition. Or define your own **foods** by hand for whatever the database has never heard of,
   then eat them, stock them, or use them in a recipe. Search results say whether a food is raw,
   cooked or dry, and whose it is.
2. **Calendar** — schedule a cook on a month grid. Cooking shows as a bar, eating as a dot. A
   Trends view shows each day's calories and macros instead, bordered green when every goal was met.
3. **Mark cooked** — confirm what actually went in and what it actually made; nutrition is
   recomputed from that rather than from the plan.
4. **Fridge** — stock, as counts or a percentage remaining. Things you simply bought go in too.
5. **Diary** — log from the fridge or quick-add. Calories as a bar, macros as rings, the full
   panel below — every bar split by the foods it came from.
6. **Plan** — every nutrient target, daily and weekly, seeded from FDA values and fully editable.
   Omega-3 and omega-6 are totalled from their individual fatty acids.

Two properties it holds onto throughout: **missing data is never zero** (every total carries a
coverage figure saying how much of it was actually measured), and **history is never rewritten**
(editing a recipe does not change what you already ate).

## Running it

```powershell
npm install
npm run dev:api   # terminal 1 — wrangler on :8788, serves the /api proxy
npm run dev       # terminal 2 — vite on :5173, open THIS one
```

Food search needs both; everything else works with just `npm run dev`.

| Script                        | Does                                             |
| ----------------------------- | ------------------------------------------------ |
| `npm run dev`                 | Vite dev server, host exposed for phone testing  |
| `npm run dev:api`             | Wrangler serving the Worker and its `/api` proxy |
| `npm run build`               | Typecheck + production build to `dist/`          |
| `npm test`                    | Vitest                                           |
| `npm run lint` / `format`     | ESLint / Prettier                                |
| `npm run deploy`              | Build and deploy to Cloudflare from this machine |
| `node scripts/screenshot.mjs` | Visual check at phone and desktop widths         |

## Stack

React 19 · TypeScript · Vite 7 · Dexie (IndexedDB) · React Router · Recharts · Workbox ·
Cloudflare Worker with static assets

**Next:** an **Experiment** tab — queue up proposed recipes and foods to see their combined
nutrition before cooking anything, and get suggestions for what the diet is missing. Planned in
[PLAN.md §10](PLAN.md); not built yet.

Each device keeps a full local copy and works offline; changes **sync through a Cloudflare D1
database** so the phone and laptop see the same data. There is no login yet. The JSON backup on the Plan screen is still the
copy you keep yourself.

Source: <https://github.com/Duncan-17/meal-prep-app> (private)
