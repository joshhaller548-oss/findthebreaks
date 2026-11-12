// The live desk: one vessel, or a day of several on one desk clock. Status
// bar, a card per vessel, the harbour, the ticket you are working, and the
// running statement. The clocks, answers and score come from run.mjs
// (createDay); this file only draws them and takes your calls.

import { h } from '../dom.mjs';
import { fromMin } from '../laytime/calc.mjs';
import { createDay, ticketTitle, CALLS } from './run.mjs';
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
const vesselName = (item) => (item.training ? 'Training cargo' : item.fixture.vessel);

function termsStrip(f, name) {
  return h('ul', { class: 'terms-strip', 'aria-label': `Terms on ${name}` },
    name ? h('li', { class: 'ts-vessel' }, name) : null,
    h('li', {}, f.shex_basis === 'SHINC' ? 'SHINC: Sundays and holidays count' : `${f.shex_basis}, ${f.shex_window}`),
    h('li', {}, 'Weather, breakdowns and shifting are excepted'),
    h('li', {}, f.shex_basis === 'SHINC' ? 'Holidays count' : 'Holidays are excepted'),
    h('li', {}, f.waiting_for_berth ? 'Waiting for berth counts' : 'Waiting for berth is not covered'),
    h('li', {}, `Despatch at half rate, ${f.despatch_basis}`));
}

// Tips that pause the clock, on the training cargo only
const TIPS = {
  start: { title: 'NOR is in', text: 'Laytime does not start at NOR. Turn time runs first, unless loading starts before it ends. Your first call is when the clock starts.' },
  commenced: { title: 'Laytime is running', text: 'From here every hour counts against the charterer, unless a ticket says otherwise. The ticker shows the despatch still in hand.' },
  time: { title: 'Read the terms first', text: 'Each ticket is one entry from the statement of facts. Check it against the terms strip, then call it. Keys: C counts, E excepted.' },
  settle: { title: 'Loading is complete', text: 'Now settle it. Under laytime is despatch at half the demurrage rate; over is demurrage at the full rate. Mind the despatch basis.' },
};

// desk: { key, title, label, items, next } where key is the ledger key,
// items the vessels, next the hash for the Next button
export function deskScreen(desk, { onLeave } = {}) {
  const day = createDay(desk.items);
  const multi = day.lanes.length > 1;
  const tips = day.training ? new Set(Object.keys(TIPS)) : new Set();
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
  let shownLane = null;

  // ---------- status bar and vessel cards ----------
  const clockLabel = h('span', { class: 'sb-label' }, multi ? 'Desk clock' : 'Clock');
  const clockEl = h('span', { class: 'sb-value mono' });
  const scoreEl = h('span', { class: 'sb-value mono' });
  const strikesEl = h('span', { class: 'strikes', 'aria-label': 'Wrong calls' });
  const pauseBtn = h('button', { class: 'gbtn small outline', type: 'button', onclick: () => setPaused(!paused) }, 'Pause');
  const speedBtn = h('button', { class: 'gbtn small outline', type: 'button', 'aria-pressed': 'false', onclick: () => {
    speed = speed === 'normal' ? 'fast' : 'normal';
    speedBtn.setAttribute('aria-pressed', String(speed === 'fast'));
    speedBtn.textContent = speed === 'fast' ? 'Speed x4' : 'Speed x1';
  } }, 'Speed x1');
  const bar = h('header', { class: 'desk-bar' },
    h('div', { class: 'sb vessel' }, h('span', { class: 'sb-label' }, desk.label), h('span', { class: 'sb-value' }, desk.title)),
    h('div', { class: 'sb' }, clockLabel, clockEl),
    h('div', { class: 'sb' }, h('span', { class: 'sb-label' }, multi ? 'Day score' : 'Score'), scoreEl, strikesEl),
    h('div', { class: 'sb controls' }, pauseBtn, speedBtn));

  const cards = day.lanes.map((l) => {
    const c = {
      clock: h('span', { class: 'vc-clock mono' }),
      phase: h('span', { class: 'phase' }),
      left: h('span', { class: 'mono' }),
      moneyLabel: h('span', { class: 'sb-label' }),
      money: h('span', { class: 'mono money' }),
      shown: null,
    };
    c.el = h('div', { class: 'vcard' },
      h('p', { class: 'vc-name' }, vesselName(l.item)),
      c.clock, c.phase,
      h('div', { class: 'vc-row' }, h('span', { class: 'sb-label' }, 'Laytime left'), c.left),
      h('div', { class: 'vc-row' }, c.moneyLabel, c.money));
    return c;
  });
  const fleet = h('div', { class: `fleet n${day.lanes.length}`, 'aria-label': 'Vessels on the desk' }, cards.map((c) => c.el));

  const harbourSlot = h('div', { class: 'harbour-slot' });
  const termsSlot = h('div', { class: 'terms-slot' });
  const work = h('div', { class: 'desk-work', 'aria-live': 'polite' });
  const statementRows = h('ol', { class: 'statement' });
  const statement = h('aside', { class: 'desk-statement', 'aria-label': 'Your statement' }, h('h3', {}, 'Your statement'), statementRows);
  const el = h('section', { class: 'screen desk-screen', 'aria-label': 'The desk' },
    bar, fleet, harbourSlot, termsSlot, h('div', { class: 'desk-grid' }, work, statement));

  // The vessel in focus: the one with a ticket, else the last one worked
  const focus = () => day.active ?? shownLane ?? day.lanes[0];
  let harb = null;
  function showLane(l) {
    if (shownLane === l && harb) return;
    shownLane = l;
    harb = harbour({ vessel: l.item.training ? 'Training' : l.item.fixture.vessel, loading: false });
    harbourSlot.replaceChildren(harb);
    termsSlot.replaceChildren(termsStrip(l.item.fixture, multi ? vesselName(l.item) : null));
  }

  // ---------- drawing ----------
  function drawStatus() {
    const f = focus();
    if (day.active) showLane(day.active);
    else if (!harb) showLane(f);
    clockEl.textContent = multi ? `+${hm(day.T)}` : stamp(f.run.t);
    scoreEl.textContent = N.format(day.score);
    if (Number.isFinite(day.strikesAllowed)) {
      strikesEl.replaceChildren(...Array.from({ length: day.strikesAllowed }, (_, i) => h('span', { class: i < day.strikes ? 'used' : '' }, '')));
      strikesEl.setAttribute('aria-label', `${day.strikes} of ${day.strikesAllowed} wrong calls used`);
    } else strikesEl.replaceChildren(h('span', { class: 'free' }, 'no strike limit'));
    day.lanes.forEach((l, i) => {
      const c = cards[i];
      const r = l.run;
      const arrived = day.arrived(l);
      c.el.classList.toggle('active', day.active === l);
      c.el.classList.toggle('done', r.finished);
      c.el.classList.toggle('waiting', !arrived);
      if (!arrived) {
        c.clock.textContent = `Arrives in ${hm(l.offset - day.T)}`;
        c.phase.textContent = 'At anchor';
        c.phase.dataset.phase = 'waiting';
        c.left.textContent = hm(r.allowed);
        c.moneyLabel.textContent = 'Despatch in hand';
        c.money.textContent = '';
        return;
      }
      c.clock.textContent = stamp(r.t);
      const phase = r.phase();
      c.phase.textContent = r.finished ? 'Settled' : { 'turn time': 'Turn time', laytime: 'Laytime running', ticket: 'Ticket open', complete: 'Loading complete', owner: 'Owner check' }[phase];
      c.phase.dataset.phase = r.finished ? 'done' : phase;
      const left = r.left;
      c.left.textContent = left >= 0 ? hm(left) : `over ${hm(left)}`;
      c.left.classList.toggle('neg', left < 0);
      // Despatch still in hand at half rate, or demurrage running at full rate
      const rate = l.item.fixture.demurrage_rate_usd_per_day;
      const money = left >= 0 ? (left / 1440) * (rate / 2) : (-left / 1440) * rate;
      c.moneyLabel.textContent = left >= 0 ? 'Despatch in hand' : 'Demurrage running';
      c.money.classList.toggle('up', left < 0);
      c.shown = c.shown === null ? money : c.shown + (money - c.shown) * 0.3;
      if (Math.abs(money - c.shown) < 0.5) c.shown = money;
      c.money.textContent = `USD ${USD.format(c.shown)}`;
    });
    const fl = focus();
    harb?.classList.toggle('loading', fl.run.t >= fl.run.loadStart && fl.run.t < fl.run.done && !fl.run.open && day.arrived(fl));
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  }

  function addLine(line, l) {
    statementRows.append(h('li', { class: `st-line ${line.kind || ''}` },
      h('span', { class: 'st-when' }, multi ? h('span', { class: 'st-vessel' }, `${vesselName(l.item)} · `) : null, line.when),
      h('span', { class: 'st-hrs mono' }, line.hrs ?? ''),
      h('span', { class: 'st-what' }, line.what),
      h('span', { class: 'st-used mono' }, line.used ?? '')));
    statementRows.lastElementChild.scrollIntoView?.({ block: 'nearest' });
  }

  function lineFor(ln, l) {
    const f = l.item.fixture;
    const tag = ln.byHead ? `, called by ${HEAD.name.split(' ')[0]}` : ln.firstTime ? '' : ', recast';
    if (ln.type === 'time') return { kind: ln.call, when: span(ln.start, ln.end), hrs: hrs(ln.minutes), what: `${ticketTitle(ln, f)} · ${CALLS[ln.call]}${tag}`, used: `${hrs(ln.usedAfter)} used` };
    if (ln.type === 'start') {
      const o = ln.options.find((x) => x.id === ln.call);
      return { kind: 'milestone', when: stamp(o.at), what: `Laytime commences, ${o.why}${tag}`, used: '0.00 used' };
    }
    if (ln.type === 'settle') return { kind: 'milestone', when: stamp(l.run.done), what: `Settled: ${ln.options.find((x) => x.id === ln.call).label}${tag}`, used: `${hrs(ln.usedAfter)} used` };
    return { kind: 'milestone', when: 'Owner', what: `Owner’s statement ${ln.call === 'dispute' ? 'disputed' : 'accepted'}${tag}`, used: '' };
  }

  const optionButtons = (tk) => h('div', { class: 'ticket-options' }, tk.options.map((o, i) =>
    h('button', { class: 'gbtn outline option', type: 'button', onclick: () => call(o.id) },
      tk.type === 'start' ? stamp(o.at) : o.label,
      h('span', { class: 'sub' }, tk.type === 'start' ? `${o.why} · key ${i + 1}` : `key ${i + 1}`))));

  function ticketBody(tk, l) {
    const f = l.item.fixture;
    const r = l.run;
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
          h('div', {}, h('dt', {}, 'NOR tendered'), h('dd', {}, stamp(r.nor))),
          h('div', {}, h('dt', {}, 'Turn time'), h('dd', {}, `${f.turn_time_hrs} hrs`)),
          h('div', {}, h('dt', {}, 'Loading commenced'), h('dd', {}, stamp(r.loadStart)))),
        h('p', { class: 'ticket-ask' }, 'When does the laytime clock start?'),
        optionButtons(tk),
      ];
    }
    if (tk.type === 'settle') {
      return [
        h('dl', { class: 'sof' },
          h('div', {}, h('dt', {}, 'Laytime allowed'), h('dd', {}, `${hrs(r.allowed)} hrs`)),
          h('div', {}, h('dt', {}, 'Laytime used'), h('dd', {}, `${hrs(r.used)} hrs`)),
          h('div', {}, h('dt', {}, 'Demurrage rate'), h('dd', {}, `USD ${N.format(f.demurrage_rate_usd_per_day)} a day`)),
          h('div', {}, h('dt', {}, 'Despatch'), h('dd', {}, `half rate, ${f.despatch_basis}`))),
        h('p', { class: 'ticket-ask' }, 'What is owed, and to whom?'),
        optionButtons(tk),
      ];
    }
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
    const l = day.active;
    if (l?.run.explaining) {
      work.replaceChildren(explainCard(l));
      if (day.takenOver) scheduleHead();
      return;
    }
    if (day.finished) return work.replaceChildren(recapCard());
    if (!l) {
      const next = day.lanes.find((x) => !day.arrived(x));
      work.replaceChildren(h('div', { class: 'waiting' },
        day.takenOver ? h('p', { class: 'taken' }, `${HEAD.name} has the desk.`) : null,
        h('p', { class: 'mono' }, multi ? `${day.lanes.filter((x) => day.arrived(x) && !x.run.finished).length} vessels working.` : (focus().run.t < focus().run.commenced ? 'Turn time running.' : 'Laytime running.')),
        h('p', { class: 'muted' }, next ? `Waiting for the agent. ${vesselName(next.item)} arrives in ${hm(next.offset - day.T)}.` : 'Waiting for the next entry from the agent.'),
        gain ? h('p', { class: 'gain' }, `+${gain}`) : null));
      return;
    }
    const tk = l.run.open;
    const k = l.run.steps.indexOf(tk) + 1;
    work.replaceChildren(h('article', { class: `ticket t-${tk.type}`, 'aria-labelledby': 'tk-title' },
      multi ? h('p', { class: 'tk-vessel' }, vesselName(l.item)) : null,
      h('p', { class: 'ticket-no' }, `Ticket ${String(k).padStart(2, '0')} of ${String(l.run.steps.length).padStart(2, '0')} · ${tk.type === 'time' ? 'statement of facts' : tk.type === 'owner' ? 'owner’s laytime statement' : 'your call'}`),
      h('h3', { id: 'tk-title' }, ticketTitle(tk, l.item.fixture)),
      ...ticketBody(tk, l),
      day.takenOver ? h('p', { class: 'taken' }, `${HEAD.name} has taken the desk and is calling this one.`) : null,
      feedback ? h('div', { class: 'coach', role: 'alert' },
        h('p', { class: 'coach-tag' }, `${HEAD.name} · not quite`),
        h('p', {}, feedback),
        day.takenOver ? null : h('p', { class: 'muted small' }, 'Call it again.')) : null));
    if (day.takenOver) scheduleHead();
  }

  // After disputing: one sentence, then the model note, then your own mark
  function explainCard(l) {
    const tk = l.run.explaining;
    const area = h('textarea', { class: 'explain-input', rows: '3', maxlength: '300', placeholder: 'One sentence: what did the owner do wrong?', 'aria-label': 'What the owner got wrong' });
    area.value = explainText;
    area.addEventListener('input', () => { explainText = area.value; });
    const parts = [
      multi ? h('p', { class: 'tk-vessel' }, vesselName(l.item)) : null,
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

  function describe(tk, l) {
    const first = l.run.firstCall(tk.id);
    const f = l.item.fixture;
    if (tk.type === 'time') return [h('strong', {}, `${ticketTitle(tk, f)}, ${hrs(tk.minutes)} hrs. `), `You called it ${CALLS[first].toLowerCase()}; it ${tk.answer === 'off' ? 'is excepted' : 'counts'}.`];
    if (tk.type === 'start') return [h('strong', {}, 'Laytime start. '), `You said ${tk.options.find((o) => o.id === first).why}; it starts ${tk.options.find((o) => o.id === tk.answer).why}.`];
    if (tk.type === 'settle') return [h('strong', {}, 'Settlement. '), `You said ${tk.options.find((o) => o.id === first).label}; it is ${tk.options.find((o) => o.id === tk.answer).label}.`];
    return [h('strong', {}, 'Owner’s statement. '), `You chose to ${CALLS[first].toLowerCase()} it; the right call was to ${CALLS[tk.answer].toLowerCase()}.`];
  }

  function recapCard() {
    const s = day.summary();
    if (!recorded) {
      recorded = true;
      profile.record({ n: desk.key, label: desk.label, vessel: desk.title, score: s.score, stars: s.stars, right: s.rightFirstTime, decisions: s.decisions, difference_usd: s.difference_usd, takenOver: s.takenOver });
    }
    const best = Math.max(...profile.ledger().filter((e) => e.n === desk.key).map((e) => e.score));
    const diff = s.difference_usd;
    const verdict = diff === 0 ? 'Your calls match the true statements.'
      : diff < 0 ? `Your calls cost the charterer USD ${USD.format(-diff)} more than the true statement${multi ? 's' : ''}.`
        : `Your calls claim USD ${USD.format(diff)} more than the true statement${multi ? 's' : ''}. The owner will push back.`;
    const one = s.per[0];
    const head = [
      h('p', { class: 'ticket-no' }, multi ? `${desk.label} complete · every vessel settled` : `Loading complete · ${stamp(one.lane.run.done)}`),
      h('div', { class: 'sum-head' }, h('h3', { id: 'sum-title' }, `${desk.title} settled`), stars(s.stars)),
      h('p', { class: 'sum-score mono' }, `Score ${N.format(s.score)}`, h('span', { class: 'muted' }, ` · best ${N.format(best)}`)),
      s.takenOver ? h('p', { class: 'taken' }, `Three wrong calls, so ${HEAD.name} took the desk. Run it again to settle it yourself.`) : null,
    ];
    const grid = multi
      ? h('table', { class: 'owner-table recap-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Vessel'), h('th', {}, 'Your first calls'), h('th', {}, 'True statement'), h('th', {}, 'Difference'), h('th', {}, 'Right'))),
        h('tbody', {}, s.per.map((p) => h('tr', {},
          h('th', {}, vesselName(p.lane.item)),
          h('td', {}, owed(p.yours.result, p.yours.amount_usd)),
          h('td', {}, owed(p.correct.result, p.correct.amount_usd)),
          h('td', { class: p.difference_usd === 0 ? 'ok' : 'bad' }, `USD ${USD.format(Math.abs(p.difference_usd))}`),
          h('td', {}, `${p.rightFirstTime} of ${p.decisions}`)))))
      : h('dl', { class: 'sum-grid' },
        h('div', {}, h('dt', {}, 'Your first calls'), h('dd', { class: 'mono' }, owed(one.yours.result, one.yours.amount_usd)), h('dd', { class: 'muted mono' }, `${hrs(one.yours.used_min)} hrs used`)),
        h('div', {}, h('dt', {}, 'True statement'), h('dd', { class: 'mono' }, owed(one.correct.result, one.correct.amount_usd)), h('dd', { class: 'muted mono' }, `${hrs(one.correct.used_min)} hrs used`)),
        h('div', { class: `diff ${diff === 0 ? 'zero' : 'off'}` }, h('dt', {}, 'Difference'), h('dd', { class: 'mono big' }, `USD ${USD.format(Math.abs(diff))}`), h('dd', {}, verdict)));
    const notes = s.per.flatMap((p) => {
      const l = p.lane;
      const ownerTk = l.run.steps.find((t) => t.type === 'owner');
      const out = [];
      if (ownerTk) {
        out.push(h('p', {}, `${multi ? `${vesselName(l.item)}: ` : ''}${ownerTk.answer === 'dispute'
          ? `the owner claimed ${ownerTk.gap_hrs.toFixed(2)} hrs more than the true statement.${p.explained ? (p.explained.gotIt ? ' You named the error.' : ' Read the model note again.') : ''}`
          : 'the owner’s statement was right, and signing it was the right call.'}`));
      }
      if (p.yours.demurrage_after_exceptions && !p.correct.demurrage_after_exceptions) {
        out.push(h('p', { class: 'note' }, `${multi ? `${vesselName(l.item)}: ` : ''}by your calls laytime ran out at ${when(p.yours.laytime_expiry)}, before the excepted time that followed. Once on demurrage, always on demurrage: those hours no longer came off.`));
      }
      return out;
    });
    const wrongs = s.per.flatMap((p) => p.wrong.map((tk) => h('li', {}, multi ? h('span', { class: 'st-vessel' }, `${vesselName(p.lane.item)} · `) : null, ...describe(tk, p.lane))));
    return h('article', { class: 'summary', 'aria-labelledby': 'sum-title' },
      ...head,
      grid,
      multi ? h('p', { class: `day-diff ${diff === 0 ? 'zero' : 'off'}` }, h('strong', {}, `Across the day: USD ${USD.format(Math.abs(diff))}. `), verdict) : null,
      h('p', {}, `Right first time: ${s.rightFirstTime} of ${s.decisions} calls.`),
      ...notes,
      wrongs.length ? h('ul', { class: 'sum-wrong' }, wrongs) : null,
      h('div', { class: 'sum-actions' },
        desk.next ? h('a', { class: 'gbtn ink', href: desk.next.href }, desk.next.label) : null,
        h('button', { class: 'gbtn outline', type: 'button', onclick: () => onLeave?.('again') }, 'Run it again'),
        h('a', { class: 'gbtn outline', href: '#/ledger' }, 'Ledger')));
  }

  // ---------- play ----------
  function showTip(key) {
    if (!tips.has(key)) return false;
    tips.delete(key);
    tip = TIPS[key];
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
  const tipFor = (l) => (l?.run.open ? showTip(l.run.open.type === 'time' ? 'time' : l.run.open.type) : false);
  function afterClose(l) {
    feedback = null;
    const ln = l.run.lines[l.run.lines.length - 1];
    addLine(lineFor(ln, l), l);
    explainStage = 'write';
    if (day.active && day.active !== l) explainText = '';
    drawStatus();
    if (tipFor(day.active)) return;
    drawWork();
  }
  function call(answer) {
    if (day.takenOver) return;
    const r = day.call(answer);
    if (!r) return;
    if (!r.right) {
      feedback = r.message;
      drawWork();
      drawStatus();
      return;
    }
    gain = r.gained || null;
    afterClose(r.lane);
  }
  function scheduleHead() {
    if (headTimer) return;
    headTimer = setTimeout(() => {
      headTimer = 0;
      const l = day.active;
      if (!l) return;
      const wasExplaining = Boolean(l.run.explaining);
      day.headCall();
      if (wasExplaining) { drawWork(); drawStatus(); return; }
      afterClose(l);
    }, HEAD_DELAY);
  }
  function finishExplain(gotIt) {
    day.explain(explainText.trim(), gotIt);
    explainText = '';
    explainStage = 'write';
    drawStatus();
    if (!tipFor(day.active)) drawWork();
  }

  let commencedShown = false;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused && !tip && !day.active && !day.finished) {
      const first = day.lanes[0].run;
      const before = first.t;
      const state = day.advance(dt * SPEEDS[speed]);
      if (!commencedShown && first.t >= first.commenced && before < first.commenced) {
        commencedShown = true;
        if (showTip('commenced')) { drawStatus(); return; }
      }
      if (state === 'ticket') {
        drawStatus();
        if (!tipFor(day.active)) drawWork();
      } else if (state === 'complete') drawWork();
    }
    drawStatus();
  }

  function onKey(e) {
    if (e.target.closest?.('input, textarea, dialog')) return;
    const tk = day.active?.run.open;
    const k = e.key.toLowerCase();
    if (tk && !tip && !day.takenOver) {
      if (tk.type === 'time' && (k === 'c' || k === 'e')) { e.preventDefault(); return call(k === 'c' ? 'counts' : 'off'); }
      if (tk.type === 'owner' && (k === 'a' || k === 'd')) { e.preventDefault(); return call(k === 'a' ? 'agree' : 'dispute'); }
      if (tk.options && /^[1-9]$/.test(k) && tk.options[Number(k) - 1]) { e.preventDefault(); return call(tk.options[Number(k) - 1].id); }
    }
    if (e.key === ' ' && !day.finished && e.target === document.body) { e.preventDefault(); setPaused(!paused); }
  }

  for (const l of day.lanes) addLine({ kind: 'milestone', when: stamp(l.run.nor), what: multi ? `NOR tendered, arrives at desk +${hm(l.offset)}` : 'NOR tendered', used: '' }, l);
  drawStatus();
  if (!tipFor(day.active)) drawWork();
  last = performance.now();
  raf = requestAnimationFrame(frame);
  addEventListener('keydown', onKey);

  return {
    el,
    day,
    destroy() {
      cancelAnimationFrame(raf);
      clearTimeout(headTimer);
      removeEventListener('keydown', onKey);
    },
  };
}
