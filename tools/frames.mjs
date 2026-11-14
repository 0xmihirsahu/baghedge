// viewport frames at given scroll fractions of the page, to check scroll driven scenes
import { chromium } from '/Users/viveksahu/Documents/videos/video-harness/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const [url = 'http://localhost:3300/', out = 'out/frames', w = '1440', h = '900'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);
const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
const stops = [0, 0.06, 0.12, 0.18, 0.26, 0.34, 0.42, 0.55, 0.68, 0.82, 1];
for (const [i, f] of stops.entries()) {
  await page.evaluate((y) => window.scrollTo(0, y), Math.round(total * f));
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${w}-${String(i).padStart(2, '0')}.png` });
}
console.log('frames', stops.length, 'scrollable', total);
await browser.close();
