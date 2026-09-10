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

## 🟠 Blocking the Phase 0 deploy

Local development works without these. They're only needed to put the app on a URL your phone
can reach and install from.

### 4. GitHub repo — **one interactive step left, then I finish it**

⚠️ Since the project left OneDrive, **nothing is backing up your source**. This is the top item.

Already done for you:

- GitHub CLI installed (`gh` 2.100.0).
- Everything committed to `main`; working tree clean and ready to push.
- Your git identity already points at GitHub user `Duncan-17`, so the account exists.

**Your one step.** Run this in the VS Code terminal — it opens a browser to authorise, which I
can't do for you from a non-interactive shell:

```powershell
gh auth login
```

Answer: **GitHub.com** → **HTTPS** → **Yes** (authenticate Git with your GitHub credentials) →
**Login with a web browser**. Copy the one-time code it shows, press Enter, paste it in the
browser, approve.

**Then tell me** and I'll run the rest — it creates the private repo, wires up `origin`, and
pushes in a single command:

```powershell
gh repo create meal-prep-app --private --source=. --remote=origin --push
```

**Manual alternative** if you'd rather not use the CLI. Create an **empty private repo** named
`meal-prep-app` at <https://github.com/new> — no README, no `.gitignore`, no license (this
project has its own). Send me the URL and I'll wire up the remote and push.

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

| #   | Item                            | Blocks              | Status                                     |
| --- | ------------------------------- | ------------------- | ------------------------------------------ |
| 1   | Moved out of OneDrive           | Phase 0             | ✅                                         |
| 1b  | Reopen VS Code on new path      | Phase 0             | ✅                                         |
| 2   | Node.js 24 LTS + deps installed | Phase 0             | ✅                                         |
| 3   | Git identity                    | Phase 0             | ✅ (already set)                           |
| 4   | GitHub repo                     | Deploy + **backup** | 🟡 ← **run `gh auth login`, then tell me** |
| 5   | Cloudflare Pages project        | Deploy              | ⬜                                         |
| 6   | Phone install test              | Deploy              | ⬜                                         |
| 7   | USDA API key                    | Phase 2             | ⬜ ← **next blocker**                      |
| 8   | OFF contact string              | Phase 2             | ⬜                                         |
| 9   | 2500-cal targets                | Phase 7             | ⬜ (FDA defaults seeded meanwhile)         |
| 10  | Pinned nutrients                | Phase 7             | ⬜ (defaults fine)                         |
| 11  | Real recipes                    | —                   | ⬜ (optional)                              |
| 12  | App icon                        | Phase 8             | ⬜ (optional)                              |
