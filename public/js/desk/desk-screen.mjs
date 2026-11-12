// The live desk for one fixture: status bar, harbour, the ticket you are
// working, and the running statement. The clock and the answers come from
// run.mjs; this file only draws them and takes your calls.

import { h } from '../dom.mjs';
import { fromMin } from '../laytime/calc.mjs';
import { createRun, ticketTitle, CALLS } from './run.mjs';
import { when, HEAD } from './briefing.mjs';
import { harbour } from './harbour.mjs';

// Simulated minutes per real second, at normal and fast speed
const SPEEDS = { normal: 240, fast: 960 };
const USD = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function termsStrip(f) {
  return h('ul', { class: 'terms-strip', 'aria-label': 'Terms on this fixture' },
    h('li', {}, f.shex_basis === 'SHINC' ? 'SHINC: Sundays and holidays count' : `${f.shex_basis}, ${f.shex_window}`),
    h('li', {}, 'Weather, breakdowns and shifting are excepted'),
    h('li', {}, f.shex_basis === 'SHINC' ? 'Holidays count' : 'Holidays are excepted'),
    h('li', {}, f.waiting_for_berth ? 'Waiting for berth counts' : 'Waiting for berth is not covered'));
}

// Tips that pause the clock, on the training cargo only
const TIPS = {
  start: (run) => ({ title: 'NOR is in', text: `Turn time runs first: ${run.item.fixture.turn_time_hrs} hrs before the clock starts. Nothing counts yet. Watch the phase in the status bar.` }),
  commenced: () => ({ title: 'Laytime is running', text: 'From here every hour counts against the charterer, unless a ticket says otherwise. The ticker shows the despatch still in hand.' }),
  ticket: () => ({ title: 'Read the terms first', text: 'Each ticket is one entry from the statement of facts. Check it against the terms strip, then call it. Keys: C counts, E excepted.' }),
};

export function deskScreen(item, { onLeave } = {}) {
  const run = createRun(item);
  const f = item.fixture;
  const tips = item.training ? new Set(['start', 'commenced', 'ticket']) : new Set();
  let speed = 'normal';
  let paused = false;
  let tip = null;
  let feedback = null;
  let raf = 0;
  let last = 0;
  let shownMoney = null;

  // ---------- status bar ----------
  const clockEl = h('span', { class: 'sb-value mono' });
  const phaseEl = h('span', { class: 'phase' });
  const leftEl = h('span', { class: 'sb-value mono' });
  const moneyLabel = h('span', { class: 'sb-label' });
  const moneyEl = h('span', { class: 'sb-value mono money' });
  const pauseBtn = h('button', { class: 'gbtn small outline', type: 'button', onclick: () => setPaused(!paused) }, 'Pause');
  const speedBtn = h('button', { class: 'gbtn small outline', type: 'button', 'aria-pressed': 'false', onclick: () => {
    speed = speed === 'normal' ? 'fast' : 'normal';
    speedBtn.setAttribute('aria-pressed', String(speed === 'fast'));
    speedBtn.textContent = speed === 'fast' ? 'Speed x4' : 'Speed x1';
  } }, 'Speed x1');
  const bar = h('header', { class: 'desk-bar' },
    h('div', { class: 'sb vessel' }, h('span', { class: 'sb-label' }, item.label), h('span', { class: 'sb-value' }, item.training ? 'Training cargo' : f.vessel)),
    h('div', { class: 'sb' }, h('span', { class: 'sb-label' }, 'Clock'), clockEl),
    h('div', { class: 'sb' }, h('span', { class: 'sb-label' }, 'Phase'), phaseEl),
    h('div', { class: 'sb' }, h('span', { class: 'sb-label' }, 'Laytime left'), leftEl),
    h('div', { class: 'sb' }, moneyLabel, moneyEl),
    h('div', { class: 'sb controls' }, pauseBtn, speedBtn));

  const harb = harbour({ vessel: item.training ? 'Training' : f.vessel, loading: false });
  const work = h('div', { class: 'desk-work', 'aria-live': 'polite' });
  const statementRows = h('ol', { class: 'statement' });
  const statement = h('aside', { class: 'desk-statement', 'aria-label': 'Your statement' },
    h('h3', {}, 'Your statement'),
    statementRows);
  const el = h('section', { class: 'screen desk-screen', 'aria-label': 'The desk' },
    bar, harb, termsStrip(f), h('div', { class: 'desk-grid' }, work, statement));

  // ---------- drawing ----------
  function drawStatus() {
    clockEl.textContent = stamp(run.t);
    const phase = run.phase();
    phaseEl.textContent = { 'turn time': 'Turn time', laytime: 'Laytime running', ticket: 'Ticket open', complete: 'Loading complete' }[phase];
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
    const loading = run.t >= run.loadStart && run.t < run.done && !run.open;
    harb.classList.toggle('loading', loading);
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  }

  function addLine(line) {
    statementRows.append(h('li', { class: `st-line ${line.kind || ''}${line.firstTime === false ? ' recast' : ''}` },
      h('span', { class: 'st-when' }, line.when),
      h('span', { class: 'st-hrs mono' }, line.hrs ?? ''),
      h('span', { class: 'st-what' }, line.what),
      h('span', { class: 'st-used mono' }, line.used ?? '')));
    statementRows.lastElementChild.scrollIntoView?.({ block: 'nearest' });
  }

  function drawWork() {
    if (tip) {
      work.replaceChildren(h('div', { class: 'tip', role: 'dialog', 'aria-label': tip.title },
        h('p', { class: 'tip-tag' }, 'Coaching · clock paused'),
        h('h3', {}, tip.title),
        h('p', {}, tip.text),
        h('button', { class: 'gbtn ink', type: 'button', onclick: closeTip }, run.t === run.nor ? 'Start the clock' : 'Got it')));
      work.querySelector('button').focus({ preventScroll: true });
      return;
    }
    if (run.finished) return work.replaceChildren(summaryCard());
    const tk = run.open;
    if (!tk) {
      work.replaceChildren(h('div', { class: 'waiting' },
        h('p', { class: 'mono' }, run.t < run.commenced ? 'Turn time running.' : 'Laytime running.'),
        h('p', { class: 'muted' }, 'Waiting for the next entry from the agent.')));
      return;
    }
    const n = run.tickets.indexOf(tk) + 1;
    work.replaceChildren(h('article', { class: 'ticket', 'aria-labelledby': 'tk-title' },
      h('p', { class: 'ticket-no' }, `Ticket ${String(n).padStart(2, '0')} of ${String(run.tickets.length).padStart(2, '0')} · statement of facts`),
      h('h3', { id: 'tk-title' }, ticketTitle(tk, f)),
      h('p', { class: 'ticket-when mono' }, `${span(tk.start, tk.end)} · ${hrs(tk.minutes)} hrs`),
      h('p', { class: 'ticket-ask' }, 'Does this time count against laytime?'),
      h('div', { class: 'ticket-calls' },
        h('button', { class: 'gbtn ink', type: 'button', onclick: () => call('counts') }, CALLS.counts, h('span', { class: 'sub' }, 'key C')),
        h('button', { class: 'gbtn accent', type: 'button', onclick: () => call('off') }, CALLS.off, h('span', { class: 'sub' }, 'key E'))),
      feedback ? h('div', { class: 'coach', role: 'alert' },
        h('p', { class: 'coach-tag' }, `${HEAD.name} · not quite`),
        h('p', {}, feedback),
        h('p', { class: 'muted small' }, 'Call it again.')) : null));
  }

  function summaryCard() {
    const s = run.summary();
    const label = (r) => (r.result === 'level' ? 'Level' : `${r.result[0].toUpperCase()}${r.result.slice(1)} USD ${USD.format(r.amount_usd)}`);
    const diff = s.difference_usd;
    const verdict = diff === 0 ? 'Your calls match the true statement.'
      : diff < 0 ? `Your calls cost the charterer USD ${USD.format(-diff)} more than the true statement.`
        : `Your calls claim USD ${USD.format(diff)} more than the true statement. The owner will push back.`;
    const ood = s.yours.demurrage_after_exceptions && !s.correct.demurrage_after_exceptions;
    return h('article', { class: 'summary', 'aria-labelledby': 'sum-title' },
      h('p', { class: 'ticket-no' }, `Loading complete · ${stamp(run.done)}`),
      h('h3', { id: 'sum-title' }, item.training ? 'Training cargo settled' : `${f.vessel} settled`),
      h('dl', { class: 'sum-grid' },
        h('div', {}, h('dt', {}, 'Your first calls'), h('dd', { class: 'mono' }, label(s.yours)), h('dd', { class: 'muted mono' }, `${hrs(s.yours.used_min)} hrs used`)),
        h('div', {}, h('dt', {}, 'True statement'), h('dd', { class: 'mono' }, label(s.correct)), h('dd', { class: 'muted mono' }, `${hrs(s.correct.used_min)} hrs used`)),
        h('div', { class: `diff ${diff === 0 ? 'zero' : 'off'}` }, h('dt', {}, 'Difference'), h('dd', { class: 'mono big' }, `USD ${USD.format(Math.abs(diff))}`), h('dd', {}, verdict))),
      h('p', {}, `Right first time: ${s.rightFirstTime} of ${s.tickets} tickets.`),
      ood ? h('p', { class: 'note' }, `By your calls laytime ran out at ${when(s.yours.laytime_expiry)}, before the excepted time that followed. Once on demurrage, always on demurrage: those hours no longer came off.`) : null,
      s.wrong.length ? h('ul', { class: 'sum-wrong' }, s.wrong.map((tk) => h('li', {},
        h('strong', {}, `${ticketTitle(tk, f)}, ${hrs(tk.minutes)} hrs. `),
        `You called it ${CALLS[run.firstCall(tk.id)].toLowerCase()}; it ${tk.answer === 'off' ? 'is excepted' : 'counts'}.`))) : null,
      h('div', { class: 'sum-actions' },
        h('button', { class: 'gbtn ink', type: 'button', onclick: () => onLeave?.('again') }, 'Run it again'),
        h('a', { class: 'gbtn outline', href: '#/' }, 'Back to the desk')));
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
  function call(answer) {
    const r = run.call(answer);
    if (!r) return;
    if (!r.right) {
      feedback = r.message;
      drawWork();
      return;
    }
    feedback = null;
    const line = run.lines[run.lines.length - 1];
    addLine({ kind: line.call, firstTime: line.firstTime, when: span(line.start, line.end), hrs: hrs(line.minutes), what: `${ticketTitle(line, f)} · ${CALLS[line.call]}${line.firstTime ? '' : ', recast'}`, used: `${hrs(line.usedAfter)} used` });
    drawWork();
  }

  let commencedShown = false;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused && !tip && !run.open && !run.finished) {
      const before = run.t;
      const state = run.advance(dt * SPEEDS[speed]);
      if (!commencedShown && run.t >= run.commenced) {
        commencedShown = true;
        addLine({ kind: 'milestone', when: stamp(run.commenced), what: `Laytime commenced, ${item.result.commenced_on === 'turn time' ? 'turn time expired' : 'loading started'}`, used: '0.00 used' });
        if (before < run.commenced && showTip('commenced')) { drawStatus(); return; }
      }
      if (state === 'ticket') {
        if (!showTip('ticket')) drawWork();
      } else if (state === 'complete') {
        addLine({ kind: 'milestone', when: stamp(run.done), what: 'Loading completed', used: `${hrs(run.used)} used` });
        drawWork();
      }
    }
    drawStatus();
  }

  function onKey(e) {
    if (e.target.closest?.('input, textarea, dialog')) return;
    if (run.open && !tip && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); call('counts'); }
    else if (run.open && !tip && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); call('off'); }
    else if (e.key === ' ' && !run.finished && e.target === document.body) { e.preventDefault(); setPaused(!paused); }
  }

  addLine({ kind: 'milestone', when: stamp(run.nor), what: 'NOR tendered', used: '' });
  drawStatus();
  if (!showTip('start')) drawWork();
  last = performance.now();
  raf = requestAnimationFrame(frame);
  addEventListener('keydown', onKey);

  return {
    el,
    run,
    destroy() {
      cancelAnimationFrame(raf);
      removeEventListener('keydown', onKey);
    },
  };
}
