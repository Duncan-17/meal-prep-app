# Your setup checklist

Things only you can do — accounts, keys, installs, and decisions. Grouped by when they block
work. Nothing in "Later" needs attention yet.

---

## ✅ Done — Phase 0 environment

### 1. ~~Decide where this project lives~~ ✅ Done

The project now lives at **`C:\Users\dncan\Projects\meal-prep-app`**, outside OneDrive, with a
`meal-prep-app` shortcut on the Desktop pointing at it.

Why it moved: once dependencies are installed, `node_modules` holds **tens of thousands of small
files**. OneDrive would try to sync every one, causing background churn, slow builds, and
`EPERM` errors when the sync client locks a file mid-build. Your Desktop is itself redirected
into OneDrive (`C:\Users\dncan\OneDrive\Desktop`), so there was no unsynced desktop to use — the
shortcut gives you the same one-click access without the sync cost.

**Your source is no longer backed up by OneDrive.** Pushing to GitHub (item 4) is now the backup,
so don't leave that too long.

> **One bit of cleanup left:** the old empty folder
> `C:\Users\dncan\OneDrive\Desktop\Meal Prep App` couldn't be deleted because VS Code still has
> it open. It's empty — all 98 files moved. Once you reopen VS Code on the new path (below), it
> can be deleted; drag it to the Recycle Bin or ask me and I'll remove it.

### 1b. ~~Reopen VS Code on the new folder~~ ✅ Done

VS Code is now open on `C:\Users\dncan\Projects\meal-prep-app`.

> **One bit of cleanup still available:** the old empty folder
> `C:\Users\dncan\OneDrive\Desktop\Meal Prep App` is confirmed empty but still present. Drag it
> to the Recycle Bin, or ask me and I'll remove it.

### 2. ~~Install Node.js 22 LTS~~ ✅ Done — Node 24 installed

Installed 2026-09-10 via `winget install OpenJS.NodeJS.LTS`:

```
node v24.19.0
npm  11.17.0
```

winget's LTS package now serves **Node 24**, not 22 — 24 is the current LTS line and 22 has
moved to maintenance. Vite 7 requires Node ≥20.19, so this is the better version anyway.

Verified working: `npm install` (216 packages, no conflicts), `npm run build` (typecheck + build
both clean), `npm run lint` (clean), `npm run dev` (serves on :5173). `npm test` exits 1 only
because no test files exist yet — Phase 1 adds them.

⚠️ If a terminal was already open before the install, it won't see `node` on its `PATH` until
VS Code restarts.

### 3. Set your git identity _(if you've never done this)_

```powershell
git config --global user.name "Duncan"
git config --global user.email "you@example.com"
```

Any email works — it's stamped on commits, nothing more.

---

## 🟠 Blocking the Phase 0 deploy — Cloudflare only

Local development works without these. They're only needed to put the app on a URL your phone
can reach and install from.

### 4. ~~GitHub repo~~ ✅ Done — published 2026-09-10

Live at <https://github.com/Duncan-17/meal-prep-app> (private). All 11 commits pushed via GitHub
Desktop; `origin/main` matches local. **Your source is backed up off this machine again.**

> **How pushing works from here.** I can commit, but I **cannot push** — GitHub Desktop keeps its
> credentials in its own store, so git in my terminal has none and any network git command hangs
> on a prompt it can never answer. When I say something is committed, hit **Push origin** in
> GitHub Desktop to send it up. Small, but worth the habit: uncommitted-and-unpushed work is the
> only work at risk.

### 5. Cloudflare account + Pages project

You mentioned the clan tracker is already on Cloudflare Pages, so the account likely exists.

1. Sign in at <https://dash.cloudflare.com>
2. **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
3. Pick the `meal-prep-app` repo
4. Build settings — Cloudflare usually auto-detects Vite; confirm they read:
   - Framework preset: **Vite**
   - Build command: `npm run build`
   - Build output directory: `dist`
5. Save and Deploy

Send me the resulting `*.pages.dev` URL.

### 6. A phone to test on

Once deployed, open the URL on your phone and install it:

- **iPhone** — Safari (must be Safari, not Chrome) → Share → **Add to Home Screen**
- **Android** — Chrome → menu → **Install app**

---

## 🟡 Blocking Phase 2 — food lookup

### 7. USDA FoodData Central API key

Free, instant, no payment details. Sign up at <https://fdc.nal.usda.gov/api-key-signup.html> —
the key arrives by email in seconds.

> **USDA's own warning:** _"It is the API Key holder's responsibility to ensure that their key is
> not made publicly available. Any API keys discovered online, such as those in a code
> repository, will be deactivated to prevent malicious use."_

That is precisely why this project proxies every lookup through a Cloudflare Worker (PLAN.md §2).
The key lives on Cloudflare's servers; the browser calls `/api/...` on your own domain and never
sees the key.

**Do not paste the key into chat, or into any file in this repo.**

- **Production** — Cloudflare dashboard → the `meal-prep-app` **Worker** → **Settings** →
  **Variables and Secrets** → add `USDA_API_KEY`, type **Secret**. Workers apply secrets
  immediately; no redeploy needed.
- **Local dev** — put it in `.dev.vars` in the project root. Already gitignored, and
  `.dev.vars.example` is committed as the template with an empty value.

#### ⛔ The one mistake that would leak it

**Never name the variable `VITE_USDA_API_KEY`, or prefix any secret with `VITE_`.**

Vite inlines every `VITE_`-prefixed variable into the client bundle **as plain text** at build
time. It would be published to every visitor and scraped within days — the proxy would be
pointless. The name stays `USDA_API_KEY`, read server-side by the Worker only, never via
`import.meta.env`.

#### If it does leak

Deleting the commit is **not** enough — git history, any clone, fork or CI cache still has it.
Generate a replacement at the signup page and update the Cloudflare secret. The old key is dead
either way; USDA deactivates keys it finds published.

### 8. Open Food Facts contact string — ⏸️ deferred by choice (2026-09-10)

OFF has no API key and no signup, but asks callers to identify themselves in the `User-Agent`
header so they can make contact if a script misbehaves. The convention is:

```
MealPrepApp/0.1 (your-contact@example.com)
```

**You chose to leave this blank for now** — this is a deliberate deferral, not an oversight, so
nobody needs to ask again unless you raise it.

What that costs: Phase 2 ships **USDA-only**. Open Food Facts is the barcode/packaged-food
source, so barcode lookups (Phase 6) wait until an address is nominated. USDA covers whole
ingredients, which is what Components are built from, so nothing else is affected.

When you want it, fill `OFF_USER_AGENT` in `.dev.vars` and tell me. Options worth knowing:

- `76717242+Duncan-17@users.noreply.github.com` — already public on every commit you have pushed,
  so it exposes nothing new, and GitHub forwards mail to you.
- Any throwaway or alias.
- Your Apple ID address — works, but it would be sent to OFF on every lookup.

---

## 🟢 Blocking Phase 7 — insight

### 9. Your 2500-cal plan targets

The one input with no sensible default. Send whatever you have — a screenshot, a paste, rough
numbers, anything:

- **Calories** — 2500, presumably
- **Macros** — protein / carbs / fat, in grams or percentages
- **Fiber**
- **Any micronutrients you're specifically targeting** and the numbers you're aiming for

Anything you do not specify falls back to standard adult RDA/DV values, clearly marked in the UI
as a default rather than your target. **These are already seeded** (`src/nutrition/targets.ts`,
every one flagged `isDefault: true`), so nothing is blocked — your real numbers just replace them.
Everything stays editable in Settings later, so an approximate answer now costs nothing.

### 10. Which nutrients to pin _(optional)_

Specific mode shows ~10 nutrients as bars; the rest live in Day Detail. Default pins:

> Calories · Protein · Carbs · Fat · Fiber · Vitamin D · B12 · Iron · Calcium · Magnesium

Change it now or reorder it later in Settings — either is easy.

---

## ⚪ Nice to have, any time

### 11. Two or three real recipes

Phase 3 goes faster with real data. Ingredients and rough quantities for a few things you
actually batch-cook — a discrete one (chicken thighs, rice) and a bulk one (chili) — so the
discrete/bulk split gets exercised against reality instead of test fixtures.

### 12. An app icon

Phase 8 needs one. A single **512×512 PNG** is enough — I generate every other size from it.
If you don't have one, I'll make a plain typographic placeholder.

---

## Quick status

| #   | Item                            | Blocks                        | Status                                      |
| --- | ------------------------------- | ----------------------------- | ------------------------------------------- |
| 1   | Moved out of OneDrive           | Phase 0                       | ✅                                          |
| 1b  | Reopen VS Code on new path      | Phase 0                       | ✅                                          |
| 2   | Node.js 24 LTS + deps installed | Phase 0                       | ✅                                          |
| 3   | Git identity                    | Phase 0                       | ✅ (already set)                            |
| 4   | GitHub repo                     | Deploy + **backup**           | ✅                                          |
| 5   | Cloudflare Worker deployed      | Deploy                        | ✅ (a Worker, not Pages)                    |
| 6   | Phone install test              | —                             | ⬜ open the Worker URL → Add to Home Screen |
| 7   | USDA API key                    | Phase 2                       | ✅ (in `.dev.vars`)                         |
| 8   | OFF contact string              | Phase 6 barcode only          | ⏸️ deferred by choice                       |
| 9   | Your real 2500-cal targets      | nothing — FDA defaults in use | ⬜ editable on the Plan screen              |
| 10  | Pinned nutrients                | —                             | ✅ editable on the Plan screen              |
| 11  | Real recipes                    | —                             | 🟡 in progress — you are building these now |
| 12  | App icon                        | —                             | ✅ generated (`scripts/make-icons.mjs`)     |
