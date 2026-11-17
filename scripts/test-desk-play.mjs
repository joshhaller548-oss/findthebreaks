// The laytime desk, playtest fixes (November 2026). One section per item in
// the playtest report, each checking the strings and numbers the player
// sees, built from the same data and calc.mjs the desk uses.

import { readFileSync } from 'node:fs';
import { calculate, workedExample, deductions } from '../public/js/laytime/calc.mjs';
import { hm, humanDates, hasIsoDate, cap } from '../public/js/desk/format.mjs';
import { briefing, dayBriefing, termsLines, modelNote, recapNotes, STRIKE_RULE, TRAINING_EXCEPTION, OWNER_STEP } from '../public/js/desk/briefing.mjs';
import { createProfile } from '../public/js/desk/profile.mjs';
import { glossary } from '../public/js/desk/glossary.mjs';
import { verdictLabel } from '../public/js/check.mjs';
import { afterCompletion, POINTS, STAR_RULES, starsFor, createRun, createDay, ownerTicket, buildTickets, settleTicket, DAYS, planDay, shiftItem } from '../public/js/desk/run.mjs';
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
const dayLanesOf = (k) => planDay(DAYS[k - 1].map((m) => all[m - 1]));
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
  for (const { item } of dayLanesOf(i + 1)) for (const g of giveaways(text, item)) leaks.push(`Day ${i + 1}, ${item.fixture.vessel}: ${g}`);
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

// ---------- 16. a day's dates agree with the desk clock and the arrivals ----------
const plans = DAYS.map((ns) => planDay(ns.map((m) => all[m - 1])));
const norOf = (it) => toMin(it.fixture.nor_tendered);
check('each vessel arrives on the desk clock at its own NOR', plans.every((p) => p.every((l) => norOf(l.item) - norOf(p[0].item) === l.offset)));
check('vessels arrive in NOR order', plans.every((p) => p.every((l, i) => i === 0 || l.offset >= p[i - 1].offset)));
check(`every day keeps its arrivals within three days (${plans.map((p) => p.map((l) => l.offset / 60).join('/')).join(', ')} hrs)`, plans.every((p) => p.at(-1).offset <= 72 * 60));
check('every day still has the same three fixtures', plans.every((p, i) => p.map((l) => l.item.n).sort((a, b) => a - b).join() === DAYS[i].join()));
check('day 1: Sea Falcon and Iron Meridian tender NOR together, Wed 9 Sep, 21:00; Cape Orchid follows on Fri 11 Sep, 21:00', plans[0].map((l) => `${l.item.fixture.vessel} ${stamp(norOf(l.item))}`).join(' | ') === 'Sea Falcon Wed 9 Sep, 21:00 | Iron Meridian Wed 9 Sep, 21:00 | Cape Orchid Fri 11 Sep, 21:00');
const same = (a, b) => ['allowed_min', 'used_min', 'elapsed_min', 'deductible_stoppage_min', 'shex_excepted_min', 'balance_min', 'result', 'time_saved_min', 'time_on_demurrage_min', 'amount_usd', 'commenced_on'].every((k) => a[k] === b[k]);
check('moving a cargo by whole weeks keeps every figure from calc.mjs', everyone.every((it) => [-3, -1, 1, 4].every((wk) => same(shiftItem(it, wk).result, it.result))));
check('moving a cargo keeps its tickets, answers and weekdays', all.every((it) => {
  const moved = shiftItem(it, 2);
  const a = createRun(it).steps;
  const b = createRun(moved).steps;
  return a.length === b.length && a.every((t, i) => t.type === b[i].type && t.answer === b[i].answer && t.minutes === b[i].minutes) && stamp(norOf(moved)).slice(0, 3) === stamp(norOf(it)).slice(0, 3);
}));
check('a moved vessel’s model note uses its moved dates', plans.flat().filter((l) => l.item.ownerError && l.item.shift).every((l) => !hasIsoDate(modelNote(l.item))) && modelNote(plans[0].find((l) => l.item.fixture.vessel === 'Cape Orchid').item).includes('Sat 12 Sep'));
// Played on the desk, with the planned offsets
const playDay = (lanes) => {
  const day = createDay(lanes);
  const seen = [];
  for (let guard = 0; !day.finished && guard < 20000; guard++) {
    const l = day.active;
    if (l) {
      if (l.run.explaining) { day.explain('x', true); continue; }
      seen.push({ i: l.i, T: day.T, at: day.start + day.T });
      day.call(l.run.open.answer);
      continue;
    }
    day.advance(60);
  }
  return { day, seen };
};
const plays = plans.map(playDay);
check('planned days play to the true statement on every vessel', plays.every(({ day }) => day.finished && day.lanes.every((l) => l.run.used === l.item.result.used_min && l.run.summary().difference_usd === 0)));
check('no vessel brings a ticket before its NOR on the desk calendar', plays.every(({ day, seen }) => seen.every((x) => x.at >= day.lanes[x.i].run.nor)));
check('every planned day still interleaves tickets across vessels', plays.every(({ seen }) => seen.some((x, i) => i > 1 && x.i !== seen[i - 1].i && seen.slice(0, i).some((y) => y.i === x.i))));
check('the desk calendar starts at the first NOR', plays.every(({ day }) => day.start === day.lanes[0].run.nor));

// ---------- 18. stars weigh right-first-time and dollars ----------
check('the playtest run, 3 of 4 right and USD 26,041.67 off, gets one star', starsFor({ rightFirstTime: 3, decisions: 4, off_usd: 26041.67 }) === 1);
check('the rain run on the training cargo, 3 of 4 right and USD 19,791.67 off, gets one star', rainWrong.summary().stars === 1 && rainWrong.summary().off_usd === 19791.67);
check('a clean run gets three stars', playThrough(training).summary().stars === 3 && all.every((it) => playThrough(it).summary().stars === 3));
check('every call right but one, with no dollars lost, is still short of three stars on a single fixture', starsFor({ rightFirstTime: 5, decisions: 6, off_usd: 0 }) === 2);
check('all right but a big dollar miss cannot reach two stars', starsFor({ rightFirstTime: 12, decisions: 13, off_usd: 10000.01 }) === 1);
check('taken over is no stars, whatever the dollars', starsFor({ rightFirstTime: 4, decisions: 4, off_usd: 0, takenOver: true }) === 0);
check('the star rules run from three stars down to one, stricter at each step', STAR_RULES.map((r) => r.stars).join() === '3,2,1' && STAR_RULES.every((r, i) => i === 0 || (r.minShare <= STAR_RULES[i - 1].minShare && r.maxOff >= STAR_RULES[i - 1].maxOff)));
// On a day the dollars add up vessel by vessel, so two errors never cancel
const d2 = plans[1];
const twoWrong = createDay(d2);
let flips = 0;
for (let guard = 0; !twoWrong.finished && guard < 20000; guard++) {
  const l = twoWrong.active;
  if (!l) { twoWrong.advance(60); continue; }
  if (l.run.explaining) { twoWrong.explain('x', true); continue; }
  const tk = l.run.open;
  // Wrong on the first time ticket of the first two vessels, then recast
  if (tk.type === 'time' && flips < 2 && !l.flipped) { l.flipped = true; flips++; twoWrong.call(tk.answer === 'off' ? 'counts' : 'off'); }
  twoWrong.call(tk.answer);
}
const tw = twoWrong.summary();
check(`a day's dollars are the sum of each vessel's miss (${tw.per.map((p) => p.off_usd).join(' + ')} = ${tw.off_usd})`, tw.off_usd === Math.round(tw.per.reduce((n, p) => n + Math.abs(p.difference_usd), 0) * 100) / 100 && tw.off_usd >= Math.abs(tw.difference_usd));

// ---------- 6. a dispute is checked before the sentence ----------
const disputed = all.filter((it) => ownerTicket(it).answer === 'dispute');
const wantLines = { clock_from_nor: 'commenced,owed,used', counted_shex_window: 'owed,used', omitted_weather: 'owed,used' };
check(`the disputed lines match each planted error (${disputed.map((it) => `${it.ownerError.type}: ${ownerTicket(it).lines.filter((x) => x.differs).map((x) => x.id).join('+')}`).join('; ')})`, disputed.length === 3 && disputed.every((it) => ownerTicket(it).lines.filter((x) => x.differs).map((x) => x.id).sort().join() === wantLines[it.ownerError.type]));
check('every dispute offers three hours, exactly one of them the gap from calc.mjs', disputed.every((it) => {
  const tk = ownerTicket(it);
  const gap = Math.abs(tk.owner.laytime_used_hrs - it.result.used_min / 60);
  return tk.hours.length === 3 && tk.hours.filter((x) => Math.abs(x.hrs - gap) < 0.005).length === 1 && tk.hours.find((x) => x.id === tk.hoursAnswer).hrs === Math.round(gap * 100) / 100;
}));
check('the right hours option is not always in the same place', new Set(disputed.map((it) => ownerTicket(it).hoursAnswer)).size > 1);
const toDispute = (it) => {
  const run = createRun(it);
  for (let guard = 0; !run.explaining && guard < 10000; guard++) run.open ? run.call(run.open.answer) : run.advance(60);
  return run;
};
const pin = (run, lines, hoursId) => run.pinpoint(lines, hoursId);
const right = (it) => { const tk = ownerTicket(it); return [tk.lines.filter((x) => x.differs).map((x) => x.id), tk.hoursAnswer]; };
check('naming the lines and the hours first time earns the pinpoint points', disputed.every((it) => {
  const run = toDispute(it);
  const before = run.score;
  const r = pin(run, ...right(it));
  return r.right && r.gained === POINTS.pinpoint && run.score === before + POINTS.pinpoint && run.pinpointed.tries === 1;
}));
check('a wrong pick is coached, costs no strike, and can be tried again for no points', disputed.every((it) => {
  const run = toDispute(it);
  const [lines, hoursId] = right(it);
  const wrongHours = ownerTicket(it).hours.find((x) => x.id !== hoursId).id;
  const a = pin(run, lines, wrongHours);
  const b = pin(run, ['commenced', 'used', 'owed'].filter((x) => !lines.includes(x)).concat(lines.slice(1)), hoursId);
  const c = pin(run, lines, hoursId);
  return !a.right && a.linesRight && !a.hoursRight && /less/.test(a.message) && !b.right && !b.linesRight && c.right && c.gained === 0 && run.strikes === 0 && run.explaining;
}));
check('the hours coaching names both figures to subtract', (() => { const it = disputed[0]; const run = toDispute(it); const m = pin(run, right(it)[0], ownerTicket(it).hours.find((x) => x.id !== right(it)[1]).id).message; return m.includes(it.owner.laytime_used_hrs.toFixed(2)) && m.includes((it.result.used_min / 60).toFixed(2)); })());

// ---------- 13. the settle ticket carries what all time saved needs ----------
const despatched = everyone.filter((it) => it.result.result === 'despatch');
const ats = despatched.filter((it) => it.fixture.despatch_basis === 'all time saved');
const wts = despatched.filter((it) => it.fixture.despatch_basis === 'working time saved');
check(`on all time saved, laytime left plus the excepted time shown equals calc.mjs's time saved (${ats.map((it) => it.label).join(', ')})`, ats.length >= 2 && ats.every((it) => { const a = afterCompletion(it); return a.left_min + a.excepted_min === it.result.time_saved_min; }));
check(`on working time saved, laytime left alone equals time saved (${wts.length} cargoes)`, wts.length >= 2 && wts.every((it) => afterCompletion(it).left_min === it.result.time_saved_min));
const f4 = settleTicket(all[3]);
check(`Fixture 4's settle ticket shows the 39 hrs after completion (${f4.after?.windows.map((w) => span(w.start, w.end)).join(', ')})`, f4.after?.excepted_min === 39 * 60 && f4.after.windows.length === 1 && span(f4.after.windows[0].start, f4.after.windows[0].end) === 'Sat 1 Aug, 17:00 to Mon 3 Aug, 08:00');
check('with that data, Fixture 4 prices from the ticket alone: (left + 39 hrs) at half rate', Math.round((f4.after.left_min + f4.after.excepted_min) / 1440 * all[3].fixture.demurrage_rate_usd_per_day / 2 * 100) / 100 === all[3].result.amount_usd);
check('demurrage cargoes carry no despatch data', everyone.filter((it) => it.result.result !== 'despatch').every((it) => afterCompletion(it) === null && settleTicket(it).after === null));

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const profStore = mem();
const prof = createProfile(() => profStore);
check('the all time saved explanation is marked seen once, and stays seen', !prof.seen('ats') && (prof.markSeen('ats'), prof.markSeen('ats'), prof.seen('ats')));
const oldStore = mem();
oldStore.setItem('findthebreaks:desk', JSON.stringify({ schema: 1, name: 'Old', ledger: [{ n: 0, score: 1 }] }));
check('a profile saved before this change keeps its name and ledger', createProfile(() => oldStore).name() === 'Old' && createProfile(() => oldStore).ledger().length === 1 && !createProfile(() => oldStore).seen('ats'));

// ---------- 14. glossary gaps, and drill feedback in plain words ----------
const terms = glossary.map((g) => g.term.toLowerCase());
const asked = ['recast', 'charter party', 'pro rata', 'master', 'stoppage', 'load rate', 'all time saved'];
check(`the glossary has every term the playtest missed (${asked.join(', ')})`, asked.every((t) => terms.includes(t)), asked.filter((t) => !terms.includes(t)).join(', '));
check('load rate is defined per weather working day', glossary.find((g) => g.term === 'Load rate').long === 'per weather working day');
const atsEntry = glossary.find((g) => g.term === 'All time saved');
check('all time saved has a worked example whose sum is right', /20 \+ 39 = 59 hrs/.test(atsEntry.example) && /working time saved pays on 20/.test(atsEntry.example));
check('every glossary term is unique', new Set(terms).size === terms.length);
check('wrong drill answers are headed in plain words', verdictLabel({ shapeOk: true }) === 'Your columns are right, but some rows are wrong' && !/shape/i.test(verdictLabel({ shapeOk: true }) + verdictLabel({ shapeOk: false })));

console.log(`\n${n - fails} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
