// /laytime: the desk game. Screens are routed on the hash so the back
// button works: #/ title, #/glossary, #/ledger, #/briefing/<n> and #/desk/<n>
// for one cargo, #/day/<k> and #/daydesk/<k> for a day of three vessels.
// The Excel and SQL drills live at /laytime/tools.

import { h } from '../dom.mjs';
import { profile, NAME_MAX } from './profile.mjs';
import { glossary } from './glossary.mjs';
import { loadFixtures } from './fixtures.mjs';
import { briefing, HEAD } from './briefing.mjs';
import { harbour } from './harbour.mjs';
import { deskScreen } from './desk-screen.mjs';
import { DAYS, ARRIVAL_GAP } from './run.mjs';

// Every cargo is playable: the training cargo and the twelve fixtures
const playable = (n) => items.some((it) => it.n === n);

const stage = document.getElementById('stage');
const dialog = document.getElementById('name-dialog');
let items = [];
let current = null;

const btn = (cls, attrs, ...kids) => h(attrs.href ? 'a' : 'button', { class: `gbtn ${cls}`, ...(attrs.href ? {} : { type: 'button' }), ...attrs }, ...kids);
const backBar = (label) => h('header', { class: 'screen-bar' },
  h('a', { class: 'gbtn small outline', href: '#/' }, 'Back to the desk'),
  h('p', { class: 'eyebrow' }, label));

const settled = () => new Set(profile.ledger().map((e) => e.n));
const nextItem = () => items.find((it) => !settled().has(it.n)) ?? items[0];
const dayKey = (k) => `day-${k}`;
const dayItems = (k) => DAYS[k - 1].map((n) => items.find((it) => it.n === n));
// After the training cargo, the desk runs in days of three vessels
function nextStep() {
  const done = settled();
  if (!done.has(0)) return { href: '#/briefing/0', tag: 'Training cargo', sub: 'Learn the clock on one cargo first', vessel: 'Training' };
  const k = DAYS.findIndex((_, i) => !done.has(dayKey(i + 1))) + 1 || 1;
  return { href: `#/day/${k}`, tag: `Day ${k} \u00B7 three vessels`, sub: dayItems(k).map((it) => it.fixture.vessel).join(', '), vessel: dayItems(k)[0].fixture.vessel };
}

function wordmark() {
  return h('h1', { class: 'wordmark', 'aria-label': 'Find the Breaks' },
    h('span', { class: 'wm-line' }, 'Find the'), ' ',
    h('span', { class: 'wm-line' }, h('span', { class: 'wm-break' }, 'Breaks')));
}

// ---------- screens ----------

function titleScreen() {
  const next = nextStep();
  const name = profile.name();
  return h('section', { class: 'screen title-screen', 'aria-label': 'Title' },
    harbour({ vessel: next.vessel }),
    h('div', { class: 'title-body' },
      h('div', { class: 'title-left' },
        wordmark(),
        h('p', { class: 'tagline' }, 'A game about laytime, breaks and the owner’s statement.'),
        name ? h('p', { class: 'greet' }, 'On the desk: ', h('strong', {}, name)) : null,
        settledLine(),
      ),
      h('nav', { class: 'title-actions', 'aria-label': 'Desk' },
        btn('big ink', { href: next.href },
          h('span', { class: 'tag-chip' }, next.tag),
          next.href.startsWith('#/day') ? 'Start the next day' : 'Start the next fixture',
          h('span', { class: 'sub' }, next.sub)),
        h('div', { class: 'row' },
          btn('accent', { href: '#/ledger' }, 'Ledger'),
          btn('sea', { href: '#/glossary' }, 'Glossary')),
        h('div', { class: 'row' },
          btn('ok', { href: '/laytime/tools' }, 'Desk tools'),
          btn('outline', { onclick: askName }, 'Change name')),
        h('p', { class: 'dnote' }, 'Desk tools holds the laytime drills in Excel and SQL.'),
      ),
    ),
    h('p', { class: 'stage-foot' }, 'Vessels are invented. Progress is kept in this browser only.'),
  );
}

// Best run per cargo, from the ledger
function bests() {
  const by = new Map();
  for (const e of profile.ledger()) {
    const b = by.get(e.n);
    if (!b) by.set(e.n, { ...e, runs: 1 });
    else by.set(e.n, { ...(e.score > b.score ? e : b), runs: b.runs + 1 });
  }
  return by;
}

function settledLine() {
  const b = bests();
  if (!b.size) return null;
  const total = [...b.values()].reduce((n, e) => n + e.score, 0);
  const days = DAYS.filter((_, i) => b.has(dayKey(i + 1))).length;
  return h('p', { class: 'greet' }, `Days settled ${days} of ${DAYS.length} \u00B7 best total ${total.toLocaleString('en-GB')}`);
}

function glossaryScreen() {
  return h('section', { class: 'screen glossary-screen', 'aria-labelledby': 'g-title' },
    backBar('Glossary'),
    h('h2', { id: 'g-title' }, 'The words on the desk'),
    h('p', { class: 'screen-lede' }, 'Every charter party uses them. Know them before you open the desk.'),
    h('dl', { class: 'glossary' }, glossary.map((g) => h('div', { class: 'g-item' },
      h('dt', {}, g.term, g.long ? h('span', { class: 'g-long' }, g.long) : null),
      h('dd', {}, g.def)))),
  );
}

function ledgerScreen() {
  const b = bests();
  const USD = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const star = (n) => h('span', { class: 'stars', 'aria-label': `${n} of 3 stars` }, '\u2605'.repeat(n), h('span', { class: 'off' }, '\u2605'.repeat(3 - n)));
  const total = [...b.values()].reduce((n, e) => n + e.score, 0);
  return h('section', { class: 'screen ledger-screen', 'aria-labelledby': 'l-title' },
    backBar('Ledger'),
    h('h2', { id: 'l-title' }, 'Your ledger'),
    b.size
      ? h('div', { class: 'ledger' },
        h('p', { class: 'screen-lede' }, `Best run on each day and each cargo, best total ${total.toLocaleString('en-GB')}. Kept in this browser only.`),
        h('h3', { class: 'ledger-h' }, 'Days on the desk'),
        h('ol', { class: 'ledger-list' }, DAYS.map((ns, i) => {
          const e = b.get(dayKey(i + 1));
          return h('li', { class: e ? 'played' : 'open' },
            h('a', { href: `#/day/${i + 1}` },
              h('span', { class: 'lg-name' }, `Day ${i + 1} \u00B7 ${dayItems(i + 1).map((it) => it.fixture.vessel).join(', ')}`),
              e ? star(e.stars) : h('span', { class: 'muted small' }, 'not played'),
              h('span', { class: 'lg-score mono' }, e ? e.score.toLocaleString('en-GB') : ''),
              e ? h('span', { class: 'lg-detail mono' }, `${e.right} of ${e.decisions} right first time \u00B7 ${e.difference_usd === 0 ? 'priced exactly' : `off by USD ${USD.format(Math.abs(e.difference_usd))}`}${e.runs > 1 ? ` \u00B7 ${e.runs} runs` : ''}`) : null));
        })),
        h('h3', { class: 'ledger-h' }, 'Single cargoes'),
        h('ol', { class: 'ledger-list' }, items.map((it) => {
          const e = b.get(it.n);
          return h('li', { class: e ? 'played' : 'open' },
            h('a', { href: `#/briefing/${it.n}` },
              h('span', { class: 'lg-name' }, it.training ? 'Training cargo' : `${it.label} \u00B7 ${it.fixture.vessel}`),
              e ? star(e.stars) : h('span', { class: 'muted small' }, 'not played'),
              h('span', { class: 'lg-score mono' }, e ? e.score.toLocaleString('en-GB') : ''),
              e ? h('span', { class: 'lg-detail mono' }, `${e.right} of ${e.decisions} right first time \u00B7 ${e.difference_usd === 0 ? 'priced exactly' : `off by USD ${USD.format(Math.abs(e.difference_usd))}`}${e.runs > 1 ? ` \u00B7 ${e.runs} runs` : ''}`) : null));
        })))
      : h('div', { class: 'empty' },
        h('p', {}, 'Nothing settled yet. Your best run on each fixture shows here.'),
        h('p', { class: 'muted small' }, 'The ledger lives in this browser only. Nobody else sees it.'),
        btn('ink', { href: `#/briefing/${nextItem().n}` }, 'Start the next fixture')),
  );
}

function briefingScreen(n) {
  const item = items.find((it) => it.n === n);
  if (!item) return notFound();
  const b = briefing(item);
  const initials = HEAD.name.split(' ').map((w) => w[0]).join('');
  return h('section', { class: 'screen briefing-screen', 'aria-labelledby': 'b-title' },
    backBar(`Morning briefing · ${item.label}`),
    h('h2', { id: 'b-title' }, item.training ? 'Training cargo' : `${item.fixture.vessel}`),
    h('div', { class: 'brief-cols' },
      h('div', { class: 'brief-lesson' },
        h('h3', {}, item.training ? 'How the clock works' : 'What decides this one'),
        h('ol', { class: 'lesson' }, b.lesson.map((l) => h('li', {}, l))),
        h('div', { class: 'clause' },
          h('p', { class: 'clause-tag' }, 'The clause that matters'),
          h('h4', {}, b.clause.title),
          h('p', {}, b.clause.text)),
      ),
      h('div', { class: 'brief-terms' },
        h('h3', {}, 'The fixture'),
        h('dl', { class: 'fx-terms' }, b.terms.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))),
        h('h3', {}, 'Your targets'),
        h('ul', { class: 'targets' }, b.targets.map((t) => h('li', {}, t))),
      ),
    ),
    h('figure', { class: 'quote' },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials),
      h('blockquote', {}, h('p', {}, b.clause.quote)),
      h('figcaption', {}, `${HEAD.name}, ${HEAD.role.toLowerCase()}`)),
    playable(item.n)
      ? h('div', { class: 'brief-actions' },
        btn('big ink', { href: `#/desk/${item.n}` }, 'Open the desk'),
        h('p', { class: 'dnote' }, 'The clock starts at NOR. Tickets arrive as the agent reports them.'))
      : h('div', { class: 'brief-actions' },
        btn('big ink', { disabled: true, 'aria-describedby': 'desk-soon' }, 'Open the desk', h('span', { class: 'sub' }, 'Coming soon')),
        h('p', { id: 'desk-soon', class: 'dnote' }, 'This fixture\u2019s desk is coming soon. Start with the training cargo, or try the drills under Desk tools.')),
  );
}

function notFound() {
  return h('section', { class: 'screen' }, backBar('Not found'), h('h2', {}, 'No screen here.'));
}

// ---------- name ----------

function askName() {
  const input = dialog.querySelector('input');
  const err = dialog.querySelector('.name-error');
  input.value = profile.name();
  input.maxLength = NAME_MAX;
  err.textContent = '';
  dialog.showModal();
}
dialog.querySelector('form').addEventListener('submit', (e) => {
  if (e.submitter?.value === 'skip') return;
  const r = profile.setName(dialog.querySelector('input').value);
  if (!r.ok) {
    e.preventDefault();
    dialog.querySelector('.name-error').textContent = r.reason;
    return;
  }
  render();
});

// ---------- routing ----------

const again = { onLeave: (why) => (why === 'again' ? render() : null) };

function deskView(n) {
  const item = items.find((it) => it.n === n);
  if (!item) return notFound();
  const next = item.training ? { href: '#/day/1', label: 'Start day 1' } : n < 12 ? { href: `#/briefing/${n + 1}`, label: 'Next fixture' } : null;
  current = deskScreen({ key: n, label: item.label, title: item.training ? 'Training cargo' : item.fixture.vessel, items: [item], next }, again);
  return current.el;
}

function dayDeskView(k) {
  if (!DAYS[k - 1]) return notFound();
  const next = k < DAYS.length ? { href: `#/day/${k + 1}`, label: `Start day ${k + 1}` } : null;
  current = deskScreen({ key: dayKey(k), label: 'Desk day', title: `Day ${k}`, items: dayItems(k), next }, again);
  return current.el;
}

function dayBriefing(k) {
  if (!DAYS[k - 1]) return notFound();
  const ships = dayItems(k);
  const gap = ARRIVAL_GAP / 60;
  return h('section', { class: 'screen briefing-screen', 'aria-labelledby': 'd-title' },
    backBar(`Morning briefing \u00B7 Day ${k}`),
    h('h2', { id: 'd-title' }, `Day ${k}: three vessels`),
    h('p', { class: 'screen-lede' }, `Three ships on one desk, each on its own charter party and statement of facts. The desk clock runs them together, the next arriving ${gap} hours after the last. Tickets come from all three, so check whose terms you are reading. Three wrong calls across the day and ${HEAD.name} takes the desk.`),
    h('div', { class: 'day-ships' }, ships.map((it, i) => {
      const b = briefing(it);
      return h('article', { class: 'day-ship' },
        h('p', { class: 'clause-tag' }, `Vessel ${i + 1} \u00B7 arrives +${i * gap} hrs`),
        h('h3', {}, it.fixture.vessel),
        h('dl', { class: 'fx-terms' }, b.terms.filter(([key]) => ['Laytime allowed', 'Exceptions', 'Waiting for berth', 'Despatch'].includes(key)).map(([key, v]) => h('div', {}, h('dt', {}, key), h('dd', {}, v)))),
        h('div', { class: 'clause' }, h('p', { class: 'clause-tag' }, 'The clause that matters'), h('h4', {}, b.clause.title), h('p', {}, b.clause.text)));
    })),
    h('figure', { class: 'quote' },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, HEAD.name.split(' ').map((w) => w[0]).join('')),
      h('blockquote', {}, h('p', {}, 'Three ships, three charter parties. Before you call a ticket, read whose it is. Same rain, different clause, different answer.')),
      h('figcaption', {}, `${HEAD.name}, ${HEAD.role.toLowerCase()}`)),
    h('div', { class: 'brief-actions' },
      btn('big ink', { href: `#/daydesk/${k}` }, 'Open the desk'),
      h('p', { class: 'dnote' }, 'Each vessel opens with when its laytime starts, and closes with settlement and the owner\u2019s statement.')));
}

function render() {
  current?.destroy();
  current = null;
  const route = location.hash.replace(/^#\/?/, '');
  const [screen, arg] = route.split('/');
  const view = !screen ? titleScreen()
    : screen === 'glossary' ? glossaryScreen()
      : screen === 'ledger' ? ledgerScreen()
        : screen === 'briefing' ? briefingScreen(Number(arg))
          : screen === 'desk' ? deskView(Number(arg))
            : screen === 'day' ? dayBriefing(Number(arg))
              : screen === 'daydesk' ? dayDeskView(Number(arg))
            : notFound();
  stage.replaceChildren(view);
  stage.dataset.screen = screen || 'title';
  if (screen) stage.scrollIntoView({ block: 'start' });
}

try {
  items = await loadFixtures();
  addEventListener('hashchange', render);
  render();
  if (!profile.name()) askName();
} catch (e) {
  stage.replaceChildren(h('p', { class: 'stage-error' }, `The desk could not load: ${e.message}. Reload the page to try again.`));
}
