// one frame per film scene, at the point where each scene holds still
import { chromium } from '/Users/viveksahu/Documents/videos/video-harness/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const [url = 'http://localhost:3300/', out = 'out/scenes', w = '1440', h = '900', pick = ''] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);
const film = await page.evaluate(() => {
  const s = document.querySelector('#top');
  return { top: s.offsetTop, len: s.offsetHeight - innerHeight };
});
const last = 7;
const scenes = pick ? pick.split(',').map(Number) : [...Array(last + 1).keys()];
for (const k of scenes) {
  await page.evaluate((y) => window.scrollTo(0, y), Math.round(film.top + (film.len * k) / last));
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${out}/${w}-s${k}.png` });
}
console.log('scenes', scenes.join(','), errors.length ? errors : 'no errors');
await browser.close();
