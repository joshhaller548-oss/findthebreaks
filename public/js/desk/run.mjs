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

import { calculate, deductions, toMin, fromMin, clip, union, windowInstances, length } from '../laytime/calc.mjs';

const REASONS = {
  rain: 'Rain stopped loading',
  swell: 'Swell stopped loading',
  breakdown: 'Shore loader broke down',
  shifting: 'Vessel shifted berth',
  'berth congestion': 'Waiting for a berth',
  'public holiday': 'Public holiday, no loading',
};

export const CALLS = { counts: 'Time counts', off: 'Excepted', agree: 'Accept', dispute: 'Dispute' };

export const POINTS = { right: 100, streakStep: 20, streakCap: 100, explained: 100, pinpoint: 50 };
export const STRIKES = 3;

// Stars weigh two things: how many calls were right first time, and how far
// your first calls were from the true statement in dollars. The first rule
// a run meets sets its stars; taken over by the head of operations is none.
// On a day, the dollars add up vessel by vessel, so errors never cancel.
export const STAR_RULES = [
  { stars: 3, minShare: 0.9, maxOff: 1000 },
  { stars: 2, minShare: 0.75, maxOff: 10000 },
  { stars: 1, minShare: 0, maxOff: Infinity },
];
export function starsFor({ rightFirstTime, decisions, off_usd, takenOver }) {
  if (takenOver) return 0;
  const share = decisions ? rightFirstTime / decisions : 0;
  return STAR_RULES.find((r) => share >= r.minShare - 1e-9 && off_usd <= r.maxOff).stars;
}

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
  return { type: 'settle', options: options.sort((a, b) => a.amount - b.amount || a.result.localeCompare(b.result)), answer, after: afterCompletion(item) };
}

// What the settle ticket needs to price despatch on either basis: laytime
// left at completion, and the SHEX windows between completion and the
// moment laytime would have run out (calc.mjs's laytime_expiry). Working
// time saved pays on the first; all time saved on both. Null when there is
// no despatch to price.
export function afterCompletion(item) {
  const { fixture: f, result: r } = item;
  if (r.result !== 'despatch') return null;
  const done = toMin(f.loading_completed);
  const expiry = toMin(r.laytime_expiry);
  const windows = f.shex_basis === 'SHINC' ? [] : clip(windowInstances(f.shex_window, done, expiry), [done, expiry]);
  return {
    left_min: r.allowed_min - r.used_min,
    windows: windows.map(([a, b]) => ({ start: a, end: b, minutes: b - a })),
    excepted_min: length(windows),
  };
}

// The owner's statement against the true one. Disputed only where they differ.
// A dispute is checked before the written sentence: which lines of their
// statement are wrong, and by how many hours their laytime used is out.
export function ownerTicket(item) {
  const o = item.owner;
  const r = item.result;
  const used = r.used_min / 60;
  const differs = Math.abs(o.laytime_used_hrs - used) > 0.005;
  const gap = Math.round((o.laytime_used_hrs - used) * 100) / 100;
  const lines = [
    { id: 'commenced', label: 'Laytime commenced', differs: o.laytime_commenced !== r.laytime_commenced },
    { id: 'used', label: 'Laytime used', differs },
    { id: 'owed', label: 'Owed', differs: o.result !== r.result || Math.abs(o.amount_usd - r.amount_usd) > 0.005 },
  ];
  // The true gap, and two misreadings of the table: their whole laytime
  // used, and their laytime used against allowed
  const seen = new Set();
  const hours = [gap, o.laytime_used_hrs, o.laytime_used_hrs - r.allowed_min / 60, gap * 2]
    .map((x) => Math.round(Math.abs(x) * 100) / 100)
    .filter((x) => x > 0 && !seen.has(x) && seen.add(x))
    .slice(0, 3)
    .sort((a, b) => a - b)
    .map((x, i) => ({ id: `h${i}`, hrs: x }));
  return {
    type: 'owner',
    owner: o,
    yours: r,
    gap_hrs: o.laytime_used_hrs - used,
    error: item.ownerError ?? null,
    lines,
    hours,
    hoursAnswer: differs ? hours.find((x) => x.hrs === Math.abs(gap)).id : null,
    answer: differs ? 'dispute' : 'agree',
    message: differs
      ? `Their laytime used is ${(o.laytime_used_hrs - used).toFixed(2)} hrs more than yours. Never sign a statement that disagrees with your own figure.`
      : 'The owner’s figure matches yours to the minute. Disputing a correct statement costs time and goodwill. Accept it.',
  };
}

// ---------- the run ----------

export function createRun(item, { strikes } = {}) {
  const { fixture: f, result } = item;
  const steps = [startTicket(item), ...buildTickets(item), settleTicket(item), ...(item.owner ? [ownerTicket(item)] : [])]
    .map((t, i) => ({ ...t, id: i + 1 }));
  const nor = toMin(f.nor_tendered);
  const commenced = toMin(result.laytime_commenced);
  const loadStart = toMin(f.loading_commenced);
  const done = toMin(f.loading_completed);
  const strikesAllowed = strikes ?? (item.training ? Infinity : STRIKES);
  const s = {
    t: nor, used: 0, next: 0, open: null, first: {}, tries: {}, lines: [],
    score: 0, streak: 0, strikes: 0, takenOver: false, explaining: null, explained: null, finished: false,
    pinpointed: null, pinTries: 0,
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
        return { right: false, message, takenOver: s.takenOver, struck: firstTry };
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
    // After disputing the owner, before the sentence: which lines are wrong
    // (ids from the ticket's lines) and the hours (an id from its hours).
    // Right on the first try earns POINTS.pinpoint; a miss is coached and
    // can be tried again, with no strike.
    pinpoint(lineIds, hoursId) {
      const tk = s.explaining;
      if (!tk || s.pinpointed) return null;
      s.pinTries += 1;
      const want = tk.lines.filter((x) => x.differs).map((x) => x.id).sort().join();
      const linesRight = [...new Set(lineIds)].sort().join() === want;
      const hoursRight = hoursId === tk.hoursAnswer;
      if (linesRight && hoursRight) {
        const gained = s.pinTries === 1 && !s.takenOver ? POINTS.pinpoint : 0;
        s.score += gained;
        s.pinpointed = { tries: s.pinTries, gained };
        return { right: true, gained };
      }
      const usedYours = (tk.yours.used_min / 60).toFixed(2);
      const message = !linesRight
        ? 'Not those lines. Read their column against yours, line by line: dispute every line where the figures differ, and only those.'
        : `The lines are right, but not the hours. Take your laytime used from theirs: ${tk.owner.laytime_used_hrs.toFixed(2)} less ${usedYours}.`;
      return { right: false, linesRight, hoursRight, message };
    },
    get pinpointed() { return s.pinpointed; },
    // After disputing the owner: your sentence, then your own mark
    explain(text, gotIt) {
      if (!s.explaining) return;
      s.explained = { text, gotIt };
      if (gotIt) s.score += POINTS.explained;
      s.explaining = null;
      s.finished = true;
    },
    firstCall: (id) => s.first[id],
    // When the next step falls due on this vessel's own clock
    nextDue() {
      if (s.finished) return Infinity;
      const tk = steps[s.next];
      return tk ? dueAt(tk) : done;
    },
    // A day on the desk shares its strikes: when they run out, every
    // vessel is handed to the head of operations
    takeOver() { s.takenOver = true; },
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
      // Positive means your calls pay the charterer more than the true statement
      const difference = Math.round((signed(yours) - signed(result)) * 100) / 100;
      const stars = starsFor({ rightFirstTime, decisions: steps.length, off_usd: Math.abs(difference), takenOver: s.takenOver });
      return {
        yours,
        correct: result,
        difference_usd: difference,
        off_usd: Math.abs(difference),
        rightFirstTime,
        decisions: steps.length,
        wrong,
        score: s.score,
        stars,
        strikes: s.strikes,
        takenOver: s.takenOver,
        explained: s.explained,
        pinpointed: s.pinpointed,
      };
    },
  };
  openNext();
  return api;
}

// ---------- a day on the desk ----------

// The twelve fixtures as four days of three vessels. Each vessel keeps its
// own statement of facts. planDay() puts them on one calendar, and the desk
// clock runs them together from the first NOR. ARRIVAL_GAP is the spacing
// createDay() uses when it is given no offsets.
export const DAYS = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]];
export const ARRIVAL_GAP = 20 * 60;

const WEEK = 7 * 1440;
// A cargo moved by whole weeks. The weekday of every entry stays the same,
// so the SHEX windows fall on the same hours and calc.mjs gives the same
// minutes and money; only the dates change. `shift` is in minutes.
export function shiftItem(item, weeks) {
  const d = weeks * WEEK;
  if (!d) return { ...item, shift: item.shift ?? 0 };
  const mv = (s) => fromMin(toMin(s) + d);
  const f = item.fixture;
  const fixture = { ...f, nor_tendered: mv(f.nor_tendered), loading_commenced: mv(f.loading_commenced), loading_completed: mv(f.loading_completed) };
  const stoppages = item.stoppages.map((x) => ({ ...x, start_time: mv(x.start_time), end_time: mv(x.end_time) }));
  const owner = item.owner ? { ...item.owner, laytime_commenced: mv(item.owner.laytime_commenced) } : item.owner;
  return { ...item, fixture, stoppages, owner, result: calculate(fixture, stoppages), events: deductions(fixture, stoppages), shift: (item.shift ?? 0) + d };
}

// A day's vessels on one calendar. One vessel keeps its dates; each other
// moves by whole weeks to its first NOR at or after that one. The anchor is
// whichever keeps the arrivals closest together. Returns [{ item, offset }]
// in arrival order, offset in minutes after the first NOR. Vessels with the
// same NOR arrive together.
export function planDay(items) {
  const nor = (it) => toMin(it.fixture.nor_tendered);
  let best = null;
  for (const anchor of items) {
    const a = nor(anchor);
    const weeks = items.map((it) => Math.ceil((a - nor(it)) / WEEK));
    const spread = Math.max(...items.map((it, i) => nor(it) + weeks[i] * WEEK - a));
    if (!best || spread < best.spread) best = { weeks, spread, a };
  }
  return items
    .map((it, i) => ({ item: shiftItem(it, best.weeks[i]), i }))
    .map((x) => ({ ...x, offset: nor(x.item) - best.a }))
    .sort((x, y) => x.offset - y.offset || x.i - y.i)
    .map(({ item, offset }) => ({ item, offset }));
}

// items are cargoes, or planned lanes [{ item, offset }] from planDay()
export function createDay(items, { gap = ARRIVAL_GAP, strikes } = {}) {
  const planned = items.every((x) => x && 'offset' in x && 'item' in x);
  const list = planned ? items.map((x) => x.item) : items;
  const training = list.length === 1 && list[0].training;
  const limit = strikes ?? (training ? Infinity : STRIKES);
  const lanes = list.map((item, i) => {
    const run = createRun(item, { strikes: Infinity });
    return { i, item, run, offset: planned ? items[i].offset : i * gap, nor: run.nor };
  });
  let T = 0;
  let strikesUsed = 0;
  let takenOver = false;
  const deskOf = (l) => l.run.t - l.nor + l.offset;
  // Only a vessel that has arrived can have a ticket in front of you
  const here = () => lanes.filter((l) => T >= l.offset);
  // When a vessel's next step falls due, in desk minutes
  const dueOn = (l) => l.offset + l.run.nextDue() - l.nor;
  // A ticket is in front of you only once the desk clock reaches it. A
  // vessel whose last ticket closed a whole period is ahead of the desk,
  // and its next ticket waits for the desk to catch up, so every ticket
  // opens at its own time on the day's one calendar.
  const due = (l) => (l.run.explaining || l.run.open) && dueOn(l) <= T;
  const active = () => here().find((l) => l.run.explaining && due(l)) ?? here().find((l) => l.run.open && due(l)) ?? null;
  // When every vessel still working is ahead of the desk, the desk catches
  // up to the earliest of them (never past the next arrival): a single
  // vessel's clock jumps with its tickets, as it always has. It runs when
  // a call closes a ticket, so advance() stays additive and a replay lands
  // where the play did.
  function catchUp() {
    const live = lanes.filter((l) => !l.run.finished);
    if (!live.length) return;
    const ahead = Math.min(...live.map((l) => (T >= l.offset ? Math.min(deskOf(l), dueOn(l)) : l.offset)));
    if (ahead > T) T = ahead;
  }

  const day = {
    lanes,
    training,
    // The desk calendar: the moment the first vessel tendered NOR, plus T
    start: lanes[0].nor - lanes[0].offset,
    strikesAllowed: limit,
    get T() { return T; },
    get strikes() { return strikesUsed; },
    get takenOver() { return takenOver; },
    get finished() { return lanes.every((l) => l.run.finished); },
    get score() { return lanes.reduce((n, l) => n + l.run.score, 0); },
    get active() { return active(); },
    arrived: (l) => T >= l.offset,
    // Advance the desk clock by up to dt minutes, stopping when any vessel
    // has a ticket due
    advance(dt) {
      if (active()) return 'ticket';
      if (day.finished) return 'complete';
      const live = lanes.filter((l) => !l.run.finished);
      const next = Math.min(...live.map(dueOn));
      const target = Math.min(T + dt, next);
      // A vessel can be ahead of the desk clock after a ticket jumps it to
      // the end of a period; it waits for the desk to catch up
      for (const l of live) if (l.offset <= target) l.run.advance(Math.max(0, target - Math.max(deskOf(l), l.offset)));
      T = target;
      return active() ? 'ticket' : day.finished ? 'complete' : 'running';
    },
    call(answer) {
      const l = active();
      if (!l || takenOver) return null;
      const r = l.run.call(answer);
      if (r?.right) catchUp();
      if (r && !r.right && r.struck) {
        strikesUsed += 1;
        if (strikesUsed >= limit) {
          takenOver = true;
          for (const x of lanes) x.run.takeOver();
        }
      }
      return r && { ...r, lane: l, takenOver };
    },
    headCall() {
      const l = active();
      if (!l) return null;
      if (l.run.explaining) l.run.explain(null, false);
      else l.run.headCall();
      catchUp();
      return l;
    },
    explain(text, gotIt) {
      const l = active();
      if (l?.run.explaining) l.run.explain(text, gotIt);
      catchUp();
    },
    pinpoint(lines, hours) {
      const l = active();
      return l?.run.explaining ? l.run.pinpoint(lines, hours) : null;
    },
    summary() {
      const per = lanes.map((l) => ({ lane: l, ...l.run.summary() }));
      const wrong = per.reduce((n, p) => n + p.wrong.length, 0);
      const out = {
        per,
        score: day.score,
        decisions: per.reduce((n, p) => n + p.decisions, 0),
        rightFirstTime: per.reduce((n, p) => n + p.rightFirstTime, 0),
        wrong,
        difference_usd: Math.round(per.reduce((n, p) => n + p.difference_usd, 0) * 100) / 100,
        off_usd: Math.round(per.reduce((n, p) => n + p.off_usd, 0) * 100) / 100,
        takenOver,
        strikes: strikesUsed,
      };
      out.stars = starsFor(out);
      return out;
    },
  };
  return day;
}

// ---------- saving and resuming ----------

// What the player did, in order, is enough to rebuild a desk: the clock
// only ever stops at tickets, so the same calls in the same order reach
// the same state. Each entry names the vessel and ticket it was made on,
// so a log that no longer fits the data is refused, not misread.
export function logEntry(day, action) {
  const l = day.active;
  if (!l) return null;
  const tk = l.run.explaining ?? l.run.open;
  return { ...action, lane: l.i, ticket: tk.id };
}

// A signature of the desk's data, so progress saved against other data is
// dropped
export const daySignature = (day) => day.lanes.map((l) => `${l.item.fixture.voyage_id}@${l.offset}:${l.run.steps.length}`).join('|');

// Replay `log` onto a new day, then run the clock on to desk time T.
// hooks.before() runs before each step, hooks.closed(lane) after a step
// that put a line on a vessel's statement. Returns false if the log does
// not fit this day.
export function replayDay(day, log, T = 0, hooks = {}) {
  for (const e of log) {
    for (let guard = 0; !day.active && !day.finished && guard < 100000; guard++) day.advance(24 * 60);
    hooks.before?.();
    const l = day.active;
    const tk = l && (l.run.explaining ?? l.run.open);
    if (!l || l.i !== e.lane || tk?.id !== e.ticket) return false;
    const lines = l.run.lines.length;
    if (e.a === 'call') day.call(e.v);
    else if (e.a === 'head') day.headCall();
    else if (e.a === 'pin') day.pinpoint(e.lines, e.hours);
    else if (e.a === 'explain') day.explain(e.text, e.gotIt);
    else return false;
    if (l.run.lines.length > lines) hooks.closed?.(l);
  }
  for (let guard = 0; day.T < T && !day.active && !day.finished && guard < 100000; guard++) day.advance(T - day.T);
  hooks.before?.();
  return true;
}
