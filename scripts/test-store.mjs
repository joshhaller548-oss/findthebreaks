// Saved progress: clean and after-reveal solves, upgrades, key changes,
// schema changes and storage that throws. Uses an in-memory storage.

import { createStore } from '../public/js/store.mjs';

const memory = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    raw: m,
  };
};

let fails = 0;
let count = 0;
const check = (label, ok) => {
  count++;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

{
  const mem = memory();
  const s = createStore(() => mem);
  s.syncKey('reconciliation', 'sql', 'key-a');
  check('unsolved drill has no status', s.status('reconciliation', 4, 'sql') === null);
  s.markSolved('reconciliation', 4, 'sql', { afterReveal: true });
  check('solve after reveal gives a hollow tick', s.status('reconciliation', 4, 'sql') === 'after-reveal');
  check('hollow tick is stored apart from clean solves', JSON.parse(mem.getItem('findthebreaks:progress')).solved['reconciliation:4:sql'] === undefined);
  s.markSolved('reconciliation', 4, 'sql');
  check('a later clean solve upgrades it to a full tick', s.status('reconciliation', 4, 'sql') === 'clean');
  check('the upgrade removes the hollow record', JSON.parse(mem.getItem('findthebreaks:progress')).afterReveal['reconciliation:4:sql'] === undefined);
  s.markSolved('reconciliation', 4, 'sql', { afterReveal: true });
  check('a solve after reveal never downgrades a full tick', s.status('reconciliation', 4, 'sql') === 'clean');
  check('status is per language', s.status('reconciliation', 4, 'excel') === null);
  s.markSolved('reconciliation', 5, 'excel', { afterReveal: true });
  s.markSolved('reconciliation', 5, 'sql');
  check('best status across languages prefers clean', s.statusInAny('reconciliation', 5) === 'clean');
  check('best status across languages reports after-reveal alone', (s.markSolved('reconciliation', 6, 'excel', { afterReveal: true }), s.statusInAny('reconciliation', 6)) === 'after-reveal');

  s.saveAnswer('reconciliation', 4, 'sql', 'SELECT 1');
  const cleared = s.syncKey('reconciliation', 'sql', 'key-b');
  check('a changed SQL key clears SQL ticks, clean and hollow', cleared === 2 && s.status('reconciliation', 4, 'sql') === null && s.status('reconciliation', 5, 'sql') === null);
  check('and keeps the saved answer', s.lastAnswer('reconciliation', 4, 'sql') === 'SELECT 1');
  check('and leaves Excel ticks alone', s.status('reconciliation', 5, 'excel') === 'after-reveal');
  check('the same key again clears nothing', s.syncKey('reconciliation', 'sql', 'key-b') === 0);
}

{
  const mem = memory();
  mem.setItem('findthebreaks:progress', JSON.stringify({ schema: 2, keys: { reconciliation: 'x' }, complete: { 'reconciliation:4:sql': true }, answers: {} }));
  mem.setItem('findthebreaks:v1', '{}');
  const s = createStore(() => mem);
  s.syncKey('reconciliation', 'sql', 'key-a');
  check('progress saved in an older schema is dropped', s.status('reconciliation', 4, 'sql') === null);
  check('the retired storage key is removed', mem.getItem('findthebreaks:v1') === null);
}

{
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const s = createStore(() => throwing);
  let ok = true;
  try {
    s.syncKey('reconciliation', 'sql', 'k');
    s.markSolved('reconciliation', 4, 'sql');
    s.saveAnswer('reconciliation', 4, 'sql', 'x');
    ok = s.status('reconciliation', 4, 'sql') === null && s.lastAnswer('reconciliation', 4, 'sql') === '';
  } catch {
    ok = false;
  }
  check('storage that throws (private window) never breaks the page', ok);
  const missing = createStore(() => { throw new Error('no localStorage'); });
  check('no storage at all is handled too', missing.status('reconciliation', 1, 'sql') === null);
}

console.log(`\n${count - fails} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
