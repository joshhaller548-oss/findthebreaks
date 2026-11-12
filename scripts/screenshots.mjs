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

// The desk's fixtures, built the way fixtures.mjs builds them, so the
// browser run can be played with the engine's answers
const { calculate: layCalc, deductions: layDed } = await import('../public/js/laytime/calc.mjs');
const { createRun } = await import('../public/js/desk/run.mjs');
const layKey = JSON.parse(readFileSync(new URL('data/laytime.key.json', root), 'utf8'));
const deskItems = layData.tables.fixtures.map((f, i) => {
  const st = layData.tables.stoppages.filter((x) => x.voyage_id === f.voyage_id);
  return { n: i + 1, training: false, label: `Fixture ${i + 1}`, fixture: f, stoppages: st, result: layCalc(f, st), events: layDed(f, st),
    owner: layData.tables.owner_statement.find((o) => o.voyage_id === f.voyage_id), ownerError: layKey.owner_errors.find((e) => e.voyage_id === f.voyage_id) ?? null };
});

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
  await runWhenReady(page);
  await page.waitForSelector('.verdict .v');
  await noStrayText(page);
}
async function excel(page, values) {
  const inputs = await page.$$('.formula');
  for (let i = 0; i < inputs.length; i++) {
    await inputs[i].evaluate((el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
    if (values[i]) await inputs[i].type(values[i], { delay: 0 });
  }
  await runWhenReady(page);
  await page.waitForSelector('.verdict .v');
  await noStrayText(page);
}
// Run is disabled until the engine has loaded, which takes longer over the network
const runWhenReady = async (page) => {
  await page.waitForFunction(() => { const b = document.querySelector('.work .btn.primary'); return b && !b.disabled; }, { timeout: 30000 });
  await page.click('.work .btn.primary');
};
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
  await go(page, 1, 'excel', 'laytime/tools');
  const worked = await page.$eval('.worked', (el) => el.innerText);
  const contrast = await page.$eval('.contrast', (el) => el.innerText);
  log('laytime worked example', worked.match(/USD [\d,.]+ payable to \w+/)?.[0]);
  log('laytime contrast', contrast.match(/USD [\d,.]+ payable to \w+/)?.[0]);
  expectThat('worked example shows despatch USD 1,041.67', worked.includes('USD 1,041.67 payable to charterer'));
  expectThat('worked example states the terms above the calculation', /SHEX EIU: Sundays and holidays excepted, even if used/.test(worked) && worked.indexOf('SHEX BASIS') < worked.indexOf('Cargo') || worked.indexOf('SHEX basis') < worked.indexOf('Cargo'));
  expectThat('contrast panel shows demurrage USD 12,500.00 under SHEX UU', contrast.includes('USD 12,500.00 payable to owner') && contrast.includes('SHEX UU'));
  await page.screenshot({ path: `${OUT}/10-laytime-top.png` });

  await go(page, 2, 'excel', 'laytime/tools');
  await excel(page, ['=K2']);
  log('lay excel 2, NOR', await verdict(page));
  await excel(page, ['=MIN(K2+J2, L2)']);
  log('lay excel 2, turn as days', await verdict(page));
  await excel(page, layExcel(2));
  log('lay excel 2, model', await verdict(page));

  await go(page, 5, 'sql', 'laytime/tools');
  await sql(page, laySql(5).replace('- COALESCE(st.mins, 0) - COALESCE(sx.mins, 0)', '- COALESCE(st.mins, 0)'));
  log('lay sql 5, no SHEX', await verdict(page));
  await sql(page, laySql(5));
  log('lay sql 5, model', await verdict(page));

  await go(page, 7, 'excel', 'laytime/tools');
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

  await go(page, 8, 'excel', 'laytime/tools');
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
for (const [drill, name, task] of [[7, '08-phone-dark-excel-drill7', 'reconciliation'], [4, '09-phone-dark-sql-drill4', 'reconciliation'], [5, '13-phone-dark-laytime-excel-drill5', 'laytime/tools']]) {
  const page = await open({ width: 400, height: 860, dark: true, mobile: true });
  await go(page, drill, drill === 4 ? 'sql' : 'excel', task);
  if (task === 'laytime/tools') await excel(page, layExcel(5));
  else if (drill === 7) await excel(page, ['=VLOOKUP(B2, cargoes!$A:$F, 6, FALSE)', '=G2-D2', '=H2<>0']);
  else await sql(page, sqlModel(4));
  log(`phone, drill ${drill}`, await verdict(page));
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  log(`phone 400px overflow`, `${overflow}px`);
  expectThat(`no horizontal scroll at 400px on drill ${drill}`, overflow <= 0);
  await page.close();
}

// ---------- drill list and frozen sheet column ----------
{
  const page = await open({ width: 400, height: 860, mobile: true });
  await go(page, 1, 'excel');
  await new Promise((r) => setTimeout(r, 300));
  const listText = await page.$eval('.drill-list', (el) => el.innerText);
  expectThat('the drill list carries titles only, not the open question', !listText.includes(byId(1).question.slice(0, 40)));
  const frozen = await page.evaluate(() => {
    const wrap = document.querySelector('.sheet-wrap');
    const cell = document.querySelector('table.sheet tbody tr:not(.names) > :nth-child(2)');
    const w = wrap.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    return { scrolled: wrap.scrollLeft, inView: c.left >= w.left && c.right <= w.right, text: cell.textContent };
  });
  log('sheet at 400px', `scrolled ${frozen.scrolled}px, column A shows ${frozen.text}`);
  expectThat('the sheet opens scrolled to the formula column with column A still in view', frozen.scrolled > 0 && frozen.inView);
  await page.close();
}

// ---------- laytime drills under Desk tools: trimmed sheet, reference tables ----------
{
  const page = await open({ width: 390, height: 844, mobile: true });
  await go(page, 1, 'excel', 'laytime/tools');
  await new Promise((r) => setTimeout(r, 300));
  const sheet = await page.evaluate(() => {
    const wrap = document.querySelector('.sheet-wrap');
    const letters = [...wrap.querySelectorAll('thead th')].map((t) => t.textContent).filter(Boolean);
    const n = [...wrap.querySelectorAll('thead th')].find((t) => t.textContent === 'N').getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    return { letters: letters.join(''), scrolled: wrap.scrollLeft, nInView: n.right <= w.right + 1 && n.left >= w.left - 1 };
  });
  log('laytime sheet 390px', `columns ${sheet.letters}, scrolled ${sheet.scrolled}px, N in view ${sheet.nInView}`);
  expectThat('laytime drill 1 sheet shows voyage_id, cargo and rate beside the formula column, from column A', sheet.letters === 'ACDN' && sheet.scrolled === 0 && sheet.nInView);
  await page.screenshot({ path: `${OUT}/20-laytime-sheet-390.png`, fullPage: true });
  await page.click('.sheet-toggle .btn');
  expectThat('Show all columns brings back every column', (await page.$$eval('.sheet-wrap thead th', (ths) => ths.filter((t) => t.textContent).length)) === 14);
  const returns = await page.$eval('.returns', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  expectThat(`the drill names its columns on a Return line (${returns})`, returns.includes('voyage_id') && returns.includes('laytime_allowed_hrs'));
  const tabs = await page.$$eval('.reference .ref-tabs .tab', (ts) => ts.map((t) => { const r = t.getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0; }));
  expectThat(`every reference tab is in view at 390px (${tabs.length})`, tabs.length === 4 && tabs.every(Boolean));
  const cap = await page.$eval('.reference caption', (e) => e.textContent);
  expectThat(`a wide reference table says it scrolls (${cap})`, /scroll sideways for more/.test(cap));
  const frozen = await page.evaluate(() => {
    const wrap = document.querySelector('.reference .table-wrap');
    wrap.scrollLeft = 400;
    const c = wrap.querySelector('tbody td').getBoundingClientRect();
    return c.left >= wrap.getBoundingClientRect().left - 1;
  });
  expectThat('the reference table keeps its first column in view when scrolled', frozen);
  await page.screenshot({ path: `${OUT}/20-laytime-reference-390.png`, fullPage: true });
  await page.close();
}

// ---------- laytime desk: name, title, glossary, briefing, ledger ----------
for (const [width, dark] of [[1360, false], [390, false], [390, true]]) {
  const ctx = await browser.createBrowserContext();
  const page = await open({ width, height: 844, dark, mobile: width < 500, context: ctx });
  const tag = `${width}${dark ? '-dark' : ''}`;
  await page.goto(`${BASE}/laytime`, { waitUntil: 'load' });
  await page.waitForSelector('#stage .screen');
  expectThat(`desk ${tag}: the name prompt opens on a first visit`, await page.$eval('#name-dialog', (d) => d.open));
  await page.click('.name-dialog button[value="ok"]');
  expectThat(`desk ${tag}: an empty name is refused with a reason`, /Type a name/.test(await page.$eval('.name-error', (e) => e.textContent)));
  await page.type('#name-input', 'Tester');
  await page.click('.name-dialog button[value="ok"]');
  await page.mouse.move(2, 2);
  await new Promise((r) => setTimeout(r, 1700));
  expectThat(`desk ${tag}: the title greets the name`, (await page.$eval('.greet', (e) => e.textContent)).includes('Tester'));
  await page.screenshot({ path: `${OUT}/16-desk-title-${tag}.png`, fullPage: true });
  for (const [hash, name, sel] of [['#/glossary', 'glossary', '.g-item'], ['#/briefing/0', 'briefing', '.fx-terms'], ['#/ledger', 'ledger', '.empty']]) {
    await page.evaluate((x) => { location.hash = x; }, hash);
    await page.waitForSelector(sel);
    await new Promise((r) => setTimeout(r, 350));
    await noStrayText(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expectThat(`desk ${tag} ${name}: no horizontal scroll`, overflow <= 0);
    if (width === 1360) await page.screenshot({ path: `${OUT}/16-desk-${name}-${tag}.png`, fullPage: true });
  }
  if (width === 1360 || dark) {
    // Play the training cargo: one wrong call on the rain, then right calls
    await page.evaluate(() => { location.hash = '#/briefing/0'; });
    await page.waitForSelector('.brief-actions a.gbtn');
    await page.click('.brief-actions a.gbtn');
    await page.waitForSelector('.tip');
    expectThat(`desk ${tag}: a coaching tip pauses the clock at NOR`, (await page.$eval('.tip h3', (e) => e.textContent)) === 'NOR is in' && (await page.$eval('.sb .sb-value.mono', (e) => e.textContent)) === 'Mon 1 Jun, 08:00');
    await page.screenshot({ path: `${OUT}/17-desk-tip-${tag}.png`, fullPage: true });
    await page.click('.tip .gbtn');
    await page.click('.sb.controls .gbtn:nth-child(2)');
    const playTo = async (sel) => {
      for (let i = 0; i < 160; i++) {
        if (await page.$('.tip')) await page.click('.tip .gbtn');
        if (await page.$(sel)) return true;
        await new Promise((r) => setTimeout(r, 250));
      }
      return false;
    };
    // Click the option whose text contains `text`
    const pickOption = async (text) => {
      const opts = await page.$$('.ticket-options .gbtn');
      for (const o of opts) if ((await o.evaluate((e) => e.innerText)).includes(text)) return o.click();
      throw new Error(`no option with ${text}`);
    };
    expectThat(`desk ${tag}: the start ticket opens at NOR`, await playTo('.ticket.t-start'));
    await page.screenshot({ path: `${OUT}/17-desk-start-${tag}.png`, fullPage: true });
    await pickOption('when turn time runs out');
    expectThat(`desk ${tag}: the first time ticket arrives`, await playTo('.ticket.t-time'));
    const t1 = await page.$eval('.ticket h3', (e) => e.textContent);
    expectThat(`desk ${tag}: the first time ticket is the rain (${t1})`, t1 === 'Rain stopped loading');
    await page.click('.ticket-calls .gbtn.ink');
    await page.waitForSelector('.coach');
    log(`desk coach ${tag}`, await page.$eval('.coach', (e) => e.innerText.replace(/\s+/g, ' ')));
    await page.screenshot({ path: `${OUT}/17-desk-coach-${tag}.png`, fullPage: true });
    await page.keyboard.press('e');
    expectThat(`desk ${tag}: the Sunday ticket arrives after the rain`, await playTo('.ticket.t-time'));
    await page.click('.ticket-calls .gbtn.accent');
    expectThat(`desk ${tag}: the settle ticket opens at completion`, await playTo('.ticket.t-settle'));
    await page.screenshot({ path: `${OUT}/17-desk-settle-${tag}.png`, fullPage: true });
    await pickOption('Despatch USD 1,041.67');
    expectThat(`desk ${tag}: the recap card shows`, await playTo('.summary'));
    const sum = await page.$eval('.summary', (e) => e.innerText.replace(/\s+/g, ' '));
    log(`desk summary ${tag}`, sum.slice(0, 300));
    expectThat(`desk ${tag}: the recap prices the wrong rain call against the true despatch`, sum.includes('Demurrage USD 18,750.00') && sum.includes('Despatch USD 1,041.67') && sum.includes('USD 19,791.67') && sum.includes('Right first time: 3 of 4'));
    const lines = await page.$$eval('.st-line', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
    expectThat(`desk ${tag}: the statement has NOR, the start, both entries and the settlement (${lines.length})`, lines.length === 5 && lines.at(-1).includes('Settled: Despatch USD 1,041.67'));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expectThat(`desk ${tag}: no horizontal scroll on the desk`, overflow <= 0);
    await page.screenshot({ path: `${OUT}/17-desk-summary-${tag}.png`, fullPage: true });

    // A fixture with a planted owner error, played clean from the engine's answers
    const fx = deskItems.find((it) => it.fixture.voyage_id === 'VOY-2609');
    const answers = createRun(fx).steps;
    await page.evaluate((n) => { location.hash = `#/desk/${n}`; }, fx.n);
    await page.waitForSelector('.desk-screen');
    await page.click('.sb.controls .gbtn:nth-child(2)');
    for (const tk of answers) {
      const sel = { start: '.ticket.t-start', time: '.ticket.t-time', settle: '.ticket.t-settle', owner: '.ticket.t-owner' }[tk.type];
      const arrived = await playTo(sel);
      if (!arrived) log(`desk ${tag} waiting for ${tk.type} ${tk.id}`, await page.$eval('.desk-work', (e) => e.innerText.replace(/\s+/g, ' ').slice(0, 200)));
      expectThat(`desk ${tag} fixture ${fx.n}: ${tk.type} ticket ${tk.id} arrives`, arrived);
      if (tk.type === 'time') await page.keyboard.press(tk.answer === 'off' ? 'e' : 'c');
      else if (tk.type === 'owner') {
        await page.screenshot({ path: `${OUT}/18-desk-owner-${tag}.png`, fullPage: true });
        await page.keyboard.press(tk.answer === 'dispute' ? 'd' : 'a');
      } else await page.keyboard.press(String(tk.options.findIndex((o) => o.id === tk.answer) + 1));
      await new Promise((r) => setTimeout(r, 150));
    }
    const asked = await playTo('.explain-input');
    if (!asked) log(`desk ${tag} stuck at`, await page.$eval('.desk-work', (e) => e.innerText.replace(/\s+/g, ' ').slice(0, 300)));
    expectThat(`desk ${tag}: disputing the owner asks for a sentence`, asked);
    await page.type('.explain-input', 'They counted the weekend window, which is excepted under SHEX EIU.');
    await page.click('.t-explain .gbtn.ink');
    await page.waitForSelector('.model-note');
    const note = await page.$eval('.model-note', (e) => e.innerText);
    expectThat(`desk ${tag}: the model note is the drill 8 note (${note.slice(11, 70)})`, note.includes(fx.ownerError.note));
    await page.screenshot({ path: `${OUT}/18-desk-explain-${tag}.png`, fullPage: true });
    await page.click('.t-explain .gbtn.ok');
    expectThat(`desk ${tag}: the fixture recap shows`, await playTo('.summary'));
    const fsum = await page.$eval('.summary', (e) => e.innerText.replace(/\s+/g, ' '));
    expectThat(`desk ${tag}: a clean fixture run gets three stars and a zero difference`, fsum.includes('3 of 3 stars') || (await page.$eval('.summary .stars', (e) => e.getAttribute('aria-label'))) === '3 of 3 stars');
    expectThat(`desk ${tag}: the recap counts every decision right (${createRun(fx).steps.length})`, fsum.includes(`Right first time: ${createRun(fx).steps.length} of ${createRun(fx).steps.length}`) && fsum.includes('Your calls match the true statement'));
    await page.screenshot({ path: `${OUT}/18-desk-recap-${tag}.png`, fullPage: true });
    // Day 1: three vessels on one desk clock, answers looked up per vessel
    const { DAYS } = await import('../public/js/desk/run.mjs');
    const dayShips = DAYS[0].map((k) => deskItems[k - 1]);
    const stepsOf = Object.fromEntries(dayShips.map((it) => [it.fixture.vessel, createRun(it).steps]));
    await page.evaluate(() => { location.hash = '#/day/1'; });
    await page.waitForSelector('.day-ship');
    expectThat(`desk ${tag}: the day briefing lists three vessels`, (await page.$$('.day-ship')).length === 3);
    await page.screenshot({ path: `${OUT}/19-day-briefing-${tag}.png`, fullPage: true });
    await page.click('.brief-actions a.gbtn');
    await page.waitForSelector('.desk-screen .fleet .vcard');
    expectThat(`desk ${tag}: the day desk shows a card per vessel`, (await page.$$('.fleet .vcard')).length === 3);
    await page.click('.sb.controls .gbtn:nth-child(2)');
    const seen = [];
    let shotMid = false;
    for (let i = 0; i < 1200 && !(await page.$('.summary')); i++) {
      if (await page.$('.t-explain .explain-input')) {
        await page.type('.explain-input', 'Their figure is wrong.');
        await page.click('.t-explain .gbtn.ink');
        await page.waitForSelector('.model-note');
        await page.click('.t-explain .gbtn.ok');
        continue;
      }
      const tkEl = await page.$('.ticket:not(.t-explain)');
      if (!tkEl) { await new Promise((r) => setTimeout(r, 100)); continue; }
      const vessel = await page.$eval('.ticket .tk-vessel', (e) => e.textContent);
      const id = Number((await page.$eval('.ticket .ticket-no', (e) => e.textContent)).match(/Ticket (\d+)/)[1]);
      const tk = stepsOf[vessel][id - 1];
      const key = `${vessel}:${id}`;
      if (seen.at(-1) === key) { await new Promise((r) => setTimeout(r, 100)); continue; }
      seen.push(key);
      if (!shotMid && seen.length === 6) { shotMid = true; await page.screenshot({ path: `${OUT}/19-day-desk-${tag}.png`, fullPage: true }); }
      if (tk.type === 'time') await page.keyboard.press(tk.answer === 'off' ? 'e' : 'c');
      else if (tk.type === 'owner') await page.keyboard.press(tk.answer === 'dispute' ? 'd' : 'a');
      else await page.keyboard.press(String(tk.options.findIndex((o) => o.id === tk.answer) + 1));
      await new Promise((r) => setTimeout(r, 120));
    }
    const vesselsSeen = seen.map((k) => k.split(':')[0]);
    expectThat(`desk ${tag}: day 1 tickets interleave across vessels (${seen.length} tickets)`, vesselsSeen.some((v, i) => i > 1 && v !== vesselsSeen[i - 1] && vesselsSeen.slice(0, i).includes(v)));
    expectThat(`desk ${tag}: every ticket of the day arrived (${seen.length} of ${Object.values(stepsOf).flat().length})`, seen.length === Object.values(stepsOf).flat().length);
    const dsum = await page.$eval('.summary', (e) => e.innerText.replace(/\s+/g, ' '));
    log(`desk day 1 ${tag}`, dsum.slice(0, 220));
    expectThat(`desk ${tag}: the day recap settles all three at a zero difference`, dsum.includes('Day 1 settled') && dsum.includes('Across the day: USD 0.00') && (await page.$$('.recap-table tbody tr')).length === 3);
    await page.screenshot({ path: `${OUT}/19-day-recap-${tag}.png`, fullPage: true });
    const dayOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expectThat(`desk ${tag}: no horizontal scroll on the day desk`, dayOverflow <= 0);

    await page.evaluate(() => { location.hash = '#/ledger'; });
    await page.waitForSelector('.ledger-list');
    const ledger = await page.$$eval('.ledger-list li.played', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
    log(`desk ledger ${tag}`, ledger.join(' | '));
    expectThat(`desk ${tag}: the ledger lists day 1, the training cargo and the fixture`, ledger.length === 3 && ledger[0].startsWith('Day 1'));
    await page.screenshot({ path: `${OUT}/18-desk-ledger-${tag}.png`, fullPage: true });
  }
  if (width === 1360 && !dark) {
    const allowed = await page.evaluate(() => { location.hash = '#/briefing/0'; return new Promise((r) => setTimeout(() => r([...document.querySelectorAll('.fx-terms > div')].map((d) => d.innerText.replace(/\s+/g, ' '))), 300)); });
    log('desk briefing', allowed.filter((t) => /allowed|NOR|Exceptions/.test(t)).join(' | '));
    expectThat('desk briefing shows 120 hrs allowed from calc.mjs', allowed.some((t) => t.includes('120 hrs (5 days)')));
    const back = await page.$('.screen-bar a');
    await back.click();
    await page.waitForSelector('.title-screen');
    expectThat('desk: the drills are one click away under Desk tools', (await page.$$eval('.title-actions a', (as) => as.map((a) => a.getAttribute('href')))).includes('/laytime/tools'));
  }
  await ctx.close();
}

// ---------- landing, about and 404, both widths and themes ----------
for (const [path, name, status] of [['/', 'landing', 200], ['/about', 'about', 200], ['/no-such-page', '404', 404]]) {
  for (const [width, dark] of [[1360, false], [400, false], [400, true]]) {
    const page = await open({ width, height: 860, dark, mobile: width === 400 });
    if (status === 404) {
      // The browser logs the page's own 404 status; any other error still counts
      page.removeAllListeners('console');
      page.on('console', (m) => m.type() === 'error' && !(m.text().includes('404') && m.location().url === `${BASE}${path}`) && problems.push(`console: ${m.text()}`));
    }
    const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });
    // A repeat visit may get 304 from a host that allows caching, as Vercel does
    expectThat(`${path} answers ${status}`, res.status() === status || (status === 200 && res.status() === 304));
    await noStrayText(page);
    // Let the landing animations finish before the screenshot
    if (path === '/') await new Promise((r) => setTimeout(r, 1800));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expectThat(`no horizontal scroll at ${width}px on ${path}`, overflow <= 0);
    if (path === '/') {
      const metas = await page.$$eval('.task-block .tb-meta', (els) => els.map((e) => e.textContent));
      const want = [drills.length, layDrills.length];
      expectThat(`landing blocks show drill counts and languages (${metas.join(' | ')})`, metas.length === 2 && metas.every((m, i) => m.startsWith(`${want[i]} drills · Excel, SQL`)));
      if (width === 1360 && !dark) log('landing blocks', metas.join(' | '));
      const feature = await page.$eval('.feature-block', (a) => ({ href: a.getAttribute('href'), art: Boolean(a.querySelector('.harbour svg')), text: a.innerText }));
      expectThat(`landing ${width}: the laytime desk is featured, with its harbour, linking to /laytime`, feature.href === '/laytime' && feature.art && /Play the laytime desk/i.test(feature.text));
    }
    await page.screenshot({ path: `${OUT}/15-${name}-${width}${dark ? '-dark' : ''}.png`, fullPage: true });
    if (width === 1360 && !dark) {
      // Every link in the header, the body and the footer resolves
      const links = await page.evaluate(() => [...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href')));
      for (const href of [...new Set(links)]) {
        const r = await fetch(`${BASE}${href}`);
        expectThat(`${path}: link ${href} resolves`, r.ok);
      }
      const current = await page.evaluate(() => [...document.querySelectorAll('header.site [aria-current="page"]')].map((a) => a.textContent));
      log(`${path} header`, `${links.length} links, current: ${current.join(', ') || 'none'}`);
    }
    await page.close();
  }
}

await browser.close();
if (problems.length) {
  console.log('\nPROBLEMS\n' + problems.join('\n'));
  process.exit(1);
}
console.log('\nNo console errors, no page errors, every check held.');
