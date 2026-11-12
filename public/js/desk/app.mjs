// /laytime: the desk game. Screens are routed on the hash so the back
// button works: #/ title, #/glossary, #/ledger, #/briefing/<n>, #/desk/<n>.
// The Excel and SQL drills live at /laytime/tools.

import { h } from '../dom.mjs';
import { profile, NAME_MAX } from './profile.mjs';
import { glossary } from './glossary.mjs';
import { loadFixtures } from './fixtures.mjs';
import { briefing, HEAD } from './briefing.mjs';
import { harbour } from './harbour.mjs';
import { deskScreen } from './desk-screen.mjs';

// Fixtures whose desk is built so far: the training cargo. The twelve
// fixtures open in a later slice.
const PLAYABLE = new Set([0]);

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

function wordmark() {
  return h('h1', { class: 'wordmark', 'aria-label': 'Find the Breaks' },
    h('span', { class: 'wm-line' }, 'Find the'), ' ',
    h('span', { class: 'wm-line' }, h('span', { class: 'wm-break' }, 'Breaks')));
}

// ---------- screens ----------

function titleScreen() {
  const next = nextItem();
  const name = profile.name();
  return h('section', { class: 'screen title-screen', 'aria-label': 'Title' },
    harbour({ vessel: next.training ? 'Training' : next.fixture.vessel }),
    h('div', { class: 'title-body' },
      h('div', { class: 'title-left' },
        wordmark(),
        h('p', { class: 'tagline' }, 'A game about laytime, breaks and the owner’s statement.'),
        name ? h('p', { class: 'greet' }, 'On the desk: ', h('strong', {}, name)) : null,
      ),
      h('nav', { class: 'title-actions', 'aria-label': 'Desk' },
        btn('big ink', { href: `#/briefing/${next.n}` },
          next.training ? h('span', { class: 'tag-chip' }, 'Training cargo') : null,
          'Start the next fixture',
          h('span', { class: 'sub' }, next.training ? 'Learn the clock on one cargo first' : next.label)),
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
  const runs = profile.ledger();
  return h('section', { class: 'screen ledger-screen', 'aria-labelledby': 'l-title' },
    backBar('Ledger'),
    h('h2', { id: 'l-title' }, 'Your ledger'),
    runs.length
      ? h('p', {}, `${runs.length} run${runs.length === 1 ? '' : 's'} settled.`)
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
    PLAYABLE.has(item.n)
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

function deskView(n) {
  const item = items.find((it) => it.n === n);
  if (!item || !PLAYABLE.has(n)) return notFound();
  current = deskScreen(item, { onLeave: (why) => (why === 'again' ? render() : null) });
  return current.el;
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
