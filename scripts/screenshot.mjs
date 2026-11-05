/**
 * Screenshot the running app at phone and desktop widths.
 *
 * Standing instruction from the user (2026-10-05): check the layout at BOTH
 * viewports, not just the one that happens to be open. A month grid is
 * exactly the sort of thing that looks fine at 1280px and falls apart at 390.
 *
 *   node scripts/screenshot.mjs                    # all routes, both widths
 *   node scripts/screenshot.mjs /calendar          # one route
 *
 * Needs `npm run dev` on :5173 AND `npm run dev:api` (sign-in). Seeds a little data first so the calendar has
 * something to draw — an empty grid hides every layout bug worth finding.
 */

import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium } from 'playwright';

import { SEED } from './seed-browser.mjs';

const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5173';
const OUT = resolve(process.cwd(), '.screenshots');

const VIEWPORTS = [
  // An iPhone 14-ish logical width; the narrow end of what matters.
  { name: 'mobile', width: 390, height: 844, scale: 2 },
  { name: 'desktop', width: 1280, height: 900, scale: 1 },
];

const ROUTES =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ['/calendar', '/components', '/fridge', '/log', '/plan'];

await mkdir(OUT, { recursive: true });

// Each browser context signs up a throwaway account, and sign-ups are capped
// at 5 per IP per hour (PLAN.md §11) — so a few runs in a row would lock this
// script out. Reset the counter in the LOCAL database only; never --remote.
{
  const wrangler = resolve(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const reset = spawnSync(
    process.execPath,
    [
      wrangler,
      'd1',
      'execute',
      'meal-prep',
      '--local',
      '--command',
      "DELETE FROM auth_attempts WHERE key LIKE 'signup:%'",
    ],
    { encoding: 'utf8' },
  );
  if (reset.status !== 0) console.warn('could not reset the local sign-up limit; sign-up may 429');
}

const browser = await chromium.launch();

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.scale,
    ...(viewport.name === 'mobile' ? { isMobile: true, hasTouch: true } : {}),
  });
  const page = await context.newPage();

  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });

  // Nothing renders until someone is signed in (PLAN.md §11), so each context
  // photographs the sign-in screen, then creates a throwaway account through
  // the real form. Needs `npm run dev:api` too, for the auth endpoints.
  await page.goto(`${BASE}/calendar`);
  await page.locator('form').waitFor({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'New account' }).click();
  await page.screenshot({ path: `${OUT}/${viewport.name}-signin.png`, fullPage: true });
  await page.locator('input[name=username]').fill(`shot${Date.now().toString(36)}`);
  await page.locator('input[name=password]').fill('screenshot-password');
  await page.locator('input[name=confirm]').fill('screenshot-password');
  await page.locator('button[type=submit]').click();
  await page.locator('.tabbar').waitFor({ timeout: 20_000 });

  // Per CONTEXT, not once globally — each context has its own IndexedDB, so
  // seeding only the first left every desktop screenshot showing empty states.
  const seedResult = await page.evaluate(SEED);
  console.log(`${viewport.name}: ${seedResult}`);

  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    const file = `${OUT}/${viewport.name}${route.replace(/\//g, '-')}.png`;
    await page.screenshot({ path: file, fullPage: true });

    // A horizontally scrolling page is a layout bug on a phone, every time.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    console.log(
      `${viewport.name.padEnd(8)} ${route.padEnd(13)} ${overflow > 0 ? `⚠ overflows by ${overflow}px` : 'ok'}`,
    );
  }

  if (problems.length > 0) {
    console.log(`  console errors (${viewport.name}):`);
    for (const problem of problems.slice(0, 5)) console.log('   ', problem.slice(0, 160));
  }

  await context.close();
}

await browser.close();
console.log(`\nwrote screenshots to ${OUT}`);
