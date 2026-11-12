// The live desk for one fixture: status bar, harbour, the ticket you are
// working, and the running statement. The clock, the answers and the score
// come from run.mjs; this file only draws them and takes your calls.

import { h } from '../dom.mjs';
import { fromMin } from '../laytime/calc.mjs';
import { createRun, ticketTitle, CALLS, STRIKES } from './run.mjs';
import { when, HEAD } from './briefing.mjs';
import { harbour } from './harbour.mjs';
import { profile } from './profile.mjs';

// Simulated minutes per real second, at normal and fast speed
const SPEEDS = { normal: 240, fast: 960 };
const HEAD_DELAY = 900;
const USD = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const N = new Intl.NumberFormat('en-GB');
const hrs = (min) => (min / 60).toFixed(2);
const hm = (min) => {
  const m = Math.abs(Math.round(min));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};
const stamp = (t) => when(fromMin(t));
const span = (a, b) => {
  const [sa, sb] = [fromMin(a), fromMin(b)];
  return sa.slice(0, 10) === sb.slice(0, 10) ? `${stamp(a)} to ${sb.slice(11)}` : `${stamp(a)} to ${stamp(b)}`;
};
const owed = (r, amount) => (r === 'level' ? 'Level' : `${r === 'demurrage' ? 'Demurrage' : 'Despatch'} USD ${USD.format(amount)}`);
const stars = (n) => h('span', { class: 'stars', 'aria-label': `${n} of 3 stars` }, '★'.repeat(n), h('span', { class: 'off' }, '★'.repeat(3 - n)));

function termsStrip(f) {
  return h('ul', { class: 'terms-strip', 'aria-label': 'Terms on this fixture' },
    h('li', {}, f.shex_basis === 'SHINC' ? 'SHINC: Sundays and holidays count' : `${f.shex_basis}, ${f.shex_window}`),
    h('li', {}, 'Weather, breakdowns and shifting are excepted'),
    h('li', {}, f.shex_basis === 'SHINC' ? 'Holidays count' : 'Holidays are excepted'),
    h('li', {}, f.waiting_for_berth ? 'Waiting for berth counts' : 'Waiting for berth is not covered'),
    h('li', {}, `Despatch at half rate, ${f.despatch_basis}`));
}

// Tips that pause the clock, on the training cargo only
const TIPS = {
  start: () => ({ title: 'NOR is in', text: 'Laytime does not start at NOR. Turn time runs first, unless loading starts before it ends. Your first call is when the clock starts.' }),
  commenced: () => ({ title: 'Laytime is running', text: 'From here every hour counts against the charterer, unless a ticket says otherwise. The ticker shows the despatch still in hand.' }),
  time: () => ({ title: 'Read the terms first', text: 'Each ticket is one entry from the statement of facts. Check it against the terms strip, then call it. Keys: C counts, E excepted.' }),
  settle: () => ({ title: 'Loading is complete', text: 'Now settle it. Under laytime is despatch at half the demurrage rate; over is demurrage at the full rate. Mind the despatch basis.' }),
};

export function deskScreen(item, { onLeave } = {}) {
  const run = createRun(item);
  const f = item.fixture;
  const tips = item.training ? new Set(Object.keys(TIPS)) : new Set();
  let speed = 'normal';
  let paused = false;
  let tip = null;
  let feedback = null;
  let gain = null;
  let explainStage = 'write';
  let explainText = '';
  let headTimer = 0;
  let recorded = false;
  let raf = 0;
  let last = 0;
  let shownMoney = null;

  // ---------- status bar ----------
  const clockEl = h('span', { class: 'sb-value mono' });
  const phaseEl = h('span', { class: 'phase' });
  const leftEl = h('span', { class: 'sb-value mono' });
  const moneyLabel = h('span', { class: 'sb-label' });
  const moneyEl = h('span', { class: 'sb-value mono money' });
  const scoreEl = h('span', { class: 'sb-value mono' });
  const strikesEl = h('span', { class: 'strikes', 'aria-label': 'Wrong calls' });
  const pauseBtn = h('button', { class: 'gbtn small outline', type: 'button', onclick: () => setPaused(!paused) }, 'Pause');
  const speedBtn = h('button', { class: 'gbtn small outline', type: 'button', 'aria-pressed': 'false', onclick: () => {
    speed = speed === 'normal' ? 'fast' : 'normal';
    speedBtn.setAttribute('aria-pressed', String(speed === 'fast'));
    speedBtn.textContent = speed === 'fast' ? 'Speed x4' : 'Speed x1';
  } }, 'Speed x1');
  const bar = h('header', { class: 'desk-bar' },
    h('div', { class: 'sb vessel' }, h('span', { class: 'sb-label' }, item.label), h('span', { class: 'sb-value' }, item.training ? 'Training cargo' : f.vessel)),
    h('div', { class: 'sb' }, h('span', { class: 'sb-label' }, 'Clock'), clockEl, phaseEl),
    h('div', { class: 'sb' }, h('span', { class: 'sb-label' }, 'Laytime left'), leftEl),
    h('div', { class: 'sb' }, moneyLabel, moneyEl),
    h('div', { class: 'sb' }, h('span', { class: 'sb-label' }, 'Score'), scoreEl, strikesEl),
    h('div', { class: 'sb controls' }, pauseBtn, speedBtn));

  const harb = harbour({ vessel: item.training ? 'Training' : f.vessel, loading: false });
  const work = h('div', { class: 'desk-work', 'aria-live': 'polite' });
  const statementRows = h('ol', { class: 'statement' });
  const statement = h('aside', { class: 'desk-statement', 'aria-label': 'Your statement' }, h('h3', {}, 'Your statement'), statementRows);
  const el = h('section', { class: 'screen desk-screen', 'aria-label': 'The desk' },
    bar, harb, termsStrip(f), h('div', { class: 'desk-grid' }, work, statement));

  // ---------- drawing ----------
  function drawStatus() {
    clockEl.textContent = stamp(run.t);
    const phase = run.phase();
    phaseEl.textContent = { 'turn time': 'Turn time', laytime: 'Laytime running', ticket: 'Ticket open', complete: 'Loading complete', owner: 'Owner check' }[phase];
    phaseEl.dataset.phase = phase;
    const left = run.left;
    leftEl.textContent = left >= 0 ? hm(left) : `over ${hm(left)}`;
    leftEl.classList.toggle('neg', left < 0);
    // Despatch still in hand at half rate, or demurrage running at full rate
    const rate = f.demurrage_rate_usd_per_day;
    const money = left >= 0 ? (left / 1440) * (rate / 2) : (-left / 1440) * rate;
    moneyLabel.textContent = left >= 0 ? 'Despatch in hand' : 'Demurrage running';
    moneyEl.classList.toggle('up', left < 0);
    shownMoney = shownMoney === null ? money : shownMoney + (money - shownMoney) * 0.3;
    if (Math.abs(money - shownMoney) < 0.5) shownMoney = money;
    moneyEl.textContent = `USD ${USD.format(shownMoney)}`;
    scoreEl.textContent = N.format(run.score);
    if (Number.isFinite(run.strikesAllowed)) {
      strikesEl.replaceChildren(...Array.from({ length: STRIKES }, (_, i) => h('span', { class: i < run.strikes ? 'used' : '' }, '')));
      strikesEl.setAttribute('aria-label', `${run.strikes} of ${STRIKES} wrong calls used`);
    } else strikesEl.replaceChildren(h('span', { class: 'free' }, 'no strike limit'));
    harb.classList.toggle('loading', run.t >= run.loadStart && run.t < run.done && !run.open);
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  }

  function addLine(line) {
    statementRows.append(h('li', { class: `st-line ${line.kind || ''}` },
      h('span', { class: 'st-when' }, line.when),
      h('span', { class: 'st-hrs mono' }, line.hrs ?? ''),
      h('span', { class: 'st-what' }, line.what),
      h('span', { class: 'st-used mono' }, line.used ?? '')));
    statementRows.lastElementChild.scrollIntoView?.({ block: 'nearest' });
  }

  function lineFor(l) {
    const tag = l.byHead ? `, called by ${HEAD.name.split(' ')[0]}` : l.firstTime ? '' : ', recast';
    if (l.type === 'time') return { kind: l.call, when: span(l.start, l.end), hrs: hrs(l.minutes), what: `${ticketTitle(l, f)} · ${CALLS[l.call]}${tag}`, used: `${hrs(l.usedAfter)} used` };
    if (l.type === 'start') {
      const o = l.options.find((x) => x.id === l.call);
      return { kind: 'milestone', when: stamp(o.at), what: `Laytime commences, ${o.why}${tag}`, used: '0.00 used' };
    }
    if (l.type === 'settle') return { kind: 'milestone', when: stamp(run.done), what: `Settled: ${l.options.find((x) => x.id === l.call).label}${tag}`, used: `${hrs(l.usedAfter)} used` };
    return { kind: 'milestone', when: 'Owner', what: `Owner’s statement ${l.call === 'dispute' ? 'disputed' : 'accepted'}${tag}`, used: '' };
  }

  const optionButtons = (tk) => h('div', { class: 'ticket-options' }, tk.options.map((o, i) =>
    h('button', { class: 'gbtn outline option', type: 'button', onclick: () => call(o.id) },
      tk.type === 'start' ? stamp(o.at) : o.label,
      h('span', { class: 'sub' }, tk.type === 'start' ? `${o.why} · key ${i + 1}` : `key ${i + 1}`))));

  function ticketBody(tk) {
    if (tk.type === 'time') {
      return [
        h('p', { class: 'ticket-when mono' }, `${span(tk.start, tk.end)} · ${hrs(tk.minutes)} hrs`),
        h('p', { class: 'ticket-ask' }, 'Does this time count against laytime?'),
        h('div', { class: 'ticket-calls' },
          h('button', { class: 'gbtn ink', type: 'button', onclick: () => call('counts') }, CALLS.counts, h('span', { class: 'sub' }, 'key C')),
          h('button', { class: 'gbtn accent', type: 'button', onclick: () => call('off') }, CALLS.off, h('span', { class: 'sub' }, 'key E'))),
      ];
    }
    if (tk.type === 'start') {
      return [
        h('dl', { class: 'sof' },
          h('div', {}, h('dt', {}, 'NOR tendered'), h('dd', {}, stamp(run.nor))),
          h('div', {}, h('dt', {}, 'Turn time'), h('dd', {}, `${f.turn_time_hrs} hrs`)),
          h('div', {}, h('dt', {}, 'Loading commenced'), h('dd', {}, stamp(run.loadStart)))),
        h('p', { class: 'ticket-ask' }, 'When does the laytime clock start?'),
        optionButtons(tk),
      ];
    }
    if (tk.type === 'settle') {
      return [
        h('dl', { class: 'sof' },
          h('div', {}, h('dt', {}, 'Laytime allowed'), h('dd', {}, `${hrs(run.allowed)} hrs`)),
          h('div', {}, h('dt', {}, 'Laytime used'), h('dd', {}, `${hrs(run.used)} hrs`)),
          h('div', {}, h('dt', {}, 'Demurrage rate'), h('dd', {}, `USD ${N.format(f.demurrage_rate_usd_per_day)} a day`)),
          h('div', {}, h('dt', {}, 'Despatch'), h('dd', {}, `half rate, ${f.despatch_basis}`))),
        h('p', { class: 'ticket-ask' }, 'What is owed, and to whom?'),
        optionButtons(tk),
      ];
    }
    // The owner's statement beside yours
    const o = tk.owner;
    return [
      h('table', { class: 'owner-table' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Owner'), h('th', {}, 'Yours'))),
        h('tbody', {},
          h('tr', {}, h('th', {}, 'Laytime commenced'), h('td', {}, when(o.laytime_commenced)), h('td', {}, when(tk.yours.laytime_commenced))),
          h('tr', {}, h('th', {}, 'Laytime used'), h('td', {}, `${o.laytime_used_hrs.toFixed(2)} hrs`), h('td', {}, `${hrs(tk.yours.used_min)} hrs`)),
          h('tr', {}, h('th', {}, 'Owed'), h('td', {}, owed(o.result, o.amount_usd)), h('td', {}, owed(tk.yours.result, tk.yours.amount_usd))))),
      h('p', { class: 'ticket-ask' }, 'Do you sign the owner’s statement?'),
      h('div', { class: 'ticket-calls' },
        h('button', { class: 'gbtn ok', type: 'button', onclick: () => call('agree') }, CALLS.agree, h('span', { class: 'sub' }, 'key A')),
        h('button', { class: 'gbtn accent', type: 'button', onclick: () => call('dispute') }, CALLS.dispute, h('span', { class: 'sub' }, 'key D'))),
    ];
  }

  function drawWork() {
    if (tip) {
      work.replaceChildren(h('div', { class: 'tip', role: 'dialog', 'aria-label': tip.title },
        h('p', { class: 'tip-tag' }, 'Coaching · clock paused'),
        h('h3', {}, tip.title),
        h('p', {}, tip.text),
        h('button', { class: 'gbtn ink', type: 'button', onclick: closeTip }, 'Got it')));
      work.querySelector('button').focus({ preventScroll: true });
      return;
    }
    if (run.explaining) return work.replaceChildren(explainCard(run.explaining));
    if (run.finished) return work.replaceChildren(recapCard());
    const tk = run.open;
    if (!tk) {
      work.replaceChildren(h('div', { class: 'waiting' },
        run.takenOver ? h('p', { class: 'taken' }, `${HEAD.name} has the desk.`) : null,
        h('p', { class: 'mono' }, run.t < run.commenced ? 'Turn time running.' : 'Laytime running.'),
        h('p', { class: 'muted' }, 'Waiting for the next entry from the agent.'),
        gain ? h('p', { class: 'gain' }, `+${gain}`) : null));
      return;
    }
    const n = run.steps.indexOf(tk) + 1;
    work.replaceChildren(h('article', { class: `ticket t-${tk.type}`, 'aria-labelledby': 'tk-title' },
      h('p', { class: 'ticket-no' }, `Ticket ${String(n).padStart(2, '0')} of ${String(run.steps.length).padStart(2, '0')} · ${tk.type === 'time' ? 'statement of facts' : tk.type === 'owner' ? 'owner’s laytime statement' : 'your call'}`),
      h('h3', { id: 'tk-title' }, ticketTitle(tk, f)),
      ...ticketBody(tk),
      run.takenOver ? h('p', { class: 'taken' }, `${HEAD.name} has taken the desk and is calling this one.`) : null,
      feedback ? h('div', { class: 'coach', role: 'alert' },
        h('p', { class: 'coach-tag' }, `${HEAD.name} · not quite`),
        h('p', {}, feedback),
        run.takenOver ? null : h('p', { class: 'muted small' }, 'Call it again.')) : null));
    if (run.takenOver) scheduleHead();
  }

  // After disputing: one sentence, then the model note, then your own mark
  function explainCard(tk) {
    const area = h('textarea', { class: 'explain-input', rows: '3', maxlength: '300', placeholder: 'One sentence: what did the owner do wrong?', 'aria-label': 'What the owner got wrong' });
    area.value = explainText;
    area.addEventListener('input', () => { explainText = area.value; });
    const parts = [
      h('p', { class: 'ticket-no' }, 'Owner’s statement · disputed'),
      h('h3', {}, 'What did the owner get wrong?'),
      h('p', {}, `They claim ${tk.gap_hrs.toFixed(2)} hrs more laytime used than you. Say why in one sentence, the way you would put it to the owner.`),
    ];
    if (explainStage === 'write') {
      parts.push(area, h('div', { class: 'sum-actions' },
        h('button', { class: 'gbtn ink', type: 'button', onclick: () => { explainStage = 'mark'; drawWork(); } }, 'Compare with the model note')));
    } else {
      parts.push(
        explainText.trim() ? h('blockquote', { class: 'yours' }, h('p', {}, explainText.trim())) : h('p', { class: 'muted' }, 'You left it blank.'),
        h('div', { class: 'model-note' }, h('p', { class: 'coach-tag' }, 'Model note'), h('p', {}, tk.error?.note ?? 'Their laytime used is higher than the true figure.')),
        h('p', { class: 'ticket-ask' }, 'Did your sentence say the same thing?'),
        h('div', { class: 'ticket-calls' },
          h('button', { class: 'gbtn ok', type: 'button', onclick: () => finishExplain(true) }, 'Yes, I had it'),
          h('button', { class: 'gbtn outline', type: 'button', onclick: () => finishExplain(false) }, 'Not quite')));
    }
    return h('article', { class: 'ticket t-explain' }, ...parts);
  }

  function recapCard() {
    const s = run.summary();
    if (!recorded) {
      recorded = true;
      profile.record({ n: item.n, label: item.label, vessel: f.vessel, score: s.score, stars: s.stars, right: s.rightFirstTime, decisions: s.decisions, difference_usd: s.difference_usd, takenOver: s.takenOver });
    }
    const best = Math.max(...profile.ledger().filter((e) => e.n === item.n).map((e) => e.score));
    const diff = s.difference_usd;
    const verdict = diff === 0 ? 'Your calls match the true statement.'
      : diff < 0 ? `Your calls cost the charterer USD ${USD.format(-diff)} more than the true statement.`
        : `Your calls claim USD ${USD.format(diff)} more than the true statement. The owner will push back.`;
    const ood = s.yours.demurrage_after_exceptions && !s.correct.demurrage_after_exceptions;
    const ownerTk = run.steps.find((t) => t.type === 'owner');
    const describe = (tk) => {
      const first = run.firstCall(tk.id);
      if (tk.type === 'time') return [h('strong', {}, `${ticketTitle(tk, f)}, ${hrs(tk.minutes)} hrs. `), `You called it ${CALLS[first].toLowerCase()}; it ${tk.answer === 'off' ? 'is excepted' : 'counts'}.`];
      if (tk.type === 'start') return [h('strong', {}, 'Laytime start. '), `You said ${tk.options.find((o) => o.id === first).why}; it starts ${tk.options.find((o) => o.id === tk.answer).why}.`];
      if (tk.type === 'settle') return [h('strong', {}, 'Settlement. '), `You said ${tk.options.find((o) => o.id === first).label}; it is ${tk.options.find((o) => o.id === tk.answer).label}.`];
      return [h('strong', {}, 'Owner’s statement. '), `You chose to ${CALLS[first].toLowerCase()} it; the right call was to ${CALLS[tk.answer].toLowerCase()}.`];
    };
    const next = item.n + 1;
    return h('article', { class: 'summary', 'aria-labelledby': 'sum-title' },
      h('p', { class: 'ticket-no' }, `Loading complete · ${stamp(run.done)}`),
      h('div', { class: 'sum-head' },
        h('h3', { id: 'sum-title' }, item.training ? 'Training cargo settled' : `${f.vessel} settled`),
        stars(s.stars)),
      h('p', { class: 'sum-score mono' }, `Score ${N.format(s.score)}`, h('span', { class: 'muted' }, ` · best on this fixture ${N.format(best)}`)),
      s.takenOver ? h('p', { class: 'taken' }, `Three wrong calls, so ${HEAD.name} took the desk. Run it again to settle it yourself.`) : null,
      h('dl', { class: 'sum-grid' },
        h('div', {}, h('dt', {}, 'Your first calls'), h('dd', { class: 'mono' }, owed(s.yours.result, s.yours.amount_usd)), h('dd', { class: 'muted mono' }, `${hrs(s.yours.used_min)} hrs used`)),
        h('div', {}, h('dt', {}, 'True statement'), h('dd', { class: 'mono' }, owed(s.correct.result, s.correct.amount_usd)), h('dd', { class: 'muted mono' }, `${hrs(s.correct.used_min)} hrs used`)),
        h('div', { class: `diff ${diff === 0 ? 'zero' : 'off'}` }, h('dt', {}, 'Difference'), h('dd', { class: 'mono big' }, `USD ${USD.format(Math.abs(diff))}`), h('dd', {}, verdict))),
      h('p', {}, `Right first time: ${s.rightFirstTime} of ${s.decisions} calls.`),
      ownerTk ? h('p', {}, ownerTk.answer === 'dispute'
        ? `The owner claimed ${ownerTk.gap_hrs.toFixed(2)} hrs more than the true statement.${s.explained ? (s.explained.gotIt ? ' You named the error.' : ' Read the model note again.') : ''}`
        : 'The owner’s statement was right, and signing it was the right call.') : null,
      ood ? h('p', { class: 'note' }, `By your calls laytime ran out at ${when(s.yours.laytime_expiry)}, before the excepted time that followed. Once on demurrage, always on demurrage: those hours no longer came off.`) : null,
      s.wrong.length ? h('ul', { class: 'sum-wrong' }, s.wrong.map((tk) => h('li', {}, ...describe(tk)))) : null,
      h('div', { class: 'sum-actions' },
        next <= 12 ? h('a', { class: 'gbtn ink', href: `#/briefing/${next}` }, 'Next fixture') : null,
        h('button', { class: 'gbtn outline', type: 'button', onclick: () => onLeave?.('again') }, 'Run it again'),
        h('a', { class: 'gbtn outline', href: '#/ledger' }, 'Ledger')));
  }

  // ---------- play ----------
  function showTip(key) {
    if (!tips.has(key)) return false;
    tips.delete(key);
    tip = TIPS[key](run);
    drawWork();
    return true;
  }
  function closeTip() {
    tip = null;
    drawWork();
    last = performance.now();
  }
  function setPaused(p) {
    paused = p;
    last = performance.now();
    drawStatus();
  }
  function afterClose() {
    feedback = null;
    const l = run.lines[run.lines.length - 1];
    addLine(lineFor(l));
    if (run.open && tipFor(run.open)) return;
    drawWork();
  }
  const tipFor = (tk) => showTip(tk.type === 'time' ? 'time' : tk.type);
  function call(answer) {
    if (run.takenOver) return;
    const r = run.call(answer);
    if (!r) return;
    if (!r.right) {
      feedback = r.message;
      drawWork();
      drawStatus();
      return;
    }
    gain = r.gained || null;
    afterClose();
    drawStatus();
  }
  function scheduleHead() {
    if (headTimer) return;
    headTimer = setTimeout(() => {
      headTimer = 0;
      if (!run.open) return;
      run.headCall();
      if (run.explaining) run.explain(null, false);
      afterClose();
    }, HEAD_DELAY);
  }
  function finishExplain(gotIt) {
    run.explain(explainText.trim(), gotIt);
    drawWork();
    drawStatus();
  }

  let commencedShown = false;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused && !tip && !run.open && !run.finished && !run.explaining) {
      const before = run.t;
      const state = run.advance(dt * SPEEDS[speed]);
      if (!commencedShown && run.t >= run.commenced && before < run.commenced) {
        commencedShown = true;
        if (showTip('commenced')) { drawStatus(); return; }
      }
      if (state === 'ticket') {
        if (!tipFor(run.open)) drawWork();
      } else if (state === 'complete') drawWork();
    }
    drawStatus();
  }

  function onKey(e) {
    if (e.target.closest?.('input, textarea, dialog')) return;
    const tk = run.open;
    const k = e.key.toLowerCase();
    if (tk && !tip && !run.takenOver) {
      if (tk.type === 'time' && (k === 'c' || k === 'e')) { e.preventDefault(); return call(k === 'c' ? 'counts' : 'off'); }
      if (tk.type === 'owner' && (k === 'a' || k === 'd')) { e.preventDefault(); return call(k === 'a' ? 'agree' : 'dispute'); }
      if (tk.options && /^[1-9]$/.test(k) && tk.options[Number(k) - 1]) { e.preventDefault(); return call(tk.options[Number(k) - 1].id); }
    }
    if (e.key === ' ' && !run.finished && e.target === document.body) { e.preventDefault(); setPaused(!paused); }
  }

  addLine({ kind: 'milestone', when: stamp(run.nor), what: 'NOR tendered', used: '' });
  drawStatus();
  if (!(run.open && tipFor(run.open))) drawWork();
  last = performance.now();
  raf = requestAnimationFrame(frame);
  addEventListener('keydown', onKey);

  return {
    el,
    run,
    destroy() {
      cancelAnimationFrame(raf);
      clearTimeout(headTimer);
      removeEventListener('keydown', onKey);
    },
  };
}

