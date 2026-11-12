// Excel tab: answers go through the same HyperFormula engine and checker
// the page uses. Asserts the verdict and diagnosis for each. Exits non-zero
// on failure.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { drills, pitfalls } from '../public/js/drills/reconciliation.mjs';
import { compare, diagnose, countsFrom, fill } from '../public/js/check.mjs';
import { createExcelEngine } from '../public/js/engines/excel.mjs';
import { excelLanguage } from '../public/js/languages/excel.mjs';

const require = createRequire(import.meta.url);
const { HyperFormula } = require('hyperformula');
const root = new URL('../public/', import.meta.url);
const data = JSON.parse(readFileSync(new URL('data/reconciliation.json', root), 'utf8'));
const key = JSON.parse(readFileSync(new URL('data/reconciliation.key.json', root), 'utf8'));
const engine = createExcelEngine(HyperFormula, data.tables);
const counts = countsFrom(data, key);
const drill = (id) => drills.find((d) => d.id === id);
const merged = key.pitfalls.map((p) => ({ ...p, ...pitfalls.find((q) => q.drill === p.drill && q.id === p.id && q.lang === p.lang) }));

function judge(id, formulas) {
  const d = drill(id);
  const filled = Object.fromEntries(Object.entries(formulas).map(([k, f]) => [k, fill(f, counts)]));
  const out = engine.run(filled, d.excel);
  if (!out.ok) return { verdict: 'error', code: out.error.code, message: out.error.message, notes: 0 };
  const exp = { ...key.expected[id], ordered: excelLanguage.ordered(d) };
  const res = compare(out, exp);
  const diag = diagnose(res, { drill: d, user: out, pitfalls: merged, lang: 'excel', generic: excelLanguage.generic, counts });
  return { verdict: res.verdict, code: diag?.code, message: diag?.message, notes: out.notes.length, note: out.notes[0] };
}

const cases = [];
const expect = (label, id, formulas, want) => cases.push({ label, id, formulas, want });
const LOOK_BL = '=VLOOKUP(B2, cargoes!$A:$F, 6, FALSE)';
const LOOK_CP = '=VLOOKUP(B2, cargoes!$A:$J, 10, FALSE)';

// Every model answer is correct
for (const d of drills.filter((x) => x.excel)) expect(`drill ${d.id} model answer`, d.id, d.excel.model, { verdict: 'correct' });

// Every Excel pitfall with a message is recognised as itself
for (const p of pitfalls.filter((x) => x.lang === 'excel' && x.message)) expect(`drill ${p.drill} pitfall ${p.id}`, p.drill, p.formulas, { verdict: 'wrong', code: `pitfall:${p.id}` });

// Correct answers written differently
expect('drill 1 lower case, as Excel ignores capitals in text', 1, { keep: '=d2="puerto bolivar"' }, { verdict: 'correct' });
expect('drill 1 IF returning TRUE and FALSE', 1, { keep: '=IF(D2="Puerto Bolivar", TRUE, FALSE)' }, { verdict: 'correct' });
expect('drill 1 IF returning 1 and 0, with semicolons', 1, { keep: '=IF(D2="Puerto Bolivar";1;0)' }, { verdict: 'correct' });
expect('drill 1 IF returning text', 1, { keep: '=IF(D2="Puerto Bolivar","yes","")' }, { verdict: 'correct' });
expect('drill 1 curly quotes from a phone keyboard', 1, { keep: '=D2=“Puerto Bolivar”' }, { verdict: 'correct' });
expect('drill 1 EXACT', 1, { keep: '=EXACT(D2, "Puerto Bolivar")' }, { verdict: 'correct' });
expect('drill 1 COUNTIF on one cell', 1, { keep: '=COUNTIF(D2, "Puerto Bolivar")' }, { verdict: 'correct' });
expect('drill 2 SUMIF', 2, { total_tonnage: '=SUMIF(cargoes!C:C, A2, cargoes!F:F)' }, { verdict: 'correct' });
expect('drill 2 SUMIFS on bounded ranges', 2, { total_tonnage: '=SUMIFS(cargoes!$F$2:$F${cg_last}, cargoes!$C$2:$C${cg_last}, A2)' }, { verdict: 'correct' });
expect('drill 2 SUMPRODUCT', 2, { total_tonnage: '=SUMPRODUCT((cargoes!$C$2:$C${cg_last}=A2)*cargoes!$F$2:$F${cg_last})' }, { verdict: 'correct' });
expect('drill 2 lower case function and sheet', 2, { total_tonnage: '=sumifs(Cargoes!f:f, Cargoes!c:c, a2)' }, { verdict: 'correct' });
expect('drill 3 INDEX and MATCH', 3, { country: '=INDEX(counterparties!$B:$B, MATCH($C2, counterparties!$A:$A, 0))', payment_terms_days: '=INDEX(counterparties!$D:$D, MATCH($C2, counterparties!$A:$A, 0))' }, { verdict: 'correct' });
expect('drill 3 XLOOKUP', 3, { country: '=XLOOKUP(C2, counterparties!A:A, counterparties!B:B)', payment_terms_days: '=XLOOKUP(C2, counterparties!A:A, counterparties!D:D)' }, { verdict: 'correct' });
expect('drill 3 VLOOKUP with 0 and IFERROR', 3, { country: '=IFERROR(VLOOKUP(C2, counterparties!A:D, 2, 0), "")', payment_terms_days: '=IFERROR(VLOOKUP(C2, counterparties!A:D, 4, 0), "")' }, { verdict: 'correct' });
expect('drill 4 ISNA MATCH', 4, { keep: '=ISNA(MATCH(A2, invoices!B:B, 0))' }, { verdict: 'correct' });
expect('drill 4 NOT ISNUMBER MATCH', 4, { keep: '=NOT(ISNUMBER(MATCH(A2, invoices!B:B, 0)))' }, { verdict: 'correct' });
expect('drill 4 IF COUNTIF returning text', 4, { keep: '=IF(COUNTIF(invoices!B:B, A2)=0, "MISSING", "")' }, { verdict: 'correct' });
expect('drill 4 COUNTIFS on a bounded range', 4, { keep: '=COUNTIFS(invoices!$B$2:$B${inv_last}, A2)<1' }, { verdict: 'correct' });
expect('drill 4 ISERROR VLOOKUP', 4, { keep: '=ISERROR(VLOOKUP(A2, invoices!B:B, 1, FALSE))' }, { verdict: 'correct' });
expect('drill 5 ISNA MATCH', 5, { keep: '=ISNA(MATCH(B2, cargoes!A:A, 0))' }, { verdict: 'correct' });
expect('drill 6 keep tests the count directly', 6, { invoice_count: '=COUNTIF(invoices!B:B, A2)', keep: '=COUNTIF(invoices!B:B, A2)>=2' }, { verdict: 'correct' });
expect('drill 7 INDEX MATCH and keep on the raw columns', 7, { bl_tonnage: '=INDEX(cargoes!F:F, MATCH(B2, cargoes!A:A, 0))', difference_mt: '=D2-G2', keep: '=D2<>G2' }, { verdict: 'correct', notes: 1 });
expect('drill 7 SUMIFS with an orphan guard', 7, { bl_tonnage: '=SUMIFS(cargoes!F:F, cargoes!A:A, B2)', difference_mt: '=D2-G2', keep: '=AND(COUNTIF(cargoes!A:A, B2)>0, H2<>0)' }, { verdict: 'correct', notes: 0 });
expect('drill 8 ROUND and XLOOKUP', 8, { contract_price: '=XLOOKUP(B2, cargoes!A:A, cargoes!J:J)', difference_usd_per_mt: '=ROUND(E2-G2, 2)', keep: '=H2<>0' }, { verdict: 'correct' });
expect('drill 9 one formula in the total cell, no helper', 9, { total: '=SUMPRODUCT((COUNTIF(invoices!$B$2:$B${inv_last},cargoes!$A$2:$A${cg_last})>0)*cargoes!$F$2:$F${cg_last}*cargoes!$J$2:$J${cg_last})-SUMPRODUCT((COUNTIF(cargoes!$A$2:$A${cg_last},invoices!$B$2:$B${inv_last})>0)*invoices!$D$2:$D${inv_last}*invoices!$E$2:$E${inv_last})' }, { verdict: 'correct' });

// Wrong answers and errors get a targeted message
expect('drill 4 bare MATCH gets the count hint, and a note on the #N/A rows', 4, { keep: '=MATCH(A2, invoices!$B:$B, 0)' }, { verdict: 'wrong', code: 'pitfall:count_not_zero', notes: 1 });
expect('drill 1 text without quotes', 1, { keep: '=D2=Puerto Bolivar' }, { verdict: 'error' });
expect('drill 1 no equals sign', 1, { keep: 'D2="Puerto Bolivar"' }, { verdict: 'error', code: 'no_equals' });
expect('drill 1 refers to the header row', 1, { keep: '=D1="Puerto Bolivar"' }, { verdict: 'error', code: 'header_row' });
expect('drill 1 misspelt function', 1, { keep: '=EXCAT(D2, "Puerto Bolivar")' }, { verdict: 'error', code: 'unknown_function' });
expect('drill 1 nothing written', 1, { keep: '' }, { verdict: 'error', code: 'empty' });
expect('drill 4 sheet name misspelt', 4, { keep: '=COUNTIF(invoice!B:B, A2)=0' }, { verdict: 'error', code: 'cell_REF' });
expect('drill 3 lookup in the wrong column', 3, { country: '=VLOOKUP(C2, counterparties!B:D, 1, FALSE)', payment_terms_days: '=VLOOKUP(C2, counterparties!A:D, 4, FALSE)' }, { verdict: 'error', code: 'cell_NA' });
expect('drill 2 ranges of different sizes', 2, { total_tonnage: '=SUMIFS(cargoes!F2:F31, cargoes!C2:C30, A2)' }, { verdict: 'error', code: 'cell_VALUE' });
expect('drill 9 whole columns inside SUMPRODUCT', 9, { difference: '=IF(COUNTIF(invoices!B:B, A2)=0, 0, F2*J2-SUMPRODUCT((invoices!B:B=A2)*invoices!D:D*invoices!E:E))', total: '=SUM(K2:K{cg_last})' }, { verdict: 'error', code: 'cell_VALUE' });
expect('drill 9 total over the whole column includes itself', 9, { difference: drill(9).excel.model.difference, total: '=SUM(K:K)' }, { verdict: 'error', code: 'cell_CYCLE' });
expect('drill 7 BL minus invoiced', 7, { bl_tonnage: LOOK_BL, difference_mt: '=G2-D2', keep: '=H2<>0' }, { verdict: 'wrong', code: 'sign_flip' });
expect('drill 8 contract minus invoiced', 8, { contract_price: LOOK_CP, difference_usd_per_mt: '=G2-E2', keep: '=H2<>0' }, { verdict: 'wrong', code: 'sign_flip' });
expect('drill 6 keep column missing', 6, { invoice_count: '=COUNTIF(invoices!B:B, A2)', keep: '' }, { verdict: 'error', code: 'empty' });
expect('drill 6 counted in the wrong sheet', 6, { invoice_count: '=COUNTIF(cargoes!A:A, A2)', keep: '=K2>1' }, { verdict: 'wrong', code: 'empty' });

let fails = 0;
for (const c of cases) {
  const got = judge(c.id, c.formulas);
  const ok = Object.entries(c.want).every(([k, v]) => got[k] === v);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.label}  ->  ${got.verdict}${got.code ? ` [${got.code}]` : ''}`);
  if (got.message) console.log(`        "${got.message}"`);
  if (got.note && (c.want.notes || !ok)) console.log(`        note: "${got.note}"`);
  if (!ok) console.log(`        wanted ${JSON.stringify(c.want)}`);
}
console.log(`\n${cases.length - fails} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
