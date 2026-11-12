// SQL tab engine: AlaSQL, in the browser, no network.
// Every run gets a fresh copy of the tables, so a DELETE or UPDATE cannot
// damage the data for the next run.

const RESERVED_HINTS = {
  TOTAL: 'total_tonnage',
  COUNT: 'invoice_count',
  SUM: 'sum_tonnage',
  VALUE: 'usd_value',
};

export function createSqlEngine(alasql, tables) {
  const tableNames = Object.keys(tables);
  const knownColumns = new Set(tableNames.flatMap((t) => Object.keys(tables[t][0] || {})));
  const listTables = joinWords(tableNames);

  function fresh() {
    const db = new alasql.Database();
    for (const name of tableNames) db.tables[name] = { data: structuredClone(tables[name]) };
    return db;
  }

  function run(source) {
    const sql = source.trim();
    if (!sql) return fail('empty', 'Write a query first, then run it.');

    let ast;
    try {
      ast = alasql.parse(sql);
    } catch (e) {
      return fail('parse', cleanParseError(e.message, sql));
    }

    const preflight = inspect(ast);
    if (preflight) return preflight;

    let out;
    try {
      out = fresh().exec(sql);
    } catch (e) {
      return fail('runtime', cleanRuntimeError(e.message));
    }

    // Several statements: check the last one
    if (Array.isArray(out) && ast.statements.length > 1) out = out[out.length - 1];
    if (!Array.isArray(out)) {
      return fail('not_select', 'Only SELECT queries are checked. Each run starts from a fresh copy of the tables, so nothing you change is kept.');
    }
    const columns = [];
    for (const row of out) for (const k of Object.keys(row)) if (!columns.includes(k)) columns.push(k);
    return { ok: true, columns, rows: out.map((r) => columns.map((c) => r[c])) };
  }

  // Catch what AlaSQL lets through silently or reports badly.
  function inspect(ast) {
    const nodes = [];
    walk(ast, nodes);
    const aliases = new Set(nodes.filter((n) => typeof n.as === 'string').map((n) => n.as));
    const tableRefs = new Set(nodes.filter((n) => typeof n.tableid === 'string' && !('columnid' in n)).map((n) => n.tableid));

    for (const t of tableRefs) {
      if (!tableNames.includes(t)) {
        const near = tableNames.find((n) => n.toLowerCase() === t.toLowerCase() || n.startsWith(t) || t.startsWith(n.slice(0, -1)));
        return fail('no_table', `There is no table called ${t}.${near ? ` Did you mean ${near}?` : ''} The tables are ${listTables}.`);
      }
    }

    for (const n of nodes) {
      if (!(n instanceof alasql.yy.Column)) continue;
      const col = n.columnid;
      if (col === '*' || typeof col !== 'string') continue;
      if (knownColumns.has(col) || aliases.has(col)) continue;
      const lower = [...knownColumns].find((k) => k === col.toLowerCase());
      const msg = lower
        ? `There is no column called ${col}. Column names are lower case here: ${lower}.`
        : `There is no column called ${col}. This engine returns blanks instead of an error for a misspelt column, so check the spelling against the tables below.`;
      return fail('no_column', msg);
    }

    for (const st of ast.statements || []) {
      if (st.where && containsAggregate(st.where)) {
        return fail('where_aggregate', 'WHERE runs before the groups are made, so it cannot see a COUNT or SUM. The count does not exist yet. Filter groups with HAVING, after GROUP BY.');
      }
    }
    return null;
  }

  function containsAggregate(node) {
    const found = [];
    walk(node, found);
    return found.some((n) => n instanceof alasql.yy.AggrValue);
  }

  return { run, fresh };
}

function walk(node, out, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (!Array.isArray(node)) out.push(node);
  for (const k of Object.keys(node)) walk(node[k], out, seen);
}

function fail(code, message) {
  return { ok: false, error: { code, message } };
}

function joinWords(list) {
  return list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

export function cleanParseError(raw, sql) {
  const got = /got '([^']+)'/.exec(raw)?.[1];
  if (got && RESERVED_HINTS[got] && new RegExp(`\\bAS\\s+${got}\\b`, 'i').test(sql)) {
    return `${got.toLowerCase()} is a reserved word in this SQL engine, so it cannot be a column name. Use something like AS ${RESERVED_HINTS[got]}.`;
  }
  const lines = raw.split('\n');
  const caret = lines.findIndex((l) => /^-*\^$/.test(l));
  // AlaSQL cuts the snippet mid word and prefixes it with dots; drop the fragment
  const near = caret > 0 ? lines[caret - 1].replace(/^\.\.\.\S*\s*/, '').trim() : '';
  if (got === 'EOF') return `The query ends too early, after: ${near}. Something is missing at the end, often a value after WHERE or a closing bracket.`;
  return `The SQL could not be read near: ${near}${got ? `. The problem is at ${got}` : ''}. Check commas between columns, quotes around text and matching brackets.`;
}

export function cleanRuntimeError(raw) {
  const first = String(raw).split('\n')[0];
  const table = /Table does not exist: (\S+)/.exec(first)?.[1];
  if (table) return `There is no table called ${table}.`;
  return `The query did not run: ${first}. Check it against the tables below.`;
}
