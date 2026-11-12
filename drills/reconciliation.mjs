// Task 1 drills. The SQL here is the model answer. The generator runs it
// against the dataset to produce the answer key, so nothing below is a
// hand typed result. Excel and pandas model answers get added in later steps
// and must reproduce the same keys.

export const DRILL_1_PORT = 'Puerto Bolivar';

export const drills = [
  {
    id: 1,
    title: 'SELECT and filter',
    tag: 'filter',
    question: `List every cargo loading at ${DRILL_1_PORT}: cargo_id, vessel and bl_tonnage only.`,
    ordered: false,
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
    sql: `SELECT c.cargo_id, c.counterparty, p.country, p.payment_terms_days
          FROM cargoes c
          LEFT JOIN counterparties p ON c.counterparty = p.counterparty`,
  },
  {
    id: 4,
    title: 'Anti-join: missing',
    tag: 'left join',
    key: true,
    question: 'Which cargoes have never been invoiced? cargo_id, vessel, counterparty.',
    ordered: false,
    sql: `SELECT c.cargo_id, c.vessel, c.counterparty
          FROM cargoes c
          LEFT JOIN invoices i ON c.cargo_id = i.cargo_id
          WHERE i.invoice_no IS NULL`,
  },
  {
    id: 5,
    title: 'Anti-join: orphans',
    tag: 'left join',
    question: 'Which invoices reference a cargo that is not in the book? invoice_no, cargo_id, counterparty.',
    ordered: false,
    sql: `SELECT i.invoice_no, i.cargo_id, i.counterparty
          FROM invoices i
          LEFT JOIN cargoes c ON i.cargo_id = c.cargo_id
          WHERE c.cargo_id IS NULL`,
  },
  {
    id: 6,
    title: 'Duplicates',
    tag: 'having',
    question: 'Which cargo has been invoiced more than once? cargo_id and the number of invoices.',
    ordered: false,
    sql: `SELECT cargo_id, COUNT(*) AS invoice_count
          FROM invoices
          GROUP BY cargo_id
          HAVING COUNT(*) > 1`,
  },
  {
    id: 7,
    title: 'Value comparison: tonnage',
    tag: 'join + compare',
    question: 'Where does invoiced tonnage disagree with BL tonnage? cargo_id, bl_tonnage, invoiced_tonnage, and the difference (invoiced minus BL).',
    ordered: false,
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
    question: 'Where does invoiced price disagree with contract price? cargo_id, contract_price, invoiced_price, and the difference (invoiced minus contract).',
    ordered: false,
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
    question: 'Drills 4 to 8 again, from scratch. Target ten minutes.',
    timed: [4, 5, 6, 7, 8],
    targetMinutes: 10,
  },
];

// Known wrong answers. The generator runs these too, so the row counts the
// diagnostic hints rely on are computed, not assumed.
export const pitfalls = [
  {
    drill: 1, id: 'no_where',
    sql: `SELECT cargo_id, vessel, bl_tonnage FROM cargoes`,
  },
  {
    drill: 1, id: 'select_star',
    sql: `SELECT * FROM cargoes WHERE load_port = '${DRILL_1_PORT}'`,
  },
  {
    drill: 2, id: 'no_group_by',
    sql: `SELECT counterparty, bl_tonnage FROM cargoes ORDER BY bl_tonnage DESC`,
  },
  {
    drill: 4, id: 'inner_join',
    sql: `SELECT c.cargo_id, c.vessel, c.counterparty
          FROM cargoes c JOIN invoices i ON c.cargo_id = i.cargo_id`,
  },
  {
    drill: 6, id: 'no_having',
    sql: `SELECT cargo_id, COUNT(*) AS invoice_count FROM invoices GROUP BY cargo_id`,
  },
  {
    drill: 9, id: 'row_by_row_join',
    sql: `SELECT ROUND(SUM(c.bl_tonnage * c.contract_price - i.invoiced_tonnage * i.invoiced_price), 2) AS usd_difference
          FROM cargoes c JOIN invoices i ON c.cargo_id = i.cargo_id`,
  },
];
