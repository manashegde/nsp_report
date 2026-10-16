import type { DataSourceMetrics, FieldDef, MetricValueField, ReportDataSource } from './types';

export type MetricAggregate = 'sum' | 'avg' | 'min' | 'max' | 'count';

export const METRIC_AGGREGATES: { value: MetricAggregate; label: string }[] = [
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'max', label: 'Maximum' },
  { value: 'min', label: 'Minimum' },
  { value: 'count', label: 'Count' },
];

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Aggregates a value field supports. Raw values support all of them; pre-aggregated values only
 * those whose parts are present (an average needs both `sum` and `count`).
 */
export function metricAggregatesFor(field: MetricValueField | undefined): typeof METRIC_AGGREGATES {
  const p = field?.parts;
  if (!p) return METRIC_AGGREGATES;
  const ok: Record<MetricAggregate, boolean> = { sum: !!p.sum, avg: !!(p.sum && p.count), min: !!p.min, max: !!p.max, count: !!p.count };
  return METRIC_AGGREGATES.filter((a) => ok[a.value]);
}

/**
 * Expression for one metric column over long-format rows, e.g.
 * `SumIf([energyKwh], [tagId] = 'grid_import')`. Evaluated in a group or report band,
 * it aggregates that item's rows within the band's scope. For pre-aggregated value fields
 * (`parts`) the matching parts are re-aggregated instead; an average is `sum / count`.
 */
export function metricExpression(metrics: DataSourceMetrics, key: string, valueField: string, aggregate: MetricAggregate): string {
  const condition = `[${metrics.keyField}] = ${quote(key)}`;
  const parts = metrics.valueFields.find((f) => f.name === valueField)?.parts;
  if (parts) {
    const sumOf = (field: string) => `SumIf([${field}], ${condition})`;
    switch (aggregate) {
      case 'count':
        return sumOf(parts.count ?? valueField);
      case 'avg':
        return `${sumOf(parts.sum ?? valueField)} / ${sumOf(parts.count ?? valueField)}`;
      case 'min':
        return `MinIf([${parts.min ?? valueField}], ${condition})`;
      case 'max':
        return `MaxIf([${parts.max ?? valueField}], ${condition})`;
      default:
        return sumOf(parts.sum ?? valueField);
    }
  }
  switch (aggregate) {
    case 'count':
      return `CountIf(${condition})`;
    case 'avg':
      return `AvgIf([${valueField}], ${condition})`;
    case 'min':
      return `MinIf([${valueField}], ${condition})`;
    case 'max':
      return `MaxIf([${valueField}], ${condition})`;
    default:
      return `SumIf([${valueField}], ${condition})`;
  }
}

/** Period grouping helpers for date fields (used by the designer's group presets). */
export const PERIOD_GROUPINGS: { value: string; label: string; expression: (field: string) => string; format: string }[] = [
  { value: 'day', label: 'Day', expression: (f) => `Format([${f}], 'yyyy-MM-dd')`, format: 'dd MMM yyyy' },
  { value: 'month', label: 'Month', expression: (f) => `Format([${f}], 'yyyy-MM')`, format: 'MMM yyyy' },
  { value: 'quarter', label: 'Quarter', expression: (f) => `Concat(Year([${f}]), '-Q', Quarter([${f}]))`, format: '' },
  { value: 'year', label: 'Year', expression: (f) => `Year([${f}])`, format: '' },
];

/* ------------------------------------------------------------------ */
/* Standard tag-summary contract                                       */
/* ------------------------------------------------------------------ */

/**
 * The standard pre-aggregated shape for tag reports: one row per site × period × tag, produced by
 * the host backend from its rollup tables. Every host that returns this shape can run the same
 * report templates, whatever its database looks like.
 */
export const TAG_SUMMARY_FIELDS: FieldDef[] = [
  { name: 'siteId', label: 'Site ID', type: 'string' },
  { name: 'siteName', label: 'Site', type: 'string' },
  { name: 'period', label: 'Period start', type: 'date' },
  { name: 'tagId', label: 'Tag ID', type: 'string' },
  { name: 'tagName', label: 'Tag', type: 'string' },
  { name: 'unit', label: 'Unit', type: 'string' },
  { name: 'sum', label: 'Sum', type: 'number' },
  { name: 'count', label: 'Readings', type: 'number' },
  { name: 'min', label: 'Minimum', type: 'number' },
  { name: 'max', label: 'Maximum', type: 'number' },
];

/** Granularities the backend aggregates `period` to (`dataFilters.granularity`). */
export const TAG_SUMMARY_GRANULARITIES = [
  { value: 'hour', label: 'Hour' },
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

export interface TagSummarySourceOptions extends Pick<ReportDataSource, 'data' | 'sampleData' | 'maxRows'> {
  name?: string;
  label?: string;
  /** Caption of the aggregated value in "Add metric column" (default `Value`). */
  valueLabel?: string;
  /** Number format for metric columns (default `n2`). */
  format?: string;
  /** Lookup names for the tag and site pickers (default `tags`, `sites`). */
  tagLookup?: string;
  siteLookup?: string;
}

/**
 * A data source for the standard tag-summary contract. The report author picks tags, sites and the
 * granularity once (`template.dataFilters`); the data function receives them as `filters` and should
 * return pre-aggregated rows in the `TAG_SUMMARY_FIELDS` shape.
 */
export function createTagSummarySource(opts: TagSummarySourceOptions): ReportDataSource {
  return {
    name: opts.name ?? 'tagSummary',
    label: opts.label ?? 'Tag summary',
    fields: TAG_SUMMARY_FIELDS,
    data: opts.data,
    sampleData: opts.sampleData,
    maxRows: opts.maxRows,
    filters: [
      { name: 'tagIds', label: 'Tags in this report', type: 'multi', lookup: opts.tagLookup ?? 'tags', field: 'tagId' },
      { name: 'siteIds', label: 'Sites in this report', type: 'multi', lookup: opts.siteLookup ?? 'sites', field: 'siteId', description: 'Leave empty to include every site the viewer can access' },
      { name: 'granularity', label: 'Aggregate per', type: 'single', options: TAG_SUMMARY_GRANULARITIES, description: 'The backend returns one row per site, tag and period of this size' },
    ],
    metrics: {
      keyField: 'tagId',
      labelField: 'tagName',
      filter: 'tagIds',
      valueFields: [{ name: 'value', label: opts.valueLabel ?? 'Value', format: opts.format ?? 'n2', parts: { sum: 'sum', count: 'count', min: 'min', max: 'max' } }],
    },
  };
}
