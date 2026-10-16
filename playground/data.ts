import { createTagSummarySource, toDate, type DataRow, type ReportDataSource } from '../src';

const REGIONS = ['North', 'South', 'East', 'West'];
const CATEGORIES: Record<string, string[]> = {
  Beverages: ['Coffee', 'Green Tea', 'Orange Juice', 'Sparkling Water'],
  Bakery: ['Croissant', 'Bagel', 'Sourdough Loaf'],
  Dairy: ['Cheddar', 'Greek Yogurt', 'Butter'],
  Produce: ['Apples', 'Avocados', 'Spinach', 'Tomatoes'],
};
const CUSTOMERS = ['Acme Corp', 'Globex', 'Initech', 'Umbrella', 'Stark Industries', 'Wayne Enterprises', 'Hooli', 'Soylent'];

function rand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function generateOrders(count = 240): DataRow[] {
  const r = rand(42);
  const cats = Object.keys(CATEGORIES);
  return Array.from({ length: count }, (_, i) => {
    const category = cats[Math.floor(r() * cats.length)];
    const products = CATEGORIES[category];
    const qty = 1 + Math.floor(r() * 20);
    const price = Math.round((2 + r() * 48) * 100) / 100;
    const d = new Date(2024, Math.floor(r() * 12), 1 + Math.floor(r() * 28));
    return {
      OrderId: 10000 + i,
      OrderDate: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      Region: REGIONS[Math.floor(r() * REGIONS.length)],
      Category: category,
      Product: products[Math.floor(r() * products.length)],
      Customer: { Name: CUSTOMERS[Math.floor(r() * CUSTOMERS.length)], Vip: r() > 0.7 },
      Quantity: qty,
      UnitPrice: price,
      Discount: r() > 0.75 ? 0.1 : 0,
      Paid: r() > 0.2,
    };
  });
}

const ORDERS = generateOrders();

export const dataSources: ReportDataSource[] = [
  {
    name: 'orders',
    label: 'Sales orders',
    fields: [
      { name: 'OrderId', label: 'Order #', type: 'number' },
      { name: 'OrderDate', label: 'Order date', type: 'date' },
      { name: 'Region', type: 'string' },
      { name: 'Category', type: 'string' },
      { name: 'Product', type: 'string' },
      { name: 'Customer', type: 'string', fields: [{ name: 'Name', label: 'Customer', type: 'string' }, { name: 'Vip', label: 'VIP', type: 'boolean' }] },
      { name: 'Quantity', type: 'number' },
      { name: 'UnitPrice', label: 'Unit price', type: 'number' },
      { name: 'Discount', type: 'number' },
      { name: 'Paid', type: 'boolean' },
    ],
    // Simulates a backend call that receives the report parameters.
    data: async ({ parameters }) => {
      await new Promise((r) => setTimeout(r, 300));
      const region = parameters.Region as string | null;
      return region ? ORDERS.filter((o) => o.Region === region) : ORDERS;
    },
    sampleData: ORDERS.slice(0, 60),
  },
];

export const parameterLookups = {
  regions: () => REGIONS.map((r) => ({ value: r, label: r })),
};

/* ------------------------------------------------------------------ */
/* Microgrid telemetry: long format, one row per site × tag × day.    */
/* Mirrors the backend's tagReadings dataset.                          */
/* ------------------------------------------------------------------ */

export const TAGS = [
  { tagId: 'grid_import_kwh', tagName: 'Grid import', unit: 'kWh', base: 900 },
  { tagId: 'grid_export_kwh', tagName: 'Grid export', unit: 'kWh', base: 120 },
  { tagId: 'solar_ac_kw', tagName: 'Solar generation', unit: 'kW', base: 650 },
  { tagId: 'bess_discharge_kw', tagName: 'BESS discharge', unit: 'kW', base: 300 },
  { tagId: 'bess_charge_kw', tagName: 'BESS charge', unit: 'kW', base: 320 },
  { tagId: 'genset_kw', tagName: 'Genset generation', unit: 'kW', base: 80 },
  { tagId: 'ev_charger_kw', tagName: 'EV charging', unit: 'kW', base: 140 },
  { tagId: 'site_load_kw', tagName: 'Site load', unit: 'kW', base: 1500 },
];
const SITES = ['Plant A · Mumbai', 'Plant B · Pune'];
const pad2 = (n: number) => String(n).padStart(2, '0');

function generateTelemetry(days = 60): DataRow[] {
  const r = rand(7);
  const rows: DataRow[] = [];
  for (let d = 0; d < days; d++) {
    const day = new Date(2026, 7, 1 + d);
    const iso = day.getFullYear() + '-' + pad2(day.getMonth() + 1) + '-' + pad2(day.getDate());
    SITES.forEach((site, si) =>
      TAGS.forEach((t) => {
        const energy = Math.round(t.base * (0.75 + r() * 0.5) * (1 + si * 0.3) * 10) / 10;
        rows.push({
          timestamp: iso,
          site,
          tagId: t.tagId,
          tagName: t.tagName,
          unit: t.unit,
          energyKwh: energy,
          avg: Math.round((energy / 24) * 100) / 100,
          max: Math.round((energy / 24) * (1.6 + r()) * 100) / 100,
        });
      }),
    );
  }
  return rows;
}

const TELEMETRY = generateTelemetry();

export const telemetrySource: ReportDataSource = {
  name: 'tagReadings',
  label: 'Tag readings (daily)',
  fields: [
    { name: 'timestamp', label: 'Day', type: 'date' },
    { name: 'site', label: 'Site', type: 'string' },
    { name: 'tagId', label: 'Tag ID', type: 'string' },
    { name: 'tagName', label: 'Tag', type: 'string' },
    { name: 'unit', label: 'Unit', type: 'string' },
    { name: 'energyKwh', label: 'Energy (kWh)', type: 'number' },
    { name: 'avg', label: 'Average', type: 'number' },
    { name: 'max', label: 'Maximum', type: 'number' },
  ],
  data: TELEMETRY,
  // The report author picks this application's tags once; viewers can't change it.
  filters: [{ name: 'tagIds', label: 'Tags in this report', type: 'multi', lookup: 'tags', field: 'tagId' }],
  metrics: {
    keyField: 'tagId',
    labelField: 'tagName',
    filter: 'tagIds',
    valueFields: [
      { name: 'energyKwh', label: 'Energy (kWh)', format: 'n0' },
      { name: 'avg', label: 'Average (kW)', format: 'n1' },
      { name: 'max', label: 'Peak (kW)', format: 'n1' },
    ],
  },
};

export const telemetryLookups = {
  tags: () => TAGS.map((t) => ({ value: t.tagId, label: t.tagName + ' (' + t.unit + ')' })),
  sites: () => SITES.map((s) => ({ value: s, label: s })),
};

/* ------------------------------------------------------------------ */
/* The same telemetry pre-aggregated, as a backend rollup returns it:  */
/* one row per site × period × tag (standard tag-summary contract).    */
/* ------------------------------------------------------------------ */

const periodStart = (iso: string, granularity: string) =>
  granularity === 'year' ? iso.slice(0, 4) + '-01-01' : granularity === 'month' ? iso.slice(0, 7) + '-01' : iso;

/** What the backend does: filter by parameters and the author's selection, then GROUP BY site, period, tag. */
function summarize(rows: DataRow[], parameters: Record<string, unknown>, filters: Record<string, unknown> = {}): DataRow[] {
  const from = toDate(parameters.From);
  const to = toDate(parameters.To);
  const tags = new Set((filters.tagIds as string[] | undefined) ?? []);
  const sites = new Set((filters.siteIds as string[] | undefined) ?? []);
  const granularity = String(filters.granularity ?? 'day');
  const out = new Map<string, DataRow & { sum: number; count: number; min: number; max: number }>();
  for (const r of rows) {
    const day = toDate(r.timestamp)!;
    if ((from && day < from) || (to && day > to)) continue;
    if ((tags.size && !tags.has(String(r.tagId))) || (sites.size && !sites.has(String(r.site)))) continue;
    const period = periodStart(String(r.timestamp), granularity);
    const key = `${r.site}|${period}|${r.tagId}`;
    const v = Number(r.energyKwh);
    const acc = out.get(key);
    if (acc) {
      acc.sum += v;
      acc.count += 1;
      acc.min = Math.min(acc.min, v);
      acc.max = Math.max(acc.max, v);
    } else {
      out.set(key, { siteId: r.site, siteName: r.site, period, tagId: r.tagId, tagName: r.tagName, unit: r.unit, sum: v, count: 1, min: v, max: v });
    }
  }
  return [...out.values()];
}

export const tagSummarySource: ReportDataSource = createTagSummarySource({
  label: 'Tag summary (pre-aggregated)',
  valueLabel: 'Daily energy (kWh)',
  format: 'n0',
  // Simulates POST /Reports/datasets/tagSummary/rows; a real host calls its API here
  // (e.g. with createRestDataSource) and the backend aggregates from rollup tables.
  data: async ({ parameters, filters }) => {
    await new Promise((r) => setTimeout(r, 200));
    return summarize(TELEMETRY, parameters, filters);
  },
});
