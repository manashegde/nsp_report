import type { DataSourceMetrics } from './types';

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
 * Expression for one metric column over long-format rows, e.g.
 * `SumIf([energyKwh], [tagId] = 'grid_import')`. Evaluated in a group or report band,
 * it aggregates that item's rows within the band's scope.
 */
export function metricExpression(metrics: DataSourceMetrics, key: string, valueField: string, aggregate: MetricAggregate): string {
  const condition = `[${metrics.keyField}] = ${quote(key)}`;
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
