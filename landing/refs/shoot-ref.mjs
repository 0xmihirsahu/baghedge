// screenshots a reference site: full page at desktop + phone, viewport strips, and the computed type and colours
import { chromium } from '/Users/viveksahu/Documents/videos/video-harness/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';

const [url, out] = process.argv.slice(2);
const browser = await chromium.launch();

for (const [tag, w, h] of [['desk', 1440, 900], ['phone', 390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => console.log(e.message));
  await page.waitForTimeout(3000);
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total; y += h * 0.8) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
  let i = 0;
  for (let y = 0; y < total && i < 30; y += h, i++) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/${tag}-${String(i).padStart(2, '0')}.png` });
  }
  if (tag === 'desk') {
    const style = await page.evaluate(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const s = getComputedStyle(el);
        return { font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, color: s.color, ls: s.letterSpacing, lh: s.lineHeight };
      };
      const body = getComputedStyle(document.body);
      return { body: { font: body.fontFamily, bg: body.backgroundColor, color: body.color }, h1: pick('h1'), h2: pick('h2'), p: pick('p'), a: pick('a'), button: pick('button') };
    });
    writeFileSync(`${out}/style.json`, JSON.stringify({ total, ...style }, null, 2));
    console.log(JSON.stringify({ total, ...style }, null, 2));
  }
  console.log(tag, 'height', total, 'shots', i);
  await page.close();
}
await browser.close();
