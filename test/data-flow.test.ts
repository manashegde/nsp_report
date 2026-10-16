import { describe, expect, it, vi } from 'vitest';
import {
  createMemoryTemplateStore,
  createRestDataSource,
  createRestTemplateStore,
  createTagSummarySource,
  createTemplate,
  DataLimitError,
  evaluateExpression,
  getFields,
  loadData,
  metricAggregatesFor,
  metricExpression,
  toLocalIsoString,
  type DataSourceMetrics,
  type ReportDataSource,
} from '../src/core';

const metrics: DataSourceMetrics = {
  keyField: 'tagId',
  valueFields: [
    { name: 'energy', label: 'Energy' },
    { name: 'value', label: 'Value', parts: { sum: 'sum', count: 'count', min: 'min', max: 'max' } },
  ],
};

// Two days of a pre-aggregated tag: day 1 has 2 readings summing to 10, day 2 has 1 reading of 30.
const summaryRows = [
  { tagId: 'pv', sum: 10, count: 2, min: 4, max: 6 },
  { tagId: 'pv', sum: 30, count: 1, min: 30, max: 30 },
  { tagId: 'grid', sum: 100, count: 4, min: 10, max: 40 },
];

describe('pre-aggregated metric columns', () => {
  it('re-aggregates parts correctly (average = total sum / total count)', () => {
    const ev = (agg: Parameters<typeof metricExpression>[3]) => evaluateExpression(metricExpression(metrics, 'pv', 'value', agg), { rows: summaryRows });
    expect(ev('sum')).toBe(40);
    expect(ev('count')).toBe(3);
    expect(ev('avg')).toBeCloseTo(40 / 3); // not the average of daily averages (5 + 30) / 2
    expect(ev('min')).toBe(4);
    expect(ev('max')).toBe(30);
  });

  it('keeps raw-value expressions unchanged', () => {
    expect(metricExpression(metrics, 'pv', 'energy', 'avg')).toBe("AvgIf([energy], [tagId] = 'pv')");
    expect(metricExpression(metrics, "o'neil", 'energy', 'count')).toBe("CountIf([tagId] = 'o''neil')");
  });

  it('gives no average when a tag has no readings', () => {
    expect(evaluateExpression(metricExpression(metrics, 'missing', 'value', 'avg'), { rows: summaryRows })).toBe(null);
  });

  it('offers only the aggregates whose parts exist', () => {
    expect(metricAggregatesFor(metrics.valueFields[0]).map((a) => a.value)).toEqual(['sum', 'avg', 'max', 'min', 'count']);
    expect(metricAggregatesFor({ name: 'v', label: 'V', parts: { sum: 's', max: 'm' } }).map((a) => a.value)).toEqual(['sum', 'max']);
  });
});

describe('data sources', () => {
  it('resolves filter-dependent field lists (wide data)', () => {
    const ds: ReportDataSource = {
      name: 'wide',
      fields: ({ filters }) => [
        { name: 'site', type: 'string' },
        ...((filters?.tagIds as string[] | undefined) ?? []).map((t) => ({ name: t, type: 'number' as const })),
      ],
    };
    expect(getFields(ds, { tagIds: ['pv', 'grid'] }).map((f) => f.name)).toEqual(['site', 'pv', 'grid']);
    expect(getFields(ds).map((f) => f.name)).toEqual(['site']);
  });

  it('refuses results above maxRows', async () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ i }));
    await expect(loadData({ name: 'big', data: rows, maxRows: 10 }, { parameters: {} })).rejects.toBeInstanceOf(DataLimitError);
    await expect(loadData({ name: 'big', data: rows, maxRows: Infinity }, { parameters: {} })).resolves.toHaveLength(11);
  });

  it('describes the standard tag-summary contract', () => {
    const ds = createTagSummarySource({ data: summaryRows });
    expect(ds.name).toBe('tagSummary');
    expect(getFields(ds).map((f) => f.name)).toEqual(['siteId', 'siteName', 'period', 'tagId', 'tagName', 'unit', 'sum', 'count', 'min', 'max']);
    expect(ds.filters?.find((f) => f.name === 'granularity')?.options?.map((o) => o.value)).toContain('month');
    expect(metricExpression(ds.metrics!, 'pv', 'value', 'avg')).toBe("SumIf([sum], [tagId] = 'pv') / SumIf([count], [tagId] = 'pv')");
  });
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('createRestDataSource', () => {
  it('posts parameters and filters with local dates and returns rows', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => json([{ a: 1 }]));
    const ds = createRestDataSource({ name: 'energy', url: '/rows', fetch: fetch as unknown as typeof globalThis.fetch, headers: () => ({ Authorization: 'Bearer x' }) });
    const from = new Date(2026, 6, 1);
    const rows = await loadData(ds, { parameters: { From: from }, filters: { tagIds: ['pv'] } });
    expect(rows).toEqual([{ a: 1 }]);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/rows');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer x');
    expect(JSON.parse(String(init?.body))).toEqual({ parameters: { From: toLocalIsoString(from) }, filters: { tagIds: ['pv'] } });
    expect(toLocalIsoString(from).startsWith('2026-07-01T00:00:00')).toBe(true);
  });

  it('refuses truncated results unless the host handles them', async () => {
    const body = { rows: [{ a: 1 }], truncated: true, rowLimit: 50000 };
    const strict = createRestDataSource({ name: 'energy', url: '/rows', fetch: (async () => json(body)) as unknown as typeof fetch });
    await expect(loadData(strict, { parameters: {} })).rejects.toBeInstanceOf(DataLimitError);

    const onTruncated = vi.fn();
    const lenient = createRestDataSource({ name: 'energy', url: '/rows', onTruncated, fetch: (async () => json(body)) as unknown as typeof fetch });
    await expect(loadData(lenient, { parameters: {} })).resolves.toEqual([{ a: 1 }]);
    expect(onTruncated).toHaveBeenCalledWith({ dataSource: 'energy', rowLimit: 50000 });
  });

  it('surfaces server error messages (ProblemDetails)', async () => {
    const ds = createRestDataSource({ name: 'energy', url: '/rows', fetch: (async () => json({ title: 'Forbidden site' }, 403)) as unknown as typeof fetch });
    await expect(loadData(ds, { parameters: {} })).rejects.toThrow('Forbidden site');
  });
});

describe('template stores filter by status', () => {
  const template = createTemplate('R');

  it('memory store', async () => {
    const store = createMemoryTemplateStore();
    await store.save({ name: 'Draft', status: 'draft', template });
    await store.save({ name: 'Live', status: 'published', template });
    expect((await store.list()).length).toBe(2);
    expect((await store.list({ status: 'published' })).map((t) => t.name)).toEqual(['Live']);
  });

  it('REST store asks the server for the status', async () => {
    const fetch = vi.fn(async (_url: string) => json([{ id: '1', name: 'Live', status: 'published' }, { id: '2', name: 'Leaked', status: 'draft' }]));
    const store = createRestTemplateStore({ baseUrl: '/templates/', fetch: fetch as unknown as typeof globalThis.fetch });
    const list = await store.list({ status: 'published' });
    expect(fetch.mock.calls[0][0]).toBe('/templates?status=published');
    // Defence in depth: a server that ignores the query still doesn't leak drafts to the list.
    expect(list.map((t) => t.name)).toEqual(['Live']);
  });
});

describe('raw vs pre-aggregated reports', () => {
  it('print the same monthly and site totals', async () => {
    const { renderReport, resolveParameters } = await import('../src/core');
    const { telemetrySource, tagSummarySource } = await import('../playground/data');
    const { siteEnergyMixReport, siteEnergyMixSummaryReport } = await import('../playground/templates');
    const numbers = async (template: ReturnType<typeof siteEnergyMixReport>, ds: ReportDataSource) => {
      const parameters = resolveParameters(template);
      const rows = await loadData(ds, { parameters, filters: template.dataFilters });
      const doc = renderReport(template, rows, { parameters, locale: 'en-IN' });
      // Body cells only: skip the report title/subtitle, which differ between the two.
      return doc.pages.flatMap((p) => p.items).flatMap((i) => (i.kind === 'text' ? [i.lines.join(' ')] : [])).slice(2);
    };
    const raw = await numbers(siteEnergyMixReport(), telemetrySource);
    const summary = await numbers(siteEnergyMixSummaryReport(), tagSummarySource);
    expect(raw.length).toBeGreaterThan(20);
    expect(summary.length).toBe(raw.length);
    // Same figures; float sums in a different order may round a .5 the other way.
    const num = (s: string) => Number(s.replace(/[,%]/g, ''));
    summary.forEach((s, i) => {
      if (Number.isNaN(num(s))) expect(s).toBe(raw[i]);
      else expect(Math.abs(num(s) - num(raw[i]))).toBeLessThanOrEqual(1);
    });
  });
});
