# Meal Prep

A personal-use PWA for meal planning: build reusable Components, schedule batch-cooking on a
calendar, track servings as fridge stock, and log meals to see macro + micronutrient trends.

- **[PLAN.md](PLAN.md)** — architecture, data model, phased build plan
- **[SETUP.md](SETUP.md)** — accounts, keys and decisions needed from you
- **[CLAUDE.md](CLAUDE.md)** — build status + conventions, auto-loaded by Claude Code

> **Status:** Phase 0 scaffold is written but **unverified** — Node.js isn't installed yet, so
> nothing here has been built or run. Start with SETUP.md items 1b and 2.

## Running it

```powershell
npm install
npm run dev
```

Then open the printed `Network:` URL on your phone to test on a real device.

| Script | Does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the domain-logic test suite |
| `npm run lint` | ESLint |
| `npm run format` | Prettier, write in place |

## Stack

React 19 · TypeScript · Vite · Dexie (IndexedDB) · React Router · Cloudflare Pages
