// Laytime drills: answers in SQL and Excel go through the same engines and
// checker the page uses. Asserts the verdict and diagnosis for each.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { drills, pitfalls, countsFor } from '../public/js/drills/laytime.mjs';
import { compare, diagnose, fill } from '../public/js/check.mjs';
import { createSqlEngine } from '../public/js/engines/sql.mjs';
import { createExcelEngine } from '../public/js/engines/excel.mjs';
import { excelLanguage } from '../public/js/languages/excel.mjs';

const require = createRequire(import.meta.url);
const alasql = require('alasql');
const { HyperFormula } = require('hyperformula');
const root = new URL('../public/', import.meta.url);
const data = JSON.parse(readFileSync(new URL('data/laytime.json', root), 'utf8'));
const key = JSON.parse(readFileSync(new URL('data/laytime.drills.key.json', root), 'utf8'));
const counts = countsFor(data);
const sql = createSqlEngine(alasql, data.tables);
const excel = createExcelEngine(HyperFormula, data.tables);
const drill = (id) => drills.find((d) => d.id === id);
const merged = key.pitfalls.map((p) => ({ ...p, ...pitfalls.find((q) => q.drill === p.drill && q.id === p.id && q.lang === p.lang) }));

function judge(lang, id, answer) {
  const d = drill(id);
  const out = lang === 'sql' ? sql.run(answer) : excel.run(Object.fromEntries(Object.entries(answer).map(([k, f]) => [k, fill(f, counts)])), d.excel);
  if (!out.ok) return { verdict: 'error', code: out.error.code, message: out.error.message };
  const exp = { ...key.expected[id], ordered: lang === 'excel' ? excelLanguage.ordered(d) : d.ordered };
  const res = compare(out, exp);
  const diag = diagnose(res, { drill: d, user: out, pitfalls: merged, lang, generic: lang === 'excel' ? excelLanguage.generic : {}, counts });
  return { verdict: res.verdict, code: diag?.code, message: diag?.message, notes: out.notes?.length ?? 0 };
}

const cases = [];
const expect = (label, lang, id, answer, want) => cases.push({ label, lang, id, answer, want });
const M = (id) => drill(id).excel.model;

for (const d of drills.filter((x) => x.sql)) {
  expect(`drill ${d.id} SQL model answer`, 'sql', d.id, d.sql, { verdict: 'correct' });
  expect(`drill ${d.id} Excel model answer`, 'excel', d.id, d.excel.model, { verdict: 'correct' });
}
for (const p of pitfalls.filter((x) => x.message)) {
  expect(`drill ${p.drill} ${p.lang} pitfall ${p.id}`, p.lang, p.drill, p.lang === 'sql' ? p.sql : p.formulas, { verdict: 'wrong', code: `pitfall:${p.id}` });
}

// Correct answers written differently
expect('drill 1 SQL, hours first', 'sql', 1, 'SELECT voyage_id, 24 * cargo_mt / load_rate_mt_per_day AS hours FROM fixtures', { verdict: 'correct' });
expect('drill 2 SQL, CASE the other way round, upper case', 'sql', 2, 'SELECT F.VOYAGE_ID, CASE WHEN F.LOADING_COMMENCED < DATEADD(hour, F.TURN_TIME_HRS, F.NOR_TENDERED) THEN F.LOADING_COMMENCED ELSE DATEADD(hour, F.TURN_TIME_HRS, F.NOR_TENDERED) END AS STARTED FROM FIXTURES F', { verdict: 'correct' });
expect('drill 2 SQL, turn time added in minutes', 'sql', 2, 'SELECT voyage_id, CASE WHEN DATEADD(minute, turn_time_hrs * 60, nor_tendered) < loading_commenced THEN DATEADD(minute, turn_time_hrs * 60, nor_tendered) ELSE loading_commenced END AS c FROM fixtures', { verdict: 'correct' });
expect('drill 4 SQL, WHERE NOT on an inner join', 'sql', 4, 'SELECT s.voyage_id, SUM(DATEDIFF(minute, s.start_time, s.end_time)) / 60 AS h FROM stoppages s WHERE NOT s.counts_against_laytime GROUP BY s.voyage_id', { verdict: 'correct' });
expect('drill 7 SQL, ROUND before comparing', 'sql', 7, drill(7).sql.replace('WHERE o.laytime_used_hrs <> t.laytime_used_hrs', 'WHERE ROUND(o.laytime_used_hrs - t.laytime_used_hrs, 2) <> 0'), { verdict: 'correct' });
expect('drill 1 Excel, 24 first', 'excel', 1, { laytime_allowed_hrs: '=24*C2/D2' }, { verdict: 'correct' });
expect('drill 2 Excel, IF instead of MIN', 'excel', 2, { laytime_commenced: '=IF(L2<K2+J2/24, L2, K2+J2/24)' }, { verdict: 'correct' });
expect('drill 2 Excel, TIME for the turn time', 'excel', 2, { laytime_commenced: '=MIN(K2+TIME(J2,0,0), L2)' }, { verdict: 'correct' });
expect('drill 4 Excel, SUMPRODUCT with double negatives', 'excel', 4, { deductible_stoppage_hrs: '=SUMPRODUCT(--(stoppages!$A$2:$A${st_last}=A2), --(stoppages!$E$2:$E${st_last}=FALSE), stoppages!$C$2:$C${st_last}-stoppages!$B$2:$B${st_last})*24' }, { verdict: 'correct' });
expect('drill 5 Excel, capitalised labels', 'excel', 5, { ...M(5), result: '=IF(Q2>C2/D2*24, "Demurrage", "Despatch")' }, { verdict: 'correct' });
expect('drill 6 Excel, ROUND on the amount', 'excel', 6, { ...M(6), amount_usd: `=ROUND(${M(6).amount_usd.slice(1)}, 2)` }, { verdict: 'correct' });
expect('drill 7 Excel, keep on a tolerance', 'excel', 7, { ...M(7), difference_hrs: '=R2-Q2', keep: '=ABS(S2)>0.01' }, { verdict: 'correct' });

// Errors and other wrong answers
expect('drill 3 SQL, a misspelt column', 'sql', 3, 'SELECT voyage_id, DATEDIFF(minute, nor_tendred, loading_completed) / 60 AS h FROM fixtures', { verdict: 'error', code: 'no_column' });
expect('drill 3 SQL, end as a column name', 'sql', 3, 'SELECT voyage_id, end FROM stoppages', { verdict: 'error', code: 'parse' });
expect('drill 7 SQL, yours minus the owner', 'sql', 7, drill(7).sql.replace('o.laytime_used_hrs - t.laytime_used_hrs AS difference_hrs', 't.laytime_used_hrs - o.laytime_used_hrs AS difference_hrs'), { verdict: 'wrong', code: 'sign_flip' });
expect('drill 2 Excel, refers to the header row', 'excel', 2, { laytime_commenced: '=MIN(K1+J1/24, L1)' }, { verdict: 'error', code: 'header_row' });
expect('drill 4 Excel, misspelt sheet', 'excel', 4, { deductible_stoppage_hrs: '=SUMPRODUCT((stoppage!$A$2:$A${st_last}=A2)*1)' }, { verdict: 'error', code: 'cell_REF' });
expect('drill 5 Excel, result left blank', 'excel', 5, { ...M(5), result: '' }, { verdict: 'error', code: 'empty' });

let fails = 0;
for (const c of cases) {
  const got = judge(c.lang, c.id, c.answer);
  const ok = Object.entries(c.want).every(([k, v]) => got[k] === v);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.label}  ->  ${got.verdict}${got.code ? ` [${got.code}]` : ''}`);
  if (got.message && (!ok || /pitfall|error|sign/.test(got.code || got.verdict))) console.log(`        "${got.message}"`);
  if (!ok) console.log(`        wanted ${JSON.stringify(c.want)}`);
}
console.log(`\n${cases.length - fails} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
