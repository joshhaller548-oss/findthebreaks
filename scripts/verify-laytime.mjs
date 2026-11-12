// Proves the laytime drill answer key is right: every expected result is
// checked against calc.mjs (itself checked minute by minute in Python),
// every Excel model answer reproduces the key, every pitfall is computed
// and differs from the right answer, and the house rules hold.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { drills, pitfalls, countsFor } from '../public/js/drills/laytime.mjs';
import { createSqlEngine } from '../public/js/engines/sql.mjs';
import { createExcelEngine } from '../public/js/engines/excel.mjs';
import { normValue, fill, compare } from '../public/js/check.mjs';

const require = createRequire(import.meta.url);
const alasql = require('alasql');
const { HyperFormula } = require('hyperformula');
const root = new URL('../public/', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const data = read('data/laytime.json');
const calc = read('data/laytime.key.json');
const key = read('data/laytime.drills.key.json');
const counts = countsFor(data);

let passes = 0;
let failures = 0;
const section = (name) => console.log(`\n${name}`);
const check = (label, ok, detail = '') => {
  if (ok) passes++;
  else failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};
const same = (user, exp, ci) => compare({ columns: user.columns, rows: user.rows }, { ...exp, ordered: false, caseInsensitive: ci }).verdict === 'correct';

// ---------- 1. expected results against the calculator ----------

section('1. Every expected result agrees with calc.mjs');
const v = calc.voyages;
const want = {
  1: (id) => [v[id].allowed_min / 60],
  2: (id) => [v[id].laytime_commenced],
  3: (id) => [v[id].elapsed_min / 60],
  4: (id) => [v[id].deductible_stoppage_min / 60],
  5: (id) => [v[id].used_min / 60, v[id].result],
  6: (id) => [v[id].result, v[id].amount_usd],
};
for (const d of drills.filter((x) => want[x.id])) {
  const exp = key.expected[d.id];
  const rows = Object.keys(v).map((id) => [id, ...want[d.id](id)]);
  check(`drill ${d.id} ${d.title}: ${exp.rows.length} voyages`, exp.rows.length === Object.keys(v).length && same({ columns: exp.columns, rows }, exp, d.caseInsensitive));
}
const owner = Object.fromEntries(data.tables.owner_statement.map((o) => [o.voyage_id, o]));
const disagree = Object.keys(v).filter((id) => owner[id].laytime_used_hrs * 60 !== v[id].used_min).map((id) => [id, owner[id].laytime_used_hrs, v[id].used_min / 60, owner[id].laytime_used_hrs - v[id].used_min / 60]);
check(`drill 7 finds exactly the planted owner errors (${calc.owner_errors.map((e) => e.voyage_id).join(', ')})`, same({ columns: key.expected[7].columns, rows: disagree }, key.expected[7]) && disagree.length === calc.owner_errors.length && calc.owner_errors.every((e) => disagree.some((r) => r[0] === e.voyage_id)));
check('drill 7 differences are all positive: the owner overstates time used', key.expected[7].rows.every((r) => r[3] > 0));

// ---------- 2. key is current ----------

section('2. Committed key matches a fresh run of the SQL model answers');
const sql = createSqlEngine(alasql, data.tables);
for (const d of drills.filter((x) => x.sql)) {
  const out = sql.run(d.sql);
  const fresh = out.ok && JSON.stringify(out.rows.map((r) => r.map(normValue))) === JSON.stringify(key.expected[d.id].rows);
  check(`drill ${d.id} SQL reproduces the committed key`, fresh, out.ok ? '' : out.error.message);
}

// ---------- 3. Excel ----------

section('3. Excel model answers reproduce the key, in HyperFormula');
const excel = createExcelEngine(HyperFormula, data.tables);
const runExcel = (d, formulas) => excel.run(Object.fromEntries(Object.entries(formulas).map(([k, f]) => [k, fill(f, counts)])), d.excel);
for (const d of drills.filter((x) => x.excel)) {
  const out = runExcel(d, d.excel.model);
  check(`drill ${d.id} Excel model answer`, out.ok && same(out, key.expected[d.id], d.caseInsensitive), out.ok ? '' : out.error.message);
}
check('every drill with SQL has an Excel frame, hints and explanations', drills.filter((d) => d.sql).every((d) => d.excel && d.hint?.sql && d.hint?.excel && d.why?.sql && d.why?.excel));

// ---------- 4. pitfalls ----------

section('4. Every pitfall is computed and differs from the right answer');
const pit = (q) => key.pitfalls.find((x) => x.drill === q.drill && x.id === q.id && x.lang === q.lang);
for (const q of pitfalls) {
  const k = pit(q);
  const exp = key.expected[q.drill];
  const differs = !!k && (k.match === 'rows' ? k.row_count !== exp.rows.length : k.match === 'value' ? Math.abs(k.value - exp.rows[0][0]) > 0.01 : !same(k.result, exp, drills.find((d) => d.id === q.drill).caseInsensitive));
  check(`${q.lang} drill ${q.drill} ${q.id}${q.message ? '' : ' (verified only)'}`, differs);
}
const rowPits = pitfalls.filter((q) => q.match === 'rows');
check('no two row-count pitfalls on one drill and language share a count', rowPits.every((a) => rowPits.every((b) => a === b || a.drill !== b.drill || a.lang !== b.lang || pit(a).row_count !== pit(b).row_count)));
check('drill 7 in Excel without ROUND keeps extra rows, so its hint is reachable', pit({ drill: 7, id: 'no_round', lang: 'excel' }).row_count > key.expected[7].rows.length);

// ---------- 5. versions and rules ----------

section('5. Fingerprints and house rules');
const hash = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
check('SQL fingerprint matches the key', key.fingerprints.sql === hash({ expected: key.expected, sql: drills.map((d) => [d.id, d.ordered ?? null, !!d.caseInsensitive]) }));
check('Excel fingerprint matches the key and frames', key.fingerprints.excel === hash({ expected: key.expected, excel: drills.map((d) => [d.id, d.excel ? { ...d.excel, model: undefined } : null, !!d.caseInsensitive]) }));
check('text fingerprint matches the owner errors', key.fingerprints.text === hash({ owner_errors: calc.owner_errors }));

const COUNTED = '(rows?|voyages?|stoppages?|hours?|days?|periods?|fixtures?|columns?)';
const SPELLED = '(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const hardCodedCount = (t) => {
  // 24 hours a day, 60 minutes an hour, and 48 for despatch at half rate are
  // units, not counts
  const s = t.replace(/`[^`]*`/g, ' ').replace(/\b[A-Z][A-Z_]*\s*\([^()]*\)/g, ' ').replace(/\bdrills? \d+( (to|and) \d+)?/gi, ' ').replace(/\{\w+\}/g, ' ').replace(/\b(24|48|60)\b/g, ' ');
  return new RegExp(`\\b\\d[\\d,.]*\\s+${COUNTED}\\b`, 'i').test(s) || new RegExp(`\\b${SPELLED}\\s+${COUNTED}\\b`, 'i').test(s) || /\b\d{2,}/.test(s);
};
const ruleCases = [
  ['Multiply by 24 for hours.', false], ['Divide by 48, not 24.', false], ['J2/24 is turn time in days.', false],
  ['You kept {got} voyages.', false], ['Laytime used is 57 hours.', true], ['There are three voyages wrong.', true], ['Expected 12 rows.', true],
];
const ruleWrong = ruleCases.filter(([t, w]) => hardCodedCount(t) !== w);
check(`count rule behaves on ${ruleCases.length} sample sentences`, ruleWrong.length === 0, ruleWrong.map(([t]) => t).join(' | '));
const texts = [
  ...drills.flatMap((d) => [...Object.values(d.hint || {}), ...Object.values(d.why || {})].map((t) => [`drill ${d.id}`, t])),
  ...pitfalls.filter((q) => q.message).map((q) => [`${q.lang} ${q.drill}/${q.id}`, q.message]),
];
const counted = texts.filter(([, t]) => hardCodedCount(t));
check(`no hard-coded counts in ${texts.length} hint, explanation and pitfall templates`, counted.length === 0, counted.map(([l]) => l).join(', '));
check('every timed drill reuses earlier drills that have SQL and Excel', drills.filter((d) => d.timed).every((d) => d.timed.every((id) => drills.find((x) => x.id === id)?.sql)));

console.log(`\n${passes} passed, ${failures} failed.`);
process.exit(failures ? 1 : 0);
