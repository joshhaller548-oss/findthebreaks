// The laytime desk, playtest fixes (November 2026). One section per item in
// the playtest report, each checking the strings and numbers the player
// sees, built from the same data and calc.mjs the desk uses.

import { readFileSync } from 'node:fs';
import { calculate, workedExample, deductions } from '../public/js/laytime/calc.mjs';
import { hm, humanDates, hasIsoDate, cap } from '../public/js/desk/format.mjs';
import { briefing, dayBriefing, termsLines, modelNote, recapNotes, STRIKE_RULE, TRAINING_EXCEPTION, OWNER_STEP } from '../public/js/desk/briefing.mjs';
import { createRun, ownerTicket, buildTickets, settleTicket, DAYS, ARRIVAL_GAP } from '../public/js/desk/run.mjs';
import { stamp, span, hrs, USD } from '../public/js/desk/format.mjs';
import { fromMin, toMin } from '../public/js/laytime/calc.mjs';

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

// ---------- 5, 12, 17. briefings: one strike rule, terms and rules only ----------
const dayLanesOf = (k) => DAYS[k - 1].map((m, i) => ({ item: all[m - 1], offset: i * ARRIVAL_GAP }));
const days = DAYS.map((_, i) => dayBriefing(dayLanesOf(i + 1)));
const tb = briefing(training);
check('the training briefing states the strike rule and its one exception', tb.targets.includes(`${STRIKE_RULE} ${TRAINING_EXCEPTION}`));
check('every fixture briefing states the same strike rule', all.every((it) => briefing(it).targets.includes(STRIKE_RULE)));
check('every day briefing states the same strike rule', days.every((d) => d.steps.includes(STRIKE_RULE)));
check('every day briefing warns that the owner’s statement and a dispute come at the end of each vessel', days.every((d) => d.steps.includes(OWNER_STEP)) && /owner’s statement/.test(OWNER_STEP) && /Dispute/.test(OWNER_STEP));

// What a ticket's answer would look like if a briefing gave it away: when
// laytime starts, any ticket's times, what was settled, the hours used, and
// any sentence that says what happened (they loaded, she waited, it rained
// on the weekend, she finished early)
const FACTS = /\b(loaded|loads? (right )?through|loading carr(y|ies|ied) on|carr(y|ies|ied) on|kept loading|nobody (loaded|worked)|they worked|worked (the|right|through)|she waited|queue(d|ing)?|finish(es|ed)? early|ran out|holiday stoppage|same rain|doesn.t matter)\b/i;
function giveaways(text, item) {
  const found = [];
  const r = item.result;
  const steps = createRun(item).steps;
  for (const s of [stamp(toMin(r.laytime_commenced)), r.laytime_commenced]) if (text.includes(s)) found.push(`commencement ${s}`);
  for (const t of buildTickets(item)) {
    for (const s of [span(t.start, t.end), stamp(t.start), stamp(t.end), fromMin(t.start), fromMin(t.end)]) if (text.includes(s)) found.push(`ticket time ${s}`);
  }
  const settle = settleTicket(item);
  const right = settle.options.find((o) => o.id === settle.answer);
  if (r.amount_usd && text.includes(USD.format(r.amount_usd))) found.push(`amount ${right.label}`);
  if (text.includes(`${hrs(r.used_min)} hrs`)) found.push(`hours used ${hrs(r.used_min)}`);
  if (steps.some((t) => t.type === 'owner') && /owner(’s|'s)? (statement )?(is|was) (right|wrong|correct)|owner (made|got)/i.test(text)) found.push('the owner check');
  const fact = FACTS.exec(text);
  if (fact) found.push(`says what happens: "${fact[0]}"`);
  return found;
}
const leaks = [];
for (const it of everyone) for (const g of giveaways(JSON.stringify(briefing(it)), it)) leaks.push(`${it.label}: ${g}`);
DAYS.forEach((ns, i) => {
  // Only the words on screen, not the cargo objects the briefing carries
  const text = JSON.stringify(days[i], (k, v) => (k === 'item' ? undefined : v));
  for (const m of ns) for (const g of giveaways(text, all[m - 1])) leaks.push(`Day ${i + 1}, ${all[m - 1].fixture.vessel}: ${g}`);
});
check(`no briefing reveals any ticket's answer (${everyone.length} cargoes, ${DAYS.length} days)`, leaks.length === 0, leaks.slice(0, 4).join('; '));
// The check itself has teeth: the old briefing lines are caught
const old4 = 'Loading carries on through Sat 17:00 to Mon 08:00. Under EIU that window is off the clock anyway.';
const oldTraining = 'They loaded right through Sun 00:00 to 24:00. Doesn’t matter. Under EIU that window is off the clock.';
check('the no-reveal check catches the old training and Fixture 4 lines', giveaways(old4, all[3]).length > 0 && giveaways(oldTraining, training).length > 0);
check('a briefing for a worked SHEX weekend reads the same as for an idle one on the same basis', (() => {
  const byBasis = new Map();
  for (const it of all.filter((x) => ['eiu_worked', 'uu_worked', 'shex_idle'].includes(briefing(x).key))) {
    const t = briefing(it).clause.title;
    if (byBasis.has(it.fixture.shex_basis) && byBasis.get(it.fixture.shex_basis) !== t) return false;
    byBasis.set(it.fixture.shex_basis, t);
  }
  return byBasis.size >= 2;
})());

console.log(`\n${n - fails} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
