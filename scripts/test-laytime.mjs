// The JS laytime calculator against the worked example from the brief, and
// against its own committed key. check_laytime.py checks the same figures
// independently in Python.

import { readFileSync } from 'node:fs';
import { calculate, workedExample, dhm, parseWindow } from '../public/js/laytime/calc.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8'));
const defaults = read('config/laytime-defaults.json');
const example = read('data/laytime-worked-example.json');
const data = read('data/laytime.json').tables;
const key = read('data/laytime.key.json');

let fails = 0;
let count = 0;
const check = (label, ok, detail = '') => {
  count++;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const base = workedExample(example, defaults).result;
check('defaults are SHEX EIU, working time saved, Sun 00:00 to 24:00', defaults.shex_basis === 'SHEX EIU' && defaults.despatch_basis === 'working time saved' && defaults.shex_window === 'Sun 00:00 to 24:00');
check('worked example commenced Mon 1 Jun 20:00', base.laytime_commenced === '2026-06-01 20:00');
check('worked example used 4d 22h', base.used_min === 4 * 1440 + 22 * 60, dhm(base.used_min));
check('worked example despatch USD 1,041.67 under SHEX EIU', base.result === 'despatch' && base.amount_usd === 1041.67, String(base.amount_usd));
const uu = workedExample(example, defaults, example.contrast).result;
check('contrast panel: demurrage USD 12,500 under SHEX UU', uu.result === 'demurrage' && uu.amount_usd === 12500, String(uu.amount_usd));
check('all time saved: USD 6,250.00', workedExample(example, defaults, { despatch_basis: 'all time saved' }).result.amount_usd === 6250);
check('Sat 17:00 to Mon 08:00, working time saved: USD 4,687.50', workedExample(example, defaults, { shex_window: 'Sat 17:00 to Mon 08:00' }).result.amount_usd === 4687.5);
check('Sat 17:00 to Mon 08:00, all time saved: USD 14,062.50', workedExample(example, defaults, { shex_window: 'Sat 17:00 to Mon 08:00', despatch_basis: 'all time saved' }).result.amount_usd === 14062.5);

check('window parser: Sun 00:00 to 24:00 is one day', (({ start, end }) => end - start === 1440)(parseWindow('Sun 00:00 to 24:00')));
check('window parser: Sat 17:00 to Mon 08:00 is 39 hours across the week boundary', (({ start, end }) => end - start === 39 * 60)(parseWindow('Sat 17:00 to Mon 08:00')));
let threw = false;
try { parseWindow('Sunday all day'); } catch { threw = true; }
check('window parser refuses text it cannot read', threw);

const fresh = data.fixtures.every((f) => JSON.stringify(calculate(f, data.stoppages)) === JSON.stringify(key.voyages[f.voyage_id]));
check('the committed key matches a fresh run of the calculator on the committed data', fresh);

console.log(`\n${count - fails} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
