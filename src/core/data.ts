import { toDate } from './format';
import type { DataFetchContext, DataRow, FieldDef, FieldType, ReportDataSource } from './types';

function inferType(values: unknown[]): FieldType {
  const sample = values.filter((v) => v !== null && v !== undefined && v !== '').slice(0, 50);
  if (!sample.length) return 'string';
  if (sample.every((v) => typeof v === 'number')) return 'number';
  if (sample.every((v) => typeof v === 'boolean')) return 'boolean';
  if (sample.every((v) => v instanceof Date || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && toDate(v))))
    return 'date';
  return 'string';
}

/** Infer a field schema from sample rows (nested objects become nested fields). */
export function inferFields(rows: DataRow[]): FieldDef[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const r of rows.slice(0, 100)) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return keys.map((name) => {
    const vals = rows.slice(0, 100).map((r) => r[name]);
    const obj = vals.find((v) => v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v));
    if (obj) {
      return {
        name,
        type: 'string' as FieldType,
        fields: inferFields(vals.filter((v) => v && typeof v === 'object') as DataRow[]),
      };
    }
    return { name, type: inferType(vals) };
  });
}

export function getFields(ds: ReportDataSource | undefined): FieldDef[] {
  if (!ds) return [];
  if (ds.fields?.length) return ds.fields;
  const sample = Array.isArray(ds.data) ? ds.data : ds.sampleData;
  return sample ? inferFields(sample) : [];
}

/** Convert date-typed fields from ISO strings to Date objects (in place on a shallow copy). */
export function prepareRows(rows: DataRow[], fields: FieldDef[]): DataRow[] {
  const dateFields = fields.filter((f) => f.type === 'date').map((f) => f.name);
  if (!dateFields.length) return rows;
  return rows.map((r) => {
    const copy = { ...r };
    for (const f of dateFields) {
      const v = copy[f];
      if (v !== null && v !== undefined && !(v instanceof Date)) copy[f] = toDate(v) ?? v;
    }
    return copy;
  });
}

/** Fetch rows for a data source. `preferSample` is used by the designer preview. */
export async function loadData(
  ds: ReportDataSource | undefined,
  ctx: DataFetchContext,
  preferSample = false,
): Promise<DataRow[]> {
  if (!ds) return [];
  let rows: DataRow[];
  if (preferSample && ds.sampleData) rows = ds.sampleData;
  else if (typeof ds.data === 'function') rows = await ds.data(ctx);
  else rows = ds.data ?? ds.sampleData ?? [];
  return prepareRows(applyDataFilters(rows, ds, ctx.filters), getFields(ds));
}

/** Applies design-time filters that declare a row `field` (empty selections keep every row). */
export function applyDataFilters(rows: DataRow[], ds: ReportDataSource, filters: Record<string, unknown> | undefined): DataRow[] {
  if (!filters || !ds.filters?.length) return rows;
  let out = rows;
  for (const def of ds.filters) {
    if (!def.field) continue;
    const raw = filters[def.name];
    const selected = (Array.isArray(raw) ? raw : raw === undefined || raw === null || raw === '' ? [] : [raw]).map(String);
    if (!selected.length) continue;
    const set = new Set(selected);
    const field = def.field;
    out = out.filter((r) => set.has(String(r[field] ?? '')));
  }
  return out;
}

/** Flatten nested field defs into dotted paths: Customer.Name */
export function flattenFields(fields: FieldDef[], prefix = ''): (FieldDef & { path: string })[] {
  return fields.flatMap((f) => {
    const path = prefix ? `${prefix}.${f.name}` : f.name;
    return f.fields?.length ? flattenFields(f.fields, path) : [{ ...f, path }];
  });
}
