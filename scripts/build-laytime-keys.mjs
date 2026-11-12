// Builds the laytime drill answer key by running the SQL model answers in
// AlaSQL, and runs every pitfall, SQL and Excel, so each hint's trigger is
// computed. Writes public/data/laytime.drills.key.json.
//
// verify-laytime.mjs then checks this key against calc.mjs, and
// check_laytime.py checks it against its own minute count.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { drills, pitfalls, countsFor } from '../public/js/drills/laytime.mjs';
import { createSqlEngine } from '../public/js/engines/sql.mjs';
import { createExcelEngine } from '../public/js/engines/excel.mjs';
import { normValue, fill } from '../public/js/check.mjs';

const require = createRequire(import.meta.url);
const alasql = require('alasql');
const { HyperFormula } = require('hyperformula');
const root = new URL('../public/', import.meta.url);
const data = JSON.parse(readFileSync(new URL('data/laytime.json', root), 'utf8'));
const tables = data.tables;
const counts = countsFor(data);
const sql = createSqlEngine(alasql, tables);
const excel = createExcelEngine(HyperFormula, tables);

// Store results normalised: timestamps as 'YYYY-MM-DD HH:MM', money and
// hours as plain numbers
const tidy = (out) => ({ columns: out.columns, rows: out.rows.map((r) => r.map(normValue)) });

const runSql = (text, label) => {
  const out = sql.run(text);
  if (!out.ok) throw new Error(`${label}: ${out.error.message}`);
  return tidy(out);
};
const runExcel = (drillId, formulas, label) => {
  const frame = drills.find((d) => d.id === drillId).excel;
  const filled = Object.fromEntries(Object.entries(formulas).map(([k, f]) => [k, fill(f, counts)]));
  const out = excel.run(filled, frame);
  if (!out.ok) throw new Error(`${label}: ${out.error.message}`);
  return tidy(out);
};

const expected = {};
for (const d of drills.filter((x) => x.sql)) {
  expected[d.id] = { ordered: d.ordered, caseInsensitive: !!d.caseInsensitive, ...runSql(d.sql, `drill ${d.id} model answer`) };
}

const pitfallResults = pitfalls.map((p) => {
  const r = p.lang === 'excel' ? runExcel(p.drill, p.formulas, `drill ${p.drill} ${p.id}`) : runSql(p.sql, `drill ${p.drill} ${p.id}`);
  const out = { drill: p.drill, id: p.id, lang: p.lang, match: p.match, row_count: r.rows.length, column_count: r.columns.length };
  if (p.match === 'value') out.value = r.rows[0][0];
  if (p.match === 'result' || p.match === 'none') out.result = r;
  return out;
});

const hash = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const key = {
  generated_by: 'scripts/build-laytime-keys.mjs',
  engines: { sql: `alasql ${alasql.version}`, excel: `hyperformula ${HyperFormula.version}` },
  fingerprints: {
    sql: hash({ expected, sql: drills.map((d) => [d.id, d.ordered ?? null, !!d.caseInsensitive]) }),
    excel: hash({ expected, excel: drills.map((d) => [d.id, d.excel ? { ...d.excel, model: undefined } : null, !!d.caseInsensitive]) }),
    text: hash({ owner_errors: JSON.parse(readFileSync(new URL('data/laytime.key.json', root), 'utf8')).owner_errors }),
  },
  expected,
  pitfalls: pitfallResults,
};
writeFileSync(new URL('data/laytime.drills.key.json', root), JSON.stringify(key, null, 2) + '\n');
console.log(`Laytime drill key: ${Object.keys(expected).length} drills, ${pitfallResults.length} pitfalls, ${key.engines.sql} and ${key.engines.excel}.`);
