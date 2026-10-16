import { describe, expect, it, vi } from 'vitest';
import {
  applyDataFilters,
  createLocalStorageTemplateStore,
  createMemoryTemplateStore,
  createRestTemplateStore,
  createTemplate,
  evaluateExpression,
  loadData,
  metricExpression,
  TemplateConflictError,
  type ReportDataSource,
  type ReportTemplateStore,
} from '../src/core';

const input = (name: string, status: 'draft' | 'published' = 'draft') => ({ name, status, category: 'Energy', template: createTemplate(name) });

async function exerciseStore(store: ReportTemplateStore) {
  const a = await store.save(input('Grid report'));
  expect(a.id).toBeTruthy();
  expect(a.version).toBe(1);
  const b = await store.save({ ...input('Solar report', 'published') });
  expect((await store.list()).map((x) => x.name).sort()).toEqual(['Grid report', 'Solar report']);

  const updated = await store.save({ ...input('Grid report v2', 'published'), id: a.id, version: a.version });
  expect(updated.version).toBe(2);
  expect(updated.template.name).toBe('Grid report v2');
  await expect(store.save({ ...input('stale'), id: a.id, version: 1 })).rejects.toBeInstanceOf(TemplateConflictError);

  expect((await store.get(b.id)).status).toBe('published');
  await store.remove(b.id);
  expect((await store.list()).map((x) => x.id)).toEqual([a.id]);
}

describe('template stores', () => {
  it('memory store keeps versions and rejects stale saves', async () => {
    await exerciseStore(createMemoryTemplateStore());
  });

  it('localStorage store persists between instances', async () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    });
    await exerciseStore(createLocalStorageTemplateStore('t'));
    expect((await createLocalStorageTemplateStore('t').list())[0].name).toBe('Grid report v2');
    vi.unstubAllGlobals();
  });

  it('REST store maps routes, auth headers and 409 conflicts', async () => {
    const calls: { url: string; method: string; auth: string | null; body?: unknown }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      calls.push({ url, method: init.method ?? 'GET', auth: headers.get('Authorization'), body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (init.method === 'PUT') return new Response(JSON.stringify({ error: 'changed', currentVersion: 4 }), { status: 409 });
      if (init.method === 'POST') return new Response(JSON.stringify({ id: 'x1', name: 'A', status: 'draft', version: 1, template: createTemplate('A') }), { status: 201 });
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      if (url.endsWith('/x1')) return new Response(JSON.stringify({ id: 'x1', name: 'A', status: 'published', version: 1, template: { name: 'A', bands: {} } }));
      return new Response(JSON.stringify([{ id: 'x1', name: 'A', status: 'published', version: 1 }]));
    });
    const store = createRestTemplateStore({ baseUrl: '/api/reports/', fetch: fetchMock as unknown as typeof fetch, headers: () => ({ Authorization: 'Bearer t' }) });

    expect(await store.list()).toEqual([{ id: 'x1', name: 'A', status: 'published', version: 1 }]);
    const got = await store.get('x1');
    expect(got.template.bands.detail).toBeDefined(); // normalized
    await store.save(input('A'));
    await expect(store.save({ ...input('A'), id: 'x1', version: 3 })).rejects.toMatchObject({ name: 'TemplateConflictError', currentVersion: 4 });
    await store.remove('x1');

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/reports',
      'GET /api/reports/x1',
      'POST /api/reports',
      'PUT /api/reports/x1',
      'DELETE /api/reports/x1',
    ]);
    expect(calls.every((c) => c.auth === 'Bearer t')).toBe(true);
  });
});

describe('data filters and metric columns', () => {
  const rows = [
    { site: 'A', tagId: 'grid', energyKwh: 10, avg: 4 },
    { site: 'A', tagId: 'grid', energyKwh: 15, avg: 6 },
    { site: 'A', tagId: 'solar', energyKwh: 7, avg: 2 },
    { site: 'B', tagId: 'load', energyKwh: 30, avg: 9 },
  ];
  const ds: ReportDataSource = {
    name: 'readings',
    data: rows,
    filters: [{ name: 'tagIds', label: 'Tags', type: 'multi', field: 'tagId' }],
    metrics: { keyField: 'tagId', filter: 'tagIds', valueFields: [{ name: 'energyKwh', label: 'Energy' }] },
  };

  it('applies design-time selections to static data and ignores empty ones', async () => {
    expect(applyDataFilters(rows, ds, { tagIds: ['grid', 'solar'] })).toHaveLength(3);
    expect(applyDataFilters(rows, ds, { tagIds: [] })).toHaveLength(4);
    expect(await loadData(ds, { parameters: {}, filters: { tagIds: 'load' } })).toHaveLength(1);
  });

  it('passes the selection to remote data functions', async () => {
    const data = vi.fn(async () => rows);
    await loadData({ ...ds, data }, { parameters: { From: 1 }, filters: { tagIds: ['grid'] } });
    expect(data).toHaveBeenCalledWith({ parameters: { From: 1 }, filters: { tagIds: ['grid'] } });
  });

  it('builds metric expressions that aggregate one item', () => {
    const m = ds.metrics!;
    expect(metricExpression(m, 'grid', 'energyKwh', 'sum')).toBe("SumIf([energyKwh], [tagId] = 'grid')");
    expect(evaluateExpression(metricExpression(m, 'grid', 'energyKwh', 'sum'), { rows })).toBe(25);
    expect(evaluateExpression(metricExpression(m, 'grid', 'avg', 'max'), { rows })).toBe(6);
    expect(evaluateExpression(metricExpression(m, 'grid', 'avg', 'min'), { rows })).toBe(4);
    expect(evaluateExpression(metricExpression(m, 'grid', 'energyKwh', 'count'), { rows })).toBe(2);
    expect(metricExpression(m, "it's", 'energyKwh', 'avg')).toBe("AvgIf([energyKwh], [tagId] = 'it''s')");
  });
});
