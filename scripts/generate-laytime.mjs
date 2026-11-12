// Generates the laytime dataset and its answer key.
//
//   public/data/laytime.json      fixtures, stoppages, owner_statement
//   public/data/laytime.key.json  every voyage worked out by
//                                 public/js/laytime/calc.mjs, plus the three
//                                 planted owner errors
//
// Seeded, so a rerun gives identical output. scripts/check_laytime.py then
// checks every figure independently, in Python, minute by minute.
//
// Three groups of voyages share one timeline and differ only in their
// terms, so the same elapsed time gives a different answer. That is the
// lesson: read the charterparty before calculating.

import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { calculate, toMin, fromMin, windowInstances, union, clip, length } from '../public/js/laytime/calc.mjs';

const SEED = 20260601;
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const HALF = 30;

const SUN = 'Sun 00:00 to 24:00';
const SATMON = 'Sat 17:00 to Mon 08:00';
const EIU = 'SHEX EIU';
const UU = 'SHEX UU';
const WTS = 'working time saved';
const ATS = 'all time saved';

// Terms per voyage. Groups share a timeline:
//   A  voyages 1 and 2   SHEX EIU against SHEX UU
//   B  voyages 4, 6, 8   despatch basis and SHEX window
//   C  voyages 10 and 11 SHEX against SHINC, holidays included
const TERMS = [
  { shex: EIU, desp: WTS, win: SUN, group: 'A' },
  { shex: UU, desp: WTS, win: SUN, group: 'A' },
  { shex: 'SHINC', desp: WTS, win: null },
  { shex: EIU, desp: ATS, win: SATMON, group: 'B' },
  { shex: UU, desp: ATS, win: SUN },
  { shex: EIU, desp: WTS, win: SATMON, group: 'B' },
  { shex: 'SHINC', desp: ATS, win: null },
  { shex: EIU, desp: ATS, win: SUN, group: 'B' },
  { shex: EIU, desp: WTS, win: SATMON },
  { shex: EIU, desp: WTS, win: SUN, group: 'C' },
  { shex: 'SHINC', desp: WTS, win: null, group: 'C' },
  { shex: UU, desp: ATS, win: SATMON },
];

const vessels = ['Pacific Venture', 'Cape Orchid', 'Star Magdalena', 'Nord Harmony', 'Ocean Pioneer', 'Sea Falcon',
  'Atlantic Grace', 'Bulk Andes', 'Ionian Spirit', 'Coral Bay', 'Iron Meridian', 'Rio Cesar', 'Silver Tern', 'Baltic Wave'];

const CARGOES = [];
for (let mt = 40000; mt <= 75000; mt += 2500) {
  for (const rate of [8000, 10000, 12000, 15000, 20000]) {
    const min = (mt * 1440) / rate;
    if (Number.isInteger(min) && min % HALF === 0 && min >= 2.5 * 1440 && min <= 7 * 1440) CARGOES.push([mt, rate]);
  }
}

// What each stoppage reason means for laytime. Rates are per weather
// working day, so weather that stopped work does not count. Waiting for a
// berth after laytime has started counts. Shifting does not, by the usual
// clause. A breakdown of the ship's gear does not. A public holiday is
// excepted under SHEX and counts under SHINC.
const COUNTS = { rain: false, swell: false, shifting: false, breakdown: false };
// Waiting for a berth counts only if the charterparty says so: WIBON, or a
// clause that time lost waiting for berth counts. Every fixture with
// congestion carries one, and check_laytime.py fails if one does not.
const CLAUSES = ['WIBON', 'time lost waiting for berth to count'];
const countsFor = (reason, shex, clause) => {
  if (reason === 'public holiday') return shex === 'SHINC';
  if (reason === 'berth congestion') return Boolean(clause);
  return COUNTS[reason];
};

const iso = (t) => fromMin(t);
const roundHalf = (t) => Math.round(t / HALF) * HALF;

// A timeline: NOR, turn time, loading start and end, cargo, rate, stoppages
function makeTimeline(windowsToAvoid) {
  const [cargo, rate] = pick(CARGOES);
  const allowed = (cargo * 1440) / rate;
  const day = int(32, 300);
  const nor = toMin('2026-01-01 00:00') + day * 1440 + pick([6, 8, 10.5, 14, 17.5, 21, 23]) * 60;
  const turn = pick([6, 12]);
  const delta = pick([-4, -2, 0, 3, 8, 20]) * 60;
  const loadStart = Math.max(nor + 60, nor + turn * 60 + delta);
  // Aim for a finish somewhere between well inside and well over laytime
  const done = roundHalf(loadStart + allowed * (0.75 + rand() * 0.6) + int(0, 2) * 1440);
  const avoid = union(windowsToAvoid.flatMap((w) => windowInstances(w, nor - 1440, done + 1440)));

  const stoppages = [];
  const taken = () => union([...avoid, ...stoppages.map((s) => [toMin(s.start), toMin(s.end)])]);
  const place = (reason, lo, hi, minLen, maxLen) => {
    for (let tries = 0; tries < 40; tries++) {
      const len = int(minLen / HALF, maxLen / HALF) * HALF;
      const start = roundHalf(lo + rand() * Math.max(0, hi - lo - len));
      const iv = [start, start + len];
      if (start < lo || iv[1] > hi) continue;
      if (length(clip(taken(), [iv[0] - 60, iv[1] + 60])) > 0) continue;
      stoppages.push({ start: iso(iv[0]), end: iso(iv[1]), reason });
      return true;
    }
    return false;
  };
  if (rand() < 0.85) place('rain', loadStart, done, 2 * 60, 9 * 60);
  if (rand() < 0.4) place(pick(['swell', 'rain']), loadStart, done, 3 * 60, 10 * 60);
  if (rand() < 0.4) place(pick(['shifting', 'breakdown']), loadStart, done, 60, 5 * 60);
  // Waiting for berth before loading starts: counts, a distractor
  const commenced = Math.min(nor + turn * 60, loadStart);
  if (loadStart - commenced >= 6 * 60 && rand() < 0.7) place('berth congestion', commenced, loadStart, 3 * 60, loadStart - commenced);
  stoppages.sort((a, b) => a.start.localeCompare(b.start));
  return { cargo, rate, nor, turn, loadStart, done, stoppages };
}

function addHoliday(tl, windowsToAvoid) {
  const avoid = union([...windowsToAvoid.flatMap((w) => windowInstances(w, tl.nor - 1440, tl.done + 1440)), ...tl.stoppages.map((s) => [toMin(s.start), toMin(s.end)])]);
  const first = Math.ceil(tl.loadStart / 1440) * 1440;
  for (let d = first; d + 1440 <= tl.done; d += 1440) {
    if (length(clip(avoid, [d - 60, d + 1440 + 60])) === 0) {
      tl.stoppages.push({ start: iso(d), end: iso(d + 1440), reason: 'public holiday' });
      tl.stoppages.sort((a, b) => a.start.localeCompare(b.start));
      return true;
    }
  }
  return false;
}

function fixtureFor(n, terms, tl) {
  return {
    voyage_id: `VOY-26${String(n).padStart(2, '0')}`,
    vessel: vessels[(n * 5) % vessels.length],
    cargo_mt: tl.cargo,
    load_rate_mt_per_day: tl.rate,
    shex_basis: terms.shex,
    shex_window: terms.win,
    despatch_basis: terms.desp,
    // Set from the timeline in build(): a clause wherever congestion happens
    waiting_for_berth: null,
    demurrage_rate_usd_per_day: 0,
    turn_time_hrs: tl.turn,
    nor_tendered: iso(tl.nor),
    loading_commenced: iso(tl.loadStart),
    loading_completed: iso(tl.done),
  };
}

// Conditions every voyage must meet so the drills have one right answer
function sound(f, r) {
  if (r.result === 'level' || Math.abs(r.balance_min) < 60) return false;
  if (r.demurrage_after_exceptions) return false;
  if (r.elapsed_min < 2 * 1440 || r.elapsed_min > 10 * 1440) return false;
  if (f.shex_basis !== 'SHINC') {
    const inLaytime = length(clip(windowInstances(f.shex_window, toMin(r.laytime_commenced), toMin(f.loading_completed)), [toMin(r.laytime_commenced), toMin(f.loading_completed)]));
    if (inLaytime === 0) return false;
  }
  if (f.shex_basis === 'SHEX EIU' && r.shex_excepted_min === 0) return false;
  return true;
}

function build() {
  const fixtures = [];
  const stoppages = [];
  const results = {};
  const shared = {};
  for (let i = 0; i < TERMS.length; i++) {
    const t = TERMS[i];
    const groupWins = t.group ? [...new Set(TERMS.filter((x) => x.group === t.group && x.win).map((x) => x.win))] : t.win ? [t.win] : [];
    let ok = false;
    for (let tries = 0; tries < 400 && !ok; tries++) {
      let tl = t.group && shared[t.group];
      const fresh = !tl;
      if (fresh) {
        tl = makeTimeline(groupWins);
        if (t.group === 'C' && !addHoliday(tl, groupWins)) continue;
      }
      const f = fixtureFor(i + 1, t, tl);
      f.demurrage_rate_usd_per_day = fresh ? int(24, 64) * 500 : shared[t.group].rate_usd;
      // Chosen without drawing a random number, so the rest of the data is unchanged
      if (tl.stoppages.some((s) => s.reason === 'berth congestion')) f.waiting_for_berth = CLAUSES[(t.group ? TERMS.findIndex((x) => x.group === t.group) : i) % 2];
      const rows = tl.stoppages.map((s) => ({ voyage_id: f.voyage_id, ...s, counts_against_laytime: countsFor(s.reason, t.shex, f.waiting_for_berth) }));
      const r = calculate(f, rows);
      if (!sound(f, r)) {
        if (!fresh) return null; // the shared timeline does not suit this member: start again
        continue;
      }
      if (fresh && t.group) shared[t.group] = { ...tl, rate_usd: f.demurrage_rate_usd_per_day };
      fixtures.push(f);
      stoppages.push(...rows);
      results[f.voyage_id] = r;
      ok = true;
    }
    if (!ok) return null;
  }
  return { fixtures, stoppages, results };
}

// Whole set must show the lesson: mixed results, and each group differing
const REASONS = ['rain', 'swell', 'berth congestion', 'shifting', 'breakdown', 'public holiday'];

function setIsGood({ fixtures, stoppages, results }) {
  const r = (n) => results[`VOY-26${String(n).padStart(2, '0')}`];
  // Every reason from the brief appears, including the congestion distractor
  if (!REASONS.every((x) => stoppages.some((s) => s.reason === x))) return false;
  const dem = Object.values(results).filter((x) => x.result === 'demurrage').length;
  if (dem < 4 || dem > 8) return false;
  // A: UU counts the Sunday that EIU excepts, and the result flips
  if (r(1).result === r(2).result) return false;
  // B: all despatch; all time saved beats working time saved; windows differ
  if (![4, 6, 8].every((n) => r(n).result === 'despatch')) return false;
  if (!(r(4).time_saved_min > r(6).time_saved_min)) return false;
  if (r(4).amount_usd === r(8).amount_usd) return false;
  // C: SHEX against SHINC on the same days, with a holiday in the period
  if (r(10).used_min === r(11).used_min) return false;
  // At least one ATS despatch elsewhere where the window changes the answer
  const atsOther = fixtures.filter((f) => f.despatch_basis === ATS && results[f.voyage_id].result === 'despatch' && results[f.voyage_id].time_saved_min !== -results[f.voyage_id].balance_min);
  return atsOther.length >= 2;
}

// ---------- owner's laytime statement, with three planted errors ----------

// Each error goes on a voyage outside the groups, and each must leave the
// owner claiming demurrage, the realistic direction of an owner's mistake.
function planErrors({ fixtures, stoppages, results }) {
  const outside = (f) => !TERMS[fixtures.indexOf(f)].group;
  const claims = (r, extra) => r.used_min + extra - r.allowed_min > 0;
  const stopsOf = (f) => stoppages.filter((x) => x.voyage_id === f.voyage_id);
  const errors = [];
  const used = new Set();
  const take = (test, make) => {
    const f = fixtures.find((x) => outside(x) && !used.has(x.voyage_id) && test(x, results[x.voyage_id]));
    if (!f) return false;
    used.add(f.voyage_id);
    errors.push({ voyage_id: f.voyage_id, ...make(f, results[f.voyage_id]) });
    return true;
  };
  const ok =
    take((f, r) => f.shex_basis === EIU && r.shex_excepted_min > 0 && claims(r, r.shex_excepted_min),
      (f, r) => ({ type: 'counted_shex_window', extra_min: r.shex_excepted_min })) &&
    take((f, r) => {
      if (r.commenced_on !== 'turn time' || !claims(r, f.turn_time_hrs * 60)) return false;
      // Nothing excepted between NOR and commencement, so the error is exactly the turn time
      const between = [toMin(f.nor_tendered), toMin(r.laytime_commenced)];
      const ex = [...stopsOf(f).map((x) => [toMin(x.start), toMin(x.end)]), ...(f.shex_window ? windowInstances(f.shex_window, between[0], between[1]) : [])];
      return length(clip(ex, between)) === 0;
    }, (f) => ({ type: 'clock_from_nor', extra_min: f.turn_time_hrs * 60 })) &&
    take((f, r) => stopsOf(f).some((x) => (x.reason === 'rain' || x.reason === 'swell') && claims(r, toMin(x.end) - toMin(x.start))),
      (f, r) => {
        const x = stopsOf(f).find((y) => (y.reason === 'rain' || y.reason === 'swell') && claims(r, toMin(y.end) - toMin(y.start)));
        return { type: 'omitted_weather', extra_min: toMin(x.end) - toMin(x.start), stoppage: { start: x.start, end: x.end, reason: x.reason } };
      });
  return ok ? errors : null;
}

let set = null;
let errors = null;
for (let attempt = 0; attempt < 4000 && !set; attempt++) {
  const s = build();
  if (s && setIsGood(s)) {
    errors = planErrors(s);
    if (errors) set = s;
  }
}
if (!set) throw new Error('no dataset met the constraints');
const { fixtures, stoppages, results } = set;

const statement = (f, r, over = {}) => {
  const used = over.used_min ?? r.used_min;
  const commenced = over.commenced ?? r.laytime_commenced;
  const balance = used - r.allowed_min;
  const rate = f.demurrage_rate_usd_per_day;
  let result = r.result;
  let amount = r.amount_usd;
  if (over.used_min !== undefined) {
    // An owner who overstates time used claims demurrage on the simple formula
    result = 'demurrage';
    amount = Math.floor((2 * balance * rate * 100 + 1440) / (2 * 1440)) / 100;
  }
  return {
    voyage_id: f.voyage_id,
    laytime_commenced: commenced,
    laytime_allowed_hrs: r.allowed_min / 60,
    laytime_used_hrs: used / 60,
    result,
    amount_usd: amount,
  };
};

const NOTES = {
  counted_shex_window: (f) => `Counted the ${f.shex_window} window, which is excepted under ${f.shex_basis}.`,
  clock_from_nor: (f) => `Started laytime at NOR, ${f.nor_tendered}, instead of after the ${f.turn_time_hrs} hour turn time.`,
  omitted_weather: (f, e) => `Left out the ${e.stoppage.reason} stoppage from ${e.stoppage.start} to ${e.stoppage.end}, which does not count on a weather working day basis.`,
};
for (const e of errors) e.note = NOTES[e.type](fixtures.find((f) => f.voyage_id === e.voyage_id), e);

const owner_statement = fixtures.map((f) => {
  const r = results[f.voyage_id];
  const e = errors.find((x) => x.voyage_id === f.voyage_id);
  if (!e) return statement(f, r);
  if (e.type === 'clock_from_nor') return statement(f, r, { used_min: r.used_min + e.extra_min, commenced: f.nor_tendered });
  return statement(f, r, { used_min: r.used_min + e.extra_min });
});

// ---------- write ----------

const groups = {};
TERMS.forEach((t, i) => { if (t.group) (groups[t.group] ||= []).push(fixtures[i].voyage_id); });
const data = { generated_by: 'scripts/generate-laytime.mjs', seed: SEED, tables: { fixtures, stoppages, owner_statement } };
const key = {
  generated_by: 'scripts/generate-laytime.mjs',
  seed: SEED,
  calculator: 'public/js/laytime/calc.mjs',
  groups,
  voyages: results,
  owner_errors: errors,
};
key.fingerprint = createHash('sha256').update(JSON.stringify({ voyages: key.voyages, owner_errors: key.owner_errors })).digest('hex').slice(0, 16);
writeFileSync(new URL('../public/data/laytime.json', import.meta.url), JSON.stringify(data, null, 2) + '\n');
writeFileSync(new URL('../public/data/laytime.key.json', import.meta.url), JSON.stringify(key, null, 2) + '\n');
const dem = Object.values(results).filter((x) => x.result === 'demurrage').length;
console.log(`Wrote ${fixtures.length} fixtures, ${stoppages.length} stoppages, ${owner_statement.length} owner statement rows.`);
console.log(`${dem} on demurrage, ${fixtures.length - dem} on despatch. Owner errors on ${errors.map((e) => `${e.voyage_id} (${e.type})`).join(', ')}.`);
