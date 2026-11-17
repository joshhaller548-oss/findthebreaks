// The laytime desk, playtest fixes (November 2026). One section per item in
// the playtest report, each checking the strings and numbers the player
// sees, built from the same data and calc.mjs the desk uses.

import { readFileSync } from 'node:fs';
import { calculate, workedExample, deductions } from '../public/js/laytime/calc.mjs';
import { hm, humanDates, hasIsoDate, cap } from '../public/js/desk/format.mjs';
import { briefing, termsLines, modelNote, recapNotes } from '../public/js/desk/briefing.mjs';
import { createRun, ownerTicket } from '../public/js/desk/run.mjs';

const root = new URL('../public/', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
let fails = 0;
let n = 0;
const check = (label, ok, detail = '') => {
  n++;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

// The cargoes, built the way fixtures.mjs builds them
const example = read('data/laytime-worked-example.json');
const defaults = read('config/laytime-defaults.json');
const data = read('data/laytime.json');
const key = read('data/laytime.key.json');
const w = workedExample(example, defaults);
const training = { n: 0, training: true, label: 'Training cargo', fixture: { ...w.fixture, vessel: 'Training cargo' }, stoppages: example.stoppages, result: w.result, owner: null };
training.events = deductions(training.fixture, training.stoppages);
const errs = Object.fromEntries(key.owner_errors.map((e) => [e.voyage_id, e]));
const owners = Object.fromEntries(data.tables.owner_statement.map((o) => [o.voyage_id, o]));
const all = data.tables.fixtures.map((f, i) => {
  const st = data.tables.stoppages.filter((x) => x.voyage_id === f.voyage_id);
  return { n: i + 1, training: false, label: `Fixture ${i + 1}`, fixture: f, stoppages: st, result: calculate(f, st), events: deductions(f, st), owner: owners[f.voyage_id], ownerError: errs[f.voyage_id] ?? null };
});
const everyone = [training, ...all];

// ---------- 1. the desk header ----------
check('clock hours are zero-padded (02:00, 00:30, 120:00)', hm(120) === '02:00' && hm(30) === '00:30' && hm(7200) === '120:00' && hm(-90) === '01:30');

// ---------- 4. model notes in the desk's own date format ----------
const note = errs['VOY-2603'].note;
check('a model note with a stoppage reads as one human span', humanDates(note).includes('from Sat 3 Oct, 12:30 to 20:30') && !hasIsoDate(humanDates(note)), humanDates(note));
check('every planted model note loses its ISO dates', key.owner_errors.every((e) => !hasIsoDate(humanDates(e.note))));
check('capitalising a sentence leaves the rest alone', cap('by your calls') === 'By your calls' && cap('') === '');

check('every desk model note is free of ISO dates', all.every((it) => !hasIsoDate(modelNote(it))));
check('the terms strip and the briefing name the weather working day basis the model notes use', all.every((it) => termsLines(it.fixture).some((t) => /weather working day/i.test(t)) && briefing(it).terms.some(([k, v]) => k === 'Load rate' && /per weather working day/.test(v))));

// ---------- 3. recap sentences start with a capital ----------
// Play a cargo to the end; pick(ticket) is the first call
const playThrough = (item, pick = (tk) => tk.answer) => {
  const run = createRun(item);
  for (let guard = 0; !run.finished && guard < 10000; guard++) {
    if (run.explaining) { run.explain('They counted time that should be off.', true); continue; }
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
const rainWrong = playThrough(training, (tk) => (tk.reason === 'rain' ? 'counts' : tk.answer));
const tNotes = recapNotes(rainWrong.summary(), training, null);
check('the once-on-demurrage note on a single cargo starts with a capital', tNotes.length === 1 && tNotes[0].text.startsWith('By your calls laytime ran out'), tNotes[0]?.text.slice(0, 40));
const sentences = all.flatMap((it) => recapNotes(playThrough(it).summary(), it, ownerTicket(it)));
check(`every recap sentence on a single cargo starts with a capital (${sentences.length})`, sentences.length >= 12 && sentences.every((x) => /^[A-Z]/.test(x.text)));
const named = recapNotes(playThrough(all[0]).summary(), all[0], ownerTicket(all[0]), 'Sea Falcon');
check('on a day, each sentence is led by the vessel name', named.every((x) => x.text.startsWith('Sea Falcon: ')));

console.log(`\n${n - fails} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
