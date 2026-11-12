// Runs answers through the same SQL engine and checker the page uses and
// asserts the verdict and diagnosis each one gets. Exits non-zero on failure.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { drills, pitfalls } from '../public/js/drills/reconciliation.mjs';
import { compare, diagnose } from '../public/js/check.mjs';
import { createSqlEngine, NOT_IN_NOTE } from '../public/js/engines/sql.mjs';

const require = createRequire(import.meta.url);
const alasql = require('alasql');
const root = new URL('../public/', import.meta.url);
const data = JSON.parse(readFileSync(new URL('data/reconciliation.json', root), 'utf8'));
const key = JSON.parse(readFileSync(new URL('data/reconciliation.key.json', root), 'utf8'));
const engine = createSqlEngine(alasql, data.tables);
const drill = (id) => drills.find((d) => d.id === id);

function judge(id, sql) {
  const d = drill(id);
  const out = engine.run(sql);
  if (!out.ok) return { verdict: 'error', code: out.error.code, message: out.error.message };
  const exp = { ...key.expected[id], ordered: d.ordered };
  const res = compare(out, exp);
  const diag = diagnose(res, { drill: d, user: out, pitfalls: key.pitfalls.map((p) => ({ ...p, ...pitfalls.find((q) => q.drill === p.drill && q.id === p.id && q.lang === p.lang) })), lang: 'sql' });
  return { verdict: res.verdict, shapeOk: res.shapeOk, code: diag?.code, message: diag?.message, notes: out.notes.length };
}

let fails = 0;
const cases = [];
const expect = (label, id, sql, want) => cases.push({ label, id, sql, want });

// Every model answer is correct
for (const d of drills.filter((x) => x.sql)) expect(`drill ${d.id} model answer`, d.id, d.sql, { verdict: 'correct' });

// Every pitfall with a message is recognised as itself
for (const p of pitfalls.filter((x) => x.lang === 'sql' && x.message)) expect(`drill ${p.drill} pitfall ${p.id}`, p.drill, p.sql, { verdict: 'wrong', code: `pitfall:${p.id}` });

// Equivalent answers written differently must pass
expect('drill 1 columns reordered', 1, `SELECT bl_tonnage, cargo_id, vessel FROM cargoes WHERE load_port = 'Puerto Bolivar'`, { verdict: 'correct' });
expect('drill 1 lower case, double quotes, trailing semicolon', 1, `select cargo_id, vessel, bl_tonnage from cargoes where load_port = "Puerto Bolivar";`, { verdict: 'correct' });
expect('drill 2 different alias', 2, `SELECT counterparty, SUM(bl_tonnage) AS tonnes FROM cargoes GROUP BY counterparty ORDER BY tonnes DESC`, { verdict: 'correct' });
expect('drill 2 no alias, order by aggregate', 2, `SELECT counterparty, SUM(bl_tonnage) FROM cargoes GROUP BY counterparty ORDER BY SUM(bl_tonnage) DESC`, { verdict: 'correct' });
expect('drill 3 inner join is fine here', 3, `SELECT c.cargo_id, c.counterparty, p.country, p.payment_terms_days FROM cargoes c JOIN counterparties p ON c.counterparty = p.counterparty`, { verdict: 'correct' });
expect('drill 4 NOT IN', 4, `SELECT cargo_id, vessel, counterparty FROM cargoes WHERE cargo_id NOT IN (SELECT cargo_id FROM invoices)`, { verdict: 'correct' });
expect('drill 4 NOT EXISTS', 4, `SELECT c.cargo_id, c.vessel, c.counterparty FROM cargoes c WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.cargo_id = c.cargo_id)`, { verdict: 'correct' });
expect('drill 4 IS NULL on the join key', 4, `SELECT c.cargo_id, c.vessel, c.counterparty FROM cargoes c LEFT JOIN invoices i ON c.cargo_id = i.cargo_id WHERE i.cargo_id IS NULL`, { verdict: 'correct' });
expect('drill 6 COUNT of a column', 6, `SELECT cargo_id, COUNT(invoice_no) AS n FROM invoices GROUP BY cargo_id HAVING COUNT(invoice_no) > 1`, { verdict: 'correct' });
expect('drill 6 HAVING on alias', 6, `SELECT cargo_id, COUNT(*) AS n FROM invoices GROUP BY cargo_id HAVING n > 1`, { verdict: 'correct' });
expect('drill 8 without ROUND (float noise within tolerance)', 8, `SELECT c.cargo_id, c.contract_price, i.invoiced_price, i.invoiced_price - c.contract_price AS d FROM cargoes c JOIN invoices i ON c.cargo_id = i.cargo_id WHERE i.invoiced_price <> c.contract_price`, { verdict: 'correct' });
expect('drill 9 no ROUND', 9, `SELECT SUM(c.bl_tonnage * c.contract_price - inv.v) AS x FROM cargoes c JOIN (SELECT cargo_id, SUM(invoiced_tonnage * invoiced_price) AS v FROM invoices GROUP BY cargo_id) AS inv ON c.cargo_id = inv.cargo_id`, { verdict: 'correct' });

// Wrong answers get the right diagnosis
expect('drill 1 SELECT *', 1, `SELECT * FROM cargoes WHERE load_port = 'Puerto Bolivar'`, { verdict: 'wrong', code: 'extra_columns' });
expect('drill 1 wrong case in text', 1, `SELECT cargo_id, vessel, bl_tonnage FROM cargoes WHERE load_port = 'puerto bolivar'`, { verdict: 'wrong', code: 'empty' });
expect('drill 1 missing a column', 1, `SELECT cargo_id, vessel FROM cargoes WHERE load_port = 'Puerto Bolivar'`, { verdict: 'wrong', code: 'missing_columns' });
expect('drill 2 ascending', 2, `SELECT counterparty, SUM(bl_tonnage) AS t FROM cargoes GROUP BY counterparty ORDER BY t`, { verdict: 'wrong', code: 'wrong_order' });
expect('drill 2 no ORDER BY', 2, `SELECT counterparty, SUM(bl_tonnage) AS t FROM cargoes GROUP BY counterparty`, { verdict: 'wrong', code: 'wrong_order' });
expect('drill 2 AS total', 2, `SELECT counterparty, SUM(bl_tonnage) AS total FROM cargoes GROUP BY counterparty ORDER BY total DESC`, { verdict: 'error', code: 'parse' });
expect('drill 4 misspelt column', 4, `SELECT c.cargoid, c.vessel, c.counterparty FROM cargoes c LEFT JOIN invoices i ON c.cargo_id = i.cargo_id WHERE i.invoice_no IS NULL`, { verdict: 'error', code: 'no_column' });
expect('drill 4 upper case everything, NOT IN', 4, `SELECT CARGO_ID, VESSEL, COUNTERPARTY FROM CARGOES WHERE CARGO_ID NOT IN (SELECT CARGO_ID FROM INVOICES)`, { verdict: 'correct', notes: 0 });
expect('drill 4 mixed case aliases and columns', 4, `SELECT C.Cargo_Id, C.Vessel, C.Counterparty FROM Cargoes C LEFT JOIN Invoices I ON C.CARGO_ID = I.cargo_id WHERE I.Invoice_No IS NULL`, { verdict: 'correct' });
expect('drill 2 alias in different case in ORDER BY', 2, `SELECT counterparty, SUM(bl_tonnage) AS Tonnes FROM cargoes GROUP BY counterparty ORDER BY TONNES DESC`, { verdict: 'correct' });
expect('drill 1 upper case misspelling still errors', 1, `SELECT CARGOID, VESSEL, BL_TONNAGE FROM CARGOES WHERE LOAD_PORT = 'Puerto Bolivar'`, { verdict: 'error', code: 'no_column' });
expect('drill 4 singular table name', 4, `SELECT * FROM cargo`, { verdict: 'error', code: 'no_table' });
expect('drill 6 WHERE COUNT', 6, `SELECT cargo_id, COUNT(*) AS n FROM invoices WHERE COUNT(*) > 1 GROUP BY cargo_id`, { verdict: 'error', code: 'where_aggregate' });
expect('drill 7 BL minus invoiced', 7, `SELECT c.cargo_id, c.bl_tonnage, i.invoiced_tonnage, c.bl_tonnage - i.invoiced_tonnage AS d FROM cargoes c JOIN invoices i ON c.cargo_id = i.cargo_id WHERE i.invoiced_tonnage <> c.bl_tonnage`, { verdict: 'wrong', code: 'sign_flip' });
expect('drill 7 only the tonnage breaks, no difference column', 7, `SELECT c.cargo_id, c.bl_tonnage, i.invoiced_tonnage FROM cargoes c JOIN invoices i ON c.cargo_id = i.cargo_id WHERE i.invoiced_tonnage <> c.bl_tonnage`, { verdict: 'wrong', code: 'missing_columns' });
expect('drill 5 starting from cargoes', 5, `SELECT i.invoice_no, i.cargo_id, i.counterparty FROM cargoes c LEFT JOIN invoices i ON c.cargo_id = i.cargo_id WHERE i.invoice_no IS NULL`, { verdict: 'wrong' });
expect('drill 9 invoiced minus contract', 9, `SELECT SUM(inv.v - c.bl_tonnage * c.contract_price) AS x FROM cargoes c JOIN (SELECT cargo_id, SUM(invoiced_tonnage * invoiced_price) AS v FROM invoices GROUP BY cargo_id) AS inv ON c.cargo_id = inv.cargo_id`, { verdict: 'wrong', code: 'sign_flip' });
expect('a DELETE does not touch the data', 1, `DELETE FROM cargoes`, { verdict: 'error', code: 'not_select' });
expect('data intact after the DELETE', 1, drill(1).sql, { verdict: 'correct' });
expect('empty editor', 1, `   `, { verdict: 'error', code: 'empty' });
expect('unfinished query', 1, `SELECT cargo_id FROM cargoes WHERE`, { verdict: 'error', code: 'parse' });

// NOT IN with a NULL in the subquery: same query, data with one blank key
{
  const withNull = structuredClone(data.tables);
  withNull.invoices[0].cargo_id = null;
  const out = createSqlEngine(alasql, withNull).run(`SELECT cargo_id FROM cargoes WHERE cargo_id NOT IN (SELECT cargo_id FROM invoices)`);
  const ok = out.ok && out.notes.length === 1 && out.notes[0] === NOT_IN_NOTE;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  NOT IN note appears when the subquery column holds a NULL`);
  if (ok) console.log(`        "${out.notes[0]}"`);
  const plain = engine.run(`SELECT cargo_id FROM cargoes WHERE cargo_id NOT IN (SELECT cargo_id FROM invoices)`);
  const quiet = plain.ok && plain.notes.length === 0;
  if (!quiet) fails++;
  console.log(`${quiet ? 'PASS' : 'FAIL'}  NOT IN note stays off on the real data, which has no NULL cargo_id`);
}

for (const c of cases) {
  const got = judge(c.id, c.sql);
  const ok = Object.entries(c.want).every(([k, v]) => got[k] === v);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.label}  ->  ${got.verdict}${got.code ? ` [${got.code}]` : ''}`);
  if (got.message) console.log(`        "${got.message}"`);
  if (!ok) console.log(`        wanted ${JSON.stringify(c.want)}`);
}
console.log(`\n${cases.length + 2 - fails} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
