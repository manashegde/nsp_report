import { describe, expect, it } from 'vitest';
import { evaluateExpression, createEnv } from './evaluator';
import { validateExpression } from './expression';
import { formatValue } from './format';
import { renderReport } from './layout';
import { createGroup, createTabularTemplate, createTemplate, uid } from './template';
import { documentToCsv } from '../export/csv';
import type { RenderedText, ReportTemplate, TextElement } from './types';

const rows = [
  { Region: 'East', Product: 'A', Amount: 100, Qty: 2, Date: new Date(2024, 0, 5) },
  { Region: 'West', Product: 'B', Amount: 300, Qty: 1, Date: new Date(2024, 1, 5) },
  { Region: 'East', Product: 'C', Amount: 200, Qty: 5, Date: new Date(2024, 2, 5) },
  { Region: 'West', Product: 'D', Amount: 400, Qty: 3, Date: new Date(2024, 3, 5) },
];

const texts = (doc: ReturnType<typeof renderReport>, page = 0) =>
  doc.pages[page].items.filter((i): i is RenderedText => i.kind === 'text').map((t) => t.lines.join(' '));

describe('expressions', () => {
  it('evaluates arithmetic, strings and logic', () => {
    expect(evaluateExpression('1 + 2 * 3')).toBe(7);
    expect(evaluateExpression("'a' + 1")).toBe('a1');
    expect(evaluateExpression('[Amount] * [Qty]', { row: rows[0] })).toBe(200);
    expect(evaluateExpression("Iif([Amount] > 150, 'big', 'small')", { row: rows[0] })).toBe('small');
    expect(evaluateExpression('not ([Qty] = 2) or false', { row: rows[0] })).toBe(false);
    expect(evaluateExpression('?Min <= [Amount]', { row: rows[0], params: { Min: 50 } })).toBe(true);
    expect(evaluateExpression("Upper(Substring('hello', 1, 3))")).toBe('ELL');
    expect(evaluateExpression('10 / 0')).toBe(null);
  });

  it('computes aggregates over a scope', () => {
    expect(evaluateExpression('Sum([Amount])', { rows })).toBe(1000);
    expect(evaluateExpression('Avg([Amount])', { rows })).toBe(250);
    expect(evaluateExpression('Count()', { rows })).toBe(4);
    expect(evaluateExpression('CountDistinct([Region])', { rows })).toBe(2);
    expect(evaluateExpression('Max([Amount]) - Min([Amount])', { rows })).toBe(300);
    expect(evaluateExpression("SumIf([Amount], [Region] = 'East')", { rows })).toBe(300);
    expect(evaluateExpression('PercentOfTotal([Amount])', { row: rows[1], rows })).toBeCloseTo(0.3);
  });

  it('supports calculated fields', () => {
    const env = createEnv({ calculatedFields: [{ name: 'Total', expression: '[Amount] * [Qty]' }] });
    expect(evaluateExpression('Sum([Total])', { rows, env })).toBe(200 + 300 + 1000 + 1200);
  });

  it('reports syntax errors', () => {
    expect(validateExpression('[Amount] +')).toMatch(/Unexpected end/);
    expect(validateExpression("Sum([A], 'group')")).toBeNull();
  });
});

describe('format', () => {
  it('formats numbers', () => {
    expect(formatValue(1234.5, 'n2', { locale: 'en-US' })).toBe('1,234.50');
    expect(formatValue(0.256, 'p1', { locale: 'en-US' })).toBe('25.6%');
    expect(formatValue(12.5, 'c2', { locale: 'en-US', currency: 'USD' })).toBe('$12.50');
    expect(formatValue(1234.5, '#,##0.0', { locale: 'en-US' })).toBe('1,234.5');
    expect(formatValue(7, 'd3')).toBe('007');
  });
  it('formats dates', () => {
    expect(formatValue(new Date(2024, 2, 9), 'yyyy-MM-dd')).toBe('2024-03-09');
    expect(formatValue('2024-03-09', 'dd/MM/yyyy')).toBe('09/03/2024');
  });
});

function text(p: Partial<TextElement>): TextElement {
  return { id: uid(), type: 'text', x: 0, y: 0, width: 200, height: 20, ...p };
}

describe('layout', () => {
  it('renders groups with group and report totals and percentages', () => {
    const t: ReportTemplate = createTemplate('Sales');
    const g = createGroup('[Region]', 'Region');
    g.header!.elements.push(text({ text: 'Region {[Region]}' }));
    g.footer!.elements.push(text({ expression: 'Sum([Amount])', id: 'gsum' }));
    g.footer!.elements.push(text({ x: 300, expression: "PercentOfTotal([Amount])", format: 'p0' }));
    t.groups.push(g);
    t.bands.detail.elements.push(text({ expression: '[Product]' }));
    t.bands.detail.elements.push(text({ x: 300, expression: 'RunningSum([Amount])' }));
    t.bands.reportFooter!.elements.push(text({ expression: "'Total ' + Sum([Amount])" }));
    t.bands.pageFooter!.elements.push(text({ text: 'Page {PageNumber} of {TotalPages}' }));

    const doc = renderReport(t, rows, { locale: 'en-US' });
    expect(doc.warnings).toEqual([]);
    expect(doc.pages).toHaveLength(1);
    const out = texts(doc);
    expect(out).toContain('Region East');
    expect(out).toContain('Region West');
    expect(out).toContain('300'); // East total
    expect(out).toContain('700'); // West total
    expect(out).toContain('30%');
    expect(out).toContain('70%');
    expect(out).toContain('Total 1000');
    expect(out).toContain('Page 1 of 1');
    // Running sum restarts per group: East A=100, C=300
    expect(out.indexOf('A')).toBeLessThan(out.indexOf('C'));
  });

  it('paginates and repeats page headers', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ N: i + 1 }));
    const t = createTemplate('Long');
    t.bands.pageHeader!.elements.push(text({ text: 'HEADER' }));
    t.bands.detail.elements.push(text({ expression: '[N]' }));
    t.bands.pageFooter!.elements.push(text({ text: '{PageNumber}/{TotalPages}', id: 'pf' }));
    t.bands.pageFooter!.elements.push(text({ x: 300, expression: "Sum([N], 'page')" }));
    const doc = renderReport(t, many);
    expect(doc.pages.length).toBeGreaterThan(3);
    for (let p = 0; p < doc.pages.length; p++) {
      expect(texts(doc, p)).toContain('HEADER');
      expect(texts(doc, p)).toContain(`${p + 1}/${doc.pages.length}`);
    }
    // Page sums add up to the grand total.
    const pageSums = doc.pages.map((_, p) => Number(texts(doc, p).at(-1)));
    expect(pageSums.reduce((a, b) => a + b, 0)).toBe((200 * 201) / 2);
  });

  it('splits inline formats on the first top-level colon', () => {
    const t = createTemplate('Fmt');
    t.bands.detail.elements.push(text({ width: 400, text: "{[D]:dd/MM/yyyy HH:mm} | {Iif([N] > 1, 'a:b', 'c')} | {[N]:n2}" }));
    const doc = renderReport(t, [{ D: new Date(2024, 2, 9, 14, 5), N: 3 }], { locale: 'en-US' });
    expect(texts(doc)).toContain('09/03/2024 14:05 | a:b | 3.00');
  });

  it('grows text and shifts elements below', () => {
    const t = createTemplate('Grow');
    t.bands.detail.height = 20;
    t.bands.detail.elements.push(text({ width: 60, expression: '[Long]', canGrow: true }));
    t.bands.detail.elements.push(text({ y: 20, width: 60, text: 'below' }));
    const doc = renderReport(t, [{ Long: 'word '.repeat(30) }]);
    const items = doc.pages[0].items.filter((i): i is RenderedText => i.kind === 'text');
    const grown = items[0];
    const below = items[1];
    expect(grown.height).toBeGreaterThan(20);
    expect(below.y).toBeGreaterThanOrEqual(grown.y + grown.height - 0.5);
  });

  it('applies filters with parameters and builds CSV', () => {
    const t = createTabularTemplate({
      name: 'Tab',
      dataSource: 'sales',
      fields: [
        { name: 'Product' },
        { name: 'Amount', type: 'number' },
      ],
      totals: ['Amount'],
    });
    t.parameters.push({ name: 'MinAmount', type: 'number', defaultValue: 150 });
    t.filter = '[Amount] >= ?MinAmount';
    const doc = renderReport(t, rows, { locale: 'en-US' });
    expect(doc.rows).toHaveLength(3);
    const csv = documentToCsv(doc);
    expect(csv.split('\r\n')[0]).toBe('Product,Amount');
    expect(csv).toContain('B,300.00');
    expect(documentToCsv(doc, { mode: 'data' }).split('\r\n')[0]).toBe('Region,Product,Amount,Qty,Date');
  });
});

describe('pdf text encoding', async () => {
  const { toWinAnsi } = await import('../export/pdf');
  it('maps text to the standard-font charset', () => {
    expect(toWinAnsi('CO₂ avoided – 5 m²')).toBe('CO2 avoided – 5 m2');
    expect(toWinAnsi('€ 12 · naïve')).toBe('€ 12 · naïve');
    expect(toWinAnsi('漢字')).toBe('??');
  });
});
