// The laytime desk, slice 1: the profile store, the glossary and the
// briefings. Briefings are checked for every fixture, built from the same
// data and calc.mjs the drills use.

import { readFileSync } from 'node:fs';
import { createProfile, cleanName } from '../public/js/desk/profile.mjs';
import { glossary } from '../public/js/desk/glossary.mjs';
import { briefing, clauseFor, when } from '../public/js/desk/briefing.mjs';
import { calculate, workedExample, deductions } from '../public/js/laytime/calc.mjs';

const root = new URL('../public/', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
let fails = 0;
let n = 0;
const check = (label, ok, detail = '') => {
  n++;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

// ---------- profile ----------
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const s = mem();
const p = createProfile(() => s);
check('a new profile has no name and an empty ledger', p.name() === '' && p.ledger().length === 0);
check('a name is trimmed and saved', p.setName('  Josh   Haller ').ok && p.name() === 'Josh Haller');
check('an empty name is refused with a reason', !cleanName('   ').ok && /Type a name/.test(cleanName('   ').reason));
check('a name over the limit is refused', !cleanName('x'.repeat(17)).ok);
check('markup in a name is refused', !cleanName('<b>x</b>').ok);
p.record({ n: 0, score: 3 });
check('a settled run goes on the ledger with a time', p.ledger().length === 1 && p.ledger()[0].n === 0 && Boolean(p.ledger()[0].at));
const throwing = createProfile(() => { throw new Error('private window'); });
check('storage that throws reads as empty and writes nothing, without throwing', throwing.name() === '' && throwing.setName('Josh').ok && throwing.ledger().length === 0);
const old = mem();
old.setItem('findthebreaks:desk', JSON.stringify({ schema: 0, name: 'Old' }));
check('a profile saved under another schema is dropped', createProfile(() => old).name() === '');

// ---------- glossary ----------
const want = ['Laytime', 'Demurrage', 'Despatch', 'NOR', 'Turn time', 'SHEX EIU', 'SHEX UU', 'SHINC', 'Weather working day', 'WIBON', 'Working time saved', 'All time saved', 'Statement of facts'];
const have = glossary.map((g) => g.term);
check(`the glossary has every term asked for (${want.length})`, want.every((t) => have.includes(t)), want.filter((t) => !have.includes(t)).join(', '));
check('every glossary entry is one or two short sentences', glossary.every((g) => g.def.length <= 140 && (g.def.match(/\./g) || []).length <= 2));

// ---------- briefings ----------
const example = read('data/laytime-worked-example.json');
const defaults = read('config/laytime-defaults.json');
const data = read('data/laytime.json');
const w = workedExample(example, defaults);
const training = { n: 0, training: true, fixture: { ...w.fixture, vessel: 'Training cargo' }, stoppages: example.stoppages, result: w.result };
training.events = deductions(training.fixture, training.stoppages);
check('the training cargo briefing is about SHEX EIU worked through the window', clauseFor(training) === 'eiu_worked');
const tb = briefing(training);
check('the training briefing shows laytime allowed from calc.mjs', tb.terms.some(([k, v]) => k === 'Laytime allowed' && v.startsWith(`${w.result.allowed_min / 60} hrs`)));
check('the training briefing gives the NOR time, not the commencement', tb.terms.some(([k, v]) => k === 'NOR tendered' && v === 'Mon 1 Jun, 08:00') && !JSON.stringify(tb).includes(w.result.laytime_commenced));
const all = data.tables.fixtures.map((f) => {
  const st = data.tables.stoppages.filter((x) => x.voyage_id === f.voyage_id);
  return { n: 1, training: false, fixture: f, stoppages: st, result: calculate(f, st), events: deductions(f, st) };
});
const keys = all.map((it) => clauseFor(it));
const built = all.map((it) => briefing(it));
check(`every fixture gets a briefing (${all.length})`, built.every((b) => b.clause.title && b.clause.quote && b.terms.length === 10));
check('no briefing gives away when laytime commenced', all.every((it, i) => !JSON.stringify(built[i]).includes(when(it.result.laytime_commenced))));
check(`the fixtures teach more than one clause (${[...new Set(keys)].join(', ')})`, new Set(keys).size >= 4);
check('the WIBON clause is picked only where the fixture has a waiting for berth clause', all.every((it, i) => keys[i] !== 'wibon' || it.fixture.waiting_for_berth));

console.log(`\n${n - fails} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
