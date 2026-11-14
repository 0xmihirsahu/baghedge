// frames through the whole page: hero, the sideways reel, each diagram step, the waitlist, the footer
import { chromium } from '/Users/viveksahu/Documents/videos/video-harness/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const [url = 'http://localhost:3300/', out = 'out/flow', w = '1440', h = '900'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2600);
await page.screenshot({ path: `${out}/${w}-0-hero.png` });

const m = await page.evaluate(() => {
  const [, reel] = document.querySelectorAll('main > section');
  const how = document.getElementById('how');
  return { reelTop: reel.offsetTop, reelLen: reel.offsetHeight - innerHeight * 2, howTop: how.offsetTop, vh: innerHeight };
});
const shots = [
  ['1-reel-a', m.reelTop],
  ['1-reel-b', m.reelTop + m.reelLen * 0.5],
  ['1-reel-c', m.reelTop + m.reelLen],
  ['2-overlap', m.reelTop + m.reelLen + m.vh * 0.5],
  ...[0, 1, 2, 3, 4].map((k) => [`3-how-${k}`, m.howTop + (k + 0.25) * 0.45 * m.vh]),
];
for (const [name, y] of shots) {
  await page.evaluate((y) => window.scrollTo(0, y), Math.round(y));
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${out}/${w}-${name}.png` });
}
for (const [i, id] of ['vision', 'about', 'launch'].entries()) {
  await page.evaluate((id) => window.scrollTo(0, document.getElementById(id).offsetTop), id);
  await page.waitForTimeout(3200);
  await page.screenshot({ path: `${out}/${w}-4${i}-${id}.png` });
}
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/${w}-5-end.png` });
console.log(JSON.stringify(m), errors.length ? errors : 'no errors');
await browser.close();
