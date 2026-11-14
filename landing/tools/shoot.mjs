// screenshots localhost at desktop and phone, full page, after live data loads
import { chromium } from '/Users/viveksahu/Documents/videos/video-harness/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const [url = 'http://localhost:3300/', out = 'out/shots'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const [tag, w, h] of [['desk', 1440, 900], ['phone', 390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3500);
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total; y += h) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${tag}-full.png`, fullPage: true });
  await page.screenshot({ path: `${out}/${tag}-top.png` });
  console.log(tag, 'height', total, errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no errors');
  await page.close();
}
await browser.close();
