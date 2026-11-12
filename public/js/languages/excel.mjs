// Excel tab. The user writes formulas for row 2 of one sheet; the engine
// fills them down and the sheet shows the result, with kept rows marked.

import { createExcelEngine, layout, letter, serialToStamp } from '../engines/excel.mjs';
import { h, loadScript, formatCell } from '../dom.mjs';
import { fill } from '../check.mjs';

const isError = (v) => v !== null && typeof v === 'object' && 'type' in v && 'value' in v;

function parse(value) {
  if (value && typeof value === 'object') return { ...value };
  try {
    const v = JSON.parse(value || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function roleText(c) {
  if (c.role === 'keep') return 'TRUE for the rows to keep';
  if (c.role === 'helper') return 'optional working column';
  return `the ${c.name} for that row`;
}

function display(column, v, type) {
  if (type === 'datetime' && typeof v === 'number') return serialToStamp(v);
  if (v === true) return 'TRUE';
  if (v === false) return 'FALSE';
  if (isError(v)) return v.value;
  if (v === null || v === undefined || v === '') return '';
  return formatCell(column, v) ?? '';
}

// The base-sheet columns a drill works from: column A, the columns its
// answer returns, and every same-sheet column the model formulas refer to.
// References into other sheets (stoppages!$A$2:...) do not count.
export function usedColumns(drill, L) {
  const used = new Set([0]);
  for (const name of drill.excel.project || []) {
    const i = L.headers.indexOf(name);
    if (i >= 0) used.add(i);
  }
  const index = (col) => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  for (const f of Object.values(drill.excel.model || {})) {
    const local = String(f).replace(/[A-Za-z_]+!\$?[A-Z]{1,3}\$?(\d+|\{\w+\})?(:\$?[A-Z]{1,3}\$?(\d+|\{\w+\})?)?/g, ' ');
    for (const m of local.matchAll(/\$?\b([A-Z]{1,3})\$?(\d+)\b/g)) {
      const i = index(m[1]);
      if (i < L.headers.length) used.add(i);
    }
  }
  return used;
}

// opts.visible: the base columns to show (all when absent); hidden runs are
// marked as Excel marks hidden columns. opts.scrollRight opens the sheet on
// the formula columns. opts.toggle draws the show all / used columns switch.
function sheetView(L, tables, out, opts = {}) {
  const view = out?.view;
  const errCell = out && !out.ok ? out.error?.cell : null;
  const base = tables[L.base];
  const show = (i) => !opts.visible || opts.visible.has(i);
  const baseCols = L.headers.map((name, i) => ({ name, i, letter: letter(i), user: false })).filter((c) => show(c.i));
  baseCols.forEach((c, k) => { c.gap = k > 0 && baseCols[k - 1].i !== c.i - 1; });
  const userCols = L.columns.map((c, u) => ({ name: c.name, letter: c.letter, user: true, type: c.type, role: c.role, u }));
  if (userCols.length && baseCols.length && baseCols[baseCols.length - 1].i !== L.headers.length - 1) userCols[0].gap = true;
  const cols = [...baseCols, ...userCols];
  const cls = (c, more = '') => [c.user ? 'user' : '', c.gap ? 'gap-before' : '', more].filter(Boolean).join(' ') || null;
  // On a compact sheet a date and time breaks onto two lines, so time
  // columns stay narrow
  const stampOf = (t) => (opts.compact && typeof t === 'string' ? /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(t) : null);
  const head = h('tr', {}, h('th', { class: 'corner', scope: 'col' }, ''), cols.map((c) => h('th', { scope: 'col', class: cls(c), 'data-col': c.letter }, c.letter)));
  // Long column names may break after an underscore, so a column is only as
  // wide as its data
  const breakable = (name) => name.split('_').flatMap((part, i, a) => (i < a.length - 1 ? [`${part}_`, h('wbr', {})] : [part]));
  const names = h('tr', { class: 'names' }, h('th', { scope: 'row', class: 'rownum' }, '1'), cols.map((c) => h('td', { class: cls(c), 'data-col': c.letter }, breakable(c.name))));
  const body = base.map((r, i) => {
    const excelRow = i + 2;
    const g = view?.grid?.[i];
    const kept = view?.kept?.has(excelRow);
    return h('tr', { class: kept ? 'kept' : null },
      h('th', { scope: 'row', class: 'rownum' }, kept ? `▸${excelRow}` : String(excelRow)),
      cols.map((c) => {
        const v = c.user ? g?.user?.[c.u] : r[c.name];
        const cell = `${c.letter}${excelRow}`;
        const t = display(c.name, v, c.type);
        const st = stampOf(t);
        return h('td', { class: cls(c, [typeof v === 'number' ? 'num' : '', isError(v) ? 'err' : '', cell === errCell ? 'err-focus' : '', st ? 'dt' : ''].filter(Boolean).join(' ')), 'data-col': c.letter }, st ? [h('span', { class: 'nw' }, st[1]), ' ', h('span', { class: 'nw' }, st[2])] : t);
      }),
    );
  });
  const rows = [names, ...body];
  if (L.total) {
    const blank = h('tr', {}, h('th', { scope: 'row', class: 'rownum' }, String(L.n + 2)), cols.map(() => h('td', {}, '')));
    const v = view?.totalValue;
    const totalRow = h('tr', { class: 'total' }, h('th', { scope: 'row', class: 'rownum' }, String(L.n + 3)),
      cols.map((c, k) => {
        if (k === L.total.col - 1) return h('td', { class: 'label' }, 'total');
        if (k === L.total.col) return h('td', { class: ['user', 'num', isError(v) ? 'err' : '', L.total.cell === errCell ? 'err-focus' : ''].filter(Boolean).join(' ') }, display('usd', v));
        return h('td', {}, '');
      }));
    rows.push(blank, totalRow);
  }
  const keptCount = view?.kept ? view.kept.size : null;
  const caption = `${L.base} sheet${keptCount !== null ? `, ${keptCount} row${keptCount === 1 ? '' : 's'} kept` : ''}`;
  // The caption sits outside the scrolling area
  const wrap = h('div', { class: 'table-wrap sheet-wrap', tabindex: '0', role: 'region', 'aria-label': caption },
    h('table', { class: 'data sheet' }, h('thead', {}, head), h('tbody', {}, rows)),
  );
  // Where every column shows, open on the formula columns at the right edge
  if (opts.scrollRight) requestAnimationFrame(() => { wrap.scrollLeft = wrap.scrollWidth; });
  // Otherwise, on a sheet wider than the page, pin the answer columns to the
  // right edge while the data scrolls between them and column A, if they
  // leave room for the data. Optional working columns scroll with the data.
  if (opts.pinAnswers) {
    requestAnimationFrame(() => {
      if (wrap.scrollWidth <= wrap.clientWidth + 1) return;
      const pin = userCols.filter((c) => c.role !== 'helper');
      const width = (c) => wrap.querySelector(`thead th[data-col="${c.letter}"]`)?.getBoundingClientRect().width ?? 0;
      const left = wrap.querySelector('thead th.corner').getBoundingClientRect().width + width(baseCols[0]);
      const total = pin.reduce((n, c) => n + width(c), 0);
      if (!pin.length || left + total > wrap.clientWidth * 0.75) return;
      let right = 0;
      for (const c of [...pin].reverse()) {
        for (const cell of wrap.querySelectorAll(`[data-col="${c.letter}"]`)) {
          cell.classList.add('pinned');
          cell.style.right = `${right}px`;
        }
        right += width(c);
      }
      wrap.querySelectorAll(`[data-col="${pin[0].letter}"]`).forEach((cell) => cell.classList.add('pinned-edge'));
    });
  }
  return h('div', {},
    h('p', { class: 'sheet-caption' }, caption, keptCount ? h('span', { class: 'muted' }, ', marked \u25B8 and shaded') : null,
      opts.toggle ? h('span', { class: 'sheet-toggle' },
        h('span', { class: 'muted' }, opts.visible ? ' \u00B7 showing the columns this drill uses ' : ' \u00B7 all columns '),
        h('button', { class: 'btn quiet small', type: 'button', onclick: opts.toggle }, opts.visible ? 'Show all columns' : 'Show only the columns used')) : null),
    wrap);
}

export const excelLanguage = {
  id: 'excel',
  label: 'Excel',
  note: (tables) => {
    const names = Object.keys(tables);
    const list = names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    const hasTimes = names.some((n) => tables[n].some((r) => Object.values(r).some((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v))));
    return `Write each formula for row 2. It is filled down to the last row, like double-clicking the fill handle. The sheets are ${list}.${hasTimes ? ' Times are Excel serial numbers, so subtracting two gives days.' : ''} Press Enter to run.`;
  },
  async load(tables) {
    await loadScript('/vendor/hyperformula-3.5.0.full.min.js');
    const HF = window.HyperFormula?.HyperFormula ?? window.HyperFormula;
    return createExcelEngine(HF, tables);
  },
  run: (engine, inputs, drill) => engine.run(inputs, drill.excel),
  ordered: (drill) => drill.excel?.ordered ?? drill.ordered,
  serialise: (v) => JSON.stringify(v),
  generic: {
    empty: 'No rows are kept. Your keep column has to be TRUE for the rows you want.',
    column_values: 'The {column} column does not hold the expected values. Check the formula behind it.',
    rows_differ: 'Right number of rows, but the values are not the expected ones. Check each formula column against a row you can work out by hand.',
  },

  instructions(drill, tables) {
    const L = layout(drill.excel, tables);
    return h('div', { class: 'frame' },
      h('p', {}, `Work on the ${L.base} sheet. Add ${L.columns.length + (L.total ? 1 : 0) === 1 ? 'this formula' : 'these formulas'}:`),
      h('ul', {},
        L.columns.map((c) => h('li', {}, h('code', {}, `${c.letter}2`), ` ${c.name}: ${roleText(c)}`)),
        L.total ? h('li', {}, h('code', {}, L.total.cell), ` ${L.total.label}: one formula for the answer`) : null,
      ),
      drill.excel.note ? h('p', { class: 'muted small' }, drill.excel.note) : null,
    );
  },

  modelAnswer(drill, counts, tables) {
    const L = layout(drill.excel, tables);
    const m = drill.excel.model;
    const lines = L.columns.filter((c) => m[c.name]).map((c) => `${`${c.letter}2`.padEnd(5)}${c.name.padEnd(24)}${fill(m[c.name], counts)}`);
    if (L.total) lines.push(`${L.total.cell.padEnd(5)}${L.total.label.padEnd(24)}${fill(m.total, counts)}`);
    if (L.columns.length) lines.push('', `Row 2 formulas are filled down to row ${L.lastRow}.`);
    return lines.join('\n');
  },

  editor({ drill, tables, value, onChange, onRun }) {
    const L = layout(drill.excel, tables);
    const state = parse(value);
    const fields = [
      ...L.columns.map((c) => ({ key: c.name, cell: `${c.letter}2`, label: c.name, optional: c.role === 'helper' })),
      ...(L.total ? [{ key: 'total', cell: L.total.cell, label: L.total.label }] : []),
    ];
    const input = h('div', { class: 'formulas' }, fields.map((f) => {
      const el = h('input', {
        class: 'formula',
        type: 'text',
        spellcheck: 'false',
        autocapitalize: 'off',
        autocomplete: 'off',
        autocorrect: 'off',
        'aria-label': `Formula for ${f.cell}, ${f.label}`,
        placeholder: f.optional ? '= optional' : '=',
        oninput: (e) => {
          state[f.key] = e.target.value;
          onChange({ ...state });
        },
        onkeydown: (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onRun();
          }
        },
      });
      el.value = state[f.key] || '';
      return h('label', { class: 'formula-row' },
        h('span', { class: 'cell-ref' }, f.cell),
        h('span', { class: 'col-name' }, f.label),
        el,
      );
    }));
    // On a wide sheet, show the columns the drill works from beside the
    // formula columns, starting at column A, with a switch to show them all
    const trim = drill.sheetColumns === 'used';
    const used = trim ? usedColumns(drill, L) : null;
    let all = !trim;
    let lastOut = null;
    const result = h('div', { class: 'result' });
    const draw = () => result.replaceChildren(sheetView(L, tables, lastOut, {
      visible: all ? null : used,
      scrollRight: !trim,
      pinAnswers: trim,
      compact: trim,
      toggle: trim ? () => { all = !all; draw(); } : null,
    }));
    draw();
    return {
      input,
      result,
      value: () => ({ ...state }),
      show(out) {
        lastOut = out;
        draw();
      },
    };
  },
};
