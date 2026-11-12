// Drives the reconciliation page in headless Chrome against the local
// server: types real answers, clicks Run, and saves screenshots. Fails if
// the page logs an error or scrolls sideways at phone width.
//
//   npm run serve            (in another terminal)
//   npm run screenshots -- <output dir>

import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4173';
const OUT = process.argv[2] || 'screenshots';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const problems = [];

async function open({ width, height, dark = false, mobile = false }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }]);
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return page;
}

async function go(page, drill) {
  await page.goto(`${BASE}/reconciliation#drill-${drill}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('.work .btn.primary') && !document.querySelector('.work .btn.primary').disabled);
}

async function answer(page, sql) {
  await page.$eval('.editor', (el) => { el.value = ''; });
  await page.type('.editor', sql, { delay: 0 });
  await page.click('.work .btn.primary');
  await page.waitForSelector('.verdict .v');
}

const shotWork = (page, name) => page.$('.layout').then((el) => el.screenshot({ path: `${OUT}/${name}.png` }));
const verdictText = (page) => page.$eval('.verdict', (el) => el.innerText.replace(/\s+/g, ' ').trim());

// Desktop, light
const page = await open({ width: 1360, height: 900 });
await go(page, 1);
await page.screenshot({ path: `${OUT}/01-landing-drill1.png`, fullPage: false });

await go(page, 4);
await answer(page, 'SELECT c.cargo_id, c.vessel, c.counterparty FROM cargoes c JOIN invoices i ON c.cargo_id = i.cargo_id');
console.log('drill 4, inner join  :', await verdictText(page));
await shotWork(page, '02-drill4-inner-join');

await answer(page, 'SELECT c.cargo_id, c.vessel, c.counterparty\nFROM cargoes c\nLEFT JOIN invoices i ON c.cargo_id = i.cargo_id\nWHERE i.invoice_no IS NULL');
console.log('drill 4, left join   :', await verdictText(page));
await page.screenshot({ path: `${OUT}/03-drill4-correct.png`, fullPage: false });

await go(page, 2);
await answer(page, 'SELECT counterparty, SUM(bl_tonnage) AS total FROM cargoes GROUP BY counterparty ORDER BY total DESC');
console.log('drill 2, AS total    :', await verdictText(page));
await shotWork(page, '04-drill2-reserved-word');

await go(page, 6);
await answer(page, 'SELECT cargo_id, COUNT(*) AS n FROM invoices GROUP BY cargo_id');
console.log('drill 6, no HAVING   :', await verdictText(page));
await answer(page, 'SELECT cargo_id, COUNT(*) AS n FROM invoices WHERE COUNT(*) > 1 GROUP BY cargo_id');
console.log('drill 6, WHERE COUNT :', await verdictText(page));
await shotWork(page, '05-drill6-where-count');

await go(page, 9);
await answer(page, 'SELECT SUM(c.bl_tonnage * c.contract_price - i.invoiced_tonnage * i.invoiced_price) AS diff FROM cargoes c JOIN invoices i ON c.cargo_id = i.cargo_id');
console.log('drill 9, row by row  :', await verdictText(page));
await page.click('.work .btn.quiet');
const firstClick = await page.$eval('.answer', (el) => el.innerText.trim());
await page.click('.work .btn.quiet');
const revealed = await page.$eval('.answer', (el) => el.innerText.replace(/\s+/g, ' ').trim());
console.log('show answer, click 1 :', firstClick);
console.log('show answer, click 2 :', revealed.slice(0, 120) + '...');
await shotWork(page, '06-drill9-hint-and-answer');

await go(page, 3);
await answer(page, 'SELECT c.cargo_id, c.counterparty, p.country, p.payment_terms_days FROM cargoes c JOIN counterparties p ON c.counterparty = p.counterparty');
console.log('drill 3, inner join  :', await verdictText(page));
await page.screenshot({ path: `${OUT}/07-drill3-correct-with-panel.png`, fullPage: false, clip: { x: 0, y: 480, width: 1360, height: 900 } });

await go(page, 10);
await page.click('.work .btn.primary');
await page.waitForSelector('.timed-bar');
await new Promise((r) => setTimeout(r, 1300));
await answer(page, 'SELECT c.cargo_id, c.vessel, c.counterparty FROM cargoes c LEFT JOIN invoices i ON c.cargo_id = i.cargo_id WHERE i.invoice_no IS NULL');
console.log('timed run, step 1    :', await verdictText(page));
await shotWork(page, '08-timed-run');

// Reload: progress survives, last answer restored
await go(page, 4);
const restored = await page.$eval('.editor', (el) => el.value.split('\n')[0]);
const ticks = await page.$$eval('.drill .status.done', (els) => els.length);
const found = await page.$$eval('.chip.found', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
console.log('after reload         :', `${ticks} drill(s) ticked, editor restored to "${restored}", chips found: ${found.join(' | ')}`);

// Phone width, dark
const phone = await open({ width: 400, height: 860, dark: true, mobile: true });
await go(phone, 4);
await answer(phone, 'SELECT c.cargo_id FROM cargoes c JOIN invoices i ON c.cargo_id = i.cargo_id');
await phone.screenshot({ path: `${OUT}/09-phone-dark-full.png`, fullPage: true });
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
console.log('phone 400px overflow :', `${overflow}px`);
if (overflow > 0) problems.push(`horizontal scroll of ${overflow}px at 400px`);

// Desktop dark
const dark = await open({ width: 1360, height: 900, dark: true });
await go(dark, 7);
await answer(dark, 'SELECT c.cargo_id, c.bl_tonnage, i.invoiced_tonnage, c.bl_tonnage - i.invoiced_tonnage AS diff FROM cargoes c JOIN invoices i ON c.cargo_id = i.cargo_id WHERE c.bl_tonnage <> i.invoiced_tonnage');
console.log('drill 7, sign flipped:', await verdictText(dark));
await dark.screenshot({ path: `${OUT}/10-desktop-dark-drill7.png`, fullPage: false });

await browser.close();
if (problems.length) {
  console.log('\nPROBLEMS\n' + problems.join('\n'));
  process.exit(1);
}
console.log('\nNo console errors, no page errors.');
