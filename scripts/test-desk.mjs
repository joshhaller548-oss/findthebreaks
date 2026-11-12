// The laytime desk, slice 1: the profile store, the glossary and the
// briefings. Briefings are checked for every fixture, built from the same
// data and calc.mjs the drills use.

import { readFileSync } from 'node:fs';
import { createProfile, cleanName } from '../public/js/desk/profile.mjs';
import { glossary } from '../public/js/desk/glossary.mjs';
import { briefing, clauseFor, when } from '../public/js/desk/briefing.mjs';
import { calculate, workedExample, deductions } from '../public/js/laytime/calc.mjs';
import { createRun, buildTickets } from '../public/js/desk/run.mjs';

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

// ---------- the desk run (slice 2) ----------
const playThrough = (item, pick = (tk) => tk.answer) => {
  const run = createRun(item);
  let guard = 0;
  while (!run.finished && guard++ < 10000) {
    if (run.advance(60) === 'ticket') {
      const tk = run.open;
      if (!run.call(pick(tk)).right) run.call(tk.answer);
    }
  }
  return run;
};
const everyone = [training, ...all];
const right = everyone.map((it) => playThrough(it));
check(`right calls reproduce calc.mjs laytime used on all ${everyone.length} cargoes`, right.every((r, i) => r.used === everyone[i].result.used_min), right.map((r, i) => r.used - everyone[i].result.used_min).join(' '));
check('right calls price to the same amount as calc.mjs, a difference of USD 0.00', right.every((r) => r.summary().difference_usd === 0 && r.summary().yours.amount_usd === r.item.result.amount_usd));
check('calculate() with the true excepted periods returns the true answer', everyone.every((it) => {
  const off = buildTickets(it).filter((t) => t.answer === 'off').map((t) => [t.start, t.end]);
  return JSON.stringify(calculate(it.fixture, it.stoppages, { excepted: off })) === JSON.stringify(it.result);
}));
const kinds = new Set(everyone.flatMap((it) => buildTickets(it).map((t) => `${t.kind}:${t.answer}`)));
check(`tickets cover every kind of call (${[...kinds].join(', ')})`, ['stoppage:off', 'stoppage:counts', 'shex:off', 'shex:counts'].every((k) => kinds.has(k)));
check('tickets arrive in time order and never overlap', everyone.every((it) => buildTickets(it).every((t, i, a) => i === 0 || a[i - 1].end <= t.start)));

const tt = buildTickets(training);
check('the training cargo brings two tickets: the rain and the Sunday', tt.length === 2 && tt[0].reason === 'rain' && tt[1].kind === 'shex' && tt[1].loading && tt.every((t) => t.answer === 'off'));
const wrongRain = playThrough(training, (tk) => (tk.reason === 'rain' ? 'counts' : tk.answer));
const ws = wrongRain.summary();
check('a wrong call is coached, then recast, and the statement still ends right', wrongRain.used === training.result.used_min && wrongRain.lines.length === 2 && !wrongRain.lines[0].firstTime);
// By those calls laytime runs out on Saturday, so the Sunday falls after
// expiry: once on demurrage, always on demurrage, and all 18 hours count
check(`counting the rain prices as demurrage USD ${ws.yours.amount_usd} against despatch USD ${training.result.amount_usd}, once on demurrage`, ws.yours.result === 'demurrage' && ws.yours.demurrage_after_exceptions && ws.yours.amount_usd === 18750 && ws.difference_usd === -19791.67);
check('the summary names the wrong call and scores the right ones', ws.wrong.length === 1 && ws.wrong[0].reason === 'rain' && ws.rightFirstTime === 1);
const early = createRun(training);
early.advance(60);
check('the clock does not count during turn time', early.phase() === 'turn time' && early.used === 0);

console.log(`\n${n - fails} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
