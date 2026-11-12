// Task 2 drills. As for reconciliation: the SQL model answers produce the
// answer key, the Excel model answers must reproduce it, and both are
// checked against calc.mjs and the Python minute count.
//
// Hint, why and pitfall text must not contain hard coded counts. Excel
// ranges use tokens for last rows: {st_last} stoppages, {sx_last} SHEX
// periods, {os_last} owner statement.

// Laytime commenced, as an SQL expression on fixtures f
const COMMENCED = `CASE WHEN DATEADD(hour, f.turn_time_hrs, f.nor_tendered) < f.loading_commenced
            THEN DATEADD(hour, f.turn_time_hrs, f.nor_tendered)
            ELSE f.loading_commenced END`;

// Laytime used per voyage, the core of drills 5 to 7
const USED = `SELECT f.voyage_id, f.loading_completed, f.despatch_basis, f.demurrage_rate_usd_per_day,
         f.cargo_mt / f.load_rate_mt_per_day * 24 AS laytime_allowed_hrs,
         (DATEDIFF(minute, ${COMMENCED}, f.loading_completed)
          - COALESCE(st.mins, 0) - COALESCE(sx.mins, 0)) / 60 AS laytime_used_hrs
  FROM fixtures f
  LEFT JOIN (SELECT voyage_id, SUM(DATEDIFF(minute, start_time, end_time)) AS mins
             FROM stoppages
             WHERE counts_against_laytime = FALSE
             GROUP BY voyage_id) AS st ON st.voyage_id = f.voyage_id
  LEFT JOIN (SELECT p.voyage_id, SUM(DATEDIFF(minute, p.start_time, p.end_time)) AS mins
             FROM shex_periods p JOIN fixtures x ON x.voyage_id = p.voyage_id
             WHERE p.phase = 'laytime'
               AND (x.shex_basis = 'SHEX EIU' OR p.loading_under_way = FALSE)
             GROUP BY p.voyage_id) AS sx ON sx.voyage_id = f.voyage_id`;

// The same with a deliberate change, for pitfalls
const usedWith = ({ stoppages = true, shex = "(x.shex_basis = 'SHEX EIU' OR p.loading_under_way = FALSE)" } = {}) =>
  USED.replace('- COALESCE(st.mins, 0)', stoppages ? '- COALESCE(st.mins, 0)' : '')
    .replace("(x.shex_basis = 'SHEX EIU' OR p.loading_under_way = FALSE)", shex);

const RESULT = `CASE WHEN t.laytime_used_hrs > t.laytime_allowed_hrs THEN 'demurrage' ELSE 'despatch' END`;

const amountSql = ({ despatchDivisor = 48, ats = 'basis' } = {}) => `SELECT u.voyage_id, u.result,
       ROUND(CASE WHEN u.result = 'demurrage'
                  THEN (u.laytime_used_hrs - u.laytime_allowed_hrs) * u.demurrage_rate_usd_per_day / 24
                  WHEN ${ats === 'basis' ? "u.despatch_basis = 'all time saved'" : ats === 'always' ? '1 = 1' : '1 = 0'}
                  THEN (u.laytime_allowed_hrs - u.laytime_used_hrs + COALESCE(u.after_mins, 0) / 60) * u.demurrage_rate_usd_per_day / ${despatchDivisor}
                  ELSE (u.laytime_allowed_hrs - u.laytime_used_hrs) * u.demurrage_rate_usd_per_day / ${despatchDivisor} END, 2) AS amount_usd
FROM (SELECT t.voyage_id, t.laytime_used_hrs, t.laytime_allowed_hrs, t.despatch_basis, t.demurrage_rate_usd_per_day,
             ${RESULT} AS result,
             SUM(DATEDIFF(minute, a.start_time, a.end_time)) AS after_mins
      FROM (${USED}) AS t
      LEFT JOIN shex_periods a ON a.voyage_id = t.voyage_id AND a.phase = 'after completion'
           AND a.start_time < DATEADD(minute, (t.laytime_allowed_hrs - t.laytime_used_hrs) * 60, t.loading_completed)
      GROUP BY t.voyage_id, t.laytime_used_hrs, t.laytime_allowed_hrs, t.despatch_basis, t.demurrage_rate_usd_per_day) AS u`;

// Excel pieces on the fixtures sheet. Columns: A voyage_id, C cargo_mt,
// D load_rate, E shex_basis, G despatch_basis, I demurrage rate, J turn time,
// K NOR, L loading start, M completion. Formula columns start at N.
const X_COMMENCED = '=MIN(K2+J2/24, L2)';
const X_STOPPAGES = '=SUMPRODUCT((stoppages!$A$2:$A${st_last}=A2)*(stoppages!$E$2:$E${st_last}=FALSE)*(stoppages!$C$2:$C${st_last}-stoppages!$B$2:$B${st_last}))*24';
const X_SHEX = '=SUMPRODUCT((shex_periods!$A$2:$A${sx_last}=A2)*(shex_periods!$D$2:$D${sx_last}="laytime")*((E2="SHEX EIU")+(E2="SHEX UU")*(shex_periods!$E$2:$E${sx_last}=FALSE))*(shex_periods!$C$2:$C${sx_last}-shex_periods!$B$2:$B${sx_last}))*24';
const X_USED = '=(M2-N2)*24-O2-P2';
const usedColumns = (usedRole = 'helper') => [
  { name: 'commenced', role: 'helper', type: 'datetime' },
  { name: 'stoppage_hrs', role: 'helper' },
  { name: 'shex_hrs', role: 'helper' },
  { name: 'laytime_used_hrs', role: usedRole },
];
const usedModel = { commenced: X_COMMENCED, stoppage_hrs: X_STOPPAGES, shex_hrs: X_SHEX, laytime_used_hrs: X_USED };

export const drills = [
  {
    id: 1,
    title: 'Laytime allowed',
    tag: 'arithmetic',
    question: 'Laytime allowed on each voyage, in hours: voyage_id and laytime_allowed_hrs. Allowed is the cargo over the daily load rate.',
    ordered: false,
    hint: {
      sql: 'Days allowed is cargo_mt over load_rate_mt_per_day. Multiply by 24 for hours.',
      excel: 'Days allowed is the cargo in column C over the daily rate in column D. Multiply by 24 for hours.',
    },
    why: {
      sql: 'Quantity over rate gives days of laytime, and times 24 gives hours, the unit every later drill works in.',
      excel: 'Cargo over daily rate is days of laytime, and 24 turns it into hours, the unit every later drill works in.',
    },
    sql: `SELECT voyage_id, cargo_mt / load_rate_mt_per_day * 24 AS laytime_allowed_hrs
FROM fixtures`,
    excel: { base: 'fixtures', columns: [{ name: 'laytime_allowed_hrs', role: 'value' }], project: ['voyage_id', 'laytime_allowed_hrs'], model: { laytime_allowed_hrs: '=C2/D2*24' } },
  },
  {
    id: 2,
    title: 'Laytime commenced',
    tag: 'turn time',
    question: 'When did laytime commence on each voyage? voyage_id and laytime_commenced. Laytime starts when turn time runs out after NOR, or when loading starts, if that is sooner.',
    ordered: false,
    hint: {
      sql: 'Add turn_time_hrs to nor_tendered with DATEADD, then take whichever is earlier: that, or loading_commenced. CASE WHEN chooses between two values.',
      excel: 'Times here are serial numbers counted in days, so hours of turn time are J2/24. MIN picks the earlier of two times.',
    },
    why: {
      sql: 'DATEADD gives the moment turn time runs out. CASE takes the earlier of that and the start of loading, because laytime starts on commencement if loading begins first.',
      excel: 'K2+J2/24 is NOR plus turn time, in days. MIN takes the earlier of that and the start of loading.',
    },
    sql: `SELECT f.voyage_id,
       ${COMMENCED} AS laytime_commenced
FROM fixtures f`,
    excel: { base: 'fixtures', columns: [{ name: 'laytime_commenced', role: 'value', type: 'datetime' }], project: ['voyage_id', 'laytime_commenced'], model: { laytime_commenced: X_COMMENCED } },
  },
  {
    id: 3,
    title: 'Elapsed time',
    tag: 'date maths',
    question: 'Hours elapsed from laytime commencement to completion of loading: voyage_id and elapsed_hrs.',
    ordered: false,
    hint: {
      sql: 'DATEDIFF(minute, start, end) gives the minutes between two times. Start from the commencement you worked out in drill 2.',
      excel: 'Subtracting two times gives days. Multiply by 24 for hours, and start from the commencement in drill 2.',
    },
    why: {
      sql: 'DATEDIFF in minutes, divided by 60, keeps half hours exact. The commencement expression is the one from drill 2.',
      excel: 'Completion minus commencement is days, and times 24 gives hours.',
    },
    sql: `SELECT f.voyage_id,
       DATEDIFF(minute, ${COMMENCED}, f.loading_completed) / 60 AS elapsed_hrs
FROM fixtures f`,
    excel: { base: 'fixtures', columns: [{ name: 'elapsed_hrs', role: 'value' }], project: ['voyage_id', 'elapsed_hrs'], model: { elapsed_hrs: '=(M2-MIN(K2+J2/24, L2))*24' } },
  },
  {
    id: 4,
    title: 'Deductible stoppages',
    tag: 'join + sum',
    question: 'Total hours of stoppages that do not count against laytime, for every voyage: voyage_id and deductible_stoppage_hrs. Every voyage appears, with 0 if it has none.',
    ordered: false,
    hint: {
      sql: 'Keep only stoppages where counts_against_laytime is FALSE, add up their minutes per voyage, and start from fixtures so every voyage appears.',
      excel: 'SUMPRODUCT multiplies conditions together: the right voyage, counts_against_laytime FALSE, and the length of each stoppage.',
    },
    why: {
      sql: 'The counts_against_laytime test sits in the ON clause so the LEFT JOIN keeps every voyage, and COALESCE turns a missing sum into 0.',
      excel: 'Each condition is 1 or 0, so the product keeps only this voyage\'s deductible stoppages. End minus start is days; times 24 is hours.',
    },
    sql: `SELECT f.voyage_id,
       COALESCE(SUM(DATEDIFF(minute, s.start_time, s.end_time)), 0) / 60 AS deductible_stoppage_hrs
FROM fixtures f
LEFT JOIN stoppages s
  ON s.voyage_id = f.voyage_id AND s.counts_against_laytime = FALSE
GROUP BY f.voyage_id`,
    excel: { base: 'fixtures', columns: [{ name: 'deductible_stoppage_hrs', role: 'value' }], project: ['voyage_id', 'deductible_stoppage_hrs'], model: { deductible_stoppage_hrs: X_STOPPAGES } },
  },
  {
    id: 5,
    title: 'Laytime used',
    tag: 'read the terms',
    question: 'Laytime used on each voyage, and whether it is on demurrage or despatch: voyage_id, laytime_used_hrs, result. Used is elapsed time, minus deductible stoppages, minus the SHEX time the fixture excepts. Read shex_basis: under SHEX EIU every SHEX period inside laytime comes off; under SHEX UU only the periods when loading was not under way; under SHINC none.',
    ordered: false,
    caseInsensitive: true,
    hint: {
      sql: 'Build it in pieces: elapsed minutes, minus the deductible stoppage minutes from drill 4, minus the SHEX minutes that shex_basis excepts. A subquery in FROM can hold each piece.',
      excel: 'Use the helper columns: commencement, stoppage hours, excepted SHEX hours. The shex_periods sheet lists every SHEX period; which ones come off depends on column E.',
    },
    why: {
      sql: 'Each LEFT JOIN brings one deduction per voyage and COALESCE makes a missing one zero. The SHEX subquery reads shex_basis: EIU excepts every period, UU only those without loading. The outer query compares used with allowed.',
      excel: 'The SHEX helper multiplies by (E2="SHEX EIU")+(E2="SHEX UU")*(no loading), so the terms decide which periods come off. Used is elapsed less both deductions.',
    },
    sql: `SELECT t.voyage_id, t.laytime_used_hrs,
       ${RESULT} AS result
FROM (${USED}) AS t`,
    excel: {
      base: 'fixtures',
      columns: [...usedColumns('value'), { name: 'result', role: 'value' }],
      project: ['voyage_id', 'laytime_used_hrs', 'result'],
      model: { ...usedModel, result: '=IF(Q2>C2/D2*24, "demurrage", "despatch")' },
    },
  },
  {
    id: 6,
    title: 'Amount owed',
    tag: 'money',
    question: 'What is owed on each voyage, in USD: voyage_id, result, amount_usd. Demurrage is time over allowed at the daily rate, pro rata. Despatch is time saved at half the demurrage rate. Read despatch_basis: on working time saved, time saved is laytime saved; on all time saved, add the SHEX period after completion that starts before laytime would have run out.',
    ordered: false,
    caseInsensitive: true,
    hint: {
      sql: 'Start from drill 5. For all time saved, join the after completion periods that start before completion plus laytime saved, and add their minutes.',
      excel: 'Reuse the drill 5 columns. Despatch is half the demurrage rate, so divide by 48, not 24.',
    },
    why: {
      sql: 'The CASE picks the rule from result and despatch_basis. The after completion periods matter only on all time saved, and only the one that starts before laytime would have run out.',
      excel: 'One IF for demurrage or despatch, one for the despatch basis. The after completion helper counts only periods that start before completion plus laytime saved.',
    },
    sql: amountSql(),
    excel: {
      base: 'fixtures',
      columns: [...usedColumns(), { name: 'result', role: 'value' }, { name: 'after_completion_hrs', role: 'helper' }, { name: 'amount_usd', role: 'value' }],
      project: ['voyage_id', 'result', 'amount_usd'],
      model: {
        ...usedModel,
        result: '=IF(Q2>C2/D2*24, "demurrage", "despatch")',
        after_completion_hrs: '=SUMPRODUCT((shex_periods!$A$2:$A${sx_last}=A2)*(shex_periods!$D$2:$D${sx_last}="after completion")*(shex_periods!$B$2:$B${sx_last}<M2+(C2/D2*24-Q2)/24)*(shex_periods!$C$2:$C${sx_last}-shex_periods!$B$2:$B${sx_last}))*24',
        amount_usd: '=IF(R2="demurrage", (Q2-C2/D2*24)*I2/24, IF(G2="all time saved", C2/D2*24-Q2+S2, C2/D2*24-Q2)*I2/48)',
      },
    },
  },
  {
    id: 7,
    title: "Check the owner's statement",
    tag: 'reconcile',
    key: true,
    keyFlag: 'The real job',
    question: "Compare the owner's laytime statement with your laytime used and list the voyages where they disagree: voyage_id, owner_used_hrs, laytime_used_hrs, and the difference, owner minus yours. Positive means the owner claims more time used.",
    ordered: false,
    signNote: 'owner minus yours',
    hint: {
      sql: 'Join owner_statement to your drill 5 figures and keep the rows where the two disagree.',
      excel: "Rebuild laytime used, bring the owner's figure across with a lookup, and keep the rows where they differ. Round before comparing: times carry floating point noise.",
    },
    why: {
      sql: "Drill 5's query becomes a subquery and the join lines each statement up with your figure. This is the job: an operator checks the owner's number and argues about it.",
      excel: 'ROUND before <> matters here: serial times give values like a half hour minus a hair, which does not equal the half hour. This is the job: an operator checks the owner\'s number and argues about it.',
    },
    sql: `SELECT o.voyage_id, o.laytime_used_hrs AS owner_used_hrs, t.laytime_used_hrs,
       o.laytime_used_hrs - t.laytime_used_hrs AS difference_hrs
FROM owner_statement o
JOIN (${USED}) AS t ON t.voyage_id = o.voyage_id
WHERE o.laytime_used_hrs <> t.laytime_used_hrs`,
    excel: {
      base: 'fixtures',
      columns: [...usedColumns('value'), { name: 'owner_used_hrs', role: 'value' }, { name: 'difference_hrs', role: 'value' }, { name: 'keep', role: 'keep' }],
      project: ['voyage_id', 'owner_used_hrs', 'laytime_used_hrs', 'difference_hrs'],
      model: { ...usedModel, owner_used_hrs: '=VLOOKUP(A2, owner_statement!$A:$D, 4, FALSE)', difference_hrs: '=ROUND(R2-Q2, 2)', keep: '=S2<>0' },
    },
  },
  {
    id: 8,
    title: 'Say what the owner got wrong',
    tag: 'free text',
    kind: 'text',
    question: 'For each voyage you found in drill 7, say in one sentence what the owner did wrong. Then compare with the model answer and mark yourself.',
  },
  {
    id: 9,
    title: 'Timed run',
    tag: 'timed',
    question: 'Drills 5 to 7 again, from scratch, against the clock. Target twenty minutes.',
    timed: [5, 6, 7],
    targetMinutes: 20,
  },
];

const usedSqlFrom = (inner) => `SELECT t.voyage_id, t.laytime_used_hrs, ${RESULT} AS result FROM (${inner}) AS t`;
const excelUsed = (over) => ({ ...usedModel, result: '=IF(Q2>C2/D2*24, "demurrage", "despatch")', ...over });
const excelAmount = (amount, over = {}) => ({
  ...usedModel,
  result: '=IF(Q2>C2/D2*24, "demurrage", "despatch")',
  after_completion_hrs: drills[5].excel.model.after_completion_hrs,
  amount_usd: amount,
  ...over,
});

export const pitfalls = [
  // ---------- SQL ----------
  { drill: 1, id: 'days_not_hours', lang: 'sql', match: 'result',
    message: 'Those are days, not hours. Multiply by 24: every later drill works in hours.',
    sql: 'SELECT voyage_id, cargo_mt / load_rate_mt_per_day AS laytime_allowed_hrs FROM fixtures' },
  { drill: 1, id: 'rate_over_cargo', lang: 'sql', match: 'result',
    message: 'The division is upside down. Laytime allowed is the cargo divided by the daily rate.',
    sql: 'SELECT voyage_id, load_rate_mt_per_day / cargo_mt * 24 AS laytime_allowed_hrs FROM fixtures' },
  { drill: 2, id: 'from_nor', lang: 'sql', match: 'result',
    message: 'That is NOR. Laytime does not start at NOR: it starts when turn time runs out, or on loading if that comes first.',
    sql: 'SELECT voyage_id, nor_tendered AS laytime_commenced FROM fixtures' },
  { drill: 2, id: 'turn_time_always', lang: 'sql', match: 'result',
    message: 'Right where the vessel waited. Where loading began before turn time ran out, laytime starts when loading starts.',
    sql: 'SELECT voyage_id, DATEADD(hour, turn_time_hrs, nor_tendered) AS laytime_commenced FROM fixtures' },
  { drill: 2, id: 'loading_always', lang: 'sql', match: 'result',
    message: 'That is the start of loading. Where the vessel waited for a berth, laytime started earlier, when turn time ran out.',
    sql: 'SELECT voyage_id, loading_commenced AS laytime_commenced FROM fixtures' },
  { drill: 3, id: 'from_nor', lang: 'sql', match: 'result',
    message: 'You counted from NOR. Elapsed time runs from laytime commencement, which comes after turn time.',
    sql: 'SELECT voyage_id, DATEDIFF(minute, nor_tendered, loading_completed) / 60 AS elapsed_hrs FROM fixtures' },
  { drill: 3, id: 'from_loading', lang: 'sql', match: 'result',
    message: 'You counted from the start of loading. Where the vessel waited for a berth, laytime was already running before that.',
    sql: 'SELECT voyage_id, DATEDIFF(minute, loading_commenced, loading_completed) / 60 AS elapsed_hrs FROM fixtures' },
  { drill: 3, id: 'datediff_hour', lang: 'sql', match: 'result',
    message: 'DATEDIFF in hours counts whole hours and drops the half hours. Take the difference in minutes and divide by 60.',
    sql: `SELECT f.voyage_id, DATEDIFF(hour, ${COMMENCED}, f.loading_completed) AS elapsed_hrs FROM fixtures f` },
  { drill: 4, id: 'all_stoppages', lang: 'sql', match: 'result',
    message: 'That includes stoppages that count: berth congestion under a waiting for berth clause, and a holiday under SHINC. Only counts_against_laytime FALSE comes off the clock.',
    sql: `SELECT f.voyage_id, COALESCE(SUM(DATEDIFF(minute, s.start_time, s.end_time)), 0) / 60 AS deductible_stoppage_hrs
FROM fixtures f LEFT JOIN stoppages s ON s.voyage_id = f.voyage_id GROUP BY f.voyage_id` },
  { drill: 5, id: 'no_deductions', lang: 'sql', match: 'result',
    message: 'Your laytime used equals the elapsed time. Nothing came off the clock: take away the deductible stoppages and the SHEX time the terms except.',
    sql: usedSqlFrom(usedWith({ stoppages: false, shex: '1 = 0' })) },
  { drill: 5, id: 'stoppages_only', lang: 'sql', match: 'result',
    message: 'You took off the stoppages but not the SHEX time. On SHEX voyages, the Sundays or weekends inside laytime come off as the terms say.',
    sql: usedSqlFrom(usedWith({ shex: '1 = 0' })) },
  { drill: 5, id: 'uu_as_eiu', lang: 'sql', match: 'result',
    message: 'You excepted every SHEX period on the SHEX UU voyages too. Unless used means time when loading was under way still counts.',
    sql: usedSqlFrom(usedWith({ shex: '1 = 1' })) },
  { drill: 5, id: 'eiu_as_uu', lang: 'sql', match: 'result',
    message: 'On the SHEX EIU voyages every SHEX period comes off, even if loading carried on. Only SHEX UU counts the time used.',
    sql: usedSqlFrom(usedWith({ shex: 'p.loading_under_way = FALSE' })) },
  { drill: 6, id: 'despatch_full_rate', lang: 'sql', match: 'result',
    message: 'Your despatch figures are double. Despatch is paid at half the demurrage rate.',
    sql: amountSql({ despatchDivisor: 24 }) },
  { drill: 6, id: 'ignored_all_time_saved', lang: 'sql', match: 'result',
    message: 'On all time saved voyages, time saved includes the SHEX time after completion that would have been excepted. You paid them on laytime saved only.',
    sql: amountSql({ ats: 'never' }) },
  { drill: 6, id: 'all_time_saved_everywhere', lang: 'sql', match: 'result',
    message: 'You added after completion SHEX time on working time saved voyages too. Only all time saved counts it.',
    sql: amountSql({ ats: 'always' }) },
  { drill: 7, id: 'all_rows', lang: 'sql', match: 'rows',
    message: "You listed all {got} voyages. Keep only the rows where the owner's figure differs from yours.",
    sql: `SELECT o.voyage_id, o.laytime_used_hrs AS owner_used_hrs, t.laytime_used_hrs, o.laytime_used_hrs - t.laytime_used_hrs AS difference_hrs
FROM owner_statement o JOIN (${USED}) AS t ON t.voyage_id = o.voyage_id` },

  // ---------- Excel ----------
  { drill: 1, id: 'days_not_hours', lang: 'excel', match: 'result',
    message: 'Those are days, not hours. Multiply by 24: every later drill works in hours.',
    formulas: { laytime_allowed_hrs: '=C2/D2' } },
  { drill: 2, id: 'from_nor', lang: 'excel', match: 'result',
    message: 'That is NOR. Laytime does not start at NOR: it starts when turn time runs out, or on loading if that comes first.',
    formulas: { laytime_commenced: '=K2' } },
  { drill: 2, id: 'turn_hours_as_days', lang: 'excel', match: 'result',
    message: 'You added the turn time as days. Excel times are counted in days, so hours of turn time are J2/24.',
    formulas: { laytime_commenced: '=MIN(K2+J2, L2)' } },
  { drill: 2, id: 'turn_time_always', lang: 'excel', match: 'result',
    message: 'Right where the vessel waited. Where loading began before turn time ran out, laytime starts when loading starts.',
    formulas: { laytime_commenced: '=K2+J2/24' } },
  { drill: 3, id: 'days_not_hours', lang: 'excel', match: 'result',
    message: 'Those are days. Subtracting two times gives days, so multiply by 24 for hours.',
    formulas: { elapsed_hrs: '=M2-MIN(K2+J2/24, L2)' } },
  { drill: 3, id: 'from_nor', lang: 'excel', match: 'result',
    message: 'You counted from NOR. Elapsed time runs from laytime commencement, which comes after turn time.',
    formulas: { elapsed_hrs: '=(M2-K2)*24' } },
  { drill: 4, id: 'all_stoppages', lang: 'excel', match: 'result',
    message: 'That includes stoppages that count: berth congestion under a waiting for berth clause, and a holiday under SHINC. Only counts_against_laytime FALSE comes off the clock.',
    formulas: { deductible_stoppage_hrs: '=SUMPRODUCT((stoppages!$A$2:$A${st_last}=A2)*(stoppages!$C$2:$C${st_last}-stoppages!$B$2:$B${st_last}))*24' } },
  { drill: 4, id: 'days_not_hours', lang: 'excel', match: 'result',
    message: 'Those are days. End minus start is in days, so multiply by 24 for hours.',
    formulas: { deductible_stoppage_hrs: '=SUMPRODUCT((stoppages!$A$2:$A${st_last}=A2)*(stoppages!$E$2:$E${st_last}=FALSE)*(stoppages!$C$2:$C${st_last}-stoppages!$B$2:$B${st_last}))' } },
  { drill: 5, id: 'no_deductions', lang: 'excel', match: 'result',
    message: 'Your laytime used equals the elapsed time. Nothing came off the clock: take away the deductible stoppages and the SHEX time the terms except.',
    formulas: excelUsed({ laytime_used_hrs: '=(M2-N2)*24' }) },
  { drill: 5, id: 'stoppages_only', lang: 'excel', match: 'result',
    message: 'You took off the stoppages but not the SHEX time. On SHEX voyages, the Sundays or weekends inside laytime come off as the terms say.',
    formulas: excelUsed({ laytime_used_hrs: '=(M2-N2)*24-O2' }) },
  { drill: 5, id: 'uu_as_eiu', lang: 'excel', match: 'result',
    message: 'You excepted every SHEX period on the SHEX UU voyages too. Unless used means time when loading was under way still counts.',
    formulas: excelUsed({ shex_hrs: '=SUMPRODUCT((shex_periods!$A$2:$A${sx_last}=A2)*(shex_periods!$D$2:$D${sx_last}="laytime")*(shex_periods!$C$2:$C${sx_last}-shex_periods!$B$2:$B${sx_last}))*24' }) },
  { drill: 5, id: 'eiu_as_uu', lang: 'excel', match: 'result',
    message: 'On the SHEX EIU voyages every SHEX period comes off, even if loading carried on. Only SHEX UU counts the time used.',
    formulas: excelUsed({ shex_hrs: '=SUMPRODUCT((shex_periods!$A$2:$A${sx_last}=A2)*(shex_periods!$D$2:$D${sx_last}="laytime")*(shex_periods!$E$2:$E${sx_last}=FALSE)*(shex_periods!$C$2:$C${sx_last}-shex_periods!$B$2:$B${sx_last}))*24' }) },
  { drill: 6, id: 'despatch_full_rate', lang: 'excel', match: 'result',
    message: 'Your despatch figures are double. Despatch is paid at half the demurrage rate.',
    formulas: excelAmount('=IF(R2="demurrage", (Q2-C2/D2*24)*I2/24, IF(G2="all time saved", C2/D2*24-Q2+S2, C2/D2*24-Q2)*I2/24)') },
  { drill: 6, id: 'ignored_all_time_saved', lang: 'excel', match: 'result',
    message: 'On all time saved voyages, time saved includes the SHEX time after completion that would have been excepted. You paid them on laytime saved only.',
    formulas: excelAmount('=IF(R2="demurrage", (Q2-C2/D2*24)*I2/24, (C2/D2*24-Q2)*I2/48)') },
  { drill: 7, id: 'no_keep_filter', lang: 'excel', match: 'rows',
    message: "You kept all {got} voyages. Keep only the rows where the owner's figure differs from yours.",
    formulas: { ...usedModel, owner_used_hrs: '=VLOOKUP(A2, owner_statement!$A:$D, 4, FALSE)', difference_hrs: '=ROUND(R2-Q2, 2)', keep: '=TRUE' } },
  { drill: 7, id: 'no_round', lang: 'excel', match: 'rows',
    message: 'You kept {got} voyages, more than the owner got wrong. Times are serial numbers, so your hours carry floating point noise and a figure the owner got right can differ by a hair. ROUND the difference before comparing.',
    formulas: { ...usedModel, owner_used_hrs: '=VLOOKUP(A2, owner_statement!$A:$D, 4, FALSE)', difference_hrs: '=R2-Q2', keep: '=S2<>0' } },
];

// Tokens for the Excel ranges and for any message that names a count
export function countsFor(data) {
  const t = data.tables;
  return {
    n_voyages: t.fixtures.length,
    st_last: t.stoppages.length + 1,
    sx_last: t.shex_periods.length + 1,
    os_last: t.owner_statement.length + 1,
  };
}
