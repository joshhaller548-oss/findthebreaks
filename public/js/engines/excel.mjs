// Excel tab engine: HyperFormula, in the browser, no network.
//
// The workbook has one sheet per table, header in row 1, data from row 2.
// A drill's frame adds formula columns to the right of one sheet. The user
// writes each formula for row 2 and it is filled down to the last row, the
// way double-clicking the fill handle does. A keep column works like a
// filter on TRUE. Every run builds a fresh workbook.

const TRUTHY_TEXT_FALSE = new Set(['', 'false']);

export const letter = (index) => {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const isError = (v) => v !== null && typeof v === 'object' && 'type' in v && 'value' in v;

// Where each frame column and the total cell live on the sheet
export function layout(frame, tables) {
  const headers = Object.keys(tables[frame.base][0]);
  const n = tables[frame.base].length;
  const columns = (frame.columns || []).map((c, k) => ({ ...c, col: headers.length + k, letter: letter(headers.length + k) }));
  const total = frame.total
    ? { ...frame.total, col: headers.length, letter: letter(headers.length), row: n + 2, cell: `${letter(headers.length)}${n + 3}` }
    : null;
  return { base: frame.base, headers, n, columns, total, lastRow: n + 1 };
}

// Make phone and European input acceptable: curly quotes become straight,
// and semicolons between arguments become commas (outside text).
export function normaliseFormula(raw) {
  let f = String(raw ?? '').trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  let out = '';
  let inText = false;
  for (const ch of f) {
    if (ch === '"') inText = !inText;
    out += !inText && ch === ';' ? ',' : ch;
  }
  return out;
}

const stripText = (f) => f.replace(/"[^"]*"/g, '""');

export function createExcelEngine(HyperFormula, tables) {
  const names = Object.keys(tables);
  const known = new Set(HyperFormula.getRegisteredFunctionNames('enGB').map((s) => s.toUpperCase()));
  const sheetList = names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  function build() {
    const sheets = {};
    for (const n of names) {
      const headers = Object.keys(tables[n][0]);
      sheets[n] = [headers, ...tables[n].map((r) => headers.map((c) => r[c]))];
    }
    return HyperFormula.buildFromSheets(
      sheets,
      { licenseKey: 'gpl-v3', useArrayArithmetic: true },
      [{ name: 'TRUE', expression: '=TRUE()' }, { name: 'FALSE', expression: '=FALSE()' }],
    );
  }

  // inputs: { [columnName]: formula, total: formula }
  function run(inputs, frame) {
    const L = layout(frame, tables);
    const cells = [...L.columns.map((c) => ({ ...c, address: `${c.letter}2` })), ...(L.total ? [{ ...L.total, name: 'total', address: L.total.cell }] : [])];
    const formulas = {};

    for (const c of cells) {
      const raw = normaliseFormula(inputs?.[c.name]);
      if (!raw) {
        if (c.role === 'helper') continue;
        return fail('empty', `Write a formula in ${c.address} (${c.label || c.name}) first, then run it.`, c.address);
      }
      if (!raw.startsWith('=')) return fail('no_equals', `${c.address} holds text, not a formula. Start it with =, as in Excel.`, c.address);
      const pre = precheck(raw, c);
      if (pre) return pre;
      formulas[c.name] = raw;
    }

    const hf = build();
    const sheet = hf.getSheetId(L.base);
    try {
      // Fill down by copy and paste, which shifts relative references the
      // way Excel does. HyperFormula does not allow paste inside a batch, so
      // the pasted block doubles each time to keep the number of pastes low.
      const cols = L.columns.filter((c) => formulas[c.name]);
      hf.batch(() => {
        for (const c of cols) hf.setCellContents({ sheet, row: 1, col: c.col }, [[formulas[c.name]]]);
      });
      for (const c of cols) {
        let filled = 1;
        while (filled < L.n) {
          const take = Math.min(filled, L.n - filled);
          hf.copy({ start: { sheet, row: 1, col: c.col }, end: { sheet, row: take, col: c.col } });
          hf.paste({ sheet, row: 1 + filled, col: c.col });
          filled += take;
        }
      }
      if (L.total && formulas.total) hf.setCellContents({ sheet, row: L.total.row, col: L.total.col }, [[formulas.total]]);
    } catch (e) {
      return fail('engine', `The spreadsheet engine could not take that formula: ${e.message}`);
    }

    const base = tables[L.base];
    const headers = L.headers;
    const grid = base.map((r, i) => ({
      excelRow: i + 2,
      base: headers.map((h) => r[h]),
      user: L.columns.map((c) => (formulas[c.name] ? hf.getCellValue({ sheet, row: i + 1, col: c.col }) : null)),
    }));
    const totalValue = L.total ? hf.getCellValue({ sheet, row: L.total.row, col: L.total.col }) : undefined;
    hf.destroy();

    const view = { base: L.base, headers, columns: L.columns, total: L.total, grid, totalValue, kept: null };
    const keepIdx = L.columns.findIndex((c) => c.role === 'keep');
    const notes = [];

    let rows = grid;
    if (keepIdx !== -1) {
      const keepCol = L.columns[keepIdx];
      const errored = grid.filter((g) => isError(g.user[keepIdx]));
      if (errored.length === grid.length) {
        return failCell(errored[0].user[keepIdx], `${keepCol.letter}${errored[0].excelRow}`, formulas[keepCol.name], view, 'every row');
      }
      if (errored.length) {
        const first = errored[0];
        const what = describeRow(L.base, first.base, headers);
        notes.push(`${plural(errored.length, 'row')} gave ${first.user[keepIdx].value} in the keep column and ${errored.length === 1 ? 'was' : 'were'} left out, as a filter on TRUE would leave ${errored.length === 1 ? 'it' : 'them'} out. The first is row ${first.excelRow}${what}.`);
      }
      rows = grid.filter((g) => truthy(g.user[keepIdx]));
      view.kept = new Set(rows.map((g) => g.excelRow));
    }

    if (L.total) {
      if (isError(totalValue)) {
        // Report where the error starts, not the total it spilled into
        for (const g of grid) {
          const k = g.user.findIndex(isError);
          if (k !== -1) {
            const c = L.columns[k];
            return failCell(g.user[k], `${c.letter}${g.excelRow}`, formulas[c.name], view, null, `${describeRow(L.base, g.base, headers)}, and the total picks it up`);
          }
        }
        return failCell(totalValue, L.total.cell, formulas.total, view);
      }
      return { ok: true, columns: [frame.total.name], rows: [[totalValue]], notes, view };
    }

    // Value cells on the rows that count must not be errors
    for (const g of rows) {
      for (let k = 0; k < L.columns.length; k++) {
        const c = L.columns[k];
        if (c.role === 'keep' || !frame.project.includes(c.name)) continue;
        if (isError(g.user[k])) return failCell(g.user[k], `${c.letter}${g.excelRow}`, formulas[c.name], view, null, describeRow(L.base, g.base, headers));
      }
    }

    const pick = (g, name) => {
      const b = headers.indexOf(name);
      if (b !== -1) return g.base[b];
      return g.user[L.columns.findIndex((c) => c.name === name)];
    };
    return { ok: true, columns: [...frame.project], rows: rows.map((g) => frame.project.map((name) => pick(g, name))), notes, view };
  }

  // Problems worth catching before the engine runs
  function precheck(f, c) {
    const plain = stripText(f);
    for (const [, fn] of plain.matchAll(/([A-Za-z][A-Za-z0-9.]*)\s*\(/g)) {
      if (!known.has(fn.toUpperCase())) {
        return fail('unknown_function', `${fn.toUpperCase()} is not a function this engine knows. Check the spelling. Most Excel functions work here, including VLOOKUP, INDEX, MATCH, XLOOKUP, SUMIFS, COUNTIFS, SUMPRODUCT and IFERROR.`, c.address);
      }
    }
    // A single cell in row 1 is the header. Ranges like F1:F30 are a separate mistake.
    const header = /(^|[^A-Za-z0-9$:!])\$?([A-Za-z]{1,2})\$?1(?![0-9:])(?!\s*:)/.exec(plain);
    if (header) {
      const ref = `${header[2].toUpperCase()}1`;
      return fail('header_row', `${c.address} refers to ${ref}, which is the header row. Formulas here are written for row 2 and filled down, so refer to ${header[2].toUpperCase()}2.`, c.address);
    }
    return null;
  }

  function failCell(err, address, formula, view, scope, rowText = '') {
    const where = scope === 'every row' ? `Every row in that column shows ${err.value}, starting at ${address}` : `${address} shows ${err.value}${rowText}`;
    return { ok: false, error: { code: `cell_${err.type}`, cell: address, message: `${where}. ${explainError(err, formula, sheetList)}` }, view };
  }

  return { run, layout: (frame) => layout(frame, tables) };
}

function truthy(v) {
  if (v === true) return true;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return !TRUTHY_TEXT_FALSE.has(v.trim().toLowerCase());
  return false;
}

function describeRow(base, values, headers) {
  const id = values[0];
  return id ? ` (${headers[0]} ${id})` : '';
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function fail(code, message, cell) {
  return { ok: false, error: { code, message, cell } };
}

export function explainError(err, formula = '', sheetList = 'the three sheets') {
  const msg = err.message || '';
  switch (err.type) {
    case 'NA':
      return '#N/A means a lookup found nothing. Check that the match is exact (FALSE as the last argument of VLOOKUP, 0 for MATCH), that you are looking in the column that holds the value, and that the value has no stray spaces. If no match is the expected answer, wrap the lookup in IFERROR or test it with ISNA.';
    case 'NAME': {
      const named = /Named expression (\S+) not recognized/.exec(msg)?.[1];
      if (named) return `${named} is not a cell, a sheet or a function. Text has to go in double quotes, like "Puerto Bolivar".`;
      return 'A name in the formula is not recognised. Check function names and put text in double quotes.';
    }
    case 'REF':
      return `That points at a sheet that does not exist. The sheets are ${sheetList}, written like invoices!B:B.`;
    case 'VALUE':
      if (/equal length/i.test(msg)) return 'The ranges in this formula are different sizes. In SUMIFS, COUNTIFS and SUMPRODUCT every range must cover the same rows.';
      if (/SUMPRODUCT/i.test(formula) && /![A-Z]{1,2}:\$?[A-Z]{1,2}\b/i.test(formula)) return 'A whole column like invoices!D:D includes the header text in row 1, which cannot be multiplied. Use ranges that start at row 2.';
      return 'Something in the formula is text where a number is needed, often a header cell or an ID.';
    case 'CYCLE':
      return 'The formula refers to its own cell, so it can never finish. A total over a whole column includes the total cell itself; sum the rows above it instead.';
    case 'DIV_BY_ZERO':
      return 'The formula divides by zero.';
    case 'SPILL':
      return 'The formula returns a whole column of values instead of one. Wrap it in a function that gives one answer per row, like COUNTIF or SUMPRODUCT.';
    case 'ERROR':
      return 'The formula could not be read. Check brackets, commas between arguments and double quotes around text.';
    case 'NUM':
      return 'A number in the formula is out of range.';
    default:
      return msg || 'The formula did not work.';
  }
}
