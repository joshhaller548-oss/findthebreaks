// A task page: drill list on the left, working area on the right, reference
// tables underneath. Shared by every task so they behave the same way.

import { h, dataTable, clock } from './dom.mjs';
import { compare, diagnose, fill, plural } from './check.mjs';
import { store } from './store.mjs';

const MOBILE = '(max-width: 860px)';

export function mountTaskPage(cfg) {
  const { task, drills, data, key, languages, counts, els, panels = {}, onProgress = () => {} } = cfg;
  // Ids repeat across languages, so match on all three
  const pitfalls = key.pitfalls.map((p) => ({ ...p, ...cfg.pitfalls.find((q) => q.drill === p.drill && q.id === p.id && q.lang === p.lang) }));
  // A free-text drill is not in any one language
  const langOf = (d) => (d.kind === 'text' ? 'text' : state.lang);
  const byId = new Map(drills.map((d) => [d.id, d]));
  const text = (s) => fill(s || '', counts);

  const state = {
    drillId: drillFromHash() ?? 1,
    lang: languages[0].id,
    drafts: new Map(),
    engines: new Map(),
    reveal: 0,
    hint: false,
    timed: null,
    // Drills whose answer was revealed in this visit, per language. A
    // correct run after a reveal earns a hollow tick, not a full one.
    revealed: new Set(),
  };

  function drillFromHash() {
    const m = /^#drill-(\d+)$/.exec(location.hash);
    return m && byId.has(Number(m[1])) ? Number(m[1]) : null;
  }

  // ---------- engines ----------

  function engineFor(langId) {
    if (!state.engines.has(langId)) {
      const lang = languages.find((l) => l.id === langId);
      state.engines.set(langId, lang.load(data.tables));
    }
    return state.engines.get(langId);
  }

  // ---------- drill list ----------

  function renderList() {
    const items = [];
    for (const d of drills) {
      const open = d.id === state.drillId;
      const status = store.status(task, d.id, langOf(d));
      items.push(h('li', { class: `drill${open ? ' open' : ''}${d.key ? ' key' : ''}` },
        h('button', {
          class: 'drill-head',
          'aria-expanded': open ? 'true' : 'false',
          'aria-controls': `drill-body-${d.id}`,
          onclick: () => selectDrill(d.id, { scroll: true }),
        },
          h('span', { class: 'num' }, String(d.id).padStart(2, '0')),
          h('span', { class: 'title' }, d.title),
          h('span', { class: 'tag' }, d.tag),
          statusMark(status),
        ),
        d.key ? h('p', { class: 'key-flag' }, d.keyFlag || 'The most important drill on the site') : null,
        h('div', { class: 'drill-body', id: `drill-body-${d.id}`, hidden: !open }, h('p', {}, text(d.question))),
      ));
      if (panels[d.id]) items.push(h('li', { class: 'panel-item' }, panels[d.id]()));
    }
    els.list.replaceChildren(
      h('ol', { class: 'drill-list' }, items),
      h('p', { class: 'legend' },
        h('span', {}, statusMark('clean'), ' solved'),
        h('span', {}, statusMark('after-reveal'), ' solved after reveal'),
      ),
    );
  }

  function statusMark(status) {
    if (status === 'clean') return h('span', { class: 'status done', title: 'Solved', 'aria-label': 'solved' }, '✓');
    if (status === 'after-reveal') return h('span', { class: 'status hollow', title: 'Solved after revealing the answer', 'aria-label': 'solved after reveal' }, '✓');
    return h('span', { class: 'status', 'aria-label': 'not solved' }, '');
  }

  function selectDrill(id, { scroll = false } = {}) {
    if (state.timed && !state.timed.done && id !== 10) stopTimed();
    state.drillId = id;
    state.reveal = 0;
    state.hint = false;
    history.replaceState(null, '', `#drill-${id}`);
    renderList();
    renderWork();
    if (scroll && matchMedia(MOBILE).matches) els.work.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- working area ----------

  const draftKey = (drillId) => `${drillId}:${state.lang}`;

  function currentDrill() {
    const d = byId.get(state.drillId);
    if (d.timed && state.timed && !state.timed.done) return byId.get(d.timed[state.timed.step]);
    return d;
  }

  function renderWork() {
    const d = byId.get(state.drillId);
    const lang = languages.find((l) => l.id === state.lang);

    const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Language' },
      languages.map((l) => h('button', {
        role: 'tab',
        'aria-selected': l.id === state.lang ? 'true' : 'false',
        class: 'tab',
        onclick: () => { state.lang = l.id; state.reveal = 0; renderList(); renderWork(); },
      }, l.label)),
    );

    const head = h('header', { class: 'work-head' },
      h('p', { class: 'eyebrow' }, `Drill ${d.id}`, h('span', { class: 'tag' }, d.tag)),
      h('h2', {}, d.title),
    );

    if (d.timed && !(state.timed && !state.timed.done)) {
      els.work.replaceChildren(tabs, head, timedIntro(d));
      return;
    }
    if (d.kind === 'text') {
      els.work.replaceChildren(head, h('p', { class: 'question' }, text(d.question)), cfg.renderTextDrill(d, {
        status: () => store.status(task, d.id, 'text'),
        saved: () => store.lastAnswer(task, d.id, 'text'),
        save: (value) => store.saveAnswer(task, d.id, 'text', value),
        solve: () => { store.markSolved(task, d.id, 'text'); renderList(); onProgress(); },
        statusInAny: (id) => store.statusInAny(task, id),
      }));
      return;
    }

    const target = currentDrill();
    const parts = [tabs, head];
    if (d.timed) parts.push(timedBar(d));
    else parts.push(h('p', { class: 'question' }, text(d.question)));
    if (d.timed) parts.push(h('p', { class: 'question' }, h('strong', {}, `Drill ${target.id}, ${target.title}. `), text(target.question)));

    const hint = h('p', { class: 'hint', hidden: !state.hint }, h('strong', {}, 'Hint. '), text(target.hint?.[lang.id]));

    const editorKey = d.timed ? `timed:${target.id}:${lang.id}` : draftKey(d.id);
    const initial = state.drafts.get(editorKey) ?? (d.timed ? '' : store.lastAnswer(task, d.id, lang.id));
    const editor = lang.editor({
      drill: target,
      tables: data.tables,
      value: initial,
      onChange: (v) => state.drafts.set(editorKey, v),
      onRun: () => runBtn.click(),
    });

    const verdict = h('div', { class: 'verdict', 'aria-live': 'polite' });
    const answer = h('div', { class: 'answer' });

    const runBtn = h('button', { class: 'btn primary', onclick: () => run(target, editor, verdict, d) }, 'Run and check');
    const hintBtn = h('button', {
      class: 'btn',
      'aria-expanded': state.hint ? 'true' : 'false',
      onclick: () => {
        state.hint = !state.hint;
        hint.hidden = !state.hint;
        hintBtn.setAttribute('aria-expanded', state.hint ? 'true' : 'false');
      },
    }, 'Hint');
    const answerBtn = h('button', { class: 'btn quiet reveal', onclick: () => revealStep(answerBtn, answer, target, lang) }, 'Show answer');
    renderReveal(answerBtn, answer, target, lang);

    parts.push(
      hint,
      lang.instructions ? lang.instructions(target, data.tables) : null,
      h('p', { class: 'engine-note' }, typeof lang.note === 'function' ? lang.note(data.tables) : lang.note),
      editor.input,
      h('div', { class: 'actions' }, runBtn, hintBtn, answerBtn),
      answer,
      verdict,
      editor.result,
    );
    els.work.replaceChildren(...parts.filter(Boolean));

    // Load the engine now, so the first run is not the slow one
    runBtn.disabled = true;
    runBtn.textContent = `Loading ${lang.label} engine`;
    engineFor(lang.id).then(
      () => { runBtn.disabled = false; runBtn.textContent = 'Run and check'; },
      (e) => { runBtn.textContent = 'Engine failed to load'; showError(verdict, `The ${lang.label} engine did not load: ${e.message}. Reload the page to try again.`); },
    );
  }

  // Show answer is always two deliberate clicks
  // Revealing only changes what is on screen. It never ticks a drill or a
  // chip; only a correct run does. In a timed run it disqualifies the run.
  function revealStep(btn, box, drill, lang) {
    state.reveal = Math.min(2, state.reveal + 1);
    if (state.reveal === 2) {
      if (state.timed && !state.timed.done) state.timed.revealed.add(drill.id);
      else state.revealed.add(`${drill.id}:${lang.id}`);
    }
    renderReveal(btn, box, drill, lang);
  }
  function renderReveal(btn, box, drill, lang) {
    if (state.reveal === 0) {
      btn.textContent = 'Show answer';
      box.replaceChildren();
    } else if (state.reveal === 1) {
      btn.textContent = 'Yes, reveal the model answer';
      const warning = state.timed && !state.timed.done
        ? 'Revealing an answer during a timed run means the run will not count.'
        : 'Try the hint first. Once revealed, the answer stays on screen for this drill.';
      box.replaceChildren(h('p', { class: 'muted small' }, warning));
    } else {
      btn.hidden = true;
      box.replaceChildren(
        h('p', { class: 'answer-label' }, `Model answer, ${lang.label}`),
        h('pre', { class: 'code' }, lang.modelAnswer(drill, counts, data.tables)),
        h('p', { class: 'why' }, text(drill.why?.[lang.id])),
      );
    }
  }

  async function run(drill, editor, verdictEl, parent) {
    const lang = languages.find((l) => l.id === state.lang);
    const engine = await engineFor(lang.id);
    const source = editor.value();
    if (!parent.timed) store.saveAnswer(task, parent.id, lang.id, lang.serialise ? lang.serialise(source) : source);

    const out = await lang.run(engine, source, drill);
    editor.show(out);
    if (!out.ok) {
      showError(verdictEl, out.error.message);
      return;
    }
    const expected = { ...key.expected[drill.id], ordered: lang.ordered ? lang.ordered(drill) : drill.ordered };
    const res = compare(out, expected);

    if (res.verdict === 'correct') {
      let status = null;
      if (!parent.timed) {
        status = store.markSolved(task, drill.id, lang.id, { afterReveal: state.revealed.has(`${drill.id}:${lang.id}`) });
        renderList();
        onProgress();
      }
      showCorrect(verdictEl, drill, parent, out.notes || [], status);
      return;
    }
    const diag = diagnose(res, { drill, user: out, pitfalls, lang: lang.id, generic: lang.generic, counts });
    verdictEl.replaceChildren(h('div', { class: 'v v-wrong' },
      h('p', { class: 'v-label' }, h('span', { class: 'v-mark', 'aria-hidden': 'true' }, '✗'), res.shapeOk ? 'Right shape, wrong rows' : 'Wrong shape'),
      h('p', {}, diag.message),
      (out.notes || []).map((n) => h('p', { class: 'note' }, h('strong', {}, 'Note. '), n)),
    ));
  }

  function showError(el, message) {
    el.replaceChildren(h('div', { class: 'v v-error' },
      h('p', { class: 'v-label' }, h('span', { class: 'v-mark', 'aria-hidden': 'true' }, '!'), 'Error'),
      h('p', {}, message),
    ));
  }

  function showCorrect(el, drill, parent, notes = [], status = null) {
    const body = [h('p', { class: 'v-label' }, h('span', { class: 'v-mark', 'aria-hidden': 'true' }, '✓'), 'Correct')];
    if (parent.timed) {
      const t = state.timed;
      const last = t.step === parent.timed.length - 1;
      t.splits[t.step] = performance.now() - t.start;
      const revealed = t.revealed.has(drill.id) ? ' You revealed the answer, so this run will not count.' : '';
      body.push(h('p', {}, `Drill ${drill.id} done at ${clock(t.splits[t.step])}.${revealed}`));
      body.push(h('button', { class: 'btn primary', onclick: () => (last ? finishTimed() : nextTimed()) }, last ? 'Finish' : 'Next drill'));
    } else {
      body.push(h('p', {}, status === 'after-reveal'
        ? 'Your result matches the answer key. You revealed the answer first, so this drill gets a hollow tick. Solve it from scratch on a later visit to make it a full tick.'
        : cfg.correctNote?.(drill) || 'Your result matches the answer key.'));
      for (const n of notes) body.push(h('p', { class: 'note' }, h('strong', {}, 'Note. '), n));
      const next = byId.get(drill.id + 1);
      if (next) body.push(h('button', { class: 'btn', onclick: () => selectDrill(next.id, { scroll: true }) }, `Next: drill ${next.id}`));
    }
    const extra = parent.timed ? null : cfg.afterCorrect?.(drill);
    el.replaceChildren(...[h('div', { class: 'v v-correct' }, body), extra].filter(Boolean));
  }

  // ---------- timed run ----------

  function timedIntro(d) {
    const done = store.status(task, d.id, state.lang) === 'clean';
    return h('div', { class: 'timed-intro' },
      h('p', { class: 'question' }, text(d.question)),
      h('p', {}, `Drills ${d.timed.join(', ')} in a row, with empty editors. The clock runs until the last one is correct. Hints and answers stay available; using them is your call.`),
      done ? h('p', { class: 'muted' }, 'You have finished this run before in this language.') : null,
      h('button', { class: 'btn primary', onclick: startTimed }, 'Start the clock'),
    );
  }

  function timedBar(d) {
    const t = state.timed;
    const target = d.targetMinutes * 60000;
    const time = h('span', { class: 'clock', role: 'timer', 'aria-live': 'off' }, clock(performance.now() - t.start));
    clearInterval(t.tick);
    t.tick = setInterval(() => {
      const ms = performance.now() - t.start;
      time.textContent = clock(ms);
      time.classList.toggle('over', ms > target);
    }, 250);
    return h('div', { class: 'timed-bar' },
      h('span', {}, `Step ${t.step + 1} of ${d.timed.length}`),
      h('span', { class: 'clock-wrap' }, time, h('span', { class: 'muted' }, ` / ${clock(target)}`)),
      h('button', { class: 'btn quiet small', onclick: () => { stopTimed(); renderWork(); } }, 'Stop'),
    );
  }

  function startTimed() {
    state.timed = { step: 0, start: performance.now(), splits: [], revealed: new Set(), done: false };
    for (const k of [...state.drafts.keys()]) if (k.startsWith('timed:')) state.drafts.delete(k);
    state.reveal = 0;
    state.hint = false;
    renderWork();
  }
  function nextTimed() {
    state.timed.step++;
    state.reveal = 0;
    state.hint = false;
    renderWork();
  }
  function stopTimed() {
    if (state.timed) clearInterval(state.timed.tick);
    state.timed = null;
  }
  function finishTimed() {
    const d = byId.get(state.drillId);
    const t = state.timed;
    clearInterval(t.tick);
    t.done = true;
    const revealed = d.timed.filter((id) => t.revealed.has(id));
    // A run counts only if no answer was revealed. The clock never stops a
    // run: past the target it keeps going and the finish reports the overrun.
    if (!revealed.length) {
      store.markSolved(task, d.id, state.lang);
      renderList();
    }
    const total = t.splits[t.splits.length - 1];
    const target = d.targetMinutes * 60000;
    const under = total <= target && !revealed.length;
    const rows = d.timed.map((id, k) => [`Drill ${id}`, byId.get(id).title, clock(t.splits[k] - (t.splits[k - 1] || 0)), clock(t.splits[k]), t.revealed.has(id) ? 'revealed' : '']);
    const verdictText = revealed.length
      ? `Not counted: you revealed the answer on drill ${revealed.join(', ')}. Run it again without revealing to count it.`
      : total <= target
        ? 'Under target.'
        : `Over target by ${clock(total - target)}. It still counts as finished. Run it again once the moves feel automatic.`;
    els.work.replaceChildren(
      els.work.firstChild,
      h('header', { class: 'work-head' }, h('p', { class: 'eyebrow' }, `Drill ${d.id}`), h('h2', {}, 'Timed run finished')),
      h('div', { class: `v ${under ? 'v-correct' : 'v-wrong'}` },
        h('p', { class: 'v-label' }, h('span', { class: 'v-mark', 'aria-hidden': 'true' }, under ? '✓' : '✗'), `${clock(total)} against a target of ${clock(target)}`),
        h('p', {}, verdictText),
      ),
      dataTable(['drill', 'title', 'split', 'elapsed', 'answer'], rows, { caption: 'Splits' }),
      h('button', { class: 'btn', onclick: startTimed }, 'Run it again'),
    );
  }

  // ---------- reference tables ----------

  function renderReference() {
    const names = Object.keys(data.tables);
    let active = names[0];
    const body = h('div', {});
    const tabs = h('div', { class: 'tabs small', role: 'tablist', 'aria-label': 'Reference tables' });
    const draw = () => {
      tabs.replaceChildren(...names.map((n) => h('button', {
        role: 'tab',
        class: 'tab',
        'aria-selected': n === active ? 'true' : 'false',
        onclick: () => { active = n; draw(); },
      }, n, h('span', { class: 'count' }, String(data.tables[n].length)))));
      const rows = data.tables[active];
      const cols = Object.keys(rows[0]);
      body.replaceChildren(dataTable(cols, rows.map((r) => cols.map((c) => r[c])), { caption: `${active}, ${plural(rows.length, 'row')}` }));
    };
    draw();
    els.reference.replaceChildren(
      h('h2', {}, 'The data'),
      h('p', { class: 'muted' }, cfg.referenceNote || ''),
      tabs,
      body,
    );
  }

  window.addEventListener('hashchange', () => {
    const id = drillFromHash();
    if (id && id !== state.drillId) selectDrill(id);
  });

  renderList();
  renderWork();
  renderReference();
}
