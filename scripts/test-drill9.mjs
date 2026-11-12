// Drill 9 worked out by hand, from the raw data only. No SQL engine, no
// checker, no answer key. Money is in integer cents, so there is no
// floating point anywhere: tonnage is whole tonnes and every price has two
// decimal places, so tonnage x price-in-cents is exact.

import { readFileSync } from 'node:fs';

const { cargoes, invoices } = JSON.parse(readFileSync(new URL('../public/data/reconciliation.json', import.meta.url), 'utf8')).tables;

const cents = (price) => {
  const c = Math.round(price * 100);
  if (Math.abs(c - price * 100) > 1e-6) throw new Error(`price ${price} has more than two decimals`);
  return c;
};
const usd = (c) => `${c < 0 ? '-' : ''}${(Math.abs(c) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`;

const book = new Map(cargoes.map((c) => [c.cargo_id, c]));
const invoicedCents = new Map();
for (const i of invoices) {
  if (!book.has(i.cargo_id)) continue;
  invoicedCents.set(i.cargo_id, (invoicedCents.get(i.cargo_id) || 0) + i.invoiced_tonnage * cents(i.invoiced_price));
}

// Per cargo: contract value minus everything invoiced against it
let perCargo = 0;
const lines = [];
for (const [id, inv] of invoicedCents) {
  const c = book.get(id);
  const diff = c.bl_tonnage * cents(c.contract_price) - inv;
  perCargo += diff;
  if (diff !== 0) lines.push([id, diff]);
}

// Row by row, for contrast: the duplicate cancels itself out
let rowByRow = 0;
for (const i of invoices) {
  const c = book.get(i.cargo_id);
  if (c) rowByRow += c.bl_tonnage * cents(c.contract_price) - i.invoiced_tonnage * cents(i.invoiced_price);
}

console.log('Cargoes where contract and invoiced value differ:');
for (const [id, d] of lines) console.log(`  ${id}  ${usd(d).padStart(16)}`);
console.log(`  ${'total'.padEnd(8)}  ${usd(perCargo).padStart(16)}`);
console.log(`Row by row join gives ${usd(rowByRow)}`);

const EXPECTED = -660223390; // USD -6,602,233.90, confirmed by hand by the site owner
const EXPECTED_ROW_BY_ROW = -80549020; // USD -805,490.20
let fails = 0;
const check = (label, ok) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};
check('drill 9 per cargo is USD -6,602,233.90 to the cent', perCargo === EXPECTED);
check('row by row join is USD -805,490.20 to the cent', rowByRow === EXPECTED_ROW_BY_ROW);
check('the gap between the two is exactly one cargo invoiced twice', (() => {
  const dup = [...new Set(invoices.map((i) => i.cargo_id))].filter((id) => invoices.filter((i) => i.cargo_id === id).length > 1);
  if (dup.length !== 1) return false;
  const c = book.get(dup[0]);
  return rowByRow - perCargo === c.bl_tonnage * cents(c.contract_price);
})());
process.exit(fails ? 1 : 0);
