// Briefing text for a fixture, built from its terms and the events calc.mjs
// finds in it. Nothing here does laytime maths; it only decides which
// clause will matter on this cargo and says so in desk language.

import { when, cap, humanDates } from './format.mjs';

export { when };
const N = new Intl.NumberFormat('en-GB');
const USD = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

export const hours = (min) => {
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(2)} hrs`;
};
const days = (min) => {
  const d = min / 1440;
  return Number.isInteger(d) ? `${d} day${d === 1 ? '' : 's'}` : `${d.toFixed(2)} days`;
};

export const HEAD = { name: 'Ines Morales', role: 'Head of operations' };

const hasWibon = (f) => Boolean(f.waiting_for_berth);

// Which clause decides this cargo, most telling first
export function clauseFor(item) {
  const { fixture: f, events, stoppages, result } = item;
  const shex = events.filter((e) => e.kind === 'shex');
  if (hasWibon(f) && stoppages.some((s) => s.reason === 'berth congestion')) return 'wibon';
  if (f.shex_basis === 'SHEX EIU' && shex.some((e) => e.loading_under_way)) return 'eiu_worked';
  if (f.shex_basis === 'SHEX UU' && shex.some((e) => e.loading_under_way)) return 'uu_worked';
  if (f.shex_basis === 'SHINC' && stoppages.some((s) => s.reason === 'public holiday')) return 'shinc';
  if (result.result === 'despatch' && f.despatch_basis === 'all time saved') return 'ats';
  if (shex.length) return 'shex_idle';
  return 'clock';
}

const CLAUSES = {
  wibon: (f) => ({
    title: 'Waiting for a berth counts',
    text: `This charter party says ${f.waiting_for_berth === 'WIBON' ? 'WIBON, whether in berth or not' : 'time lost waiting for a berth counts'}. Hours she spends queueing for the berth stay on the clock.`,
    quote: 'She waited for a berth. Under this clause that waiting is laytime. Don’t let anyone take it off.',
  }),
  eiu_worked: (f) => ({
    title: `${f.shex_basis}: the window comes off, worked or not`,
    text: `Loading carries on through ${f.shex_window}. Under EIU that window is off the clock anyway.`,
    quote: `They loaded right through ${f.shex_window}. Doesn’t matter. Under EIU that window is off the clock. Read the clause before you touch the clock.`,
  }),
  uu_worked: (f) => ({
    title: `${f.shex_basis}: worked hours count`,
    text: `Inside ${f.shex_window}, only the hours nobody worked come off. Where they loaded, the clock keeps running.`,
    quote: 'Unless used means unless used. Where they worked the weekend, those hours count. Where they didn’t, they come off.',
  }),
  shinc: () => ({
    title: 'SHINC: holidays count',
    text: 'Sundays and holidays are included. A holiday stoppage stays on the clock like any other hour.',
    quote: 'SHINC. The holiday is just another day of laytime here. Don’t give it away.',
  }),
  ats: () => ({
    title: 'All time saved',
    text: 'Finish early and despatch is paid on every hour until laytime would have run out, excepted time included.',
    quote: 'All time saved. If she finishes early, the weekend after completion earns despatch too. Count it.',
  }),
  shex_idle: (f) => ({
    title: `${f.shex_basis}: the window comes off`,
    text: `Nobody loads through ${f.shex_window}. Under any SHEX clause those hours come off the clock.`,
    quote: 'Nobody worked the weekend. It comes off. Easy hours, so don’t miss them.',
  }),
  clock: () => ({
    title: 'Start the clock in the right place',
    text: 'Laytime starts when turn time runs out after NOR, or when loading starts if that comes first.',
    quote: 'Start the clock in the right place and the rest is arithmetic.',
  }),
};

export function briefing(item) {
  const { fixture: f, result } = item;
  const key = clauseFor(item);
  const clause = CLAUSES[key](f);
  const halfRate = f.demurrage_rate_usd_per_day / 2;
  return {
    key,
    clause,
    lesson: item.training
      ? [
        'NOR goes in. Turn time runs. Then laytime starts.',
        'Every hour from then until loading completes is on the clock, unless the charter party takes it off.',
        'Two things take hours off: stoppages the terms except, like rain, and the SHEX window.',
        'Finish inside laytime and the owner pays you despatch. Go over and you pay demurrage.',
      ]
      : [clause.text, 'Each stoppage and SHEX period arrives as a ticket. Call it, and it goes on your statement.', 'At completion you check your figure against the owner’s.'],
    terms: [
      ['Vessel', f.vessel],
      ['Cargo', `${N.format(f.cargo_mt)} MT coal`],
      ['Load rate', `${N.format(f.load_rate_mt_per_day)} MT per weather working day`],
      ['Laytime allowed', `${hours(result.allowed_min)} (${days(result.allowed_min)})`],
      ['Turn time', `${f.turn_time_hrs} hrs`],
      ['NOR tendered', when(f.nor_tendered)],
      ['Exceptions', f.shex_basis === 'SHINC' ? 'SHINC, no window' : `${f.shex_basis}, ${f.shex_window}`],
      ['Waiting for berth', hasWibon(f) ? 'counts as laytime' : 'not covered'],
      ['Demurrage', `USD ${USD.format(f.demurrage_rate_usd_per_day)} a day`],
      ['Despatch', `USD ${USD.format(halfRate)} a day, ${f.despatch_basis}`],
    ],
    targets: item.training
      ? ['Call when laytime starts.', 'Call every stoppage and SHEX period.', 'Settle the money. No strike limit on training.']
      : ['Call when laytime starts.', 'Call every stoppage and SHEX period.', 'Settle the money.', 'Accept or dispute the owner’s statement.', 'Three wrong calls and the head of operations takes over.'],
  };
}

// The terms strip over the desk: what this charter party takes off the
// clock, in the words the tickets and model notes use
export function termsLines(f) {
  return [
    f.shex_basis === 'SHINC' ? 'SHINC: Sundays and holidays count' : `${f.shex_basis}, ${f.shex_window}`,
    'Weather working days: rain or swell that stops loading is excepted',
    'Breakdowns and shifting are excepted',
    f.shex_basis === 'SHINC' ? 'Holidays count' : 'Holidays are excepted',
    f.waiting_for_berth ? 'Waiting for berth counts' : 'Waiting for berth is not covered',
    `Despatch at half rate, ${f.despatch_basis}`,
  ];
}

// The model note for a disputed owner's statement, in the desk's dates
export const modelNote = (item) => (item.ownerError ? humanDates(item.ownerError.note, item.shift ?? 0) : 'Their laytime used is higher than the true figure.');

// The sentences under the recap, one list per vessel. `p` is a vessel's
// summary from run.mjs; `name` is set on a day of several vessels.
export function recapNotes(p, item, ownerTk, name = null) {
  const lead = (text) => (name ? `${name}: ${text}` : cap(text));
  const out = [];
  if (ownerTk) {
    out.push({ kind: 'owner', text: lead(ownerTk.answer === 'dispute'
      ? `the owner claimed ${ownerTk.gap_hrs.toFixed(2)} hrs more than the true statement.${p.explained ? (p.explained.gotIt ? ' You named the error.' : ' Read the model note again.') : ''}`
      : 'the owner’s statement was right, and signing it was the right call.') });
  }
  if (p.yours.demurrage_after_exceptions && !p.correct.demurrage_after_exceptions) {
    out.push({ kind: 'note', text: lead(`by your calls laytime ran out at ${when(p.yours.laytime_expiry)}, before the excepted time that followed. Once on demurrage, always on demurrage: those hours no longer came off.`) });
  }
  return out;
}
