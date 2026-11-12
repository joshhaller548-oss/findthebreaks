// One run of the desk: the clock from NOR to completion, the tickets that
// arrive on the way, the score, and what the player's calls are worth. No
// DOM here, so it can be tested in Node.
//
// Every right answer comes from calc.mjs. Time tickets: deductions() lists
// what the terms take off the clock, and every other stoppage counts. The
// start ticket: calculate()'s laytime_commenced. The settle ticket:
// calculate()'s amount, with wrong options priced by calculate() on
// altered terms. The owner ticket: the owner's figure against calculate().
// The player's first calls are priced by calculate() with those calls as
// the excepted periods and the commencement, so the same rules apply.

import { calculate, deductions, toMin, fromMin, clip, union } from '../laytime/calc.mjs';

const REASONS = {
  rain: 'Rain stopped loading',
  swell: 'Swell stopped loading',
  breakdown: 'Shore loader broke down',
  shifting: 'Vessel shifted berth',
  'berth congestion': 'Waiting for a berth',
  'public holiday': 'Public holiday, no loading',
};

export const CALLS = { counts: 'Time counts', off: 'Excepted', agree: 'Accept', dispute: 'Dispute' };

export const POINTS = { right: 100, streakStep: 20, streakCap: 100, explained: 100 };
export const STRIKES = 3;

const USD = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (result, amount) => (result === 'level' ? 'Level, nothing owed' : `${result === 'demurrage' ? 'Demurrage' : 'Despatch'} USD ${USD.format(amount)}`);

// ---------- time tickets ----------

export function buildTickets(item) {
  const { fixture: f, stoppages, result } = item;
  const span = [toMin(result.laytime_commenced), toMin(f.loading_completed)];
  const tickets = deductions(f, stoppages).map((e) => ({
    type: 'time',
    kind: e.kind,
    reason: e.kind === 'stoppage' ? e.label : null,
    start: e.start,
    end: e.end,
    minutes: e.minutes,
    loading: e.kind === 'shex' ? e.loading_under_way : false,
    answer: e.kind === 'shex' && !e.excepted ? 'counts' : 'off',
  }));
  // Stoppages that count are not in deductions(), but they still arrive as
  // tickets: they are the ones people wrongly take off
  for (const s of stoppages.filter((x) => x.voyage_id === f.voyage_id && x.counts_against_laytime)) {
    for (const [a, b] of clip([[toMin(s.start_time), toMin(s.end_time)]], span)) {
      tickets.push({ type: 'time', kind: 'stoppage', reason: s.reason, start: a, end: b, minutes: b - a, loading: false, answer: 'counts' });
    }
  }
  return tickets.sort((x, y) => x.start - y.start);
}

export function ticketTitle(t, f) {
  if (t.type === 'start') return 'When does laytime start?';
  if (t.type === 'settle') return 'Settle the laytime';
  if (t.type === 'owner') return 'The owner’s statement is in';
  if (t.kind === 'stoppage') return REASONS[t.reason] ?? t.reason;
  return `${f.shex_basis} window, ${t.loading ? 'loading carried on' : 'no loading'}`;
}

// What the head of operations says when a time call is wrong. Adapted from
// the drill 4 and drill 5 pitfalls for one ticket at a time.
export function coaching(t, f) {
  if (t.kind === 'shex') {
    if (t.answer === 'off' && t.loading) return 'Under SHEX EIU the window comes off even though loading carried on. Only SHEX UU counts the hours used.';
    if (t.answer === 'off') return 'Nobody loaded through the window and the terms except it. It comes off the clock.';
    return 'Unless used means unless used. They loaded through this part of the window, so it counts.';
  }
  if (t.answer === 'counts') {
    if (t.reason === 'berth congestion') return `The charter party says ${f.waiting_for_berth === 'WIBON' ? 'WIBON, whether in berth or not' : 'time lost waiting for a berth counts'}. Waiting for the berth is laytime.`;
    if (t.reason === 'public holiday') return 'SHINC includes holidays. The holiday counts like any other day.';
    return 'The terms do not except this stoppage, so the clock keeps running.';
  }
  if (t.reason === 'berth congestion') return 'There is no waiting for berth clause here, so congestion before berthing comes off the clock.';
  if (t.reason === 'public holiday') return 'The terms except holidays. No loading on the holiday, so it comes off.';
  if (t.reason === 'rain' || t.reason === 'swell') return 'Weather stopped loading, and the terms except weather. It comes off the clock.';
  if (t.reason === 'breakdown') return 'The shore loader broke down. Breakdowns are excepted on these terms, so it comes off.';
  if (t.reason === 'shifting') return 'Shifting berth is excepted on these terms. It comes off the clock.';
  return 'The terms except this stoppage. It comes off the clock.';
}

// ---------- decision tickets ----------

// When laytime starts. Options are the moments people pick; the coaching
// is drill 2's pitfalls, said about one vessel.
export function startTicket(item) {
  const { fixture: f, result } = item;
  const nor = toMin(f.nor_tendered);
  const turnEnd = nor + f.turn_time_hrs * 60;
  const load = toMin(f.loading_commenced);
  const right = toMin(result.laytime_commenced);
  const cand = [
    { at: nor, why: 'at NOR', wrong: 'That is NOR. Laytime does not start at NOR: it starts when turn time runs out, or on loading if that comes first.' },
    { at: turnEnd, why: 'when turn time runs out', wrong: 'Turn time had not run out when loading began. Laytime starts when loading starts if that comes first.' },
    { at: load, why: 'when loading starts', wrong: 'That is the start of loading. She was waiting before that, and laytime started when turn time ran out.' },
    { at: nor + f.turn_time_hrs * 1440, why: `${f.turn_time_hrs} days after NOR`, wrong: `Turn time is ${f.turn_time_hrs} hours, not ${f.turn_time_hrs} days.` },
  ];
  const seen = new Set();
  const options = cand.filter((c) => !seen.has(c.at) && seen.add(c.at)).slice(0, 3)
    .map((c, i) => ({ id: `s${i}`, at: c.at, label: fromMin(c.at), why: c.why, message: c.at === right ? null : c.wrong }));
  if (!options.some((o) => o.at === right)) throw new Error(`${f.voyage_id}: no start option is right`);
  return { type: 'start', start: nor, end: nor, minutes: 0, options: options.sort((a, b) => a.at - b.at), answer: options.find((o) => o.at === right).id };
}

// What is owed at completion. Wrong options are calculate() on altered
// terms or the classic slips from drill 6; the right one is calculate().
export function settleTicket(item) {
  const { fixture: f, stoppages, result } = item;
  const opts = [{ result: result.result, amount: result.amount_usd, message: null }];
  const add = (r, amount, message) => opts.push({ result: r, amount: Math.round(amount * 100) / 100, message });
  if (result.result === 'despatch') {
    add('despatch', result.amount_usd * 2, 'That is despatch at the full demurrage rate. Despatch is paid at half the rate.');
    const other = f.despatch_basis === 'all time saved' ? 'working time saved' : 'all time saved';
    const alt = calculate({ ...f, despatch_basis: other }, stoppages);
    add('despatch', alt.amount_usd, f.despatch_basis === 'all time saved'
      ? 'That pays laytime saved only. On all time saved, the excepted time after completion earns despatch too.'
      : 'That adds the excepted time after completion. Only all time saved pays it; this fixture is working time saved.');
    add('demurrage', result.amount_usd, 'Check the direction. She finished inside laytime, so the owner pays the charterer despatch.');
  } else if (result.result === 'demurrage') {
    add('demurrage', result.amount_usd / 2, 'That is demurrage at half rate. Half rate is for despatch; demurrage is paid at the full daily rate.');
    add('despatch', result.amount_usd, 'Check the direction. Laytime ran out before loading finished, so the charterer pays the owner demurrage.');
    const fromNor = calculate(f, stoppages, { commenced: toMin(f.nor_tendered) });
    add(fromNor.result, fromNor.amount_usd, 'That counts the clock from NOR. Laytime starts when turn time runs out, or on loading if that comes first.');
  }
  const seen = new Set();
  const options = opts.filter((o) => {
    const k = `${o.result}:${o.amount.toFixed(2)}`;
    return !seen.has(k) && seen.add(k);
  }).map((o, i) => ({ id: `m${i}`, ...o, label: money(o.result, o.amount) }));
  const answer = options[0].id;
  return { type: 'settle', options: options.sort((a, b) => a.amount - b.amount || a.result.localeCompare(b.result)), answer };
}

// The owner's statement against the true one. Disputed only where they differ.
export function ownerTicket(item) {
  const o = item.owner;
  const used = item.result.used_min / 60;
  const differs = Math.abs(o.laytime_used_hrs - used) > 0.005;
  return {
    type: 'owner',
    owner: o,
    yours: item.result,
    gap_hrs: o.laytime_used_hrs - used,
    error: item.ownerError ?? null,
    answer: differs ? 'dispute' : 'agree',
    message: differs
      ? `Their laytime used is ${(o.laytime_used_hrs - used).toFixed(2)} hrs more than yours. Never sign a statement that disagrees with your own figure.`
      : 'The owner’s figure matches yours to the minute. Disputing a correct statement costs time and goodwill. Accept it.',
  };
}

// ---------- the run ----------

export function createRun(item) {
  const { fixture: f, result } = item;
  const steps = [startTicket(item), ...buildTickets(item), settleTicket(item), ...(item.owner ? [ownerTicket(item)] : [])]
    .map((t, i) => ({ ...t, id: i + 1 }));
  const nor = toMin(f.nor_tendered);
  const commenced = toMin(result.laytime_commenced);
  const loadStart = toMin(f.loading_commenced);
  const done = toMin(f.loading_completed);
  const strikesAllowed = item.training ? Infinity : STRIKES;
  const s = {
    t: nor, used: 0, next: 0, open: null, first: {}, tries: {}, lines: [],
    score: 0, streak: 0, strikes: 0, takenOver: false, explaining: null, explained: null, finished: false,
  };

  const timeTickets = steps.filter((t) => t.type === 'time');

  function countUpTo(to) {
    const a = Math.max(s.t, commenced);
    if (to > a) s.used += to - a;
    s.t = to;
  }

  // Tickets due at a given moment: the start at NOR, time tickets at their
  // start, settle and owner at completion
  const dueAt = (tk) => (tk.type === 'time' ? tk.start : tk.type === 'start' ? nor : done);

  function openNext() {
    const tk = steps[s.next];
    if (tk && s.t >= dueAt(tk)) {
      s.open = tk;
      return true;
    }
    return false;
  }

  function close(tk, answer, firstTime, byHead = false) {
    if (tk.type === 'time') {
      if (tk.answer === 'counts') s.used += tk.minutes;
      s.t = tk.end;
    }
    s.lines.push({ ...tk, call: answer, firstTime, byHead, usedAfter: s.used });
    s.open = null;
    s.next += 1;
    if (tk.type === 'owner' && tk.answer === 'dispute') s.explaining = tk;
    else if (s.next >= steps.length) s.finished = true;
    else openNext();
  }

  const api = {
    item,
    steps,
    tickets: timeTickets,
    nor, commenced, loadStart, done,
    allowed: result.allowed_min,
    strikesAllowed,
    get t() { return s.t; },
    get used() { return s.used; },
    get open() { return s.open; },
    get lines() { return s.lines; },
    get finished() { return s.finished; },
    get explaining() { return s.explaining; },
    get score() { return s.score; },
    get strikes() { return s.strikes; },
    get takenOver() { return s.takenOver; },
    get left() { return result.allowed_min - s.used; },
    phase() {
      if (s.explaining) return 'owner';
      if (s.open) return 'ticket';
      if (s.finished) return 'complete';
      if (s.t >= done) return 'complete';
      if (s.t < commenced) return 'turn time';
      return 'laytime';
    },
    // Advance the clock by up to dt minutes; stops at the next ticket
    advance(dt) {
      if (s.open || s.finished || s.explaining) return s.open ? 'ticket' : 'stopped';
      if (openNext()) return 'ticket';
      const tk = steps[s.next];
      const stop = Math.min(s.t + dt, tk ? dueAt(tk) : done, done);
      countUpTo(stop);
      if (openNext()) return 'ticket';
      if (s.t >= done && s.next >= steps.length) s.finished = true;
      return s.finished ? 'complete' : 'running';
    },
    // Call the open ticket. A wrong call is coached, costs a strike, and the
    // ticket stays open to call again. Out of strikes, the head of
    // operations takes over and calls the rest.
    call(answer) {
      const tk = s.open;
      if (!tk) return null;
      const firstTry = !(tk.id in s.first);
      if (firstTry) s.first[tk.id] = answer;
      s.tries[tk.id] = (s.tries[tk.id] ?? 0) + 1;
      if (answer !== tk.answer) {
        s.streak = 0;
        let message = tk.message ?? null;
        if (tk.type === 'time') message = coaching(tk, f);
        if (tk.options) message = tk.options.find((o) => o.id === answer)?.message ?? message;
        if (firstTry) s.strikes += 1;
        if (s.strikes >= strikesAllowed) s.takenOver = true;
        return { right: false, message, takenOver: s.takenOver };
      }
      let gained = 0;
      if (firstTry && !s.takenOver) {
        gained = POINTS.right + Math.min(POINTS.streakCap, POINTS.streakStep * s.streak);
        s.streak += 1;
        s.score += gained;
      }
      close(tk, answer, firstTry);
      return { right: true, gained };
    },
    // Once taken over, the head of operations calls each ticket right
    headCall() {
      const tk = s.open;
      if (!tk) return null;
      if (!(tk.id in s.first)) s.first[tk.id] = '__head';
      close(tk, tk.answer, false, true);
      return tk;
    },
    // After disputing the owner: your sentence, then your own mark
    explain(text, gotIt) {
      if (!s.explaining) return;
      s.explained = { text, gotIt };
      if (gotIt) s.score += POINTS.explained;
      s.explaining = null;
      s.finished = true;
    },
    firstCall: (id) => s.first[id],
    summary() {
      const firstOf = (tk) => (s.first[tk.id] && s.first[tk.id] !== '__head' ? s.first[tk.id] : tk.answer);
      const callsOff = timeTickets.filter((tk) => firstOf(tk) === 'off').map((tk) => [tk.start, tk.end]);
      const st = steps.find((tk) => tk.type === 'start');
      const startAt = st.options.find((o) => o.id === firstOf(st)).at;
      const yours = calculate(f, item.stoppages, { excepted: union(callsOff), commenced: startAt });
      const signed = (r) => (r.result === 'demurrage' ? -r.amount_usd : r.amount_usd);
      const called = steps.filter((tk) => s.first[tk.id] && s.first[tk.id] !== '__head');
      const wrong = called.filter((tk) => s.first[tk.id] !== tk.answer);
      const rightFirstTime = called.length - wrong.length;
      const stars = s.takenOver ? 0 : wrong.length === 0 ? 3 : wrong.length <= 2 ? 2 : 1;
      return {
        yours,
        correct: result,
        // Positive means your calls pay the charterer more than the true statement
        difference_usd: Math.round((signed(yours) - signed(result)) * 100) / 100,
        rightFirstTime,
        decisions: steps.length,
        wrong,
        score: s.score,
        stars,
        strikes: s.strikes,
        takenOver: s.takenOver,
        explained: s.explained,
      };
    },
  };
  openNext();
  return api;
}
