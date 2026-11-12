import { h } from './dom.mjs';
import { drills, pitfalls, countsFor } from './drills/laytime.mjs';
import { store } from './store.mjs';
import { mountTaskPage } from './task-page.mjs';
import { sqlLanguage } from './languages/sql.mjs';
import { excelLanguage } from './languages/excel.mjs';
import { calculate, deductions, toMin } from './laytime/calc.mjs';

// One entry per language tab, in tab order. Python is added here.
const languages = [excelLanguage, sqlLanguage];

const TASK = 'laytime';
const FICTION_NOTE = 'Vessels and voyages are invented. Any match with a real ship is coincidence.';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BASIS = {
  'SHEX EIU': 'Sundays and holidays excepted, even if used',
  'SHEX UU': 'Sundays and holidays excepted, unless used',
  SHINC: 'Sundays and holidays included',
};
const pad = (n) => String(n).padStart(2, '0');
const at = (t) => new Date(t * 60000);
const clockOf = (t) => `${pad(at(t).getUTCHours())}:${pad(at(t).getUTCMinutes())}`;
const dateOf = (t, long = false) => `${(long ? DAY_LONG : DAY)[at(t).getUTCDay()]} ${at(t).getUTCDate()} ${MONTH[at(t).getUTCMonth()]}`;
const when = (t) => `${dateOf(t)}, ${clockOf(t)}`;
const sameDay = (a, b) => Math.floor(a / 1440) === Math.floor((b - 1) / 1440);
const period = (a, b, long) => (sameDay(a, b) ? `${dateOf(a, long)} ${clockOf(a)} to ${b % 1440 === 0 ? '24:00' : clockOf(b)}` : `${dateOf(a, long)} ${clockOf(a)} to ${dateOf(b, long)} ${clockOf(b)}`);
const daysHrs = (min) => `${Math.floor(min / 1440)} days ${pad(Math.floor((min % 1440) / 60))} hrs${min % 60 ? ` ${pad(min % 60)} mins` : ''}`;
const hrs = (min) => `${pad(Math.floor(min / 60))} hrs${min % 60 ? ` ${pad(min % 60)} mins` : ''}`;
const hoursNumber = (min) => (min % 60 ? (min / 60).toFixed(2).replace(/0$/, '') : String(min / 60));
const num = (n) => n.toLocaleString('en-GB');
const usd = (n) => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const capital = (s) => s[0].toUpperCase() + s.slice(1);

// The worked example laid out the way the brief does, from calc.mjs
function calculation(fixture, stoppages) {
  const r = calculate(fixture, stoppages);
  const lines = [];
  const row = (label, value) => lines.push(`${label.padEnd(22)}${value}`);
  row('Cargo', `${num(fixture.cargo_mt)} MT coal`);
  row('Load rate', `${num(fixture.load_rate_mt_per_day)} MT per weather working day, ${fixture.shex_basis}`);
  row('Demurrage rate', `USD ${num(fixture.demurrage_rate_usd_per_day)} per day`);
  row('Despatch', 'half demurrage');
  lines.push('');
  row('Laytime allowed', `${num(fixture.cargo_mt)} / ${num(fixture.load_rate_mt_per_day)} = ${daysHrs(r.allowed_min)}`);
  lines.push('');
  row('NOR tendered', when(toMin(fixture.nor_tendered)));
  row('Turn time', `${fixture.turn_time_hrs} hours`);
  row('Laytime commenced', when(toMin(r.laytime_commenced)));
  row('Loading completed', when(toMin(fixture.loading_completed)));
  row('Elapsed', daysHrs(r.elapsed_min));
  lines.push('', 'Deductions');
  let total = 0;
  const items = deductions(fixture, stoppages).map((d) => {
    if (d.kind === 'stoppage') {
      total += d.minutes;
      return [`${capital(d.label)}, ${period(d.start, d.end)}`, hrs(d.minutes)];
    }
    if (d.excepted) {
      total += d.minutes;
      return [`${period(d.start, d.end, true)}, ${d.label}`, hrs(d.minutes)];
    }
    return [`${period(d.start, d.end, true)}, loading under way: counts under ${d.label}`, hrs(0)];
  });
  const width = Math.max(...items.map(([l]) => l.length), 'Total'.length) + 4;
  for (const [label, value] of items) lines.push(`  ${label.padEnd(width)}${value}`);
  lines.push(`  ${'Total'.padEnd(width)}${hrs(total)}`);
  lines.push('');
  row('Laytime used', `${daysHrs(r.elapsed_min)} - ${hrs(total)} = ${daysHrs(r.used_min)}`);
  row('Against allowed', daysHrs(r.allowed_min));
  const rate = fixture.demurrage_rate_usd_per_day;
  if (r.result === 'despatch') {
    row('Result', `${hoursNumber(r.time_saved_min)} hrs saved, despatch due`);
    lines.push('');
    row('Despatch', `${hoursNumber(r.time_saved_min)}/24 x (${num(rate)} / 2) = USD ${usd(r.amount_usd)} payable to charterer`);
  } else {
    row('Result', `${hoursNumber(r.time_on_demurrage_min)} hrs over, on demurrage`);
    lines.push('');
    row('Demurrage', `${hoursNumber(r.time_on_demurrage_min)}/24 x ${num(rate)} = USD ${usd(r.amount_usd)} payable to owner`);
  }
  return { text: lines.join('\n'), result: r };
}

function termsList(fixture) {
  return h('dl', { class: 'terms' },
    h('dt', {}, 'SHEX basis'), h('dd', {}, `${fixture.shex_basis}: ${BASIS[fixture.shex_basis]}`),
    h('dt', {}, 'SHEX window'), h('dd', {}, fixture.shex_window || 'none'),
    h('dt', {}, 'Despatch basis'), h('dd', {}, fixture.despatch_basis),
  );
}

async function getJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} returned ${r.status}`);
  return r.json();
}

async function main() {
  const [data, calcKey, key, defaults, example] = await Promise.all([
    getJSON('/data/laytime.json'),
    getJSON('/data/laytime.key.json'),
    getJSON('/data/laytime.drills.key.json'),
    getJSON('/config/laytime-defaults.json'),
    getJSON('/data/laytime-worked-example.json'),
  ]);
  const counts = { ...countsFor(data), n_errors: calcKey.owner_errors.length };
  const cleared = [...languages.map((l) => l.id), 'text'].reduce((n, id) => n + store.syncKey(TASK, id, key.fingerprints[id]), 0);

  // The worked example on the defaults, and the same voyage under SHEX UU
  const base = { ...example.fixture, shex_basis: defaults.shex_basis, despatch_basis: defaults.despatch_basis, shex_window: defaults.shex_window };
  const contrast = { ...base, ...example.contrast };
  const a = calculation(base, example.stoppages);
  const b = calculation(contrast, example.stoppages);

  const errorsChip = h('ul', { class: 'chips', 'aria-label': 'Owner errors' });
  const drawChips = () => {
    const status = store.statusInAny(TASK, 7);
    errorsChip.replaceChildren(h('li', { class: `chip${status === 'clean' ? ' found' : status === 'after-reveal' ? ' found-hollow' : ''}` },
      h('span', { class: 'chip-count' }, String(counts.n_errors)),
      h('span', {}, "Errors in the owner's statement"),
      h('span', { class: 'chip-state' }, status === 'clean' ? '✓ found in drill 7' : status === 'after-reveal' ? 'found after reveal, drill 7' : 'drill 7'),
    ));
  };
  drawChips();

  document.getElementById('intro').replaceChildren(...[
    h('p', { class: 'eyebrow' }, 'Task 2'),
    h('h1', {}, 'Laytime and demurrage'),
    h('p', { class: 'lede' }, 'The charterer gets an agreed time to load. That is laytime. Run over and the charterer pays the owner demurrage; finish early and the owner pays despatch, at half the rate. Nobody teaches it, and every junior gets handed it in week one.'),

    h('section', { class: 'worked', 'aria-labelledby': 'worked-title' },
      h('h2', { id: 'worked-title' }, 'Worked example'),
      h('p', {}, 'The terms come first. Read them before you calculate.'),
      termsList(base),
      h('pre', { class: 'code calc' }, a.text),
    ),

    h('aside', { class: 'panel contrast', 'aria-labelledby': 'contrast-title' },
      h('h3', { id: 'contrast-title' }, `The same voyage under ${contrast.shex_basis}`),
      h('p', {}, `Loading carried on through Sunday. Under ${contrast.shex_basis} (${BASIS[contrast.shex_basis]}) the Sunday hours worked count against laytime.`),
      h('pre', { class: 'code calc' }, b.text),
      h('p', { class: 'contrast-line' },
        `${base.shex_basis}: USD ${usd(a.result.amount_usd)} ${a.result.result}. ${contrast.shex_basis}: USD ${usd(b.result.amount_usd)} ${b.result.result}. Same times, same rain, one clause.`),
    ),

    h('section', { class: 'how', 'aria-labelledby': 'how-title' },
      h('h2', { id: 'how-title' }, 'The drills'),
      h('p', {}, `${counts.n_voyages} voyages, each with its own terms. The fixtures table gives cargo, rate, terms and times; stoppages lists every stoppage and whether it counts; shex_periods lists the SHEX periods the way a statement of facts does; owner_statement is the owner's own calculation.`),
      errorsChip,
      h('p', {}, "The owner's statement is wrong on some voyages. Drills 1 to 6 build the calculation; drill 7 checks the owner's number, which is the real job."),
      h('details', { class: 'rules' },
        h('summary', {}, 'Rules these drills use'),
        h('ul', {},
          h('li', {}, 'Laytime starts when turn time runs out after NOR, or when loading starts if that is sooner.'),
          h('li', {}, 'Rates are per weather working day, so rain and swell that stopped work do not count.'),
          h('li', {}, 'Berth congestion counts only where the fixture has a waiting for berth clause, such as WIBON.'),
          h('li', {}, "Shifting and a breakdown of the ship's gear do not count. A public holiday is excepted under SHEX and counts under SHINC."),
          h('li', {}, 'Despatch is paid at half the demurrage rate, on working time saved or all time saved as the fixture says.'),
          h('li', {}, 'No exception falls after laytime runs out, so used minus allowed is the time on demurrage.'),
        ),
      ),
      h('p', { class: 'muted small' }, 'Answers are checked on the result, not the wording of your code. Hours within a minute and money within a cent count as equal.'),
      cleared ? h('p', { class: 'notice', role: 'status' }, 'The answer key has changed since your last visit, so your earlier ticks were cleared. Your saved answers are still in the editors.') : null,
    ),
  ].filter(Boolean));

  mountTaskPage({
    task: TASK,
    drills,
    pitfalls,
    data,
    key,
    languages,
    counts,
    referenceNote: FICTION_NOTE,
    onProgress: drawChips,
    renderTextDrill: (drill, api) => textDrill(calcKey.owner_errors, api),
    els: {
      list: document.getElementById('drills'),
      work: document.getElementById('work'),
      reference: document.getElementById('reference'),
    },
  });
}

// Drill 8: one sentence per owner error, self-marked against the model answer
function textDrill(errors, api) {
  let answers = {};
  try {
    answers = JSON.parse(api.saved() || '{}') || {};
  } catch {}
  const box = h('div', { class: 'text-drill' });
  const draw = (show) => {
    if (!show) {
      box.replaceChildren(
        h('p', { class: 'muted' }, 'Drill 7 finds the voyages. Solve it first, or open them now.'),
        h('button', { class: 'btn show-voyages', onclick: () => draw(true) }, 'Show the voyages'),
      );
      return;
    }
    const fields = errors.map((e) => {
      const area = h('textarea', { class: 'editor short', rows: '2', 'aria-label': `What the owner did wrong on ${e.voyage_id}`, placeholder: 'One sentence', oninput: (ev) => { answers[e.voyage_id] = ev.target.value; api.save(JSON.stringify(answers)); } });
      area.value = answers[e.voyage_id] || '';
      const model = h('p', { class: 'model-note', hidden: true }, h('strong', {}, 'Model answer. '), e.note);
      return { e, area, model };
    });
    const verdict = h('div', { class: 'verdict', 'aria-live': 'polite' });
    const marks = h('div', { class: 'actions', hidden: true },
      h('button', { class: 'btn primary mark-done', onclick: () => { api.solve(); verdict.replaceChildren(h('div', { class: 'v v-correct' }, h('p', { class: 'v-label' }, h('span', { class: 'v-mark', 'aria-hidden': 'true' }, '✓'), 'Marked as done'), h('p', {}, 'An operator would put the same point in the reply to the owner, with the hours.'))); } }, 'I had all of them'),
      h('button', { class: 'btn mark-not-yet', onclick: () => verdict.replaceChildren(h('div', { class: 'v v-wrong' }, h('p', { class: 'v-label' }, h('span', { class: 'v-mark', 'aria-hidden': 'true' }, '✗'), 'Not yet'), h('p', {}, 'Go back to drill 7 and look at how far each figure is out: the size of the gap usually names the mistake.'))) }, 'Not yet'),
    );
    const compareBtn = h('button', { class: 'btn primary compare', onclick: () => { fields.forEach((f) => { f.model.hidden = false; }); marks.hidden = false; compareBtn.hidden = true; } }, 'Compare with the model answers');
    // replaceChildren prints null as text, so drop empty slots
    box.replaceChildren(...[
      ...fields.map(({ e, area, model }) => h('div', { class: 'text-item' }, h('label', { class: 'cell-ref' }, e.voyage_id), area, model)),
      h('div', { class: 'actions' }, compareBtn),
      marks,
      verdict,
      api.status() ? h('p', { class: 'muted small' }, 'You have marked this drill done before.') : null,
    ].filter(Boolean));
  };
  draw(Boolean(api.statusInAny(7)));
  return box;
}

main().catch((e) => {
  document.getElementById('work').replaceChildren(
    h('div', { class: 'v v-error' }, h('p', { class: 'v-label' }, 'Error'), h('p', {}, `The page could not load its data: ${e.message}. Reload to try again.`)),
  );
});
