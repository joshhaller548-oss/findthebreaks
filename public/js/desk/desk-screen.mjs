// The live desk: one vessel, or a day of several on one desk clock. Status
// bar, a card per vessel, the harbour, the ticket you are working, and the
// running statement. The clocks, answers and score come from run.mjs
// (createDay); this file only draws them and takes your calls.

import { h } from '../dom.mjs';
import { createDay, ticketTitle, CALLS, STAR_RULES } from './run.mjs';
import { HEAD, termsLines, modelNote, recapNotes } from './briefing.mjs';
import { when, stamp, span, hm, hrs, owed, USD, N } from './format.mjs';
import { gloss } from './gloss.mjs';
import { harbour } from './harbour.mjs';
import { profile } from './profile.mjs';

// Simulated minutes per real second, at normal and fast speed
const SPEEDS = { normal: 240, fast: 960 };
const HEAD_DELAY = 900;
const stars = (n) => h('span', { class: 'stars', role: 'img', 'aria-label': `${n} of 3 stars` }, '★'.repeat(n), h('span', { class: 'off' }, '★'.repeat(3 - n)));
// The star rules from run.mjs, written out, with the one this run met marked
function starRules(s) {
  const pct = (x) => `${Math.round(x * 100)}%`;
  const rule = (r) => (r.maxOff === Infinity ? 'Settled it yourself' : `${pct(r.minShare)} or more right first time, and first calls within USD ${N.format(r.maxOff)} of the true statement${s.per.length > 1 ? 's' : ''}`);
  const share = s.decisions ? s.rightFirstTime / s.decisions : 0;
  return h('div', { class: 'star-rules' },
    h('p', { class: 'coach-tag' }, 'How stars are earned'),
    h('p', { class: 'mono small' }, `This run: ${pct(share)} right first time (${s.rightFirstTime} of ${s.decisions}), first calls off by USD ${USD.format(s.off_usd)}${s.per.length > 1 ? ', vessel by vessel' : ''}.`),
    h('ul', {}, STAR_RULES.map((r) => h('li', { class: r.stars === s.stars ? 'met' : null },
      stars(r.stars), h('span', {}, rule(r)), r.stars === s.stars ? h('strong', { class: 'met-tag' }, 'Your run') : null)),
    h('li', { class: s.stars === 0 ? 'met' : null }, stars(0), h('span', {}, `${HEAD.name} took the desk`), s.stars === 0 ? h('strong', { class: 'met-tag' }, 'Your run') : null)));
}
const vesselName = (item) => (item.training ? 'Training cargo' : item.fixture.vessel);

// The vessel's name heads the strip only when several share the desk, but
// the list is always labelled with it. Each term is underlined once.
function termsStrip(f, name, showName) {
  const seen = new Set();
  return h('ul', { class: 'terms-strip', 'aria-label': `Terms on ${name}` },
    showName ? h('li', { class: 'ts-vessel' }, name) : null,
    termsLines(f).map((t) => h('li', {}, gloss(t, seen))));
}

// Tips that pause the clock, on the training cargo only
const TIPS = {
  start: { title: 'NOR is in', text: 'Laytime does not start at NOR. Turn time runs first, unless loading starts before it ends. Your first call is when the clock starts.' },
  commenced: { title: 'Laytime is running', text: 'From here every hour counts against the charterer, unless a ticket says otherwise. The ticker shows the despatch still in hand.' },
  time: { title: 'Read the terms first', text: 'Each ticket is one entry from the statement of facts. Check it against the terms strip, then call it. Keys: C counts, E excepted.' },
  settle: { title: 'Loading is complete', text: 'Now settle it. Under laytime is despatch at half the demurrage rate; over is demurrage at the full rate. Mind the despatch basis.' },
};
// Shown once in this browser, the first time a settle ticket is on all
// time saved. The numbers are an example, not this vessel's.
const ATS_TIP = {
  title: 'All time saved or working time saved',
  text: 'Say laytime has 20 hrs left when loading completes, and a 39 hr weekend window (excepted time) falls before laytime would run out. Working time saved pays despatch on the laytime saved: 20 hrs. All time saved pays on all the time until laytime would have run out: 20 + 39 = 59 hrs. The settle ticket lists the excepted time after completion. Count it only on all time saved.',
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
  // A dispute runs check, then write, then mark
  let explainStage = 'check';
  let explainText = '';
  let pickLines = new Set();
  let pickHours = null;
  let checkMsg = null;
  let headTimer = 0;
  let recorded = false;
  let raf = 0;
  let last = 0;
  let shownLane = null;
  const announced = new Set();

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
      leftLabel: h('span', { class: 'sb-label' }, 'Laytime left'),
      left: h('span', { class: 'mono vc-value' }),
      moneyLabel: h('span', { class: 'sb-label' }),
      money: h('span', { class: 'mono money vc-value' }),
      shown: null,
    };
    c.el = h('div', { class: 'vcard' },
      h('p', { class: 'vc-name' }, vesselName(l.item)),
      c.clock, c.phase,
      h('div', { class: 'vc-row' }, c.leftLabel, c.left),
      h('div', { class: 'vc-row' }, c.moneyLabel, c.money));
    return c;
  });
  const fleet = h('div', { class: `fleet n${day.lanes.length}`, 'aria-label': 'Vessels on the desk' }, cards.map((c) => c.el));

  const harbourSlot = h('div', { class: 'harbour-slot' });
  const termsSlot = h('div', { class: 'terms-slot' });
  const work = h('div', { class: 'desk-work', 'aria-live': 'polite', tabindex: '-1' });
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
    termsSlot.replaceChildren(termsStrip(l.item.fixture, vesselName(l.item), multi));
  }

  // ---------- drawing ----------
  function drawStatus() {
    announceArrivals();
    const f = focus();
    if (day.active) showLane(day.active);
    else if (!harb) showLane(f);
    // One calendar for the day: the desk clock and every vessel read the same
    clockEl.textContent = multi ? stamp(day.start + day.T) : stamp(f.run.t);
    scoreEl.textContent = N.format(day.score);
    if (Number.isFinite(day.strikesAllowed)) {
      strikesEl.replaceChildren(...Array.from({ length: day.strikesAllowed }, (_, i) => h('span', { class: i < day.strikes ? 'used' : '' }, '')));
      strikesEl.setAttribute('aria-label', `${day.strikes} of ${day.strikesAllowed} wrong calls used`);
    } else strikesEl.replaceChildren(h('span', { class: 'free' }, 'Training: no strike limit'));
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
      // A vessel whose last ticket closed a whole period is ahead of the
      // desk; it shows the desk's time until the desk catches up
      c.clock.textContent = stamp(multi && !r.finished ? Math.min(r.t, day.start + day.T) : r.t);
      const phase = r.phase();
      c.phase.textContent = r.finished ? 'Settled' : { 'turn time': 'Turn time', laytime: 'Laytime running', ticket: 'Ticket open', complete: 'Loading complete', owner: 'Owner check' }[phase];
      c.phase.dataset.phase = r.finished ? 'done' : phase;
      // Settled: the running figures stop, and the card shows the final ones
      if (r.finished) {
        const res = l.item.result;
        c.leftLabel.textContent = 'Laytime used';
        c.left.textContent = `${hm(r.used)} of ${hm(r.allowed)}`;
        c.left.classList.remove('neg');
        c.moneyLabel.textContent = 'Settled';
        c.money.classList.toggle('up', res.result === 'demurrage');
        c.money.textContent = owed(res.result, res.amount_usd);
        return;
      }
      c.leftLabel.textContent = 'Laytime left';
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
      h('span', { class: 'st-what' }, gloss(line.what)),
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

  function ticketBody(tk, l, seen = new Set()) {
    const g = (t) => gloss(t, seen);
    const f = l.item.fixture;
    const r = l.run;
    if (tk.type === 'time') {
      return [
        h('p', { class: 'ticket-when mono' }, `${span(tk.start, tk.end)} · ${hrs(tk.minutes)} hrs`),
        h('p', { class: 'ticket-ask' }, g('Does this time count against laytime?')),
        h('div', { class: 'ticket-calls' },
          h('button', { class: 'gbtn ink', type: 'button', onclick: () => call('counts') }, CALLS.counts, h('span', { class: 'sub' }, 'key C')),
          h('button', { class: 'gbtn accent', type: 'button', onclick: () => call('off') }, CALLS.off, h('span', { class: 'sub' }, 'key E'))),
      ];
    }
    if (tk.type === 'start') {
      return [
        h('dl', { class: 'sof' },
          h('div', {}, h('dt', {}, g('NOR tendered')), h('dd', {}, stamp(r.nor))),
          h('div', {}, h('dt', {}, g('Turn time')), h('dd', {}, `${f.turn_time_hrs} hrs`)),
          h('div', {}, h('dt', {}, g('Loading commenced')), h('dd', {}, stamp(r.loadStart)))),
        h('p', { class: 'ticket-ask' }, g('When does the laytime clock start?')),
        optionButtons(tk),
      ];
    }
    if (tk.type === 'settle') {
      return [
        h('dl', { class: 'sof' },
          h('div', {}, h('dt', {}, g('Laytime allowed')), h('dd', {}, `${hrs(r.allowed)} hrs`)),
          h('div', {}, h('dt', {}, g('Laytime used')), h('dd', {}, `${hrs(r.used)} hrs`)),
          h('div', {}, h('dt', {}, g('Demurrage rate')), h('dd', {}, `USD ${N.format(f.demurrage_rate_usd_per_day)} a day`)),
          h('div', {}, h('dt', {}, g('Despatch')), h('dd', {}, `half rate, ${f.despatch_basis}`)),
          ...(tk.after ? [
            h('div', {}, h('dt', {}, g('Laytime left at completion')), h('dd', {}, `${hrs(tk.after.left_min)} hrs`)),
            h('div', {}, h('dt', {}, g('Excepted after completion')), h('dd', {},
              tk.after.windows.length
                ? [...tk.after.windows.map((w) => h('span', { class: 'after-w' }, `${f.shex_basis} window ${span(w.start, w.end)}, ${hrs(w.minutes)} hrs`)), h('span', { class: 'after-w muted' }, `before laytime would have run out: ${hrs(tk.after.excepted_min)} hrs in all`)]
                : 'none before laytime would have run out')),
          ] : [])),
        h('p', { class: 'ticket-ask' }, g('What is owed, and to whom?')),
        optionButtons(tk),
      ];
    }
    const o = tk.owner;
    return [
      h('table', { class: 'owner-table' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Owner'), h('th', {}, 'Yours'))),
        h('tbody', {},
          h('tr', {}, h('th', {}, g('Laytime commenced')), h('td', {}, when(o.laytime_commenced)), h('td', {}, when(tk.yours.laytime_commenced))),
          h('tr', {}, h('th', {}, g('Laytime used')), h('td', {}, `${o.laytime_used_hrs.toFixed(2)} hrs`), h('td', {}, `${hrs(tk.yours.used_min)} hrs`)),
          h('tr', {}, h('th', {}, 'Owed'), h('td', {}, owed(o.result, o.amount_usd)), h('td', {}, owed(tk.yours.result, tk.yours.amount_usd))))),
      h('p', { class: 'ticket-ask' }, g('Do you sign the owner’s statement?')),
      h('div', { class: 'ticket-calls' },
        h('button', { class: 'gbtn ok', type: 'button', onclick: () => call('agree') }, CALLS.agree, h('span', { class: 'sub' }, 'key A')),
        h('button', { class: 'gbtn accent', type: 'button', onclick: () => call('dispute') }, CALLS.dispute, h('span', { class: 'sub' }, 'key D'))),
    ];
  }

  // Redrawing the work panel replaces its buttons. If focus was in the
  // panel, keep it there: on the same control if it is still there, else on
  // the panel's first one. Focus elsewhere is never moved, so Space still
  // pauses and a ticket arriving never steals it.
  function drawWork() {
    const had = work.contains(document.activeElement);
    const fk = had ? document.activeElement.closest('[data-fk]')?.dataset.fk : null;
    paintWork();
    if (!had || tip || work.contains(document.activeElement)) return;
    const again = fk && work.querySelector(`[data-fk="${fk}"]`);
    // With nothing to press, the panel itself holds focus for the next ticket
    const target = (again && !again.disabled ? again : work.querySelector('button:not(:disabled):not(.gl), textarea, a[href]')) ?? work;
    target.focus({ preventScroll: true });
  }
  function paintWork() {
    if (tip) {
      work.replaceChildren(h('div', { class: 'tip', role: 'dialog', 'aria-label': tip.title },
        h('p', { class: 'tip-tag' }, 'Coaching · clock paused'),
        h('h3', {}, tip.title),
        h('p', {}, gloss(tip.text)),
        h('button', { class: 'gbtn ink', type: 'button', onclick: closeTip }, 'Got it')));
      work.querySelector('.tip .gbtn').focus({ preventScroll: true });
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
    // A term is underlined once per ticket
    const seen = new Set();
    work.replaceChildren(h('article', { class: `ticket t-${tk.type}`, 'aria-labelledby': 'tk-title' },
      multi ? h('p', { class: 'tk-vessel' }, vesselName(l.item)) : null,
      h('p', { class: 'ticket-no' }, `Ticket ${String(k).padStart(2, '0')} of ${String(l.run.steps.length).padStart(2, '0')} · ${tk.type === 'time' ? 'statement of facts' : tk.type === 'owner' ? 'owner’s laytime statement' : 'your call'}`),
      h('h3', { id: 'tk-title' }, gloss(ticketTitle(tk, l.item.fixture), seen)),
      ...ticketBody(tk, l, seen),
      day.takenOver ? h('p', { class: 'taken' }, `${HEAD.name} has taken the desk and is calling this one.`) : null,
      feedback ? h('div', { class: 'coach', role: 'alert' },
        h('p', { class: 'coach-tag' }, `${HEAD.name} · not quite`),
        h('p', {}, gloss(feedback)),
        day.takenOver ? null : h('p', { class: 'muted small' }, 'Call it again.')) : null));
    if (day.takenOver) scheduleHead();
  }

  // After disputing: name the wrong lines and the hours, then one sentence,
  // then the model note, then your own mark
  function explainCard(l) {
    const tk = l.run.explaining;
    const parts = [
      multi ? h('p', { class: 'tk-vessel' }, vesselName(l.item)) : null,
      h('p', { class: 'ticket-no' }, 'Owner’s statement · disputed'),
    ];
    if (explainStage === 'check') {
      const toggle = (id) => {
        if (pickLines.has(id)) pickLines.delete(id); else pickLines.add(id);
        drawWork();
      };
      const o = tk.owner;
      const shown = {
        commenced: [when(o.laytime_commenced), when(tk.yours.laytime_commenced)],
        used: [`${o.laytime_used_hrs.toFixed(2)} hrs`, `${hrs(tk.yours.used_min)} hrs`],
        owed: [owed(o.result, o.amount_usd), owed(tk.yours.result, tk.yours.amount_usd)],
      };
      parts.push(
        h('h3', {}, 'Where is their statement wrong?'),
        h('p', { class: 'ticket-ask', id: 'pick-lines' }, 'Pick every line you dispute.'),
        h('div', { class: 'pick-lines', role: 'group', 'aria-labelledby': 'pick-lines' }, tk.lines.map((x) => h('button', {
          class: `gbtn outline pick${pickLines.has(x.id) ? ' on' : ''}`, type: 'button', 'data-fk': `line-${x.id}`, 'aria-pressed': String(pickLines.has(x.id)), onclick: () => toggle(x.id),
        }, x.label, h('span', { class: 'sub' }, `Owner ${shown[x.id][0]} · yours ${shown[x.id][1]}`)))),
        h('p', { class: 'ticket-ask', id: 'pick-hours' }, 'By how many hours is their laytime used out?'),
        h('div', { class: 'pick-hours', role: 'radiogroup', 'aria-labelledby': 'pick-hours' }, tk.hours.map((x) => h('button', {
          class: `gbtn outline pick${pickHours === x.id ? ' on' : ''}`, type: 'button', 'data-fk': `hours-${x.id}`, role: 'radio', 'aria-checked': String(pickHours === x.id),
          onclick: () => { pickHours = x.id; drawWork(); },
        }, `${x.hrs.toFixed(2)} hrs`))),
        h('div', { class: 'sum-actions' },
          h('button', { class: 'gbtn ink', type: 'button', 'data-fk': 'check', disabled: !pickLines.size || !pickHours, onclick: checkDispute }, 'Check')),
        checkMsg ? h('div', { class: 'coach', role: 'alert' }, h('p', { class: 'coach-tag' }, `${HEAD.name} · not quite`), h('p', {}, checkMsg), h('p', { class: 'muted small' }, 'Try again.')) : null);
      return h('article', { class: 'ticket t-explain' }, ...parts);
    }
    const area = h('textarea', { class: 'explain-input', rows: '3', maxlength: '300', placeholder: 'One sentence: what did the owner do wrong?', 'aria-label': 'What the owner got wrong' });
    area.value = explainText;
    area.addEventListener('input', () => { explainText = area.value; });
    const pin = l.run.pinpointed;
    parts.push(
      h('h3', {}, 'What did the owner get wrong?'),
      h('p', { class: 'pin-ok' }, `Lines and hours right${pin?.gained ? `, first try: +${pin.gained}` : ''}. Their laytime used is ${Math.abs(tk.gap_hrs).toFixed(2)} hrs ${tk.gap_hrs > 0 ? 'over' : 'under'} yours.`),
    );
    if (explainStage === 'write') {
      parts.push(h('p', {}, 'Now say why in one sentence, the way you would put it to the owner.'), area, h('div', { class: 'sum-actions' },
        h('button', { class: 'gbtn ink', type: 'button', onclick: () => { explainStage = 'mark'; drawWork(); } }, 'Compare with the model note')));
    } else {
      parts.push(
        explainText.trim() ? h('blockquote', { class: 'yours' }, h('p', {}, explainText.trim())) : h('p', { class: 'muted' }, 'You left it blank.'),
        h('div', { class: 'model-note' }, h('p', { class: 'coach-tag' }, 'Model note'), h('p', {}, gloss(modelNote(l.item)))),
        h('p', { class: 'ticket-ask' }, gloss('Did your sentence say the same thing?')),
        h('div', { class: 'ticket-calls' },
          h('button', { class: 'gbtn ok', type: 'button', onclick: () => finishExplain(true) }, 'Yes, I had it'),
          h('button', { class: 'gbtn outline', type: 'button', onclick: () => finishExplain(false) }, 'Not quite')));
    }
    return h('article', { class: 'ticket t-explain' }, ...parts);
  }

  function checkDispute() {
    const l = day.active;
    const r = l?.run.pinpoint([...pickLines], pickHours);
    if (!r) return;
    if (r.right) {
      checkMsg = null;
      explainStage = 'write';
      if (r.gained) gain = r.gained;
    } else checkMsg = r.message;
    drawWork();
    drawStatus();
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
      profile.record({ n: desk.key, label: desk.label, vessel: desk.title, score: s.score, stars: s.stars, right: s.rightFirstTime, decisions: s.decisions, difference_usd: s.difference_usd, off_usd: s.off_usd, takenOver: s.takenOver });
    }
    const best = Math.max(...profile.ledger().filter((e) => e.n === desk.key).map((e) => e.score));
    const diff = s.difference_usd;
    const verdict = multi
      ? (s.off_usd === 0 ? 'Your calls match the true statements.' : `Your first calls were USD ${USD.format(s.off_usd)} away from the true statements, added up vessel by vessel.`)
      : diff === 0 ? 'Your calls match the true statement.'
        : diff < 0 ? `Your calls cost the charterer USD ${USD.format(-diff)} more than the true statement.`
          : `Your calls claim USD ${USD.format(diff)} more than the true statement. The owner will push back.`;
    const one = s.per[0];
    const head = [
      h('p', { class: 'ticket-no' }, multi ? `${desk.label} complete · every vessel settled` : `Loading complete · ${stamp(one.lane.run.done)}`),
      h('div', { class: 'sum-head' }, h('h3', { id: 'sum-title' }, `${desk.title} settled`), stars(s.stars)),
      h('p', { class: 'sum-score mono' }, `Score ${N.format(s.score)}`, h('span', { class: 'muted' }, ` · best ${N.format(best)}`)),
      s.takenOver ? h('p', { class: 'taken' }, `Three strikes, so ${HEAD.name} took the desk and called the rest. Run it again to settle it yourself.`) : null,
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
        h('div', {}, h('dt', {}, gloss('Your first calls')), h('dd', { class: 'mono' }, owed(one.yours.result, one.yours.amount_usd)), h('dd', { class: 'muted mono' }, `${hrs(one.yours.used_min)} hrs used`)),
        h('div', {}, h('dt', {}, gloss('True statement')), h('dd', { class: 'mono' }, owed(one.correct.result, one.correct.amount_usd)), h('dd', { class: 'muted mono' }, `${hrs(one.correct.used_min)} hrs used`)),
        h('div', { class: `diff ${diff === 0 ? 'zero' : 'off'}` }, h('dt', {}, gloss('Difference')), h('dd', { class: 'mono big' }, `USD ${USD.format(Math.abs(diff))}`), h('dd', {}, verdict)));
    const notes = s.per.flatMap((p) => recapNotes(p, p.lane.item, p.lane.run.steps.find((t) => t.type === 'owner'), multi ? vesselName(p.lane.item) : null)
      .map((x) => h('p', { class: x.kind === 'note' ? 'note' : null }, gloss(x.text))));
    const wrongs = s.per.flatMap((p) => p.wrong.map((tk) => h('li', {}, multi ? h('span', { class: 'st-vessel' }, `${vesselName(p.lane.item)} · `) : null, ...describe(tk, p.lane))));
    return h('article', { class: 'summary', 'aria-labelledby': 'sum-title' },
      ...head,
      grid,
      multi ? h('p', { class: `day-diff ${s.off_usd === 0 ? 'zero' : 'off'}` }, h('strong', {}, `Across the day: USD ${USD.format(s.off_usd)}. `), verdict) : null,
      h('p', {}, `Right first time: ${s.rightFirstTime} of ${s.decisions} calls.`),
      starRules(s),
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
  function tipFor(l) {
    const tk = l?.run.open;
    if (!tk) return false;
    if (tk.type === 'settle' && l.item.fixture.despatch_basis === 'all time saved' && !profile.seen('ats')) {
      profile.markSeen('ats');
      tip = ATS_TIP;
      drawWork();
      return true;
    }
    return showTip(tk.type === 'time' ? 'time' : tk.type);
  }
  function afterClose(l) {
    feedback = null;
    const ln = l.run.lines[l.run.lines.length - 1];
    addLine(lineFor(ln, l), l);
    if (day.active && day.active !== l) resetDispute();
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
  function resetDispute() {
    explainText = '';
    explainStage = 'check';
    pickLines = new Set();
    pickHours = null;
    checkMsg = null;
  }
  function finishExplain(gotIt) {
    day.explain(explainText.trim(), gotIt);
    resetDispute();
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
    if (e.key === ' ' && !day.finished && (e.target === document.body || e.target === work)) { e.preventDefault(); setPaused(!paused); }
  }

  // A vessel's NOR goes on the statement when the desk clock reaches it
  function announceArrivals() {
    for (const l of day.lanes) {
      if (announced.has(l) || !day.arrived(l)) continue;
      announced.add(l);
      addLine({ kind: 'milestone', when: stamp(l.run.nor), what: 'NOR tendered', used: '' }, l);
    }
  }
  announceArrivals();
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
