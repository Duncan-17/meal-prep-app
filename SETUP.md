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

## Moving your data between devices

Everything lives in **this browser, on this device**. Your phone and your laptop keep entirely
separate databases — that is deliberate (PLAN.md §1, re-confirmed 2026-10-06), not a bug.

To move it:

1. On the device that has the data: **Diary → Plan → Export a backup**. A JSON file lands in
   your downloads.
2. Get the file onto the other device however suits — AirDrop, email, a cloud folder.
3. There: **Plan → Restore from a file**, pick it, confirm.

⚠️ **Restore replaces, it does not merge.** Whatever is on the receiving device is wiped. If both
devices have things you want, export the receiving one first.

The same export is your only backup against clearing site data, or iOS evicting storage from a
site you have not opened in about seven weeks. The Plan screen nags when it has been a fortnight.

---

## Quick status

Everything that ever blocked work is done. Three rows remain, none of them blocking.

| Item                       | Status                                               |
| -------------------------- | ---------------------------------------------------- |
| Your real 2500-cal targets | ⬜ FDA defaults in use — editable on the Plan screen |
| Install on your phone      | ⬜ open the Worker URL → Add to Home Screen          |
| Open Food Facts contact    | ⏸️ deferred by choice — gates barcode scanning only  |
| Everything else            | ✅ done — see the record above                       |
