// Task 1 drills. The SQL here is the model answer. The generator runs it
// against the dataset to produce the answer key, so no expected result is
// hand typed. Excel and pandas model answers get added in later steps and
// must reproduce the same keys.
//
// Hint, why and pitfall text must not contain hard coded counts. Use a
// {token}; the page fills it from the computed key. verify enforces this.

export const DRILL_1_PORT = 'Puerto Bolivar';

export const drills = [
  {
    id: 1,
    title: 'SELECT and filter',
    tag: 'filter',
    question: `List every cargo loading at ${DRILL_1_PORT}: cargo_id, vessel and bl_tonnage only.`,
    ordered: false,
    hint: { sql: 'WHERE keeps only the rows that pass a test. Text goes in single quotes and must match exactly, capitals and spaces included.' },
    why: { sql: 'WHERE filters the rows, and naming the three columns instead of * returns only what was asked for.' },
    sql: `SELECT cargo_id, vessel, bl_tonnage
FROM cargoes
WHERE load_port = '${DRILL_1_PORT}'`,
  },
  {
    id: 2,
    title: 'Aggregate',
    tag: 'group by',
    question: 'Total BL tonnage per counterparty, biggest first.',
    ordered: true,
    hint: { sql: 'GROUP BY makes one row per counterparty, SUM adds up inside each group, and ORDER BY puts them in order.' },
    why: { sql: 'GROUP BY collapses the cargoes into one row per counterparty, SUM totals each group, and DESC puts the biggest first. The alias is total_tonnage because this engine reserves the word total.' },
    sql: `SELECT counterparty, SUM(bl_tonnage) AS total_tonnage
FROM cargoes
GROUP BY counterparty
ORDER BY total_tonnage DESC`,
  },
  {
    id: 3,
    title: 'Lookup across tables',
    tag: 'join',
    question: "Each cargo alongside its counterparty's country and payment terms: cargo_id, counterparty, country, payment_terms_days.",
    ordered: false,
    hint: { sql: 'Country and payment terms live in counterparties, not cargoes. Join the two tables on the column they share.' },
    why: { sql: 'A LEFT JOIN keeps every cargo even if its counterparty were missing from the reference table, which is the safe default for a lookup. It is what VLOOKUP does.' },
    sql: `SELECT c.cargo_id, c.counterparty, p.country, p.payment_terms_days
FROM cargoes c
LEFT JOIN counterparties p ON c.counterparty = p.counterparty`,
  },
  {
    id: 4,
    title: 'Anti-join: missing',
    tag: 'left join',
    key: true,
    finds: 'missing_invoice',
    question: 'Which cargoes have never been invoiced? cargo_id, vessel, counterparty.',
    ordered: false,
    hint: { sql: 'You want cargoes with no matching invoice. A join that keeps unmatched rows fills the invoice side with NULL where nothing matched.' },
    why: { sql: 'LEFT JOIN keeps every cargo. Where no invoice matched, the invoice columns are NULL, and IS NULL keeps exactly those rows. This is the anti-join, the core move in any reconciliation.' },
    sql: `SELECT c.cargo_id, c.vessel, c.counterparty
FROM cargoes c
LEFT JOIN invoices i ON c.cargo_id = i.cargo_id
WHERE i.invoice_no IS NULL`,
  },
  {
    id: 5,
    title: 'Anti-join: orphans',
    tag: 'left join',
    finds: 'orphan_invoice',
    question: 'Which invoices reference a cargo that is not in the book? invoice_no, cargo_id, counterparty.',
    ordered: false,
    hint: { sql: 'The same move as drill 4, turned around. Start from invoices.' },
    why: { sql: 'Starting from invoices and left joining cargoes leaves the cargo side NULL wherever the book holds no such cargo.' },
    sql: `SELECT i.invoice_no, i.cargo_id, i.counterparty
FROM invoices i
LEFT JOIN cargoes c ON i.cargo_id = c.cargo_id
WHERE c.cargo_id IS NULL`,
  },
  {
    id: 6,
    title: 'Duplicates',
    tag: 'having',
    finds: 'duplicate_invoice',
    question: 'Which cargo has been invoiced more than once? cargo_id and the number of invoices.',
    ordered: false,
    hint: { sql: 'Count the invoices per cargo, then keep only the groups where the count is above one.' },
    why: { sql: 'GROUP BY makes one row per cargo and COUNT(*) counts its invoices. HAVING filters after the groups are made, which is the only point at which the count exists.' },
    sql: `SELECT cargo_id, COUNT(*) AS invoice_count
FROM invoices
GROUP BY cargo_id
HAVING COUNT(*) > 1`,
  },
  {
    id: 7,
    title: 'Value comparison: tonnage',
    tag: 'join + compare',
    finds: 'tonnage_mismatch',
    question: 'Where does invoiced tonnage disagree with BL tonnage? cargo_id, bl_tonnage, invoiced_tonnage, and the difference (invoiced minus BL).',
    ordered: false,
    signNote: 'invoiced minus BL',
    hint: { sql: 'Join each invoice to its cargo, then keep the rows where the two tonnage figures differ. Not equal is written <>.' },
    why: { sql: 'An inner join is right here: only a cargo with an invoice can have a tonnage break. <> keeps the disagreements, and the subtraction runs invoiced minus BL as asked.' },
    sql: `SELECT c.cargo_id, c.bl_tonnage, i.invoiced_tonnage,
       i.invoiced_tonnage - c.bl_tonnage AS difference_mt
FROM cargoes c
JOIN invoices i ON c.cargo_id = i.cargo_id
WHERE i.invoiced_tonnage <> c.bl_tonnage`,
  },
  {
    id: 8,
    title: 'Value comparison: price',
    tag: 'join + compare',
    finds: 'price_mismatch',
    question: 'Where does invoiced price disagree with contract price? cargo_id, contract_price, invoiced_price, and the difference (invoiced minus contract).',
    ordered: false,
    signNote: 'invoiced minus contract',
    hint: { sql: 'The same shape as drill 7, on the price columns.' },
    why: { sql: 'The same join and filter as drill 7. ROUND to two places stops floating point noise showing up in a money column.' },
    sql: `SELECT c.cargo_id, c.contract_price, i.invoiced_price,
       ROUND(i.invoiced_price - c.contract_price, 2) AS difference_usd_per_mt
FROM cargoes c
JOIN invoices i ON c.cargo_id = i.cargo_id
WHERE i.invoiced_price <> c.contract_price`,
  },
  {
    id: 9,
    title: 'Put a number on it',
    tag: 'subquery',
    question: 'Across every cargo that has at least one invoice, what is contract value (BL tonnage x contract price) minus total invoiced value, in USD?',
    ordered: false,
    signNote: 'contract value minus invoiced value',
    hint: { sql: "Total the invoices for each cargo first, then compare each cargo's total to its contract value. Watch what a plain join does to a cargo invoiced twice." },
    why: { sql: 'The subquery collapses invoices to one row per cargo before the join. Join row by row instead and the duplicate matches its contract twice, so the double bill cancels out and disappears.' },
    // Invoices are summed per cargo first, so the duplicate shows up as an
    // overbill instead of cancelling itself out on a row by row join.
    sql: `SELECT ROUND(SUM(c.bl_tonnage * c.contract_price - inv.invoiced_value), 2) AS usd_difference
FROM cargoes c
JOIN (SELECT cargo_id, SUM(invoiced_tonnage * invoiced_price) AS invoiced_value
      FROM invoices
      GROUP BY cargo_id) AS inv
  ON c.cargo_id = inv.cargo_id`,
  },
  {
    id: 10,
    title: 'Timed run',
    tag: 'timed',
    question: 'Drills 4 to 8 again, from scratch, against the clock. Target ten minutes.',
    timed: [4, 5, 6, 7, 8],
    targetMinutes: 10,
  },
];

// Known wrong answers. The generator runs every one, so the counts a hint
// relies on are computed from the data. match says how a user's result is
// recognised: 'rows' by row count, 'value' by a single figure, 'none' only
// verified, with the generic checker producing the message.
export const pitfalls = [
  {
    drill: 1, id: 'no_where', lang: 'sql', match: 'rows',
    message: 'You got all {got} cargoes. The question asks for one port, so the query needs a WHERE.',
    sql: `SELECT cargo_id, vessel, bl_tonnage FROM cargoes`,
  },
  {
    drill: 1, id: 'select_star', lang: 'sql', match: 'none',
    sql: `SELECT * FROM cargoes WHERE load_port = '${DRILL_1_PORT}'`,
  },
  {
    drill: 2, id: 'no_group_by', lang: 'sql', match: 'rows',
    message: 'You got {got} rows, one per cargo. To get one row per counterparty, group them with GROUP BY.',
    sql: `SELECT counterparty, bl_tonnage FROM cargoes ORDER BY bl_tonnage DESC`,
  },
  {
    drill: 4, id: 'inner_join', lang: 'sql', match: 'rows',
    message: 'You got {got} rows: every invoice that found its cargo. An inner join throws away cargoes with no invoice, and those are exactly the rows you want. Look at LEFT JOIN.',
    sql: `SELECT c.cargo_id, c.vessel, c.counterparty
FROM cargoes c JOIN invoices i ON c.cargo_id = i.cargo_id`,
  },
  {
    drill: 4, id: 'inner_join_distinct', lang: 'sql', match: 'rows',
    message: 'You got {got} rows: every cargo that has an invoice. The question asks for the opposite. An inner join throws away the cargoes you want. Look at LEFT JOIN.',
    sql: `SELECT DISTINCT c.cargo_id, c.vessel, c.counterparty
FROM cargoes c JOIN invoices i ON c.cargo_id = i.cargo_id`,
  },
  {
    drill: 5, id: 'inner_join', lang: 'sql', match: 'rows',
    message: 'You got {got} rows: every invoice that found a cargo. The orphan is the one invoice an inner join drops. Start from invoices and keep the unmatched rows.',
    sql: `SELECT i.invoice_no, i.cargo_id, i.counterparty
FROM invoices i JOIN cargoes c ON i.cargo_id = c.cargo_id`,
  },
  {
    drill: 6, id: 'no_having', lang: 'sql', match: 'rows',
    message: 'You got {got} rows: every cargo ID with its count. Keep only the groups with more than one invoice. That filter goes in HAVING, after GROUP BY.',
    sql: `SELECT cargo_id, COUNT(*) AS invoice_count FROM invoices GROUP BY cargo_id`,
  },
  {
    drill: 7, id: 'no_where', lang: 'sql', match: 'rows',
    message: 'You got {got} rows: every invoice joined to its cargo. Keep only the rows where the two tonnage figures disagree.',
    sql: `SELECT c.cargo_id, c.bl_tonnage, i.invoiced_tonnage, i.invoiced_tonnage - c.bl_tonnage AS difference_mt
FROM cargoes c JOIN invoices i ON c.cargo_id = i.cargo_id`,
  },
  {
    drill: 8, id: 'no_where', lang: 'sql', match: 'rows',
    message: 'You got {got} rows: every invoice joined to its cargo. Keep only the rows where the two prices disagree.',
    sql: `SELECT c.cargo_id, c.contract_price, i.invoiced_price, i.invoiced_price - c.contract_price AS difference_usd_per_mt
FROM cargoes c JOIN invoices i ON c.cargo_id = i.cargo_id`,
  },
  {
    drill: 9, id: 'row_by_row_join', lang: 'sql', match: 'value',
    message: 'That is the row by row figure. A cargo invoiced twice matches its contract twice, so the double bill cancels out and the biggest break disappears. Total the invoices per cargo before comparing.',
    sql: `SELECT ROUND(SUM(c.bl_tonnage * c.contract_price - i.invoiced_tonnage * i.invoiced_price), 2) AS usd_difference
FROM cargoes c JOIN invoices i ON c.cargo_id = i.cargo_id`,
  },
];
