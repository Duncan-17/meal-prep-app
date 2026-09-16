/**
 * Generate the PWA icon set from one inline SVG.
 *
 * Run with `node scripts/make-icons.mjs`. Committed output lives in `public/`,
 * so this only needs re-running when the mark changes.
 *
 * The mark: a divided meal-prep tray — one large compartment and two smaller
 * ones, in three tints. Geometric rather than typographic, because a letter at
 * 48px is unreadable and every second app is a monogram.
 *
 * The first attempt was three stacked bars, which at icon size read as a
 * hamburger menu button. A food app whose icon looks like a nav control is
 * worse than a dull one, hence the compartments.
 *
 * Two variants are produced. The plain one fills the tile edge to edge, which
 * is what iOS wants. The **maskable** one keeps the mark inside the middle 80%
 * so Android can crop it to a circle, a squircle or a rounded square without
 * clipping anything — the safe zone is a real spec, not padding for taste.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '..', 'public');

const ACCENT = '#2f7d5a';
const LIGHT = '#eaf3ed';
const MID = '#9dc7ae';

/**
 * @param {number} size
 * @param {boolean} maskable  keep the mark inside the 80% safe zone
 */
function svg(size, maskable) {
  // Android may crop up to 10% from each edge on a maskable icon.
  const inset = maskable ? size * 0.1 : 0;
  const box = size - inset * 2;
  const radius = maskable ? 0 : size * 0.22;

  // The tray, centred with generous air so it still reads at 32px.
  const trayW = box * 0.62;
  const trayH = box * 0.5;
  const trayX = inset + (box - trayW) / 2;
  const trayY = inset + (box - trayH) / 2;
  const trayR = box * 0.07;

  // A 2px-equivalent gap between compartments, scaled — the same surface-gap
  // idea the charts use, so shapes never fuse into one blob.
  const gap = box * 0.035;
  const bigW = trayW * 0.52;
  const smallW = trayW - bigW - gap;
  const smallH = (trayH - gap) / 2;
  const pad = box * 0.045;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${ACCENT}"/>
  <rect x="${trayX - pad}" y="${trayY - pad}" width="${trayW + pad * 2}" height="${
    trayH + pad * 2
  }" rx="${trayR + pad * 0.5}" fill="${LIGHT}" opacity="0.28"/>
  <rect x="${trayX}" y="${trayY}" width="${bigW}" height="${trayH}" rx="${trayR}" fill="${LIGHT}"/>
  <rect x="${trayX + bigW + gap}" y="${trayY}" width="${smallW}" height="${smallH}" rx="${
    trayR * 0.8
  }" fill="${MID}"/>
  <rect x="${trayX + bigW + gap}" y="${trayY + smallH + gap}" width="${smallW}" height="${smallH}" rx="${
    trayR * 0.8
  }" fill="${LIGHT}"/>
</svg>`;
}

/** @type {Array<{ file: string; size: number; maskable: boolean }>} */
const targets = [
  { file: 'pwa-192x192.png', size: 192, maskable: false },
  { file: 'pwa-512x512.png', size: 512, maskable: false },
  { file: 'pwa-maskable-512x512.png', size: 512, maskable: true },
  // iOS ignores the manifest here and wants this exact filename.
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
  { file: 'favicon-32x32.png', size: 32, maskable: false },
];

await mkdir(publicDir, { recursive: true });

for (const { file, size, maskable } of targets) {
  const png = await sharp(Buffer.from(svg(size, maskable)))
    .png()
    .toBuffer();
  await writeFile(resolve(publicDir, file), png);
  console.log(`${file}  ${size}×${size}${maskable ? '  (maskable)' : ''}`);
}

// A crisp vector favicon for desktop browsers that prefer one.
await writeFile(resolve(publicDir, 'favicon.svg'), svg(512, false));
console.log('favicon.svg');
