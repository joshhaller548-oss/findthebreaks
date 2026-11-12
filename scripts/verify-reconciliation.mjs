// Proves the reconciliation dataset and answer key are right.
//
// It reads only the generated JSON and re-derives everything in plain
// JavaScript, with no SQL, so a bug in a model answer or in AlaSQL cannot
// hide behind itself. Then it reruns the SQL model answers to prove the
// committed key is not stale. Exits non-zero on any failure.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { drills, pitfalls, DRILL_1_PORT } from '../public/js/drills/reconciliation.mjs';

const require = createRequire(import.meta.url);
const alasql = require('alasql');
const { HyperFormula } = require('hyperformula');
const { createExcelEngine } = await import('../public/js/engines/excel.mjs');
const { countsFrom, fill } = await import('../public/js/check.mjs');

const root = new URL('../', import.meta.url);
const data = JSON.parse(readFileSync(new URL('public/data/reconciliation.json', root), 'utf8'));
const key = JSON.parse(readFileSync(new URL('public/data/reconciliation.key.json', root), 'utf8'));
const { cargoes, invoices, counterparties } = data.tables;

let failures = 0;
let passes = 0;
const section = (name) => console.log(`\n${name}`);
const check = (label, ok, detail = '') => {
  if (ok) passes++;
  else failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameSet = (a, b) => eq([...a].sort(), [...b].sort());
const round2 = (x) => Math.round(x * 100) / 100;

// ---------- 1. shape ----------

section('1. Shape and ranges');

const cargoCols = ['cargo_id', 'vessel', 'counterparty', 'load_port', 'grade', 'bl_tonnage', 'laycan_start', 'laycan_end', 'incoterm', 'contract_price'];
const invoiceCols = ['invoice_no', 'cargo_id', 'counterparty', 'invoiced_tonnage', 'invoiced_price', 'invoice_date'];
const cpCols = ['counterparty', 'country', 'credit_limit_usd', 'payment_terms_days'];

check('cargoes has 30 rows', cargoes.length === 30, `${cargoes.length}`);
check('invoices has 29 rows', invoices.length === 29, `${invoices.length}`);
check('counterparties has 6 rows', counterparties.length === 6, `${counterparties.length}`);
check('cargoes columns exactly as specified', cargoes.every((r) => eq(Object.keys(r), cargoCols)));
check('invoices columns exactly as specified', invoices.every((r) => eq(Object.keys(r), invoiceCols)));
check('counterparties columns exactly as specified', counterparties.every((r) => eq(Object.keys(r), cpCols)));

const ids = cargoes.map((c) => c.cargo_id);
const expectedIds = Array.from({ length: 30 }, (_, k) => `CRG-${1001 + k}`);
check('cargo_id runs CRG-1001 to CRG-1030, unique', eq(ids, expectedIds));
check('invoice_no unique', new Set(invoices.map((i) => i.invoice_no)).size === invoices.length);

const PORTS = ['Puerto Bolivar', 'Santa Marta', 'Barranquilla', 'Balikpapan', 'Richards Bay'];
const GRADES = ['API 2', 'API 4', 'NAR 5500', 'NAR 4200'];
check('load_port in the five named ports', cargoes.every((c) => PORTS.includes(c.load_port)));
check('grade in the four named grades', cargoes.every((c) => GRADES.includes(c.grade)));
check('bl_tonnage whole tonnes, 45,000 to 75,000', cargoes.every((c) => Number.isInteger(c.bl_tonnage) && c.bl_tonnage >= 45000 && c.bl_tonnage <= 75000));
check('contract_price 82 to 118, 2dp', cargoes.every((c) => c.contract_price >= 82 && c.contract_price <= 118 && round2(c.contract_price) === c.contract_price));
check('laycans inside H1 2026', cargoes.every((c) => c.laycan_start >= '2026-01-01' && c.laycan_end <= '2026-06-30'));
check('laycan_end after laycan_start', cargoes.every((c) => c.laycan_end > c.laycan_start));
check('incoterm FOB, CFR or CIF', cargoes.every((c) => ['FOB', 'CFR', 'CIF'].includes(c.incoterm)));
const cpNames = new Set(counterparties.map((p) => p.counterparty));
check('every cargo counterparty exists in counterparties', cargoes.every((c) => cpNames.has(c.counterparty)));
check('every invoice counterparty exists in counterparties', invoices.every((i) => cpNames.has(i.counterparty)));
check('every table and column name is lower case (the SQL tab relies on it to be case insensitive)',
  Object.entries(data.tables).every(([t, rows]) => t === t.toLowerCase() && rows.every((r) => Object.keys(r).every((k) => k === k.toLowerCase()))));
check('no invoice has a NULL or blank cargo_id, so NOT IN behaves the same here as in Postgres and SQL Server',
  invoices.every((i) => typeof i.cargo_id === 'string' && i.cargo_id.trim() !== ''));
check('no leading or trailing whitespace in any string', [...cargoes, ...invoices, ...counterparties].every((r) => Object.values(r).every((v) => typeof v !== 'string' || v === v.trim())));

// ---------- 2. derive the breaks from the data alone ----------

section('2. Breaks derived from the data, without the key');

const cargoById = new Map(cargoes.map((c) => [c.cargo_id, c]));
const invByCargo = new Map();
for (const i of invoices) {
  if (!invByCargo.has(i.cargo_id)) invByCargo.set(i.cargo_id, []);
  invByCargo.get(i.cargo_id).push(i);
}

const found = {
  missing: cargoes.filter((c) => !invByCargo.has(c.cargo_id)).map((c) => c.cargo_id),
  orphan: invoices.filter((i) => !cargoById.has(i.cargo_id)).map((i) => i.invoice_no),
  duplicate: [...invByCargo].filter(([id, list]) => cargoById.has(id) && list.length > 1).map(([id]) => id),
  tonnage: [...new Set(invoices.filter((i) => cargoById.has(i.cargo_id) && i.invoiced_tonnage !== cargoById.get(i.cargo_id).bl_tonnage).map((i) => i.cargo_id))],
  price: [...new Set(invoices.filter((i) => cargoById.has(i.cargo_id) && i.invoiced_price !== cargoById.get(i.cargo_id).contract_price).map((i) => i.cargo_id))],
};

check('exactly 3 cargoes with no invoice', found.missing.length === 3, found.missing.join(', '));
check('exactly 1 orphan invoice', found.orphan.length === 1, found.orphan.join(', '));
check('exactly 1 cargo invoiced more than once, exactly twice', found.duplicate.length === 1 && invByCargo.get(found.duplicate[0]).length === 2, found.duplicate.join(', '));
check('exactly 2 tonnage mismatches', found.tonnage.length === 2, found.tonnage.join(', '));
check('exactly 1 price mismatch, invoiced below contract', found.price.length === 1 && invByCargo.get(found.price[0])[0].invoiced_price < cargoById.get(found.price[0]).contract_price, found.price.join(', '));

const breakCargoes = [...found.missing, ...found.duplicate, ...found.tonnage, ...found.price];
check('no cargo carries more than one break', new Set(breakCargoes).size === breakCargoes.length);

const clean = cargoes.filter((c) => !breakCargoes.includes(c.cargo_id));
check(`the other ${clean.length} cargoes reconcile exactly: one invoice, same counterparty, tonnage and price`,
  clean.every((c) => {
    const list = invByCargo.get(c.cargo_id);
    return list.length === 1 && list[0].counterparty === c.counterparty && list[0].invoiced_tonnage === c.bl_tonnage && list[0].invoiced_price === c.contract_price;
  }));
check('break cargoes differ only in the planted field (counterparty always matches)',
  invoices.filter((i) => cargoById.has(i.cargo_id)).every((i) => i.counterparty === cargoById.get(i.cargo_id).counterparty));
check('duplicate invoices are identical apart from number and date', (() => {
  const [a, b] = invByCargo.get(found.duplicate[0]);
  return a.invoiced_tonnage === b.invoiced_tonnage && a.invoiced_price === b.invoiced_price && a.invoice_no !== b.invoice_no;
})());
check('every invoice is dated after its laycan opened', invoices.filter((i) => cargoById.has(i.cargo_id)).every((i) => i.invoice_date > cargoById.get(i.cargo_id).laycan_start));

// ---------- 3. key manifest agrees ----------

section('3. Planted breaks in the key match what the data shows');

const p = key.planted;
check('key: missing_invoice', sameSet(p.missing_invoice.map((x) => x.cargo_id), found.missing));
check('key: orphan_invoice', sameSet(p.orphan_invoice.map((x) => x.invoice_no), found.orphan));
check('key: duplicate_invoice', sameSet(p.duplicate_invoice.map((x) => x.cargo_id), found.duplicate));
check('key: duplicate invoice numbers', sameSet(p.duplicate_invoice[0].invoice_nos, invByCargo.get(found.duplicate[0]).map((i) => i.invoice_no)));
check('key: tonnage_mismatch', sameSet(p.tonnage_mismatch.map((x) => x.cargo_id), found.tonnage));
check('key: tonnage figures', p.tonnage_mismatch.every((x) => x.bl_tonnage === cargoById.get(x.cargo_id).bl_tonnage && x.invoiced_tonnage === invByCargo.get(x.cargo_id)[0].invoiced_tonnage));
check('key: price_mismatch', sameSet(p.price_mismatch.map((x) => x.cargo_id), found.price));
check('key: price figures', p.price_mismatch.every((x) => x.contract_price === cargoById.get(x.cargo_id).contract_price && x.invoiced_price === invByCargo.get(x.cargo_id)[0].invoiced_price));

// ---------- 4. every drill answer, recomputed in plain JS ----------

section('4. Every drill answer recomputed in plain JS and compared to the key');

const cpByName = new Map(counterparties.map((x) => [x.counterparty, x]));
const matchedPairs = invoices.filter((i) => cargoById.has(i.cargo_id)).map((i) => [cargoById.get(i.cargo_id), i]);

const tonnagePerCp = new Map();
for (const c of cargoes) tonnagePerCp.set(c.counterparty, (tonnagePerCp.get(c.counterparty) || 0) + c.bl_tonnage);

const drill9 = round2(
  [...invByCargo]
    .filter(([id]) => cargoById.has(id))
    .reduce((sum, [id, list]) => {
      const c = cargoById.get(id);
      const invoiced = list.reduce((s, i) => s + i.invoiced_tonnage * i.invoiced_price, 0);
      return sum + invoiced - c.bl_tonnage * c.contract_price;
    }, 0),
);

const independent = {
  1: cargoes.filter((c) => c.load_port === DRILL_1_PORT).map((c) => [c.cargo_id, c.vessel, c.bl_tonnage]),
  2: [...tonnagePerCp].sort((a, b) => b[1] - a[1]),
  3: cargoes.map((c) => [c.cargo_id, c.counterparty, cpByName.get(c.counterparty).country, cpByName.get(c.counterparty).payment_terms_days]),
  4: cargoes.filter((c) => !invByCargo.has(c.cargo_id)).map((c) => [c.cargo_id, c.vessel, c.counterparty]),
  5: invoices.filter((i) => !cargoById.has(i.cargo_id)).map((i) => [i.invoice_no, i.cargo_id, i.counterparty]),
  6: [...invByCargo].filter(([, l]) => l.length > 1).map(([id, l]) => [id, l.length]),
  7: matchedPairs.filter(([c, i]) => c.bl_tonnage !== i.invoiced_tonnage).map(([c, i]) => [c.cargo_id, c.bl_tonnage, i.invoiced_tonnage, i.invoiced_tonnage - c.bl_tonnage]),
  8: matchedPairs.filter(([c, i]) => c.contract_price !== i.invoiced_price).map(([c, i]) => [c.cargo_id, c.contract_price, i.invoiced_price, round2(i.invoiced_price - c.contract_price)]),
  9: [[drill9]],
};

const canon = (rows, ordered) => {
  const r = rows.map((row) => row.map((v) => (typeof v === 'number' ? round2(v) : v)));
  return ordered ? r : [...r].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
};

for (const d of drills) {
  if (!d.sql) continue;
  const k = key.expected[d.id];
  const mine = independent[d.id];
  const ok = k && eq(canon(k.rows, d.ordered), canon(mine, d.ordered)) && k.columns.length === mine[0].length;
  check(`drill ${d.id} ${d.title}: ${mine.length} row(s), ${mine[0].length} col(s)${d.ordered ? ', order checked' : ''}`, ok);
}

const totals = [...tonnagePerCp.values()];
check('drill 2 has no tied totals, so "biggest first" has one right order', new Set(totals).size === totals.length);
const portCount = independent[1].length;
check('drill 1 port is a real subset (not 0, not 30)', portCount > 0 && portCount < 30, `${portCount} of 30`);
check('drills 7, 8 and 9 state the direction: invoiced minus book, positive means invoiced above',
  [7, 8, 9].every((id) => { const d = drills.find((x) => x.id === id); return /invoiced (value )?minus/.test(d.question) && /Positive means invoiced above/.test(d.question) && /^invoiced/.test(d.signNote); }));
check('drill 9 is positive: the duplicate makes the book overbilled', key.expected[9].rows[0][0] > 0);
check('drill 10 reuses drills 4 to 8', eq(drills.find((d) => d.id === 10).timed, [4, 5, 6, 7, 8]));
check('drill 4 is flagged as the key drill', drills.find((d) => d.id === 4).key === true);

// ---------- 5. key is current ----------

section('5. Committed key matches a fresh run of the SQL model answers');

const db = new alasql.Database();
for (const [name, rows] of Object.entries(data.tables)) db.tables[name] = { data: structuredClone(rows) };
const run = (sql) => {
  const rows = db.exec(sql);
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return { columns, rows: rows.map((r) => columns.map((c) => r[c])) };
};
for (const d of drills) {
  if (!d.sql) continue;
  const fresh = run(d.sql);
  check(`drill ${d.id} SQL reproduces committed key`, eq(fresh.columns, key.expected[d.id].columns) && eq(fresh.rows, key.expected[d.id].rows));
}
check(`key built with the pinned engines (${key.engines.sql}, ${key.engines.excel})`, key.engines.sql === `alasql ${alasql.version}` && key.engines.excel === `hyperformula ${HyperFormula.version}`);
const hash = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const fpSql = hash({ planted: key.planted, expected: key.expected, sql: drills.map((d) => [d.id, d.ordered ?? null]) });
const fpExcel = hash({ planted: key.planted, expected: key.expected, excel: drills.map((d) => [d.id, d.excel ? { ...d.excel, model: undefined } : null]) });
check(`SQL fingerprint matches the key and SQL drill definitions (${key.fingerprints.sql})`, key.fingerprints.sql === fpSql);
check(`Excel fingerprint matches the key and Excel frames (${key.fingerprints.excel})`, key.fingerprints.excel === fpExcel);
check('the two fingerprints differ, so each language clears its own ticks', fpSql !== fpExcel);
const reserved = drills.filter((d) => d.sql && /\bAS\s+total\b/i.test(d.sql));
check('no model answer aliases a column AS total (AlaSQL reserved word)', reserved.length === 0);

// ---------- 6. pitfall counts the hints will rely on ----------

section('6. Wrong answers the diagnostic hints will recognise');

const pit = (drill, id, lang) => key.pitfalls.find((x) => x.drill === drill && x.id === id && (!lang || x.lang === lang));
const innerJoinRows = matchedPairs.length;
check(`drill 4 INNER JOIN returns ${innerJoinRows} rows (27 invoiced cargoes + 1 duplicate row)`, pit(4, 'inner_join').row_count === innerJoinRows);
check('drill 1 without WHERE returns 30 rows', pit(1, 'no_where').row_count === 30);
check(`drill 1 SELECT * returns right rows, ${cargoCols.length} columns not 3`, pit(1, 'select_star').row_count === portCount && pit(1, 'select_star').column_count === cargoCols.length);
check('drill 2 without GROUP BY returns 30 raw rows not 6', pit(2, 'no_group_by').row_count === 30);
check(`drill 6 without HAVING returns every invoiced cargo ID (${invByCargo.size})`, pit(6, 'no_having').row_count === invByCargo.size);
check(`drill 4 INNER JOIN with DISTINCT returns ${invByCargo.size - 1} rows (every invoiced cargo)`, pit(4, 'inner_join_distinct').row_count === [...invByCargo.keys()].filter((id) => cargoById.has(id)).length);
check(`drill 5 INNER JOIN returns ${innerJoinRows} rows`, pit(5, 'inner_join').row_count === innerJoinRows);
check(`drills 7 and 8 without WHERE return every matched invoice (${innerJoinRows})`, pit(7, 'no_where').row_count === innerJoinRows && pit(8, 'no_where').row_count === innerJoinRows);
check('every pitfall in the drill file has a computed result in the key', pitfalls.every((q) => pit(q.drill, q.id, q.lang)));
const pitfallRows = pitfalls.filter((q) => q.match === 'rows').map((q) => [q.drill, pit(q.drill, q.id, q.lang).row_count, key.expected[q.drill].rows.length]);
check('no row-count pitfall has the same count as the right answer', pitfallRows.every(([, n, exp]) => n !== exp));
const rowByRow = round2(matchedPairs.reduce((s, [c, i]) => s + i.invoiced_tonnage * i.invoiced_price - c.bl_tonnage * c.contract_price, 0));
check('drill 9 row by row join gives a different number (duplicate cancels out)', pit(9, 'row_by_row_join').value === rowByRow && rowByRow !== drill9, `${rowByRow} vs ${drill9}`);

// ---------- 7. Excel ----------

section('7. Excel model answers and pitfalls, run in HyperFormula');

const counts = countsFrom(data, key);
const excel = createExcelEngine(HyperFormula, data.tables);
const runExcel = (d, formulas) => excel.run(Object.fromEntries(Object.entries(formulas).map(([k, f]) => [k, fill(f, counts)])), d.excel);
for (const d of drills.filter((x) => x.excel)) {
  const out = runExcel(d, d.excel.model);
  const ordered = d.excel.ordered ?? d.ordered;
  const k = key.expected[d.id];
  const ok = out.ok && eq(canon(out.rows, ordered), canon(k.rows, ordered)) && out.columns.length === k.columns.length;
  check(`drill ${d.id} Excel model answer reproduces the key: ${k.rows.length} row(s)${ordered ? ', order checked' : ''}`, ok, out.ok ? '' : out.error.message);
}
check('every drill with SQL has an Excel frame, hint and explanation', drills.filter((d) => d.sql).every((d) => d.excel && d.hint?.excel && d.why?.excel));
const excelPits = pitfalls.filter((q) => q.lang === 'excel');
for (const q of excelPits) {
  const kp = pit(q.drill, q.id, 'excel');
  const exp = key.expected[q.drill];
  const differs = kp.match === 'value'
    ? Math.abs(kp.value - exp.rows[0][0]) > 0.01
    : kp.match === 'result'
      ? !eq(canon(kp.result.rows, false), canon(exp.rows, false))
      : kp.row_count !== exp.rows.length;
  check(`drill ${q.drill} Excel pitfall ${q.id} is computed and differs from the right answer`, !!kp && differs);
}
check('drill 4 bare MATCH lands on the same count as COUNTIF without =0, so it gets that hint', pit(4, 'bare_match').row_count === pit(4, 'count_not_zero').row_count);
check('drill 9 Excel first-match figure equals the SQL row-by-row figure', pit(9, 'first_match_only').value === pit(9, 'row_by_row_join').value);

// ---------- 8. licence ----------

section('8. Licence');

const txt = (p) => readFileSync(new URL(p, root), 'utf8');
const GPL3_SHA256 = '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986';
check('LICENSE is the unmodified GPL-3.0 text from gnu.org', createHash('sha256').update(txt('LICENSE')).digest('hex') === GPL3_SHA256);
check('the site serves the same licence text', txt('public/LICENSE.txt') === txt('LICENSE'));
check('the site serves the same third-party notices', txt('public/THIRD_PARTY_NOTICES.txt') === txt('THIRD_PARTY_NOTICES.txt'));
check('package.json declares GPL-3.0-only', JSON.parse(txt('package.json')).license === 'GPL-3.0-only');
const notices = txt('THIRD_PARTY_NOTICES.txt');
const vendored = readdirSync(new URL('public/vendor/', root));
check(`notices name every vendored file (${vendored.join(', ')})`, vendored.every((f) => notices.includes(`vendor/${f}`)));
check(`notices carry the installed versions (alasql ${alasql.version}, hyperformula ${HyperFormula.version})`, notices.includes(`AlaSQL ${alasql.version}`) && notices.includes(`HyperFormula ${HyperFormula.version}`));
check('vendored file names carry the same versions', vendored.includes(`alasql-${alasql.version}.min.js`) && vendored.includes(`hyperformula-${HyperFormula.version}.full.min.js`));
const htmlPages = readdirSync(new URL('public/', root)).filter((f) => f.endsWith('.html')).map((f) => `public/${f}`);
check(`every page footer links source, licence and notices (${htmlPages.length} pages)`, htmlPages.every((p) => /data-source-link/.test(txt(p)) && txt(p).includes('/LICENSE.txt') && txt(p).includes('/THIRD_PARTY_NOTICES.txt')));

// ---------- 9. house rules ----------

section('9. House rules');

const dashFree = (txt) => !new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']').test(txt);
const walkFiles = (dir) => readdirSync(new URL(dir, root)).flatMap((f) => {
  const rel = `${dir}${f}`;
  if (rel.startsWith('public/vendor/')) return [];
  return statSync(new URL(rel, root)).isDirectory() ? walkFiles(`${rel}/`) : [rel];
});
const files = [...walkFiles('public/'), ...walkFiles('scripts/'), ...walkFiles('docs/'), 'vercel.json', 'package.json'];
const dashed = files.filter((f) => !dashFree(readFileSync(new URL(f, root), 'utf8')));
check(`no em or en dashes in ${files.length} site and script files`, dashed.length === 0, dashed.join(', '));

// Counts in hint text must come from the key, as {tokens}. This scans the
// templates as written in the drill file, never the text after filling.
// It flags what looks like a count: a number followed by a counted noun
// ("27 rows", "three cargoes") or any number of two or more digits. Code
// is left alone: `backtick spans`, function calls like ROUND(x, 2), and
// small thresholds like > 1 pass. Drill numbers ("drill 4") pass.
const COUNTED = '(rows?|cargo(es)?|invoices?|counterpart(y|ies)|columns?|breaks?|types?|groups?|records?|voyages?|fixtures?|tonnes|MT)';
const SPELLED = '(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty)';
function hardCodedCount(t) {
  const s = t
    .replace(/`[^`]*`/g, ' ')
    .replace(/\b[A-Z][A-Z_]*\s*\([^()]*\)/g, ' ')
    .replace(/\bdrills? \d+( (to|and) \d+)?/gi, ' ')
    .replace(/\{\w+\}/g, ' ');
  return new RegExp(`\\b\\d[\\d,.]*\\s+${COUNTED}\\b`, 'i').test(s)
    || new RegExp(`\\b${SPELLED}\\s+${COUNTED}\\b`, 'i').test(s)
    || /\b\d{2,}/.test(s);
}
const ruleCases = [
  ['ROUND(x, 2) keeps two decimal places.', false],
  ['HAVING COUNT(*) > 1 keeps the duplicates.', false],
  ['Use `LIMIT 10` to look at a few rows.', false],
  ['The same move as drill 4, turned around.', false],
  ['You got {got} rows.', false],
  ['Keep the groups with more than one invoice.', false],
  ['You got 27 rows.', true],
  ['There are three cargoes missing.', true],
  ['The total is 6,602,233.90.', true],
  ['Expected 3 rows.', true],
];
const ruleWrong = ruleCases.filter(([t, want]) => hardCodedCount(t) !== want);
check(`no-hard-coded-count rule behaves on ${ruleCases.length} sample sentences`, ruleWrong.length === 0, ruleWrong.map(([t]) => t).join(' | '));

const texts = [
  ...drills.flatMap((d) => [...Object.values(d.hint || {}), ...Object.values(d.why || {})].map((t) => [`drill ${d.id} hint/why`, t])),
  ...pitfalls.filter((q) => q.message).map((q) => [`pitfall ${q.lang} ${q.drill}/${q.id}`, q.message]),
];
const counted = texts.filter(([, t]) => hardCodedCount(t));
check(`no hard-coded counts in ${texts.length} hint, explanation and pitfall templates`, counted.length === 0, counted.map(([l]) => l).join(', '));

const retired = ['Drummond', 'Andino', 'Highveld', 'Nordmark', 'Borneo Bara', 'Marmara'];
const raw = readFileSync(new URL('public/data/reconciliation.json', root), 'utf8');
check('no retired counterparty names left in the data', retired.every((n) => !raw.includes(n)));

// ---------- summary ----------

console.log(`\n${passes} passed, ${failures} failed.`);
process.exit(failures ? 1 : 0);
