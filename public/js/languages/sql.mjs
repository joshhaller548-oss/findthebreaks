// SQL tab. Each language is one module with this shape; the page lists them
// in one array, so a tab is added or removed in one place.

import { createSqlEngine } from '../engines/sql.mjs';
import { h, loadScript, dataTable } from '../dom.mjs';
import { plural } from '../check.mjs';

export const sqlLanguage = {
  id: 'sql',
  label: 'SQL',
  note: 'This SQL engine reserves the word total: AS total fails, AS total_tonnage works. Run with Ctrl+Enter or Cmd+Enter.',
  async load(tables) {
    await loadScript('/vendor/alasql-4.21.1.min.js');
    return createSqlEngine(window.alasql, tables);
  },
  run: (engine, source) => engine.run(source),
  modelAnswer: (drill) => drill.sql,

  editor({ drill, value, onChange, onRun }) {
    const area = h('textarea', {
      class: 'editor',
      spellcheck: 'false',
      autocapitalize: 'off',
      autocomplete: 'off',
      'aria-label': `SQL answer for drill ${drill.id}`,
      placeholder: 'SELECT ...\nFROM ...',
      rows: '8',
      oninput: (e) => onChange(e.target.value),
      onkeydown: (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onRun();
        }
      },
    });
    area.value = value || '';
    const result = h('div', { class: 'result' });
    return {
      input: area,
      result,
      value: () => area.value,
      show(out) {
        result.replaceChildren(out.ok ? dataTable(out.columns, out.rows, { caption: `Your result: ${plural(out.rows.length, 'row')}` }) : '');
      },
    };
  },
};
