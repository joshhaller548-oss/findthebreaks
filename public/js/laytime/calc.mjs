// Laytime, demurrage and despatch for one voyage. Interval arithmetic in
// whole minutes. scripts/check_laytime.py checks every figure with a
// separate minute by minute count.
//
// The rules, as the drills teach them:
//   allowed      cargo / load rate, in days of laytime
//   commenced    NOR + turn time, or loading start if loading began first
//   excepted     stoppages that do not count against laytime, plus the
//                SHEX window: all of it under SHEX EIU (even if used);
//                under SHEX UU (unless used) only the part where no loading
//                happened; none under SHINC
//   used         elapsed from commencement to completion, minus excepted
//   demurrage    used minus allowed, at the daily rate, pro rata
//   despatch     at half the demurrage rate, on laytime saved (working time
//                saved) or on all time saved: the calendar time from
//                completion to the moment laytime would have run out,
//                counting the SHEX windows that would have been excepted
//
// Once on demurrage, always on demurrage: exceptions stop counting when
// laytime runs out. The generated data avoids exceptions after that point,
// and demurrageAfterExceptions reports if one is ever present.

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK = 7 * 1440;
// 2026-01-04 was a Sunday; windows are laid out in weeks from there
const SUNDAY_ZERO = Date.UTC(2026, 0, 4) / 60000;

export const toMin = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`bad time ${s}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000;
};
export const fromMin = (t) => new Date(t * 60000).toISOString().slice(0, 16).replace('T', ' ');
export const dayName = (t) => DAYS[new Date(t * 60000).getUTCDay()];
export const dhm = (min) => {
  const sign = min < 0 ? '-' : '';
  const a = Math.abs(min);
  const d = Math.floor(a / 1440);
  const h = Math.floor((a % 1440) / 60);
  const m = a % 60;
  return `${sign}${d}d ${String(h).padStart(2, '0')}h${m ? ` ${String(m).padStart(2, '0')}m` : ''}`;
};

// "Sun 00:00 to 24:00", "Sat 17:00 to Mon 08:00"
export function parseWindow(text) {
  const m = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (\d{2}):(\d{2}) to (?:(Sun|Mon|Tue|Wed|Thu|Fri|Sat) )?(\d{2}):(\d{2})$/.exec(text || '');
  if (!m) throw new Error(`cannot read SHEX window "${text}"`);
  const startDay = DAYS.indexOf(m[1]);
  const start = startDay * 1440 + +m[2] * 60 + +m[3];
  const endDay = m[4] ? DAYS.indexOf(m[4]) : startDay;
  let end = endDay * 1440 + +m[5] * 60 + +m[6];
  if (end <= start) end += WEEK;
  return { start, end };
}

// Window instances overlapping [a, b)
export function windowInstances(text, a, b) {
  const w = parseWindow(text);
  const out = [];
  const first = Math.floor((a - SUNDAY_ZERO) / WEEK) - 1;
  const last = Math.floor((b - SUNDAY_ZERO) / WEEK) + 1;
  for (let k = first; k <= last; k++) {
    const s = SUNDAY_ZERO + k * WEEK + w.start;
    const e = SUNDAY_ZERO + k * WEEK + w.end;
    if (e > a && s < b) out.push([s, e]);
  }
  return out;
}

// ---------- intervals: arrays of [start, end) ----------

export function union(list) {
  const s = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
export const clip = (list, [a, b]) => union(list.map(([s, e]) => [Math.max(s, a), Math.min(e, b)]));
export const length = (list) => union(list).reduce((n, [a, b]) => n + b - a, 0);
export function subtract(list, minus) {
  let out = union(list);
  for (const [ma, mb] of union(minus)) {
    out = out.flatMap(([a, b]) => (mb <= a || ma >= b ? [[a, b]] : [[a, Math.min(b, ma)], [Math.max(a, mb), b]].filter(([x, y]) => y > x)));
  }
  return out;
}

// Walk forward from t until `need` minutes of laytime have counted
function runOut(t, need, excepted) {
  let at = t;
  let left = need;
  for (const [a, b] of union(excepted)) {
    if (b <= at) continue;
    if (a > at) {
      if (a - at >= left) return at + left;
      left -= a - at;
    }
    at = Math.max(at, b);
  }
  return at + left;
}

// Integer cents, rounded half up: minutes * rate per day * 100 / (1440 * divisor)
const cents = (minutes, ratePerDay, divisor) => {
  const num = minutes * ratePerDay * 100;
  const den = 1440 * divisor;
  return Math.floor((2 * num + den) / (2 * den));
};

export function calculate(fixture, stoppages) {
  const nor = toMin(fixture.nor_tendered);
  const loadStart = toMin(fixture.loading_commenced);
  const done = toMin(fixture.loading_completed);
  const allowedExact = (fixture.cargo_mt * 1440) / fixture.load_rate_mt_per_day;
  if (!Number.isInteger(allowedExact)) throw new Error(`${fixture.voyage_id}: laytime allowed is not a whole number of minutes`);
  const allowed = allowedExact;

  const viaTurn = nor + fixture.turn_time_hrs * 60;
  const commenced = Math.min(viaTurn, loadStart);
  const span = [commenced, done];
  const own = stoppages.filter((s) => s.voyage_id === fixture.voyage_id).map((s) => ({ ...s, iv: [toMin(s.start), toMin(s.end)] }));
  const deductible = clip(own.filter((s) => !s.counts_against_laytime).map((s) => s.iv), span);
  const anyStop = union(own.map((s) => s.iv));

  const basis = fixture.shex_basis;
  const shex = basis !== 'SHINC';
  const horizon = done + 30 * 1440;
  const windows = shex ? windowInstances(fixture.shex_window, commenced, horizon) : [];
  const windowsIn = clip(windows, span);
  let shexExcepted = [];
  if (basis === 'SHEX EIU') shexExcepted = windowsIn;
  if (basis === 'SHEX UU') {
    const worked = subtract(clip(windowsIn, [loadStart, done]), anyStop);
    shexExcepted = subtract(windowsIn, worked);
  }
  const excepted = union([...deductible, ...shexExcepted]);
  const elapsed = done - commenced;
  const used = elapsed - length(excepted);
  const balance = used - allowed;

  // After completion nothing is loaded, so a SHEX window would be excepted
  // under EIU and UU alike. That matters only for all time saved.
  const future = windows.filter(([, b]) => b > done).map(([a, b]) => [Math.max(a, done), b]);
  const expiry = runOut(commenced, allowed, [...excepted, ...future]);

  const out = {
    voyage_id: fixture.voyage_id,
    allowed_min: allowed,
    laytime_commenced: fromMin(commenced),
    commenced_on: commenced === loadStart && loadStart < viaTurn ? 'loading start' : 'turn time',
    elapsed_min: elapsed,
    deductible_stoppage_min: length(deductible),
    shex_excepted_min: length(subtract(shexExcepted, deductible)),
    used_min: used,
    balance_min: balance,
    laytime_expiry: fromMin(expiry),
    result: balance > 0 ? 'demurrage' : balance < 0 ? 'despatch' : 'level',
    time_on_demurrage_min: 0,
    time_saved_min: 0,
    amount_usd: 0,
    demurrage_after_exceptions: false,
  };
  if (balance > 0) {
    out.time_on_demurrage_min = done - expiry;
    out.demurrage_after_exceptions = done - expiry !== balance;
    out.amount_usd = cents(out.time_on_demurrage_min, fixture.demurrage_rate_usd_per_day, 1) / 100;
  } else if (balance < 0) {
    out.time_saved_min = fixture.despatch_basis === 'all time saved' ? expiry - done : -balance;
    out.amount_usd = cents(out.time_saved_min, fixture.demurrage_rate_usd_per_day, 2) / 100;
  }
  return out;
}

// The worked example with the terms from the defaults file, plus overrides
export function workedExample(example, defaults, overrides = {}) {
  const fixture = {
    ...example.fixture,
    shex_basis: defaults.shex_basis,
    despatch_basis: defaults.despatch_basis,
    shex_window: defaults.shex_window,
    ...overrides,
  };
  return { fixture, result: calculate(fixture, example.stoppages) };
}
