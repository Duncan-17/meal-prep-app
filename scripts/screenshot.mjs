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
 * Needs `npm run dev` on :5173. Seeds a little data first so the calendar has
 * something to draw — an empty grid hides every layout bug worth finding.
 */

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

  // Per CONTEXT, not once globally — each context has its own IndexedDB, so
  // seeding only the first left every desktop screenshot showing empty states.
  await page.goto(`${BASE}/calendar`, { waitUntil: 'networkidle' });
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
