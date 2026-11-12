import { h } from './dom.mjs';
import { drills, pitfalls } from './drills/reconciliation.mjs';
import { countsFrom } from './check.mjs';
import { store } from './store.mjs';
import { mountTaskPage } from './task-page.mjs';
import { sqlLanguage } from './languages/sql.mjs';
import { excelLanguage } from './languages/excel.mjs';

// One entry per language tab, in tab order. Python is added here.
const languages = [excelLanguage, sqlLanguage];

const TASK = 'reconciliation';
const FICTION_NOTE = 'Counterparties, vessels and invoices are invented. Any match with a real company or ship is coincidence. Ports and grades are real.';
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const word = (n) => WORDS[n] ?? String(n);
const cap = (s) => s[0].toUpperCase() + s.slice(1);

const BREAK_LABELS = {
  missing_invoice: 'Missing invoice',
  orphan_invoice: 'Orphan invoice',
  duplicate_invoice: 'Duplicate invoice',
  tonnage_mismatch: 'Tonnage mismatch',
  price_mismatch: 'Price mismatch',
};

async function getJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} returned ${r.status}`);
  return r.json();
}

async function main() {
  const [data, key] = await Promise.all([
    getJSON('/data/reconciliation.json'),
    getJSON('/data/reconciliation.key.json'),
  ]);
  const counts = countsFrom(data, key);
  const cleared = languages.reduce((n, l) => n + store.syncKey(TASK, l.id, key.fingerprints[l.id]), 0);

  const chips = h('ul', { class: 'chips', 'aria-label': 'Planted breaks' });
  const drawChips = () => {
    chips.replaceChildren(...Object.entries(key.planted).map(([type, list]) => {
      const drill = drills.find((d) => d.finds === type);
      const status = drill && store.statusInAny(TASK, drill.id);
      const state = status === 'clean' ? `✓ found in drill ${drill.id}` : status === 'after-reveal' ? `found after reveal, drill ${drill.id}` : `drill ${drill.id}`;
      return h('li', { class: `chip${status === 'clean' ? ' found' : status === 'after-reveal' ? ' found-hollow' : ''}` },
        h('span', { class: 'chip-count' }, String(list.length)),
        h('span', {}, BREAK_LABELS[type] || type),
        h('span', { class: 'chip-state' }, state),
      );
    }));
  };
  drawChips();

  // replaceChildren prints null as text, so drop empty slots
  document.getElementById('intro').replaceChildren(...[
    h('p', { class: 'eyebrow' }, 'Task 1'),
    h('h1', {}, 'Invoice reconciliation'),
    h('p', { class: 'lede' }, 'You are the junior operator on a coal desk. The trading book holds the cargoes you have shipped. Finance has sent you the invoice book. They do not agree. Find every discrepancy before month end.'),
    h('p', {}, `${cap(word(counts.n_breaks))} breaks across ${word(counts.n_break_types)} types are planted in ${counts.n_cargoes} cargoes and ${counts.n_invoices} invoices. They are the heart of the task. The mix is deliberate: it is what an operator actually finds.`),
    chips,
    h('p', { class: 'muted small' }, 'Answers are checked on the result, not the wording of your code. Any query that returns the right rows passes, whatever you call the columns.'),
    cleared ? h('p', { class: 'notice', role: 'status' }, 'The answer key has changed since your last visit, so your earlier ticks were cleared. Your saved answers are still in the editors.') : null,
  ].filter(Boolean));

  // The teaching panel after drill 3. The figure in it comes from the key.
  const [topCp, topTonnage] = key.expected[2].rows[0];
  const syntaxPanel = () => h('aside', { class: 'panel', 'aria-labelledby': 'syntax-title' },
    h('h3', { id: 'syntax-title' }, 'Three syntaxes, one idea'),
    h('dl', { class: 'compare' },
      h('dt', {}, 'Excel'), h('dd', {}, h('code', {}, `=SUMIFS(tonnage_range, counterparty_range, "${topCp}")`)),
      h('dt', {}, 'SQL'), h('dd', {}, h('code', {}, 'SELECT counterparty, SUM(bl_tonnage) FROM cargoes GROUP BY counterparty')),
      h('dt', {}, 'pandas'), h('dd', {}, h('code', {}, "cargoes.groupby('counterparty')['bl_tonnage'].sum()"), h('span', { class: 'soon' }, 'Python tab coming')),
    ),
    h('p', {}, `Split the rows by counterparty and add up the tonnage in each pile. SUMIFS does one pile at a time; GROUP BY and .groupby() do every pile at once. For ${topCp} all three give ${topTonnage.toLocaleString('en-GB')} MT.`),
    h('p', { class: 'muted small' }, 'Learn the idea once and the other two tools are only syntax.'),
  );

  mountTaskPage({
    task: TASK,
    drills,
    pitfalls,
    data,
    key,
    languages,
    counts,
    panels: { 3: syntaxPanel },
    // Solving drill 3 shows the panel again, in the working area
    afterCorrect: (drill) => (drill.id === 3 ? syntaxPanel() : null),
    referenceNote: FICTION_NOTE,
    onProgress: drawChips,
    els: {
      list: document.getElementById('drills'),
      work: document.getElementById('work'),
      reference: document.getElementById('reference'),
    },
  });
}

main().catch((e) => {
  document.getElementById('work').replaceChildren(
    h('div', { class: 'v v-error' }, h('p', { class: 'v-label' }, 'Error'), h('p', {}, `The page could not load its data: ${e.message}. Reload to try again.`)),
  );
});
