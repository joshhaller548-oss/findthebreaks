// Landing page: each task block shows its drill count, its languages and
// how far this browser has got. Counts come from the drill files and ticks
// from saved progress, checked against the current answer keys first, so a
// tick earned against an old key never shows.

import { store } from './store.mjs';
import { drills as reconciliation } from './drills/reconciliation.mjs';
import { drills as laytime } from './drills/laytime.mjs';
import { harbour } from './desk/harbour.mjs';

// The harbour picture on the laytime desk block, same drawing as the game
document.querySelector('.fb-art')?.append(harbour({ vessel: 'Training' }));

const TASKS = {
  reconciliation: { drills: reconciliation, key: '/data/reconciliation.key.json' },
  laytime: { drills: laytime, key: '/data/laytime.drills.key.json' },
};

const languagesOf = (drills) => [['Excel', 'excel'], ['SQL', 'sql']].filter(([, f]) => drills.some((d) => d[f])).map(([label]) => label);

for (const block of document.querySelectorAll('.task-block[data-task]')) {
  const { drills, key } = TASKS[block.dataset.task];
  const n = drills.length;
  const meta = block.querySelector('.tb-meta');
  meta.textContent = `${n} drills · ${languagesOf(drills).join(', ')}`;
  fetch(key)
    .then((r) => r.json())
    .then(({ fingerprints }) => {
      for (const [lang, fp] of Object.entries(fingerprints)) store.syncKey(block.dataset.task, lang, fp);
      const solved = drills.filter((d) => store.statusInAny(block.dataset.task, d.id)).length;
      if (!solved) return;
      meta.textContent += ` · ${solved} of ${n} solved`;
      const bar = block.querySelector('.tb-bar');
      bar.hidden = false;
      // Fill on the next frame so the width change animates
      requestAnimationFrame(() => requestAnimationFrame(() => bar.firstElementChild.style.setProperty('--done', `${(100 * solved) / n}%`)));
    })
    .catch(() => {});
}
