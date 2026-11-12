// Task 1 drills. The SQL here is the model answer the generator runs to
// produce the answer key, so no expected result is hand typed. The Excel
// model answers must reproduce the same key; verify proves they do.
//
// Hint, why and pitfall text must not contain hard coded counts. Use a
// {token}; the page fills it from the computed key. verify enforces this.
// Excel formulas may also use tokens for last rows, like {inv_last}.
//
// An Excel frame says which sheet the user works on and which formula
// columns sit to the right of it. Each formula is written for row 2 and
// filled down. Roles: keep (a filter on TRUE), value (a column the answer
// reads), helper (optional working column). project lists the columns of
// the result, by field name, in order.

export const DRILL_1_PORT = 'Puerto Bolivar';

export const drills = [
  {
    id: 1,
    title: 'SELECT and filter',
    tag: 'filter',
    question: `List every cargo loading at ${DRILL_1_PORT}: cargo_id, vessel and bl_tonnage only.`,
    ordered: false,
    hint: {
      sql: 'WHERE keeps only the rows that pass a test. Text goes in single quotes and must match exactly, capitals and spaces included.',
      excel: 'The keep column works like a filter: TRUE keeps the row. Compare the load port in column D with the port name, in double quotes.',
    },
    why: {
      sql: 'WHERE filters the rows, and naming the columns the question asks for, instead of *, returns only what was asked for.',
      excel: `D2="${DRILL_1_PORT}" is TRUE only on that port's rows, and filled down it tests every cargo. Excel compares text without regard to capitals; SQL does not.`,
    },
    sql: `SELECT cargo_id, vessel, bl_tonnage
FROM cargoes
WHERE load_port = '${DRILL_1_PORT}'`,
    excel: {
      base: 'cargoes',
      columns: [{ name: 'keep', role: 'keep' }],
      project: ['cargo_id', 'vessel', 'bl_tonnage'],
      model: { keep: `=D2="${DRILL_1_PORT}"` },
    },
  },
  {
    id: 2,
    title: 'Aggregate',
    tag: 'group by',
    question: 'Total BL tonnage per counterparty, biggest first.',
    ordered: true,
    hint: {
      sql: 'GROUP BY makes one row per counterparty, SUM adds up inside each group, and ORDER BY puts them in order.',
      excel: "SUMIFS adds up one column where another column matches a value: the tonnage column, the counterparty column, and this row's counterparty.",
    },
    why: {
      sql: 'GROUP BY collapses the cargoes into one row per counterparty, SUM totals each group, and DESC puts the biggest first. The alias is total_tonnage because this engine reserves the word total.',
      excel: "SUMIFS(sum range, criteria range, criteria) adds up each counterparty's tonnage. The $ signs keep the ranges fixed as the formula fills down, while A2 moves with each row.",
    },
    sql: `SELECT counterparty, SUM(bl_tonnage) AS total_tonnage
FROM cargoes
GROUP BY counterparty
ORDER BY total_tonnage DESC`,
    excel: {
      base: 'counterparties',
      columns: [{ name: 'total_tonnage', role: 'value' }],
      project: ['counterparty', 'total_tonnage'],
      // Sorting is a button in Excel, not a formula, so order is not checked
      ordered: false,
      note: 'In Excel you would then sort this column largest to smallest. The check here is on the totals, not the order.',
      model: { total_tonnage: '=SUMIFS(cargoes!$F:$F, cargoes!$C:$C, A2)' },
    },
  },
  {
    id: 3,
    title: 'Lookup across tables',
    tag: 'join',
    question: "Each cargo alongside its counterparty's country and payment terms: cargo_id, counterparty, country, payment_terms_days.",
    ordered: false,
    hint: {
      sql: 'Country and payment terms live in counterparties, not cargoes. Join the two tables on the column they share.',
      excel: "Look up this row's counterparty, in column C, on the counterparties sheet and bring back another column from the same row.",
    },
    why: {
      sql: 'A LEFT JOIN keeps every cargo even if its counterparty were missing from the reference table, which is the safe default for a lookup. It is what VLOOKUP does.',
      excel: 'VLOOKUP finds the counterparty in the first column of the range and returns the column you count to. FALSE makes it an exact match, which a lookup on names needs. INDEX with MATCH, or XLOOKUP, does the same job.',
    },
    sql: `SELECT c.cargo_id, c.counterparty, p.country, p.payment_terms_days
FROM cargoes c
LEFT JOIN counterparties p ON c.counterparty = p.counterparty`,
    excel: {
      base: 'cargoes',
      columns: [{ name: 'country', role: 'value' }, { name: 'payment_terms_days', role: 'value' }],
      project: ['cargo_id', 'counterparty', 'country', 'payment_terms_days'],
      model: {
        country: '=VLOOKUP($C2, counterparties!$A:$D, 2, FALSE)',
        payment_terms_days: '=VLOOKUP($C2, counterparties!$A:$D, 4, FALSE)',
      },
    },
  },
  {
    id: 4,
    title: 'Anti-join: missing',
    tag: 'left join',
    key: true,
    finds: 'missing_invoice',
    question: 'Which cargoes have never been invoiced? cargo_id, vessel, counterparty.',
    ordered: false,
    hint: {
      sql: 'You want cargoes with no matching invoice. A join that keeps unmatched rows fills the invoice side with NULL where nothing matched.',
      excel: 'Count how many invoices carry this cargo ID. The cargoes you want are the ones where that count is nothing.',
    },
    why: {
      sql: 'LEFT JOIN keeps every cargo. Where no invoice matched, the invoice columns are NULL, and IS NULL keeps exactly those rows. This is the anti-join, the core move in any reconciliation.',
      excel: "COUNTIF counts the invoices for each cargo, and =0 makes it TRUE only where there are none. This is the anti-join done the Excel way; SQL's LEFT JOIN with IS NULL asks the same question.",
    },
    sql: `SELECT c.cargo_id, c.vessel, c.counterparty
FROM cargoes c
LEFT JOIN invoices i ON c.cargo_id = i.cargo_id
WHERE i.invoice_no IS NULL`,
    excel: {
      base: 'cargoes',
      columns: [{ name: 'keep', role: 'keep' }],
      project: ['cargo_id', 'vessel', 'counterparty'],
      model: { keep: '=COUNTIF(invoices!$B:$B, A2)=0' },
    },
  },
  {
    id: 5,
    title: 'Anti-join: orphans',
    tag: 'left join',
    finds: 'orphan_invoice',
    question: 'Which invoices reference a cargo that is not in the book? invoice_no, cargo_id, counterparty.',
    ordered: false,
    hint: {
      sql: 'The same move as drill 4, turned around. Start from invoices.',
      excel: "The same move as drill 4, turned around: work on the invoices sheet and count each invoice's cargo ID in the cargo book.",
    },
    why: {
      sql: 'Starting from invoices and left joining cargoes leaves the cargo side NULL wherever the book holds no such cargo.',
      excel: "Counting each invoice's cargo ID in the cargo book gives zero only for a cargo the book does not hold.",
    },
    sql: `SELECT i.invoice_no, i.cargo_id, i.counterparty
FROM invoices i
LEFT JOIN cargoes c ON i.cargo_id = c.cargo_id
WHERE c.cargo_id IS NULL`,
    excel: {
      base: 'invoices',
      columns: [{ name: 'keep', role: 'keep' }],
      project: ['invoice_no', 'cargo_id', 'counterparty'],
      model: { keep: '=COUNTIF(cargoes!$A:$A, B2)=0' },
    },
  },
  {
    id: 6,
    title: 'Duplicates',
    tag: 'having',
    finds: 'duplicate_invoice',
    question: 'Which cargo has been invoiced more than once? cargo_id and the number of invoices.',
    ordered: false,
    hint: {
      sql: 'Count the invoices per cargo, then keep only the groups where the count is above one.',
      excel: 'Count the invoices for each cargo in one column, then keep the rows where that count is above one.',
    },
    why: {
      sql: 'GROUP BY makes one row per cargo and COUNT(*) counts its invoices. HAVING filters after the groups are made, which is the only point at which the count exists.',
      excel: 'The count column is the helper an operator would add, and the keep column is the filter on it. In SQL the same split is GROUP BY, then HAVING.',
    },
    sql: `SELECT cargo_id, COUNT(*) AS invoice_count
FROM invoices
GROUP BY cargo_id
HAVING COUNT(*) > 1`,
    excel: {
      base: 'cargoes',
      columns: [{ name: 'invoice_count', role: 'value' }, { name: 'keep', role: 'keep' }],
      project: ['cargo_id', 'invoice_count'],
      model: { invoice_count: '=COUNTIF(invoices!$B:$B, A2)', keep: '=K2>1' },
    },
  },
  {
    id: 7,
    title: 'Value comparison: tonnage',
    tag: 'join + compare',
    finds: 'tonnage_mismatch',
    question: 'Where does invoiced tonnage disagree with BL tonnage? cargo_id, bl_tonnage, invoiced_tonnage, and the difference, invoiced minus BL. Positive means invoiced above the BL figure.',
    ordered: false,
    signNote: 'invoiced minus BL',
    hint: {
      sql: 'Join each invoice to its cargo, then keep the rows where the two tonnage figures differ. Not equal is written <>.',
      excel: "Bring each invoice's BL tonnage across from the cargo book, subtract, and keep the rows where the difference is not zero. Not equal is written <>.",
    },
    why: {
      sql: 'An inner join is right here: only a cargo with an invoice can have a tonnage break. <> keeps the disagreements, and the subtraction runs invoiced minus BL as asked.',
      excel: 'VLOOKUP brings the BL figure across, the difference runs invoiced minus BL as asked, and <>0 keeps only the breaks. The orphan invoice has no cargo, so its lookup gives #N/A and the filter leaves it out, as an inner join would.',
    },
    sql: `SELECT c.cargo_id, c.bl_tonnage, i.invoiced_tonnage,
       i.invoiced_tonnage - c.bl_tonnage AS difference_mt
FROM cargoes c
JOIN invoices i ON c.cargo_id = i.cargo_id
WHERE i.invoiced_tonnage <> c.bl_tonnage`,
    excel: {
      base: 'invoices',
      columns: [{ name: 'bl_tonnage', role: 'value' }, { name: 'difference_mt', role: 'value' }, { name: 'keep', role: 'keep' }],
      project: ['cargo_id', 'bl_tonnage', 'invoiced_tonnage', 'difference_mt'],
      model: { bl_tonnage: '=VLOOKUP(B2, cargoes!$A:$F, 6, FALSE)', difference_mt: '=D2-G2', keep: '=H2<>0' },
    },
  },
  {
    id: 8,
    title: 'Value comparison: price',
    tag: 'join + compare',
    finds: 'price_mismatch',
    question: 'Where does invoiced price disagree with contract price? cargo_id, contract_price, invoiced_price, and the difference, invoiced minus contract. Positive means invoiced above contract.',
    ordered: false,
    signNote: 'invoiced minus contract',
    hint: {
      sql: 'The same shape as drill 7, on the price columns.',
      excel: 'The same shape as drill 7, on the price columns.',
    },
    why: {
      sql: 'The same join and filter as drill 7. ROUND to two places stops floating point noise showing up in a money column.',
      excel: 'The same lookup, subtraction and filter as drill 7. Prices carry floating point noise in any spreadsheet, so ROUND(H2, 2) is a habit worth having in a money column.',
    },
    sql: `SELECT c.cargo_id, c.contract_price, i.invoiced_price,
       ROUND(i.invoiced_price - c.contract_price, 2) AS difference_usd_per_mt
FROM cargoes c
JOIN invoices i ON c.cargo_id = i.cargo_id
WHERE i.invoiced_price <> c.contract_price`,
    excel: {
      base: 'invoices',
      columns: [{ name: 'contract_price', role: 'value' }, { name: 'difference_usd_per_mt', role: 'value' }, { name: 'keep', role: 'keep' }],
      project: ['cargo_id', 'contract_price', 'invoiced_price', 'difference_usd_per_mt'],
      model: { contract_price: '=VLOOKUP(B2, cargoes!$A:$J, 10, FALSE)', difference_usd_per_mt: '=E2-G2', keep: '=H2<>0' },
    },
  },
  {
    id: 9,
    title: 'Put a number on it',
    tag: 'subquery',
    question: 'Across every cargo that has at least one invoice, what is total invoiced value minus contract value (BL tonnage x contract price), in USD? Positive means invoiced above contract, the same direction as drills 7 and 8.',
    ordered: false,
    signNote: 'invoiced value minus contract value',
    hint: {
      sql: "Total the invoices for each cargo first, then take each cargo's contract value away from its invoiced total. Watch what a plain join does to a cargo invoiced twice.",
      excel: 'Work per cargo in the helper column: the value of every invoice for that cargo minus its contract value, and nothing for a cargo with no invoice. Then add the column up in the total cell. Watch what VLOOKUP does to a cargo invoiced twice.',
    },
    why: {
      sql: 'The subquery collapses invoices to one row per cargo before the join. Join row by row instead and the duplicate matches its contract twice, so the double bill cancels out and disappears.',
      excel: 'SUMPRODUCT adds tonnage times price across every invoice for the cargo, so a cargo invoiced twice counts twice. VLOOKUP would stop at the first invoice and hide the double bill. The COUNTIF guard leaves out cargoes nobody invoiced, as the question asks.',
    },
    // Invoices are summed per cargo first, so the duplicate shows up as an
    // overbill instead of cancelling itself out on a row by row join.
    sql: `SELECT ROUND(SUM(inv.invoiced_value - c.bl_tonnage * c.contract_price), 2) AS usd_difference
FROM cargoes c
JOIN (SELECT cargo_id, SUM(invoiced_tonnage * invoiced_price) AS invoiced_value
      FROM invoices
      GROUP BY cargo_id) AS inv
  ON c.cargo_id = inv.cargo_id`,
    excel: {
      base: 'cargoes',
      columns: [{ name: 'difference', role: 'helper' }],
      total: { name: 'usd_difference', label: 'total' },
      model: {
        difference: '=IF(COUNTIF(invoices!$B:$B, A2)=0, 0, SUMPRODUCT((invoices!$B$2:$B${inv_last}=A2)*invoices!$D$2:$D${inv_last}*invoices!$E$2:$E${inv_last})-F2*J2)',
        total: '=SUM(K2:K{cg_last})',
      },
    },
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

// Known wrong answers. The generator runs every one, so the counts and
// results a hint relies on are computed from the data. match says how a
// user's result is recognised: 'rows' by row count, 'value' by a single
// figure, 'result' by the whole result, 'none' only verified.
export const pitfalls = [
  // ---------- SQL ----------
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
    sql: `SELECT ROUND(SUM(i.invoiced_tonnage * i.invoiced_price - c.bl_tonnage * c.contract_price), 2) AS usd_difference
FROM cargoes c JOIN invoices i ON c.cargo_id = i.cargo_id`,
  },

  // ---------- Excel ----------
  {
    drill: 1, id: 'all_rows', lang: 'excel', match: 'rows',
    message: "Your keep column is TRUE on all {got} rows. It has to test the load port, so that only one port's cargoes come out TRUE.",
    formulas: { keep: '=TRUE' },
  },
  {
    drill: 2, id: 'countifs', lang: 'excel', match: 'result',
    message: 'These are counts of cargoes, not tonnage. COUNTIFS counts rows; SUMIFS adds up a column.',
    formulas: { total_tonnage: '=COUNTIFS(cargoes!$C:$C, A2)' },
  },
  {
    drill: 2, id: 'grand_total', lang: 'excel', match: 'result',
    message: 'Every row shows the same figure, the grand total. SUMIFS needs the counterparty as its condition, so that each row adds only its own cargoes.',
    formulas: { total_tonnage: '=SUM(cargoes!$F:$F)' },
  },
  {
    drill: 2, id: 'header_range', lang: 'excel', match: 'result',
    message: 'One total is short. Your ranges start at row 1, the header, and stop a row early, so the last cargo in the book is left out. Start the ranges at row 2 and run them to the last row, or use whole columns.',
    formulas: { total_tonnage: '=SUMIFS(cargoes!$F$1:$F${cg_n}, cargoes!$C$1:$C${cg_n}, A2)' },
  },
  {
    drill: 2, id: 'swapped_args', lang: 'excel', match: 'result',
    message: 'Every total is 0. SUMIFS takes the column to add first, then the column to test, then the value to look for.',
    formulas: { total_tonnage: '=SUMIFS(cargoes!$C:$C, cargoes!$F:$F, A2)' },
  },
  {
    drill: 3, id: 'approximate', lang: 'excel', match: 'result',
    message: "Some rows carry another counterparty's details. Without FALSE as its last argument VLOOKUP does an approximate match, which only works on a sorted list. Add FALSE for an exact match.",
    formulas: { country: '=VLOOKUP($C2, counterparties!$A:$D, 2)', payment_terms_days: '=VLOOKUP($C2, counterparties!$A:$D, 4)' },
  },
  {
    drill: 3, id: 'wrong_index', lang: 'excel', match: 'result',
    message: "The payment terms column holds credit limits. VLOOKUP's third argument counts columns from the left edge of the range, starting at 1.",
    formulas: { country: '=VLOOKUP($C2, counterparties!$A:$D, 2, FALSE)', payment_terms_days: '=VLOOKUP($C2, counterparties!$A:$D, 3, FALSE)' },
  },
  {
    drill: 4, id: 'count_not_zero', lang: 'excel', match: 'rows',
    message: 'Your keep column is TRUE for the {got} cargoes that do have an invoice. You want the other side: the cargoes where the count is 0. If you used MATCH, its #N/A is the signal you want, and ISNA turns it into TRUE.',
    formulas: { keep: '=COUNTIF(invoices!$B:$B, A2)' },
  },
  {
    drill: 4, id: 'bare_match', lang: 'excel', match: 'none',
    formulas: { keep: '=MATCH(A2, invoices!$B:$B, 0)' },
  },
  {
    drill: 5, id: 'count_not_zero', lang: 'excel', match: 'rows',
    message: 'Your keep column is TRUE for the {got} invoices whose cargo is in the book. You want the other side: the invoices where the count is 0.',
    formulas: { keep: '=COUNTIF(cargoes!$A:$A, B2)' },
  },
  {
    drill: 6, id: 'keep_any', lang: 'excel', match: 'rows',
    message: 'Your keep column is TRUE for every cargo with at least one invoice, {got} of them. A duplicate is a cargo with more than one.',
    formulas: { invoice_count: '=COUNTIF(invoices!$B:$B, A2)', keep: '=K2>0' },
  },
  {
    drill: 7, id: 'no_keep_filter', lang: 'excel', match: 'rows',
    message: 'You kept {got} rows: every invoice that has a cargo. Keep only the rows where the two tonnage figures disagree.',
    formulas: { bl_tonnage: '=VLOOKUP(B2, cargoes!$A:$F, 6, FALSE)', difference_mt: '=D2-G2', keep: '=ISNUMBER(H2)' },
  },
  {
    drill: 7, id: 'sumifs_orphan', lang: 'excel', match: 'result',
    message: 'One row too many: invoice {orphan_invoice}, the orphan. SUMIFS gives 0 when nothing matches, so a cargo that is not in the book looks like a cargo of zero tonnes. Use a lookup that fails, like VLOOKUP, or leave out invoices whose cargo is not in the book.',
    formulas: { bl_tonnage: '=SUMIFS(cargoes!$F:$F, cargoes!$A:$A, B2)', difference_mt: '=D2-G2', keep: '=H2<>0' },
  },
  {
    drill: 8, id: 'no_keep_filter', lang: 'excel', match: 'rows',
    message: 'You kept {got} rows: every invoice that has a cargo. Keep only the rows where the two prices disagree.',
    formulas: { contract_price: '=VLOOKUP(B2, cargoes!$A:$J, 10, FALSE)', difference_usd_per_mt: '=E2-G2', keep: '=ISNUMBER(H2)' },
  },
  {
    drill: 8, id: 'sumifs_orphan', lang: 'excel', match: 'result',
    message: 'One row too many: invoice {orphan_invoice}, the orphan. SUMIFS gives 0 when nothing matches, so a cargo that is not in the book looks like a contract price of zero. Use a lookup that fails, like VLOOKUP, or leave out invoices whose cargo is not in the book.',
    formulas: { contract_price: '=SUMIFS(cargoes!$J:$J, cargoes!$A:$A, B2)', difference_usd_per_mt: '=E2-G2', keep: '=H2<>0' },
  },
  {
    drill: 9, id: 'first_match_only', lang: 'excel', match: 'value',
    message: 'VLOOKUP finds only the first invoice for each cargo, so a cargo invoiced twice looks billed once and the double bill disappears. Add up every invoice for the cargo, with SUMPRODUCT.',
    formulas: {
      difference: '=IF(COUNTIF(invoices!$B:$B, A2)=0, 0, VLOOKUP(A2, invoices!$B:$E, 3, FALSE)*VLOOKUP(A2, invoices!$B:$E, 4, FALSE)-F2*J2)',
      total: '=SUM(K2:K{cg_last})',
    },
  },
  {
    drill: 9, id: 'includes_uninvoiced', lang: 'excel', match: 'value',
    message: 'Your total counts the cargoes with no invoice at all, as if each were underbilled by its full contract value. The question covers only cargoes with at least one invoice.',
    formulas: {
      difference: '=SUMPRODUCT((invoices!$B$2:$B${inv_last}=A2)*invoices!$D$2:$D${inv_last}*invoices!$E$2:$E${inv_last})-F2*J2',
      total: '=SUM(K2:K{cg_last})',
    },
  },
  {
    drill: 9, id: 'grand_totals', lang: 'excel', match: 'value',
    message: 'That compares the whole cargo book with every invoice, so it counts cargoes nobody invoiced and the orphan invoice as well. Restrict both sides to cargoes that have an invoice.',
    formulas: { total: '=SUMPRODUCT(invoices!$D$2:$D${inv_last}, invoices!$E$2:$E${inv_last})-SUMPRODUCT(cargoes!$F$2:$F${cg_last}, cargoes!$J$2:$J${cg_last})' },
  },
];
