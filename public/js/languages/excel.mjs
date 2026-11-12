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

function sheetView(L, tables, out) {
  const view = out?.view;
  const errCell = out && !out.ok ? out.error?.cell : null;
  const base = tables[L.base];
  const cols = [...L.headers.map((name, i) => ({ name, letter: letter(i), user: false })), ...L.columns.map((c) => ({ name: c.name, letter: c.letter, user: true, type: c.type }))];
  const head = h('tr', {}, h('th', { class: 'corner', scope: 'col' }, ''), cols.map((c) => h('th', { scope: 'col', class: c.user ? 'user' : null }, c.letter)));
  const names = h('tr', { class: 'names' }, h('th', { scope: 'row', class: 'rownum' }, '1'), cols.map((c) => h('td', { class: c.user ? 'user' : null }, c.name)));
  const body = base.map((r, i) => {
    const excelRow = i + 2;
    const g = view?.grid?.[i];
    const kept = view?.kept?.has(excelRow);
    return h('tr', { class: kept ? 'kept' : null },
      h('th', { scope: 'row', class: 'rownum' }, kept ? `▸${excelRow}` : String(excelRow)),
      cols.map((c, k) => {
        const v = c.user ? g?.user?.[k - L.headers.length] : r[c.name];
        const cell = `${c.letter}${excelRow}`;
        const cls = [c.user ? 'user' : '', typeof v === 'number' ? 'num' : '', isError(v) ? 'err' : '', cell === errCell ? 'err-focus' : ''].filter(Boolean).join(' ');
        return h('td', { class: cls || null }, display(c.name, v, c.type));
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
  // The caption sits outside the scrolling area, which starts scrolled right
  const wrap = h('div', { class: 'table-wrap sheet-wrap', tabindex: '0', role: 'region', 'aria-label': caption },
    h('table', { class: 'data sheet' }, h('thead', {}, head), h('tbody', {}, rows)),
  );
  // Show the formula columns, which sit at the right edge
  requestAnimationFrame(() => { wrap.scrollLeft = wrap.scrollWidth; });
  return h('div', {}, h('p', { class: 'sheet-caption' }, caption, keptCount ? h('span', { class: 'muted' }, ', marked \u25B8 and shaded') : null), wrap);
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
    const result = h('div', { class: 'result' }, sheetView(L, tables, null));
    return {
      input,
      result,
      value: () => ({ ...state }),
      show(out) {
        result.replaceChildren(sheetView(L, tables, out));
      },
    };
  },
};
