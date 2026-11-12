// SQL tab. Each language is one module with this shape; the page lists them
// in one array, so a tab is added or removed in one place.

import { createSqlEngine } from '../engines/sql.mjs';
import { loadScript } from '../dom.mjs';

export const sqlLanguage = {
  id: 'sql',
  label: 'SQL',
  placeholder: 'SELECT ...\nFROM ...',
  note: 'This SQL engine reserves the word total: AS total fails, AS total_tonnage works. Run with Ctrl+Enter or Cmd+Enter.',
  async load(tables) {
    await loadScript('/vendor/alasql-4.21.1.min.js');
    return createSqlEngine(window.alasql, tables);
  },
  modelAnswer: (drill) => drill.sql,
};
