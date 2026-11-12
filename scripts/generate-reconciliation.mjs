// Generates the reconciliation dataset and its answer key.
//
//   public/data/reconciliation.json      the three tables every language reads
//   public/data/reconciliation.key.json  the planted breaks, plus the expected result
//                                        of every drill, computed by running
//                                        the SQL model answers in AlaSQL
//
// Seeded, so a rerun produces byte identical output. Run verify afterwards.

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { drills, pitfalls } from '../public/js/drills/reconciliation.mjs';

const require = createRequire(import.meta.url);
const alasql = require('alasql');

const SEED = 20260611;

// mulberry32
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const round2 = (x) => Math.round(x * 100) / 100;

const isoDate = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
};

// ---------- counterparties ----------

// All six are invented and were checked against web search for real firms
// of the same name. Ports and grades are real.

const counterparties = [
  { counterparty: 'Vallenor Carbones SA',         country: 'Colombia',     credit_limit_usd: 25000000, payment_terms_days: 30 },
  { counterparty: 'Marquesa Bulk Trading Ltd',       country: 'Colombia',     credit_limit_usd: 40000000, payment_terms_days: 30 },
  { counterparty: 'PT Selindo Bara Nusantara',      country: 'Indonesia',    credit_limit_usd: 15000000, payment_terms_days: 15 },
  { counterparty: 'Sondela Ridge Coal (Pty) Ltd', country: 'South Africa', credit_limit_usd: 20000000, payment_terms_days: 20 },
  { counterparty: 'Halvetter Energiehandel GmbH', country: 'Germany',     credit_limit_usd: 35000000, payment_terms_days: 45 },
  { counterparty: 'Selvira Enerji Ticaret AS',  country: 'Turkey',       credit_limit_usd: 18000000, payment_terms_days: 60 },
];

// Producers ship from their own coast. The two utilities buy from anywhere.
const portsFor = {
  'Vallenor Carbones SA': ['Puerto Bolivar', 'Santa Marta', 'Barranquilla'],
  'Marquesa Bulk Trading Ltd': ['Puerto Bolivar', 'Santa Marta'],
  'PT Selindo Bara Nusantara': ['Balikpapan'],
  'Sondela Ridge Coal (Pty) Ltd': ['Richards Bay'],
  'Halvetter Energiehandel GmbH': ['Puerto Bolivar', 'Santa Marta', 'Richards Bay'],
  'Selvira Enerji Ticaret AS': ['Puerto Bolivar', 'Barranquilla', 'Balikpapan', 'Richards Bay'],
};
const incotermsFor = {
  'Vallenor Carbones SA': ['FOB'],
  'Marquesa Bulk Trading Ltd': ['FOB'],
  'PT Selindo Bara Nusantara': ['FOB'],
  'Sondela Ridge Coal (Pty) Ltd': ['FOB'],
  'Halvetter Energiehandel GmbH': ['CIF', 'CFR'],
  'Selvira Enerji Ticaret AS': ['CFR', 'CIF'],
};
const gradesFor = {
  'Puerto Bolivar': ['API 2', 'NAR 5500'],
  'Santa Marta': ['API 2', 'NAR 5500'],
  'Barranquilla': ['NAR 5500'],
  'Balikpapan': ['NAR 4200', 'NAR 5500'],
  'Richards Bay': ['API 4'],
};
// USD per tonne, inside the brief's 82 to 118 range, ordered by calorific value
const priceBand = {
  'NAR 4200': [82, 89],
  'NAR 5500': [90, 101],
  'API 4': [99, 110],
  'API 2': [106, 118],
};

const vessels = [
  'Pacific Venture', 'Cape Orchid', 'Star Magdalena', 'Nord Harmony', 'Golden Kalimantan',
  'Ocean Pioneer', 'Sea Falcon', 'Atlantic Grace', 'Bulk Andes', 'Ionian Spirit',
  'Coral Bay', 'Mineral Hope', 'Iron Meridian', 'Santa Catalina', 'Bright Horizon',
  'Kota Mutiara', 'Aegean Trader', 'Rio Cesar', 'Silver Tern', 'Baltic Wave',
  'Zulu Star', 'Morning Glory', 'Great Condor', 'Thor Venture',
];

// Weighted so drill 2 has a clear spread of totals
const cpSchedule = shuffle([
  ...Array(7).fill('Vallenor Carbones SA'),
  ...Array(6).fill('Marquesa Bulk Trading Ltd'),
  ...Array(5).fill('PT Selindo Bara Nusantara'),
  ...Array(4).fill('Sondela Ridge Coal (Pty) Ltd'),
  ...Array(5).fill('Halvetter Energiehandel GmbH'),
  ...Array(3).fill('Selvira Enerji Ticaret AS'),
]);

// ---------- cargoes ----------

const H1_START = '2026-01-05';
const cargoes = [];
const vesselLastUsed = new Map();
for (let n = 0; n < 30; n++) {
  const counterparty = cpSchedule[n];
  const load_port = pick(portsFor[counterparty]);
  const grade = pick(gradesFor[load_port]);
  const [lo, hi] = priceBand[grade];
  // contract prices in 5 cent steps
  const contract_price = round2(int(lo * 20, hi * 20) / 20);
  // laycans spread across January to mid June, cargo IDs in laycan order
  const laycan_start = addDays(H1_START, Math.round(n * 5.6) + int(0, 2));
  const laycan_end = addDays(laycan_start, 9);
  let vessel;
  do {
    vessel = pick(vessels);
  } while (vesselLastUsed.has(vessel) && n - vesselLastUsed.get(vessel) < 12);
  vesselLastUsed.set(vessel, n);
  cargoes.push({
    cargo_id: `CRG-${1001 + n}`,
    vessel,
    counterparty,
    load_port,
    grade,
    bl_tonnage: int(45000, 75000),
    laycan_start,
    laycan_end,
    incoterm: pick(incotermsFor[counterparty]),
    contract_price,
  });
}

// ---------- choose where the breaks go ----------

// Avoid the first two and last two cargoes so no break looks like a timing artefact.
const candidates = shuffle(cargoes.slice(2, 28).map((c) => c.cargo_id));
const missingIds = candidates.slice(0, 3).sort();
const duplicateId = candidates[3];
const tonnageIds = candidates.slice(4, 6).sort();
const priceId = candidates[6];
const ORPHAN_CARGO_ID = 'CRG-1031';

const byId = new Map(cargoes.map((c) => [c.cargo_id, c]));

// Transpose the two middle digits of a 5 digit tonnage, a keying error.
const transpose = (t) => {
  const s = String(t).split('');
  for (let i = 1; i < 4; i++) {
    if (s[i] !== s[i + 1]) {
      [s[i], s[i + 1]] = [s[i + 1], s[i]];
      return Number(s.join(''));
    }
  }
  throw new Error('no transposable digits in ' + t);
};

const planted = {
  missing_invoice: missingIds.map((id) => ({
    cargo_id: id,
    note: 'Cargo shipped, no invoice raised.',
  })),
  orphan_invoice: [],
  duplicate_invoice: [{ cargo_id: duplicateId, note: 'Invoiced twice under two invoice numbers, identical amounts.' }],
  tonnage_mismatch: [],
  price_mismatch: [],
};

// ---------- invoices ----------

const draft = [];
for (const c of cargoes) {
  if (missingIds.includes(c.cargo_id)) continue;
  const inv = {
    cargo_id: c.cargo_id,
    counterparty: c.counterparty,
    invoiced_tonnage: c.bl_tonnage,
    invoiced_price: c.contract_price,
    invoice_date: addDays(c.laycan_end, int(4, 18)),
  };
  if (c.cargo_id === tonnageIds[0]) {
    inv.invoiced_tonnage = transpose(c.bl_tonnage);
    planted.tonnage_mismatch.push({
      cargo_id: c.cargo_id,
      bl_tonnage: c.bl_tonnage,
      invoiced_tonnage: inv.invoiced_tonnage,
      note: 'Two digits transposed when keying the invoice.',
    });
  }
  if (c.cargo_id === tonnageIds[1]) {
    // invoiced on the nominated quantity, rounded to the nearest 5,000 MT
    let nominated = Math.round(c.bl_tonnage / 5000) * 5000;
    if (nominated === c.bl_tonnage) nominated += 5000;
    inv.invoiced_tonnage = nominated;
    planted.tonnage_mismatch.push({
      cargo_id: c.cargo_id,
      bl_tonnage: c.bl_tonnage,
      invoiced_tonnage: inv.invoiced_tonnage,
      note: 'Invoiced on the nominated quantity, not the BL figure.',
    });
  }
  if (c.cargo_id === priceId) {
    inv.invoiced_price = round2(c.contract_price - 2.15);
    planted.price_mismatch.push({
      cargo_id: c.cargo_id,
      contract_price: c.contract_price,
      invoiced_price: inv.invoiced_price,
      note: 'Invoiced at a superseded provisional price, USD 2.15 below contract.',
    });
  }
  draft.push(inv);
  if (c.cargo_id === duplicateId) {
    draft.push({ ...inv, invoice_date: addDays(inv.invoice_date, int(9, 15)) });
  }
}

// Orphan: a cargo finance invoiced that the trading book does not hold.
const orphanCp = pick(counterparties).counterparty;
draft.push({
  cargo_id: ORPHAN_CARGO_ID,
  counterparty: orphanCp,
  invoiced_tonnage: int(45000, 75000),
  invoiced_price: round2(int(95 * 20, 105 * 20) / 20),
  invoice_date: '2026-06-24',
});

// Invoice numbers run in date order, as a finance system would issue them.
draft.sort((a, b) => a.invoice_date.localeCompare(b.invoice_date) || a.cargo_id.localeCompare(b.cargo_id));
const invoices = draft.map((d, k) => ({
  invoice_no: `INV-26-${String(141 + k).padStart(4, '0')}`,
  cargo_id: d.cargo_id,
  counterparty: d.counterparty,
  invoiced_tonnage: d.invoiced_tonnage,
  invoiced_price: d.invoiced_price,
  invoice_date: d.invoice_date,
}));

planted.orphan_invoice.push({
  invoice_no: invoices.find((i) => i.cargo_id === ORPHAN_CARGO_ID).invoice_no,
  cargo_id: ORPHAN_CARGO_ID,
  note: 'Invoice raised against a cargo ID the trading book does not hold.',
});
planted.duplicate_invoice[0].invoice_nos = invoices
  .filter((i) => i.cargo_id === duplicateId)
  .map((i) => i.invoice_no);

// ---------- answer key: run the model answers ----------

const tables = { cargoes, invoices, counterparties };
const db = new alasql.Database();
for (const [name, rows] of Object.entries(tables)) {
  db.tables[name] = { data: structuredClone(rows) };
}
const run = (sql) => {
  const rows = db.exec(sql);
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return { columns, rows: rows.map((r) => columns.map((c) => r[c])) };
};

const expected = {};
for (const d of drills) {
  if (!d.sql) continue;
  expected[d.id] = { ordered: d.ordered, ...run(d.sql) };
}
const pitfallResults = pitfalls.map((p) => {
  const r = run(p.sql);
  const out = { drill: p.drill, id: p.id, lang: p.lang, match: p.match, row_count: r.rows.length, column_count: r.columns.length };
  if (p.match === 'value') out.value = r.rows[0][0];
  return out;
});

// ---------- write ----------

const data = {
  generated_by: 'scripts/generate-reconciliation.mjs',
  seed: SEED,
  tables,
};
const key = {
  generated_by: 'scripts/generate-reconciliation.mjs',
  seed: SEED,
  engine: `alasql ${alasql.version}`,
  planted,
  expected,
  pitfalls: pitfallResults,
};

writeFileSync(new URL('../public/data/reconciliation.json', import.meta.url), JSON.stringify(data, null, 2) + '\n');
writeFileSync(new URL('../public/data/reconciliation.key.json', import.meta.url), JSON.stringify(key, null, 2) + '\n');
console.log(`Wrote ${cargoes.length} cargoes, ${invoices.length} invoices, ${counterparties.length} counterparties.`);
console.log(`Answer key: ${Object.keys(expected).length} drills, ${pitfallResults.length} pitfalls, engine alasql ${alasql.version}.`);
