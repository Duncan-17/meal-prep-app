# Your setup checklist

Things only you can do — accounts, keys, installs, and decisions. Grouped by when they block
work. Nothing in "Later" needs attention yet.

---

## Nothing is blocking

Every account, key and install this project needed is done, and the app is **live and in use**.
What follows is a record of how it was set up, plus the two things still genuinely waiting on you.

---

## 🟡 Still waiting on you (neither blocks anything)

### Your real 2500-calorie targets

The one input nobody else can supply. The Plan screen works today, seeded with **FDA Daily
Values** — each labelled "FDA default" in the UI, so a number you never chose never looks like
one you did.

Send whatever you have — a screenshot, a paste, rough numbers:

- **Calories** — 2500, presumably
- **Macros** — protein / carbs / fat, in grams or percentages
- **Fibre**, and any micronutrients you are specifically targeting

Or edit them directly: **Diary → Plan**. Every target has a number field and a slider, a daily
and a weekly figure, and a goal type (at least / about / at most). Editing one clears its
"FDA default" badge.

### Design answers for the Experiment tab

The next feature is planned but deliberately not started. Your answers so far are recorded in
**PLAN.md §10**. Still open: a few scratchpad details, everything about suggestions, and whether —
and how — data should be saved somewhere other than this browser. Nothing gets built until you
have answered them.

### Sync: create the database and send its id

Steps are under **Switching on sync** below.

### Which address you open after an update

Your data lives in the browser, tied to the exact web address. If the app looks empty after an
update, the likeliest reason is a _different_ address — a one-off preview link from GitHub or
Cloudflare, rather than your usual bookmark. Tell me which link you open, and on which device, and
it can be pinned down.

### Omega-3 and omega-6 goals

Both were added with starting goals — **1.6 g omega-3** and **about 17 g omega-6**, the IOM
adequate intakes for adult men (there is no FDA Daily Value for either). They carry the same
"FDA default" badge as every untouched goal. Change them on the Plan screen if you have numbers
of your own.

### An Open Food Facts contact address — ⏸️ deferred by choice (2026-09-10)

OFF has no key and no signup, but asks callers to identify themselves in a `User-Agent` header.
You chose to leave this blank; that is recorded as a decision, not an oversight.

What it costs: **barcode scanning only**. OFF is the packaged-food source, while USDA covers the
whole ingredients recipes are built from. Everything else works without it.

If you ever want it, put a contact string in `OFF_USER_AGENT` in `.dev.vars` and as a Worker
secret. Your GitHub noreply address (`76717242+Duncan-17@users.noreply.github.com`) is already
public on every commit, so it would expose nothing new.

---

## ✅ Done — the record

| #   | Item             | How it ended up                                                                     |
| --- | ---------------- | ----------------------------------------------------------------------------------- |
| 1   | Project location | Outside OneDrive, deliberately — `node_modules` sync was unusable                   |
| 2   | Node             | 24 LTS via winget. `.node-version` pins 22 for the Cloudflare build                 |
| 3   | Git identity     | Already set — GitHub user `Duncan-17`                                               |
| 4   | GitHub repo      | <https://github.com/Duncan-17/meal-prep-app>, private. Pushed from GitHub Desktop   |
| 5   | Cloudflare       | A **Worker** named `meal-prep-app`, not a Pages project — see CLAUDE.md § Deploying |
| 6   | USDA API key     | In `.dev.vars` locally and as a Worker Secret. **Never read that file**             |
| 7   | App icon         | Generated — `node scripts/make-icons.mjs`                                           |
| 8   | Pinned nutrients | Editable on the Plan screen                                                         |

### The one thing left to try

**Install it on your phone.** Open the Worker URL in Safari (iPhone) → Share → **Add to Home
Screen**, or Chrome (Android) → menu → **Install app**. It then runs full screen and works
offline.

---

## ⛔ If the USDA key ever leaks

Deleting the commit is **not** enough — git history, clones and CI caches keep it. Generate a
replacement at <https://fdc.nal.usda.gov/api-key-signup.html>, then update `.dev.vars` and the
Worker secret. USDA deactivates keys it finds published, so assume a leaked one is already dead.

**Never prefix a secret with `VITE_`.** Vite inlines those into the client bundle as plain text.

---

## Switching on sync — your steps, in this order

Sync is built. It goes live once the Cloudflare database exists and the app knows its id.

1. **Export a backup on each device first** — phone and laptop: **Diary → Plan → Export a
   backup**. The first time each device opens the new version, it renumbers its records so the
   two devices' data can merge. That is tested, but a backup costs nothing.
2. **Push** the current commits from GitHub Desktop. Safe on its own: with no database connected
   the app behaves exactly as before, and the Plan screen says "Sync is not set up yet".
3. **Create the database** in the Cloudflare dashboard: **Storage & Databases → D1 SQL Database →
   Create**. Any name (e.g. `meal-prep`); leave the location on automatic.
4. **Send me the Database ID** shown on its page. It is not a secret. I add it to the project and
   commit; you push again.
5. **Open the app on the laptop, then the phone.** Each uploads its data and downloads the other's.
   Anything you had entered on both will appear twice — delete the spare copies.

After that, edits on one device show up on the other within about 30 seconds while both are open.
**Plan → Sync** shows the state, with a **Sync now** button.

⚠️ **Restore from a file now replaces data everywhere.** Once it syncs, the other devices follow.

⚠️ **No password yet**, by your choice: anyone who found the exact address could read or change
the data. Fine while it is just you; worth fixing before sharing the address.

---

## Quick status

Everything that ever blocked work is done. Three rows remain, none of them blocking.

| Item                       | Status                                               |
| -------------------------- | ---------------------------------------------------- |
| Your real 2500-cal targets | ⬜ FDA defaults in use — editable on the Plan screen |
| Install on your phone      | ⬜ open the Worker URL → Add to Home Screen          |
| Open Food Facts contact    | ⏸️ deferred by choice — gates barcode scanning only  |
| Everything else            | ✅ done — see the record above                       |
