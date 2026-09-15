# Meal Prep

A personal-use PWA for meal planning: build reusable Components, schedule batch-cooking on a
calendar, track servings as fridge stock, and log meals to see macro + micronutrient trends.

- **[PLAN.md](PLAN.md)** — architecture, data model, phased build plan
- **[SETUP.md](SETUP.md)** — accounts, keys and decisions needed from you
- **[CLAUDE.md](CLAUDE.md)** — build status + conventions, auto-loaded by Claude Code

> **Status:** Phases 0–4 are complete — **290 tests** passing, with typecheck, lint and production
> build all clean. Nutrition foundation, Dexie schema, live USDA food lookup, the Component
> Builder and the scheduling Calendar are all in. Phase 5 (Cook → Fridge) is next. Source is
> backed up at <https://github.com/Duncan-17/meal-prep-app> (private).

## Running it

```powershell
npm install
npm run dev
```

Then open the printed `Network:` URL on your phone to test on a real device.

| Script            | Does                                    |
| ----------------- | --------------------------------------- |
| `npm run dev`     | Dev server with hot reload              |
| `npm run build`   | Typecheck + production build to `dist/` |
| `npm run preview` | Serve the production build locally      |
| `npm test`        | Run the domain-logic test suite         |
| `npm run lint`    | ESLint                                  |
| `npm run format`  | Prettier, write in place                |

## Stack

React 19 · TypeScript · Vite · Dexie (IndexedDB) · React Router · Cloudflare Pages
