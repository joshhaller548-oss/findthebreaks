// Briefing text for a fixture, built from its terms and the events calc.mjs
// finds in it. Nothing here does laytime maths; it only decides which
// clause to read first on this cargo and states its rule in desk language.
// A briefing never says what happens on a ticket: scripts/test-desk-play.mjs
// checks every one against every ticket's answer.

import { when, cap, humanDates } from './format.mjs';
import { STRIKES } from './run.mjs';

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

// Which clause to read first on this cargo, most telling first. The pick
// looks at the statement of facts, but what the briefing says about it is
// the clause and its rule only, never what happens on a ticket: the text
// below depends on the terms alone, so the briefing for a worked weekend
// reads the same as for an idle one.
export function clauseFor(item) {
  const { fixture: f, events, stoppages } = item;
  const shex = events.filter((e) => e.kind === 'shex');
  if (hasWibon(f) && stoppages.some((s) => s.reason === 'berth congestion')) return 'wibon';
  if (f.shex_basis === 'SHEX EIU' && shex.some((e) => e.loading_under_way)) return 'eiu_worked';
  if (f.shex_basis === 'SHEX UU' && shex.some((e) => e.loading_under_way)) return 'uu_worked';
  if (f.shex_basis === 'SHINC' && stoppages.some((s) => s.reason === 'public holiday')) return 'shinc';
  if (f.despatch_basis === 'all time saved') return 'ats';
  if (shex.length) return 'shex_idle';
  return 'clock';
}

// The rule for each SHEX basis, worded the same wherever it is chosen
const shexRule = (f) => (f.shex_basis === 'SHEX EIU'
  ? {
    title: 'SHEX EIU: excepted even if used',
    text: `Under SHEX EIU every hour inside ${f.shex_window} comes off the clock, whether or not they load in it.`,
    quote: 'EIU means even if used. Read the clause before you touch the clock.',
  }
  : {
    title: 'SHEX UU: excepted unless used',
    text: `Under SHEX UU an hour inside ${f.shex_window} comes off the clock only if nobody loads in it. Hours they work count.`,
    quote: 'Unless used means unless used. Check the statement of facts for each hour of the window before you call it.',
  });

const CLAUSES = {
  wibon: (f) => ({
    title: 'Waiting for berth',
    text: `This charter party says ${f.waiting_for_berth === 'WIBON' ? 'WIBON, whether in berth or not' : 'time lost waiting for a berth counts'}. Once laytime has started, time spent waiting for a berth counts as laytime.`,
    quote: 'Know the waiting for berth clause before the agent’s first report. It decides who pays for a busy berth.',
  }),
  eiu_worked: shexRule,
  uu_worked: shexRule,
  shex_idle: shexRule,
  shinc: () => ({
    title: 'SHINC: Sundays and holidays included',
    text: 'Sundays and holidays count like any other day. Only the stoppages the terms except come off the clock.',
    quote: 'SHINC. A Sunday or a holiday is just another day of laytime here.',
  }),
  ats: () => ({
    title: 'Despatch on all time saved',
    text: 'If loading finishes inside laytime, despatch is paid on all the time from completion until laytime would have run out, excepted time included.',
    quote: 'All time saved or working time saved changes the despatch. Know which one you are on before you settle.',
  }),
  clock: () => ({
    title: 'Start the clock in the right place',
    text: 'Laytime starts when turn time runs out after NOR, or when loading starts if that comes first.',
    quote: 'Start the clock in the right place and the rest is arithmetic.',
  }),
};

// One strike rule, stated the same way in every briefing and on the desk
export const STRIKE_RULE = `Each wrong first call is a strike. ${STRIKES} strikes on a fixture, or across a day, and ${HEAD.name} takes the desk and calls the rest.`;
export const TRAINING_EXCEPTION = `The training cargo is the one exception: ${HEAD.name.split(' ')[0]} coaches every call and never takes over.`;
export const strikeRule = (training) => (training ? `${STRIKE_RULE} ${TRAINING_EXCEPTION}` : STRIKE_RULE);
export const OWNER_STEP = 'When a vessel completes, you settle the money and then the owner’s statement comes in. Accept it if it matches yours. Dispute it if not: name the wrong line and the hours, then say why in one sentence.';

export function briefing(item) {
  const { fixture: f, result } = item;
  const key = clauseFor(item);
  const clause = CLAUSES[key](f);
  const halfRate = f.demurrage_rate_usd_per_day / 2;
  return {
    key,
    clause,
    strikes: strikeRule(item.training),
    lesson: item.training
      ? [
        'NOR goes in. Turn time runs. Then laytime starts.',
        'Every hour from then until loading completes is on the clock, unless the charter party takes it off.',
        'Two things take hours off: stoppages the terms except, like rain, and the SHEX window.',
        'Finish inside laytime and the owner pays you despatch. Go over and you pay demurrage.',
      ]
      : [clause.text, 'Each stoppage and SHEX period arrives as a ticket. Call it, and it goes on your statement.', OWNER_STEP],
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
      ? ['Call when laytime starts.', 'Call every stoppage and SHEX period.', 'Settle the money.', strikeRule(true)]
      : ['Call when laytime starts.', 'Call every stoppage and SHEX period.', 'Settle the money.', 'Accept or dispute the owner’s statement.', STRIKE_RULE],
  };
}

// The briefing for a day of several vessels. `lanes` are [{ item, offset }]
// in arrival order, offset in minutes after the first NOR.
export function dayBriefing(lanes) {
  const first = lanes[0];
  const arrivals = lanes.map((l, i) => ({
    item: l.item,
    tag: `Vessel ${i + 1} · NOR ${when(l.item.fixture.nor_tendered)}${i ? (l.offset === 0 ? ', with the first' : `, ${hours(l.offset)} after the first`) : ''}`,
    brief: briefing(l.item),
  }));
  const together = lanes.filter((l) => l.offset === 0).length;
  return {
    lede: `${lanes.length} ships on one desk, each on its own charter party and statement of facts. The desk clock runs them together from ${when(first.item.fixture.nor_tendered)}${together > 1 ? `; ${together} tender NOR at the same moment` : ''}. Tickets come from all of them, so check whose terms you are reading.`,
    steps: [OWNER_STEP, STRIKE_RULE],
    arrivals,
    quote: `${lanes.length} ships, ${lanes.length} charter parties. Before you call a ticket, read whose it is. The same entry can count on one vessel and come off on another.`,
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
