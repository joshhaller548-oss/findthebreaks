// The laytime desk, slice 1: the profile store, the glossary and the
// briefings. Briefings are checked for every fixture, built from the same
// data and calc.mjs the drills use.

import { readFileSync } from 'node:fs';
import { createProfile, cleanName } from '../public/js/desk/profile.mjs';
import { glossary } from '../public/js/desk/glossary.mjs';
import { briefing, clauseFor, when } from '../public/js/desk/briefing.mjs';
import { calculate, workedExample, deductions, toMin } from '../public/js/laytime/calc.mjs';
import { createRun, buildTickets, startTicket, settleTicket, ownerTicket, POINTS, STRIKES } from '../public/js/desk/run.mjs';

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

// ---------- the desk run (slices 2 and 3) ----------
const key = read('data/laytime.key.json');
const errs = Object.fromEntries(key.owner_errors.map((e) => [e.voyage_id, e]));
const owners = Object.fromEntries(data.tables.owner_statement.map((o) => [o.voyage_id, o]));
for (const it of all) { it.owner = owners[it.fixture.voyage_id]; it.ownerError = errs[it.fixture.voyage_id] ?? null; }
const everyone = [training, ...all];

// Play a cargo to the end. pick(ticket) is the first call; a wrong one is
// recast with the right answer, unless the head has taken over.
const playThrough = (item, pick = (tk) => tk.answer, gotIt = true) => {
  const run = createRun(item);
  let guard = 0;
  while (!run.finished && guard++ < 10000) {
    if (run.explaining) { run.explain('They counted time that should be off.', gotIt); continue; }
    if (run.open) {
      const tk = run.open;
      if (run.takenOver) { run.headCall(); continue; }
      const r = run.call(pick(tk));
      if (!r.right) { if (run.takenOver) run.headCall(); else run.call(tk.answer); }
      continue;
    }
    run.advance(60);
  }
  return run;
};
const right = everyone.map((it) => playThrough(it));
check(`right calls reproduce calc.mjs laytime used on all ${everyone.length} cargoes`, right.every((r, i) => r.used === everyone[i].result.used_min), right.map((r, i) => r.used - everyone[i].result.used_min).join(' '));
check('right calls price to the same amount as calc.mjs, a difference of USD 0.00', right.every((r) => r.summary().difference_usd === 0 && r.summary().yours.amount_usd === r.item.result.amount_usd));
check('calculate() with the true excepted periods and commencement returns the true answer', everyone.every((it) => {
  const off = buildTickets(it).filter((t) => t.answer === 'off').map((t) => [t.start, t.end]);
  return JSON.stringify(calculate(it.fixture, it.stoppages, { excepted: off, commenced: toMin(it.result.laytime_commenced) })) === JSON.stringify(it.result);
}));
const kinds = new Set(everyone.flatMap((it) => buildTickets(it).map((t) => `${t.kind}:${t.answer}`)));
check(`time tickets cover every kind of call (${[...kinds].join(', ')})`, ['stoppage:off', 'stoppage:counts', 'shex:off', 'shex:counts'].every((k) => kinds.has(k)));
check('time tickets arrive in time order and never overlap', everyone.every((it) => buildTickets(it).every((t, i, a) => i === 0 || a[i - 1].end <= t.start)));

// Decision tickets
const starts = everyone.map((it) => startTicket(it));
check('every start ticket has three distinct options and exactly one right one, the engine\'s commencement', starts.every((t, i) => t.options.length === 3 && new Set(t.options.map((o) => o.at)).size === 3 && t.options.filter((o) => o.at === toMin(everyone[i].result.laytime_commenced)).length === 1 && t.options.find((o) => o.id === t.answer).at === toMin(everyone[i].result.laytime_commenced)));
check('every wrong start option carries coaching', starts.every((t) => t.options.every((o) => (o.id === t.answer) === (o.message === null))));
const settles = everyone.map((it) => settleTicket(it));
check('every settle ticket offers at least three amounts, the right one from calc.mjs', settles.every((t, i) => t.options.length >= 3 && t.options.find((o) => o.id === t.answer).amount === everyone[i].result.amount_usd && t.options.find((o) => o.id === t.answer).result === everyone[i].result.result));
check('no two settle options read the same', settles.every((t) => new Set(t.options.map((o) => o.label)).size === t.options.length));
const ownerTk = all.map((it) => ownerTicket(it));
const disputed = all.filter((it, i) => ownerTk[i].answer === 'dispute').map((it) => it.fixture.voyage_id).sort();
check(`the owner is disputed on exactly the planted errors (${disputed.join(', ')})`, JSON.stringify(disputed) === JSON.stringify(key.owner_errors.map((e) => e.voyage_id).sort()));
check('every disputed owner ticket carries the drill 8 model note', all.every((it, i) => ownerTk[i].answer !== 'dispute' || (ownerTk[i].error && ownerTk[i].error.note.length > 20)));
const decisionsPer = everyone.map((it) => createRun(it).steps.length);
check(`each cargo brings start, time, settle and owner decisions (${decisionsPer.join(', ')})`, decisionsPer.every((d, i) => d === buildTickets(everyone[i]).length + 2 + (everyone[i].owner ? 1 : 0)));

// The training cargo
const tt = buildTickets(training);
check('the training cargo brings two time tickets: the rain and the Sunday', tt.length === 2 && tt[0].reason === 'rain' && tt[1].kind === 'shex' && tt[1].loading && tt.every((t) => t.answer === 'off'));
const trainRun = createRun(training);
check('the training run opens on the start ticket at NOR, clock stopped', trainRun.open?.type === 'start' && trainRun.t === toMin(training.fixture.nor_tendered) && trainRun.advance(60) === 'ticket');
const wrongRain = playThrough(training, (tk) => (tk.reason === 'rain' ? 'counts' : tk.answer));
const ws = wrongRain.summary();
check('a wrong call is coached, then recast, and the statement still ends right', wrongRain.used === training.result.used_min && !wrongRain.lines.find((l) => l.reason === 'rain').firstTime);
check(`counting the rain prices as demurrage USD ${ws.yours.amount_usd} against despatch USD ${training.result.amount_usd}, once on demurrage`, ws.yours.result === 'demurrage' && ws.yours.demurrage_after_exceptions && ws.yours.amount_usd === 18750 && ws.difference_usd === -19791.67);
check('the summary names the wrong call and scores the rest', ws.wrong.length === 1 && ws.wrong[0].reason === 'rain' && ws.rightFirstTime === 3 && ws.stars === 2);
const fromNor = playThrough(training, (tk) => (tk.type === 'start' ? tk.options.find((o) => o.why === 'at NOR').id : tk.answer));
check('starting the clock at NOR is priced by calc.mjs with that commencement', fromNor.summary().yours.used_min === training.result.used_min + 12 * 60 && fromNor.summary().difference_usd < 0);
const early = createRun(training);
early.call(early.open.answer);
early.advance(60);
check('the clock does not count during turn time', early.phase() === 'turn time' && early.used === 0);

// Scoring and strikes
const perfect = right[0].summary();
check(`a clean training run scores ${perfect.score} with three stars`, perfect.stars === 3 && perfect.score === [0, 1, 2, 3].reduce((n, k) => n + POINTS.right + Math.min(POINTS.streakCap, POINTS.streakStep * k), 0));
check('the training cargo has no strike limit', createRun(training).strikesAllowed === Infinity);
const v5 = all.find((it) => it.fixture.voyage_id === 'VOY-2605');
const sloppy = playThrough(v5, (tk) => (tk.options ? tk.options.find((o) => o.id !== tk.answer).id : tk.type === 'time' ? (tk.answer === 'off' ? 'counts' : 'off') : tk.answer === 'agree' ? 'dispute' : 'agree'));
const ss = sloppy.summary();
check(`three strikes on a fixture and the head takes over (${ss.strikes} strikes, ${sloppy.lines.filter((l) => l.byHead).length} called by the head)`, ss.takenOver && ss.strikes === STRIKES && ss.stars === 0 && sloppy.lines.some((l) => l.byHead) && sloppy.used === v5.result.used_min);
const disputedRun = playThrough(v5);
check('disputing the owner asks for a sentence, then self-marking adds points', disputedRun.summary().explained?.gotIt === true && disputedRun.summary().score > right.find((r) => r.item === v5).summary().score - 1);
const honest = playThrough(v5, (tk) => tk.answer, false);
check('marking your own sentence as not quite adds nothing', honest.summary().score === disputedRun.summary().score - POINTS.explained);

console.log(`\n${n - fails} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
