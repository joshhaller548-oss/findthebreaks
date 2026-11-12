// Small DOM helpers. No framework.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const loading = new Map();
export function loadScript(src) {
  if (!loading.has(src)) {
    loading.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.append(s);
    }));
  }
  return loading.get(src);
}

const NUMBER = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 6 });
const DECIMAL = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const MONEY = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatCell(column, v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? String(v) : v.toISOString().slice(0, 16).replace('T', ' ');
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (/price/.test(column)) return MONEY.format(v);
    if (/usd/.test(column) && !Number.isInteger(v)) return MONEY.format(v);
    return Number.isInteger(v) ? NUMBER.format(v) : DECIMAL.format(v);
  }
  return String(v);
}

export function dataTable(columns, rows, { caption, limit = 200 } = {}) {
  const shown = rows.slice(0, limit);
  const numeric = columns.map((_, j) => rows.length > 0 && rows.every((r) => r[j] === null || r[j] === undefined || typeof r[j] === 'number'));
  return h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': caption || 'Table' },
    h('table', { class: 'data' },
      caption ? h('caption', {}, caption) : null,
      h('thead', {}, h('tr', {}, columns.map((c, j) => h('th', { scope: 'col', class: numeric[j] ? 'num' : null }, c)))),
      h('tbody', {}, shown.map((r) => h('tr', {}, r.map((v, j) => {
        const text = formatCell(columns[j], v);
        return text === null
          ? h('td', { class: 'null' }, 'NULL')
          : h('td', { class: numeric[j] ? 'num' : null }, text);
      })))),
    ),
    rows.length > limit ? h('p', { class: 'muted small' }, `Showing the first ${limit} of ${rows.length} rows.`) : null,
  );
}

export const pad2 = (n) => String(n).padStart(2, '0');
export const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
};
