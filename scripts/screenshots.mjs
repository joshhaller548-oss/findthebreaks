// Drives the reconciliation page in headless Chrome against the local
// server: types real answers, clicks Run, and saves screenshots. Fails if
// the page logs an error, scrolls sideways at phone width, or any check
// below goes the wrong way.
//
//   npm run serve            (in another terminal)
//   npm run screenshots -- <output dir>

import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { drills } from '../public/js/drills/reconciliation.mjs';
import { countsFrom, fill } from '../public/js/check.mjs';

const BASE = process.env.BASE || 'http://localhost:4173';
const OUT = process.argv[2] || 'screenshots';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(OUT, { recursive: true });

const root = new URL('../public/', import.meta.url);
const data = JSON.parse(readFileSync(new URL('data/reconciliation.json', root), 'utf8'));
const key = JSON.parse(readFileSync(new URL('data/reconciliation.key.json', root), 'utf8'));
const counts = countsFrom(data, key);
const byId = (id) => drills.find((d) => d.id === id);
const sqlModel = (id) => byId(id).sql;
const excelModel = (id) => {
  const x = byId(id).excel;
  return [...x.columns.map((c) => x.model[c.name] || ''), ...(x.total ? [x.model.total] : [])].map((f) => fill(f, counts));
};

const { drills: layDrills } = await import('../public/js/drills/laytime.mjs');
const { countsFor: layCountsFor } = await import('../public/js/drills/laytime.mjs');
const layData = JSON.parse(readFileSync(new URL('data/laytime.json', root), 'utf8'));
const layCounts = layCountsFor(layData);
const layExcel = (id) => {
  const x = layDrills.find((d) => d.id === id).excel;
  return x.columns.map((c) => fill(x.model[c.name] || '', layCounts));
};
const laySql = (id) => layDrills.find((d) => d.id === id).sql;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const problems = [];
const expectThat = (label, ok) => { if (!ok) problems.push(label); };

async function open({ width = 1360, height = 900, dark = false, mobile = false, context = null } = {}) {
  const page = await (context || browser).newPage();
  await page.setViewport({ width, height, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }]);
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return page;
}
const ready = async (page) => {
  await page.waitForFunction(() => document.querySelector('.work .text-drill') || (document.querySelector('.work .btn.primary') && !document.querySelector('.work .btn.primary').disabled), { timeout: 20000 });
  await noStrayText(page);
};
// JS leaking into the page: null, undefined, [object Object], NaN. SQL NULL cells are upper case.
async function noStrayText(page) {
  const text = await page.evaluate(() => document.body.innerText);
  const hit = /\b(null|undefined|NaN)\b|\[object Object\]/.exec(text);
  if (hit) problems.push(`stray "${hit[0]}" on the page near: ${text.slice(Math.max(0, hit.index - 60), hit.index + 20).replace(/\s+/g, ' ')}`);
}
async function go(page, drill, lang = 'excel', task = 'reconciliation') {
  await page.goto(`${BASE}/${task}#drill-${drill}`, { waitUntil: 'networkidle0' });
  await ready(page);
  // A hash change keeps the page and its current tab, so always choose one
  if (await page.$('.work .tabs .tab')) await tab(page, lang === 'sql' ? 'SQL' : 'Excel');
}
async function tab(page, label) {
  const tabs = await page.$$('.work .tabs .tab');
  for (const t of tabs) if ((await t.evaluate((el) => el.textContent)) === label) await t.click();
  await ready(page);
}
async function sql(page, text) {
  await page.$eval('.editor', (el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.type('.editor', text, { delay: 0 });
  await page.click('.work .btn.primary');
  await page.waitForSelector('.verdict .v');
  await noStrayText(page);
}
async function excel(page, values) {
  const inputs = await page.$$('.formula');
  for (let i = 0; i < inputs.length; i++) {
    await inputs[i].evaluate((el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
    if (values[i]) await inputs[i].type(values[i], { delay: 0 });
  }
  await page.click('.work .btn.primary');
  await page.waitForSelector('.verdict .v');
  await noStrayText(page);
}
const verdict = (page) => page.$eval('.verdict', (el) => el.innerText.replace(/\s+/g, ' ').trim());
const shot = (page, sel, name) => page.$(sel).then((el) => el.screenshot({ path: `${OUT}/${name}.png` }));
const statusOf = (page, n) => page.$$eval('.drill .status', (els, i) => els[i - 1].className, n);
const log = (label, text) => console.log(`${label.padEnd(24)}: ${text}`);

// ---------- Excel, desktop light ----------
{
  const page = await open();
  await go(page, 1);
  const tabs = await page.$$eval('.work .tabs .tab', (els) => els.map((e) => `${e.textContent}${e.getAttribute('aria-selected') === 'true' ? '*' : ''}`));
  log('tabs (selected *)', tabs.join(' | '));
  expectThat('Excel is the first and default tab', tabs[0] === 'Excel*');
  await page.screenshot({ path: `${OUT}/01-excel-drill1.png` });

  await go(page, 4);
  await excel(page, ['=COUNTIF(invoices!$B:$B, A2)']);
  log('excel 4, no =0', await verdict(page));
  await shot(page, '.work', '02-excel-drill4-count-not-zero');
  await excel(page, ['=COUNTIF(invoices!$B:$B, A2)=0']);
  log('excel 4, =0', await verdict(page));
  const chip = await page.$$eval('.chip.found', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  log('found chips', chip.join(' | '));
  expectThat('drill 4 in Excel marks the missing invoice chip', chip.some((c) => c.includes('Missing invoice')));
  await shot(page, '.work', '03-excel-drill4-correct');

  await go(page, 2);
  await excel(page, ['=SUMIFS(cargoes!$F$1:$F$30, cargoes!$C$1:$C$30, A2)']);
  log('excel 2, header range', await verdict(page));

  await go(page, 3);
  await excel(page, ['=VLOOKUP($C2, counterparties!$A:$D, 2)', '=VLOOKUP($C2, counterparties!$A:$D, 4)']);
  log('excel 3, no FALSE', await verdict(page));

  await go(page, 7);
  await excel(page, ['=SUMIFS(cargoes!$F:$F, cargoes!$A:$A, B2)', '=D2-G2', '=H2<>0']);
  log('excel 7, SUMIFS orphan', await verdict(page));
  await excel(page, excelModel(7));
  log('excel 7, model', await verdict(page));
  await shot(page, '.layout', '04-excel-drill7-correct-sheet');

  await go(page, 9);
  await excel(page, ['=IF(COUNTIF(invoices!B:B, A2)=0, 0, VLOOKUP(A2, invoices!B:E, 3, FALSE)*VLOOKUP(A2, invoices!B:E, 4, FALSE)-F2*J2)', `=SUM(K2:K${counts.cg_last})`]);
  log('excel 9, first match', await verdict(page));
  await excel(page, ['=IF(COUNTIF(invoices!B:B, A2)=0, 0, SUMPRODUCT((invoices!B:B=A2)*invoices!D:D*invoices!E:E)-F2*J2)', `=SUM(K2:K${counts.cg_last})`]);
  log('excel 9, whole columns', await verdict(page));
  await shot(page, '.work', '05-excel-drill9-error');

  await go(page, 3);
  await excel(page, excelModel(3));
  log('excel 3, model', (await verdict(page)).slice(0, 60) + '...');
  await page.close();
}

// ---------- SQL still works ----------
{
  const page = await open();
  await go(page, 4, 'sql');
  await sql(page, 'SELECT c.cargo_id, c.vessel, c.counterparty FROM cargoes c JOIN invoices i ON c.cargo_id = i.cargo_id');
  log('sql 4, inner join', await verdict(page));
  await sql(page, 'SELECT CARGO_ID, VESSEL, COUNTERPARTY FROM CARGOES WHERE CARGO_ID NOT IN (SELECT CARGO_ID FROM INVOICES)');
  log('sql 4, upper case NOT IN', await verdict(page));
  await go(page, 9, 'sql');
  await sql(page, 'SELECT SUM(i.invoiced_tonnage * i.invoiced_price - c.bl_tonnage * c.contract_price) AS diff FROM cargoes c JOIN invoices i ON c.cargo_id = i.cargo_id');
  log('sql 9, row by row', await verdict(page));
  await shot(page, '.work', '06-sql-drill9-row-by-row');
  await page.close();
}

// ---------- hollow tick: reveal, solve, then a clean solve upgrades it ----------
{
  const ctx = await browser.createBrowserContext();
  const page = await open({ context: ctx });
  await go(page, 5);
  await page.click('.work .btn.reveal');
  await page.click('.work .btn.reveal');
  log('after reveal only', `status "${await statusOf(page, 5)}"`);
  expectThat('reveal alone does not tick', (await statusOf(page, 5)) === 'status');
  await excel(page, excelModel(5));
  log('solved after reveal', await verdict(page));
  const hollow = await statusOf(page, 5);
  const chipHollow = await page.$$eval('.chip.found-hollow', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  log('drill 5 status', `"${hollow}", chip: ${chipHollow.join(' | ')}`);
  expectThat('solve after reveal gives a hollow tick', hollow.includes('hollow'));
  expectThat('and a hollow found chip', chipHollow.some((c) => c.includes('Orphan')));
  await shot(page, '.layout', '07-hollow-tick');
  // Same visit: solving again still counts as after reveal
  await excel(page, excelModel(5));
  log('same visit, solve again', `status "${await statusOf(page, 5)}"`);
  expectThat('a second solve in the same visit stays hollow', (await statusOf(page, 5)).includes('hollow'));
  // A later visit: a real reload, not a hash change
  await page.reload({ waitUntil: 'networkidle0' });
  await ready(page);
  log('after reload', `status "${await statusOf(page, 5)}", editor kept: ${(await page.$$eval('.formula', (els) => els.map((e) => e.value))).join(' ')}`);
  await excel(page, excelModel(5));
  const upgraded = await statusOf(page, 5);
  log('clean solve later', `status "${upgraded}"`);
  expectThat('a clean solve upgrades to a full tick', upgraded.includes('done'));
  await go(page, 5, 'sql');
  log('SQL tab, same drill', `status "${await statusOf(page, 5)}" (ticks are per language)`);
  await ctx.close();
}

// ---------- versioning: a changed SQL key clears SQL ticks only ----------
{
  const ctx = await browser.createBrowserContext();
  const page = await open({ context: ctx });
  await go(page, 4);
  await page.evaluate((fpExcel) => localStorage.setItem('findthebreaks:progress', JSON.stringify({
    schema: 3,
    keys: { 'reconciliation:sql': 'old-key-0000', 'reconciliation:excel': fpExcel },
    solved: { 'reconciliation:4:sql': true, 'reconciliation:4:excel': true },
    afterReveal: { 'reconciliation:5:sql': true },
    answers: { 'reconciliation:4:sql': 'SELECT 1' },
  })), key.fingerprints.excel);
  await page.reload({ waitUntil: 'networkidle0' });
  await ready(page);
  const notice = await page.$eval('.notice', (el) => el.innerText).catch(() => '(no notice)');
  const excelTick = await statusOf(page, 4);
  await tab(page, 'SQL');
  const sqlTick = await statusOf(page, 4);
  const sqlHollow = await statusOf(page, 5);
  const kept = await page.$eval('.editor', (el) => el.value);
  log('old SQL key, reload', `Excel drill 4 "${excelTick}", SQL drill 4 "${sqlTick}", SQL drill 5 "${sqlHollow}", SQL answer "${kept}"`);
  log('notice', notice);
  expectThat('Excel tick survives a SQL key change', excelTick.includes('done'));
  expectThat('SQL ticks, full and hollow, are cleared', sqlTick === 'status' && sqlHollow === 'status');
  expectThat('saved SQL answer is kept', kept === 'SELECT 1');
  await ctx.close();
}

// ---------- timed run in Excel, one step ----------
{
  const page = await open();
  await go(page, 10);
  await page.click('.work .btn.primary');
  await page.waitForSelector('.timed-bar');
  await excel(page, excelModel(4));
  log('excel timed, step 1', await verdict(page));
  await page.close();
}

// ---------- timed run: a reveal disqualifies it, a slow clean run counts ----------
for (const mode of ['reveal', 'slow']) {
  const ctx = await browser.createBrowserContext();
  const page = await open({ context: ctx });
  await go(page, 10);
  await page.click('.work .btn.primary');
  await page.waitForSelector('.timed-bar');
  if (mode === 'reveal') {
    await page.click('.work .btn.reveal');
    await page.click('.work .btn.reveal');
  } else {
    await page.evaluate(() => {
      const real = performance.now.bind(performance);
      performance.now = () => real() + 10 * 60000 + 5000;
    });
    await new Promise((r) => setTimeout(r, 600));
    log('timed, past 10:00', await page.$eval('.clock', (el) => `${el.textContent} class="${el.className}"`));
  }
  for (const id of [4, 5, 6, 7, 8]) {
    if (id !== 4) { await page.click('.verdict .btn.primary'); await page.waitForSelector('.timed-bar'); }
    await excel(page, excelModel(id));
  }
  await page.click('.verdict .btn.primary');
  await page.waitForSelector('.work .v');
  const end = await page.$eval('.work .v', (el) => el.innerText.replace(/\s+/g, ' ').trim());
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('findthebreaks:progress') || '{}').solved?.['reconciliation:10:excel'] === true);
  log(`timed, ${mode}`, `${end} | drill 10 stored solved: ${stored}`);
  expectThat(`timed run (${mode}) counted correctly`, mode === 'reveal' ? !stored : stored);
  await ctx.close();
}

// ---------- laytime ----------
{
  const ctx = await browser.createBrowserContext();
  const page = await open({ context: ctx });
  await go(page, 1, 'excel', 'laytime');
  const worked = await page.$eval('.worked', (el) => el.innerText);
  const contrast = await page.$eval('.contrast', (el) => el.innerText);
  log('laytime worked example', worked.match(/USD [\d,.]+ payable to \w+/)?.[0]);
  log('laytime contrast', contrast.match(/USD [\d,.]+ payable to \w+/)?.[0]);
  expectThat('worked example shows despatch USD 1,041.67', worked.includes('USD 1,041.67 payable to charterer'));
  expectThat('worked example states the terms above the calculation', /SHEX EIU: Sundays and holidays excepted, even if used/.test(worked) && worked.indexOf('SHEX BASIS') < worked.indexOf('Cargo') || worked.indexOf('SHEX basis') < worked.indexOf('Cargo'));
  expectThat('contrast panel shows demurrage USD 12,500.00 under SHEX UU', contrast.includes('USD 12,500.00 payable to owner') && contrast.includes('SHEX UU'));
  await page.screenshot({ path: `${OUT}/10-laytime-top.png` });

  await go(page, 2, 'excel', 'laytime');
  await excel(page, ['=K2']);
  log('lay excel 2, NOR', await verdict(page));
  await excel(page, ['=MIN(K2+J2, L2)']);
  log('lay excel 2, turn as days', await verdict(page));
  await excel(page, layExcel(2));
  log('lay excel 2, model', await verdict(page));

  await go(page, 5, 'sql', 'laytime');
  await sql(page, laySql(5).replace('- COALESCE(st.mins, 0) - COALESCE(sx.mins, 0)', '- COALESCE(st.mins, 0)'));
  log('lay sql 5, no SHEX', await verdict(page));
  await sql(page, laySql(5));
  log('lay sql 5, model', await verdict(page));

  await go(page, 7, 'excel', 'laytime');
  const noRound = layExcel(7);
  noRound[5] = '=R2-Q2';
  await excel(page, noRound);
  log('lay excel 7, no ROUND', await verdict(page));
  await excel(page, layExcel(7));
  log('lay excel 7, model', await verdict(page));
  await shot(page, '.layout', '11-laytime-excel-drill7');
  const chip = await page.$$eval('.chip.found', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  log('laytime chip', chip.join(' | '));
  expectThat('drill 7 marks the owner errors chip found', chip.some((c) => c.includes("owner's statement")));

  await go(page, 8, 'excel', 'laytime');
  const show = await page.$('.text-drill .show-voyages');
  log('drill 8 before drill 7', show ? 'asks to solve drill 7 first' : 'voyages shown, drill 7 is solved');
  const areas = await page.$$('.text-drill textarea');
  for (const a of areas) await a.type('The owner counted time that should not count.', { delay: 0 });
  await page.click('.text-drill .compare');
  const models = await page.$$eval('.model-note', (els) => els.map((e) => e.innerText));
  log('drill 8 model answers', models.length + ': ' + models[0]);
  await page.click('.text-drill .mark-done');
  log('drill 8 status', await statusOf(page, 8));
  expectThat('drill 8 self-marked gives a tick', (await statusOf(page, 8)).includes('done'));
  await shot(page, '.layout', '12-laytime-drill8');
  await ctx.close();
}

// ---------- phone width, dark ----------
for (const [drill, name, task] of [[7, '08-phone-dark-excel-drill7', 'reconciliation'], [4, '09-phone-dark-sql-drill4', 'reconciliation'], [5, '13-phone-dark-laytime-excel-drill5', 'laytime']]) {
  const page = await open({ width: 400, height: 860, dark: true, mobile: true });
  await go(page, drill, drill === 4 ? 'sql' : 'excel', task);
  if (task === 'laytime') await excel(page, layExcel(5));
  else if (drill === 7) await excel(page, ['=VLOOKUP(B2, cargoes!$A:$F, 6, FALSE)', '=G2-D2', '=H2<>0']);
  else await sql(page, sqlModel(4));
  log(`phone, drill ${drill}`, await verdict(page));
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  log(`phone 400px overflow`, `${overflow}px`);
  expectThat(`no horizontal scroll at 400px on drill ${drill}`, overflow <= 0);
  await page.close();
}

await browser.close();
if (problems.length) {
  console.log('\nPROBLEMS\n' + problems.join('\n'));
  process.exit(1);
}
console.log('\nNo console errors, no page errors, every check held.');
