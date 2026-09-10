# Your setup checklist

Things only you can do — accounts, keys, installs, and decisions. Grouped by when they block
work. Nothing in "Later" needs attention yet.

---

## 🔴 Blocking now — Phase 0

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

### 1b. Reopen VS Code on the new folder

VS Code is still pointed at the old, now-empty location. **File → Open Folder →**
`C:\Users\dncan\Projects\meal-prep-app`, or just double-click the new Desktop shortcut.

### 2. Install Node.js 22 LTS

Not currently installed on this machine — nothing can be built or run until it is.

```powershell
winget install OpenJS.NodeJS.LTS
```

Or download the Windows installer from <https://nodejs.org> (pick **LTS**).

⚠️ **Close and reopen VS Code afterwards.** The installer edits your `PATH`, and already-running
terminals won't see it. Verify with:

```powershell
node --version   # expect v22.x
npm --version    # expect 10.x or 11.x
```

### 3. Set your git identity *(if you've never done this)*

```powershell
git config --global user.name "Duncan"
git config --global user.email "you@example.com"
```

Any email works — it's stamped on commits, nothing more.

---

## 🟠 Blocking the Phase 0 deploy

Local development works without these. They're only needed to put the app on a URL your phone
can reach and install from.

### 4. GitHub account + empty repo

Cloudflare Pages deploys by watching a git repository. Create an **empty private repo** named
`meal-prep-app` at <https://github.com/new> — no README, no `.gitignore`, no license (this
project already has its own). Then send me the URL and I'll wire it up.

> Alternative if you'd rather skip GitHub: Cloudflare's `wrangler` CLI can push builds directly
> from your machine. Slightly more friction per deploy, one less account. Say the word.

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

Free, instant, no payment details. Sign up at
<https://fdc.nal.usda.gov/api-key-signup.html> — the key arrives by email in seconds.

**Do not paste the key into chat or into a file in this repo.** It goes into Cloudflare as an
encrypted secret so it never touches the client bundle or git:

> Cloudflare dashboard → your Pages project → **Settings** → **Variables and Secrets** →
> add `USDA_API_KEY`, type **Secret**, then redeploy.

For local development it goes in `.dev.vars` in the project root, which is already gitignored.
I'll create that file with a placeholder — you just fill in the value.

### 8. Open Food Facts contact string

OFF has no API key and no signup, but it asks callers to identify themselves in the
`User-Agent` header so they can contact you if a script misbehaves. The convention is:

```
MealPrepApp/0.1 (your-contact@example.com)
```

**Decision needed:** which contact address do you want used? It gets sent to Open Food Facts on
every lookup, so pick one you're comfortable exposing — a throwaway or alias is completely fine.
I won't use your Apple ID address unless you tell me to.

---

## 🟢 Blocking Phase 7 — insight

### 9. Your 2500-cal plan targets

The one input with no sensible default. Send whatever you have — a screenshot, a paste, rough
numbers, anything:

- **Calories** — 2500, presumably
- **Macros** — protein / carbs / fat, in grams or percentages
- **Fiber**
- **Any micronutrients you're specifically targeting** and the numbers you're aiming for

Anything you don't specify falls back to standard adult RDA/DV values, clearly marked in the UI
as a default rather than your target. Everything stays editable in Settings later, so an
approximate answer now costs nothing.

### 10. Which nutrients to pin *(optional)*

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

| # | Item | Blocks | Status |
|---|---|---|---|
| 1 | Moved out of OneDrive | Phase 0 | ✅ |
| 1b | Reopen VS Code on new path | Phase 0 | ⬜ |
| 2 | Node.js 22 LTS | Phase 0 | ⬜ |
| 3 | Git identity | Phase 0 | ✅ (already set) |
| 4 | GitHub repo | Deploy | ⬜ |
| 5 | Cloudflare Pages project | Deploy | ⬜ |
| 6 | Phone install test | Deploy | ⬜ |
| 7 | USDA API key | Phase 2 | ⬜ |
| 8 | OFF contact string | Phase 2 | ⬜ |
| 9 | 2500-cal targets | Phase 7 | ⬜ |
| 10 | Pinned nutrients | Phase 7 | ⬜ (defaults fine) |
| 11 | Real recipes | — | ⬜ (optional) |
| 12 | App icon | Phase 8 | ⬜ (optional) |
