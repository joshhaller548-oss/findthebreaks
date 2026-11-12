// Answer checking, shared by every language tab. A language engine turns the
// user's code into { columns, rows } and this module decides the verdict.
//
// Normalisation: row order (unless the drill is ordered), column order and
// column names are ignored, columns are matched by their contents, strings
// are trimmed, and numbers within a cent of each other are equal.

const TOLERANCE = 0.01 - 1e-9;

export function normValue(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

const rank = (v) => (v === null ? 0 : typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : 3);

function cmp(a, b) {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 1) return a - b;
  if (ra === 0) return 0;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

export function valEq(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < TOLERANCE;
  return a === b;
}

const rowCmp = (x, y) => {
  for (let k = 0; k < x.length; k++) {
    const c = cmp(x[k], y[k]);
    if (c) return c;
  }
  return 0;
};
const sortRows = (rows) => [...rows].sort(rowCmp);
const rowsEq = (a, b) => a.length === b.length && a.every((r, i) => r.length === b[i].length && r.every((v, k) => valEq(v, b[i][k])));
const column = (rows, j) => rows.map((r) => r[j]);
const multiEq = (a, b) => rowsEq(a.map((v) => [v]).sort(rowCmp), b.map((v) => [v]).sort(rowCmp));
const negate = (vals) => vals.map((v) => (typeof v === 'number' ? -v : v));

// Map each expected column to a user column with the same contents.
// Preference: same name, then same position, then the first free match.
function mapColumns(U, ucols, E, ecols, transform = (x) => x) {
  const used = new Set();
  return ecols.map((name, j) => {
    const want = column(E, j);
    const fits = ucols
      .map((_, i) => i)
      .filter((i) => !used.has(i) && multiEq(transform(column(U, i)), want));
    if (!fits.length) return null;
    const pick =
      fits.find((i) => ucols[i].toLowerCase() === name.toLowerCase()) ??
      fits.find((i) => i === j) ??
      fits[0];
    used.add(pick);
    return pick;
  });
}

// Returns { verdict: 'correct' | 'wrong', shapeOk, code, ...detail }
export function compare(user, expected) {
  const U = user.rows.map((r) => r.map(normValue));
  const E = expected.rows.map((r) => r.map(normValue));
  const ucols = user.columns;
  const ecols = expected.columns;
  const shapeOk = ucols.length === ecols.length;
  const base = { shapeOk, gotRows: U.length, expRows: E.length, gotCols: ucols.length, expCols: ecols.length };

  if (E.length && !U.length) return { verdict: 'wrong', code: 'empty', ...base };

  const map = mapColumns(U, ucols, E, ecols);
  if (map.every((i) => i !== null)) {
    const proj = U.map((r) => map.map((i) => r[i]));
    const sameSet = rowsEq(sortRows(proj), sortRows(E));
    const sameSeq = rowsEq(proj, E);
    if ((expected.ordered ? sameSeq : sameSet) && shapeOk) return { verdict: 'correct', ...base };
    if (sameSet && !shapeOk) return { verdict: 'wrong', code: 'extra_columns', ...base };
    if (sameSet && expected.ordered) return { verdict: 'wrong', code: 'wrong_order', ...base };
    return { verdict: 'wrong', code: 'rows_differ', ...base };
  }

  if (U.length === E.length) {
    // A column that matches once its sign is flipped
    for (let j = 0; j < ecols.length; j++) {
      if (map[j] !== null) continue;
      const flipped = ucols.findIndex((_, i) => !map.includes(i) && column(E, j).some((v) => typeof v === 'number' && v !== 0) && multiEq(negate(column(U, i)), column(E, j)));
      if (flipped !== -1) return { verdict: 'wrong', code: 'sign_flip', column: ucols[flipped], ...base };
    }
    if (ucols.length < ecols.length) {
      const missing = ecols.filter((_, j) => map[j] === null);
      return { verdict: 'wrong', code: 'missing_columns', missing, ...base };
    }
    const named = ecols.findIndex((name, j) => map[j] === null && ucols.some((u) => u.toLowerCase() === name.toLowerCase()));
    if (named !== -1) return { verdict: 'wrong', code: 'column_values', column: ecols[named], ...base };
    return { verdict: 'wrong', code: 'rows_differ', ...base };
  }

  return { verdict: 'wrong', code: 'row_count', ...base };
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

const GENERIC = {
  empty: 'No rows came back. If you filtered on text, the match is exact: capitals and spaces count.',
  extra_columns: 'The rows are right but you returned {gotCols} columns, not {expCols}. SELECT * brings back every column; name only the ones the question asks for.',
  wrong_order: 'Right rows, wrong order. The question asks for biggest first.',
  sign_flip: '{column} has the right figures with the opposite sign. The question asks for {signNote}.',
  missing_columns: 'The question asks for {expCols} columns and you returned {gotCols}. Missing: {missing}.',
  column_values: 'The column {column} does not hold the expected values. Check the calculation behind it.',
  rows_differ: 'Right number of rows, but the values are not the expected ones.',
  row_count: 'Expected {expRowsText}, got {gotRowsText}.',
};

// Turn a compare() result into the message shown to the user. Drill
// pitfalls are checked first, against counts computed by the generator.
export function diagnose(result, { drill, user, pitfalls = [], lang }) {
  if (result.verdict === 'correct') return null;
  const vars = {
    got: result.gotRows,
    ...result,
    missing: (result.missing || []).join(', '),
    expRowsText: plural(result.expRows, 'row'),
    gotRowsText: plural(result.gotRows, 'row'),
    signNote: drill.signNote || 'the difference the right way round',
  };
  for (const p of pitfalls) {
    if (p.drill !== drill.id || p.lang !== lang || !p.message) continue;
    if (p.match === 'rows' && result.gotRows === p.row_count && result.gotRows !== result.expRows) {
      return { code: `pitfall:${p.id}`, message: fill(p.message, vars) };
    }
    if (p.match === 'value' && user.rows.length === 1 && user.rows[0].length === 1 && valEq(normValue(user.rows[0][0]), normValue(p.value))) {
      return { code: `pitfall:${p.id}`, message: fill(p.message, vars) };
    }
  }
  return { code: result.code, message: fill(GENERIC[result.code], vars) };
}

// Fill {tokens} in hint, why and message text from the computed key.
export function countsFrom(data, key) {
  return {
    n_cargoes: data.tables.cargoes.length,
    n_invoices: data.tables.invoices.length,
    n_counterparties: data.tables.counterparties.length,
    n_breaks: Object.values(key.planted).reduce((s, list) => s + list.length, 0),
    n_break_types: Object.keys(key.planted).length,
  };
}
