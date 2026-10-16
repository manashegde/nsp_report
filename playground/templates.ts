import { createGroup, createTemplate, metricExpression, uid, type ReportTemplate, type TextElement, type AnyElement } from '../src';
import { tagSummarySource, telemetrySource } from './data';

const text = (p: Partial<TextElement>): TextElement => ({ id: uid(), type: 'text', x: 0, y: 0, width: 100, height: 20, ...p });

/** A grouped sales report showing parameters, summaries, percentages and conditional formatting. */
export function salesReport(): ReportTemplate {
  const t = createTemplate('Sales by Category');
  t.dataSource = 'orders';
  t.currency = 'USD';
  t.locale = 'en-US';
  t.parameters = [
    { name: 'Region', label: 'Region', type: 'string', lookup: 'regions', description: 'Leave empty for all regions' },
    { name: 'From', label: 'From date', type: 'date', defaultValue: '2024-01-01' },
    { name: 'To', label: 'To date', type: 'date', defaultValue: '2024-12-31' },
    { name: 'MinAmount', label: 'Min line amount', type: 'number', defaultValue: 0 },
  ];
  t.calculatedFields = [{ name: 'Amount', expression: '[Quantity] * [UnitPrice] * (1 - [Discount])', type: 'number' }];
  t.filter = '[OrderDate] >= ?From and [OrderDate] <= ?To and [Amount] >= ?MinAmount';
  t.sort = [{ expression: '[OrderDate]', direction: 'asc' }];

  const W = 718;
  const b = t.bands;
  b.reportHeader!.height = 74;
  b.reportHeader!.elements.push(
    { id: uid(), type: 'shape', shape: 'rectangle', x: 0, y: 0, width: W, height: 62, fill: '#1e3a8a', stroke: '#1e3a8a', strokeWidth: 0, radius: 6 } as AnyElement,
    text({ x: 16, y: 10, width: 420, height: 28, text: 'Sales by Category', style: { fontSize: 18, bold: true, color: '#ffffff' } }),
    text({ x: 16, y: 36, width: 460, height: 18, text: "{Iif(IsNullOrEmpty(?Region), 'All regions', ?Region)} · {?From:dd MMM yyyy} – {?To:dd MMM yyyy}", style: { fontSize: 9, color: '#c7d2fe' } }),
    text({ x: W - 220, y: 14, width: 204, height: 34, expression: 'Sum([Amount])', format: 'c0', style: { fontSize: 18, bold: true, color: '#ffffff', textAlign: 'right' } }),
  );

  b.pageHeader!.height = 26;
  b.pageHeader!.backgroundColor = '#f1f5f9';
  const cols = [
    { x: 0, w: 70, label: 'Order #', expr: '[OrderId]', fmt: 'd' },
    { x: 70, w: 80, label: 'Date', expr: '[OrderDate]', fmt: 'dd/MM/yyyy' },
    { x: 150, w: 150, label: 'Customer', expr: '[Customer.Name]' },
    { x: 300, w: 130, label: 'Product', expr: '[Product]' },
    { x: 430, w: 50, label: 'Qty', expr: '[Quantity]', right: true },
    { x: 480, w: 80, label: 'Amount', expr: '[Amount]', fmt: 'c2', right: true },
    { x: 560, w: 70, label: '% of cat.', expr: "PercentOfTotal([Amount], 'group')", fmt: 'p1', right: true },
    { x: 630, w: 88, label: 'Running', expr: 'RunningSum([Amount])', fmt: 'n0', right: true },
  ];
  for (const c of cols) {
    b.pageHeader!.elements.push(text({ x: c.x, y: 3, width: c.w, height: 20, text: c.label, style: { bold: true, fontSize: 9, color: '#334155', textAlign: c.right ? 'right' : 'left', padding: 4 } }));
    b.detail.elements.push(
      text({
        x: c.x,
        y: 0,
        width: c.w,
        height: 18,
        expression: c.expr,
        format: c.fmt,
        style: { fontSize: 9, textAlign: c.right ? 'right' : 'left', padding: 4 },
        conditionalStyles: c.label === 'Amount' ? [{ condition: '[Amount] > 500', style: { bold: true, color: '#15803d' } }] : undefined,
      }),
    );
  }
  b.detail.height = 18;
  b.detail.alternateBackgroundColor = '#f8fafc';

  const g = createGroup('[Category]', 'Category');
  g.header!.height = 28;
  g.header!.repeatOnEveryPage = true;
  g.header!.elements.push(
    text({ x: 0, y: 6, width: 400, height: 20, text: '{[Category]}', style: { bold: true, fontSize: 11, color: '#1e3a8a' } }),
    text({ x: 400, y: 6, width: W - 400, height: 20, text: '{Count()} orders · {PercentOfTotal([Amount]):p1} of total', style: { fontSize: 9, color: '#64748b', textAlign: 'right' } }),
    { id: uid(), type: 'line', x: 0, y: 24, width: W, height: 4, direction: 'horizontal', color: '#93c5fd', thickness: 1 } as AnyElement,
  );
  g.footer!.height = 26;
  g.footer!.elements.push(
    text({ x: 300, y: 3, width: 130, height: 20, text: 'Category total', style: { bold: true, fontSize: 9, textAlign: 'right', padding: 4 } }),
    text({ x: 430, y: 3, width: 50, height: 20, expression: "Sum([Quantity], 'group')", format: 'n0', style: { bold: true, fontSize: 9, textAlign: 'right', padding: 4, border: { width: 1, color: '#94a3b8', sides: { top: true } } } }),
    text({ x: 480, y: 3, width: 80, height: 20, expression: "Sum([Amount], 'group')", format: 'c2', style: { bold: true, fontSize: 9, textAlign: 'right', padding: 4, border: { width: 1, color: '#94a3b8', sides: { top: true } } } }),
    text({ x: 560, y: 3, width: 70, height: 20, expression: "Avg([Amount], 'group')", format: 'n2', style: { fontSize: 8, color: '#64748b', textAlign: 'right', padding: 4 } }),
  );
  t.groups.push(g);

  b.reportFooter!.height = 60;
  b.reportFooter!.elements.push(
    { id: uid(), type: 'line', x: 0, y: 8, width: W, height: 4, direction: 'horizontal', color: '#1e3a8a', thickness: 2 } as AnyElement,
    text({ x: 300, y: 16, width: 130, height: 20, text: 'Grand total', style: { bold: true, textAlign: 'right', padding: 4 } }),
    text({ x: 430, y: 16, width: 50, height: 20, expression: "Sum([Quantity], 'report')", format: 'n0', style: { bold: true, textAlign: 'right', padding: 4 } }),
    text({ x: 480, y: 16, width: 120, height: 20, expression: "Sum([Amount], 'report')", format: 'c2', style: { bold: true, textAlign: 'right', padding: 4 } }),
    text({ x: 0, y: 38, width: 500, height: 18, text: '{Count()} orders · avg {Avg([Amount]):c2} · max {Max([Amount]):c2} · {CountIf(not [Paid])} unpaid', style: { fontSize: 8, color: '#64748b' } }),
    { id: uid(), type: 'progress', x: 560, y: 40, width: 158, height: 12, props: { value: 'CountIf([Paid]) / Count()', color: '#16a34a' } } as AnyElement,
  );

  b.pageFooter!.height = 24;
  b.pageFooter!.elements.push(
    text({ x: 0, y: 4, width: 300, height: 16, text: 'Printed {Now():g}', style: { fontSize: 7, color: '#94a3b8' } }),
    text({ x: W - 200, y: 4, width: 200, height: 16, text: 'Page {PageNumber} of {TotalPages}', style: { fontSize: 7, color: '#94a3b8', textAlign: 'right' } }),
  );
  return t;
}

interface EnergyMixOptions {
  name: string;
  subtitle: string;
  dataSource: string;
  /** Site and date fields of the data source. */
  site: string;
  date: string;
  /** Expression for a tag's metric column. */
  metric: (tag: string) => string;
  dataFilters: Record<string, unknown>;
  filter?: string;
}

const MIX_COLUMNS = [
  { tag: 'grid_import_kwh', label: 'Grid import' },
  { tag: 'solar_ac_kw', label: 'Solar' },
  { tag: 'bess_discharge_kw', label: 'BESS out' },
  { tag: 'genset_kw', label: 'Genset' },
  { tag: 'site_load_kw', label: 'Load' },
];

/**
 * "Site energy mix": one row per site per month, one metric column per tag —
 * built the same way the designer's "Add metric column" does.
 */
function energyMix(o: EnergyMixOptions): ReportTemplate {
  const cols = MIX_COLUMNS;
  const t = createTemplate(o.name);
  t.dataSource = o.dataSource;
  t.locale = 'en-IN';
  t.dataFilters = o.dataFilters;
  t.parameters = [
    { name: 'From', label: 'From', type: 'date', defaultValue: '2026-08-01' },
    { name: 'To', label: 'To', type: 'date', defaultValue: '2026-09-29' },
  ];
  t.filter = o.filter;
  const W = 718;
  t.bands.reportHeader!.height = 50;
  t.bands.reportHeader!.elements.push(
    text({ x: 0, y: 4, width: 500, height: 28, text: o.name, style: { fontSize: 17, bold: true, color: '#0f766e' } }),
    text({ x: 0, y: 30, width: 500, height: 16, text: '{?From:dd MMM yyyy} – {?To:dd MMM yyyy} · ' + o.subtitle, style: { fontSize: 9, color: '#64748b' } }),
  );
  const ph = t.bands.pageHeader!;
  ph.height = 26;
  ph.backgroundColor = '#f1f5f4';
  ph.elements.push(text({ x: 0, y: 3, width: 160, height: 20, text: 'Month', style: { bold: true, fontSize: 9, padding: 4 } }));
  const colW = Math.floor((W - 160 - 90) / cols.length);
  cols.forEach((c, i) =>
    ph.elements.push(text({ x: 160 + i * colW, y: 3, width: colW, height: 20, text: c.label, style: { bold: true, fontSize: 9, padding: 4, textAlign: 'right' } })),
  );
  ph.elements.push(text({ x: W - 90, y: 3, width: 90, height: 20, text: 'Renewable %', style: { bold: true, fontSize: 9, padding: 4, textAlign: 'right' } }));
  t.bands.detail.height = 0;

  const site = createGroup(`[${o.site}]`, 'Site');
  site.header!.height = 26;
  site.header!.elements.push(text({ x: 0, y: 4, width: 400, height: 20, text: `{[${o.site}]}`, style: { bold: true, fontSize: 11, color: '#0f766e' } }));
  site.footer!.height = 24;
  site.footer!.elements.push(text({ x: 0, y: 2, width: 160, height: 20, text: 'Site total', style: { bold: true, fontSize: 9, padding: 4 } }));
  const month = createGroup(`Format([${o.date}], 'yyyy-MM')`, 'Month');
  month.header = undefined;
  month.footer!.height = 20;
  month.footer!.elements.push(text({ x: 0, y: 0, width: 160, height: 20, expression: `[${o.date}]`, format: 'MMM yyyy', style: { fontSize: 9, padding: 4 } }));
  cols.forEach((c, i) => {
    const expr = o.metric(c.tag);
    month.footer!.elements.push(text({ x: 160 + i * colW, y: 0, width: colW, height: 20, expression: expr, format: 'n0', exportName: c.label, style: { fontSize: 9, padding: 4, textAlign: 'right' } }));
    site.footer!.elements.push(text({ x: 160 + i * colW, y: 2, width: colW, height: 20, expression: expr, format: 'n0', style: { fontSize: 9, padding: 4, textAlign: 'right', bold: true, border: { width: 1, color: '#94a3b8', sides: { top: true } } } }));
  });
  const renewable = 'Percent(' + o.metric('solar_ac_kw') + ' + ' + o.metric('bess_discharge_kw') + ', ' + o.metric('site_load_kw') + ')';
  month.footer!.elements.push(text({ x: W - 90, y: 0, width: 90, height: 20, expression: renewable, format: 'p1', exportName: 'Renewable %', style: { fontSize: 9, padding: 4, textAlign: 'right' } }));
  site.footer!.elements.push(text({ x: W - 90, y: 2, width: 90, height: 20, expression: renewable, format: 'p1', style: { fontSize: 9, padding: 4, textAlign: 'right', bold: true } }));
  t.groups.push(site, month);
  t.bands.pageFooter!.elements.push(text({ x: W - 200, y: 4, width: 200, height: 16, text: 'Page {PageNumber} of {TotalPages}', style: { fontSize: 7, color: '#94a3b8', textAlign: 'right' } }));
  return t;
}

/** On raw daily readings, aggregated in the browser — fine for small data. */
export function siteEnergyMixReport(): ReportTemplate {
  const m = telemetrySource.metrics!;
  return energyMix({
    name: 'Site energy mix',
    subtitle: 'kWh',
    dataSource: 'tagReadings',
    site: 'site',
    date: 'timestamp',
    metric: (tag) => metricExpression(m, tag, 'energyKwh', 'sum'),
    dataFilters: { tagIds: MIX_COLUMNS.map((c) => c.tag) },
    filter: '[timestamp] >= ?From and [timestamp] <= ?To',
  });
}

/** The same report on pre-aggregated rows: the backend returns one row per site × month × tag. */
export function siteEnergyMixSummaryReport(): ReportTemplate {
  const m = tagSummarySource.metrics!;
  return energyMix({
    name: 'Site energy mix (pre-aggregated)',
    subtitle: 'kWh · aggregated per month on the server',
    dataSource: 'tagSummary',
    site: 'siteName',
    date: 'period',
    metric: (tag) => metricExpression(m, tag, 'value', 'sum'),
    dataFilters: { tagIds: MIX_COLUMNS.map((c) => c.tag), granularity: 'month' },
  });
}
