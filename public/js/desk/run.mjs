// One run of the desk: the clock from NOR to completion, the tickets that
// arrive on the way, and what the player's calls are worth. No DOM here,
// so it can be tested in Node.
//
// The right answer on every ticket comes from calc.mjs: deductions() lists
// what the terms take off the clock, and every other stoppage counts. The
// money for a set of calls comes from calculate() with those calls as the
// excepted periods, so the player is priced by the same rules as the key.

import { calculate, deductions, toMin, clip, union } from '../laytime/calc.mjs';

const REASONS = {
  rain: 'Rain stopped loading',
  swell: 'Swell stopped loading',
  breakdown: 'Shore loader broke down',
  shifting: 'Vessel shifted berth',
  'berth congestion': 'Waiting for a berth',
  'public holiday': 'Public holiday, no loading',
};

export const CALLS = { counts: 'Time counts', off: 'Excepted' };

// Every ticket in time order, with the engine's answer
export function buildTickets(item) {
  const { fixture: f, stoppages, result } = item;
  const span = [toMin(result.laytime_commenced), toMin(f.loading_completed)];
  const off = deductions(f, stoppages);
  const tickets = off.map((e) => ({
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
      tickets.push({ kind: 'stoppage', reason: s.reason, start: a, end: b, minutes: b - a, loading: false, answer: 'counts' });
    }
  }
  return tickets.sort((x, y) => x.start - y.start).map((t, i) => ({ ...t, id: i + 1 }));
}

export function ticketTitle(t, f) {
  if (t.kind === 'stoppage') return REASONS[t.reason] ?? t.reason;
  return `${f.shex_basis} window, ${t.loading ? 'loading carried on' : 'no loading'}`;
}

// What the head of operations says when a call is wrong. Adapted from the
// drill pitfalls (drills 4 and 5) for one ticket at a time.
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

// The run itself. Times are minutes since the epoch, like calc.mjs.
export function createRun(item) {
  const { fixture: f, result } = item;
  const tickets = buildTickets(item);
  const nor = toMin(f.nor_tendered);
  const commenced = toMin(result.laytime_commenced);
  const loadStart = toMin(f.loading_commenced);
  const done = toMin(f.loading_completed);
  const state = {
    t: nor,
    used: 0,
    next: 0,
    open: null,
    first: {},
    tries: {},
    lines: [],
    finished: false,
  };

  // Free time between tickets counts once laytime has commenced
  function countUpTo(to) {
    const a = Math.max(state.t, commenced);
    if (to > a) state.used += to - a;
    state.t = to;
  }

  return {
    item,
    tickets,
    nor,
    commenced,
    loadStart,
    done,
    allowed: result.allowed_min,
    get t() { return state.t; },
    get used() { return state.used; },
    get open() { return state.open; },
    get lines() { return state.lines; },
    get finished() { return state.finished; },
    get left() { return result.allowed_min - state.used; },
    phase() {
      if (state.open) return 'ticket';
      if (state.finished) return 'complete';
      if (state.t < commenced) return 'turn time';
      return 'laytime';
    },
    // Advance the clock by up to `dt` minutes; stops at the next ticket or at
    // completion and reports which
    advance(dt) {
      if (state.open || state.finished) return state.open ? 'ticket' : 'complete';
      const nextTicket = tickets[state.next];
      const stop = Math.min(state.t + dt, nextTicket ? nextTicket.start : done, done);
      countUpTo(stop);
      if (nextTicket && state.t >= nextTicket.start) {
        state.open = nextTicket;
        return 'ticket';
      }
      if (state.t >= done) {
        state.finished = true;
        return 'complete';
      }
      return 'running';
    },
    // Call the open ticket. Wrong calls return a coaching line and leave it
    // open to call again; the first call is what the summary prices.
    call(answer) {
      const tk = state.open;
      if (!tk) return null;
      if (!(tk.id in state.first)) state.first[tk.id] = answer;
      state.tries[tk.id] = (state.tries[tk.id] ?? 0) + 1;
      if (answer !== tk.answer) return { right: false, message: coaching(tk, f) };
      if (tk.answer === 'counts') state.used += tk.minutes;
      state.t = tk.end;
      state.lines.push({ ...tk, call: answer, firstTime: state.tries[tk.id] === 1, usedAfter: state.used });
      state.open = null;
      state.next += 1;
      return { right: true };
    },
    firstCall: (id) => state.first[id],
    summary() {
      const callsOff = tickets.filter((tk) => (state.first[tk.id] ?? tk.answer) === 'off').map((tk) => [tk.start, tk.end]);
      const yours = calculate(f, item.stoppages, { excepted: union(callsOff) });
      const signed = (r) => (r.result === 'demurrage' ? -r.amount_usd : r.amount_usd);
      return {
        yours,
        correct: result,
        // Positive means your calls pay the charterer more than the true statement
        difference_usd: Math.round((signed(yours) - signed(result)) * 100) / 100,
        rightFirstTime: tickets.filter((tk) => state.first[tk.id] === tk.answer).length,
        wrong: tickets.filter((tk) => state.first[tk.id] !== undefined && state.first[tk.id] !== tk.answer),
        tickets: tickets.length,
      };
    },
  };
}
