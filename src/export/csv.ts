import { formatValue } from '../core/format';
import { flattenFields, inferFields } from '../core/data';
import { getFieldValue } from '../core/evaluator';
import type { DataRow, RenderedDocument, TabularData } from '../core/types';
import { downloadBlob, sanitizeFileName } from './pdf';

export interface CsvExportOptions {
  /**
   * `report` (default): the detail band's displayed values (formatted, with group columns).
   * `data`: the underlying filtered/sorted rows, one column per field.
   */
  mode?: 'report' | 'data';
  delimiter?: string;
  /** Prepend a UTF-8 BOM so Excel detects the encoding (default true). */
  bom?: boolean;
  fileName?: string;
  /** Formula-injection protection: prefix cells starting with = + - @ (default true). */
  escapeFormulas?: boolean;
}

function cell(v: string, delimiter: string, escapeFormulas: boolean): string {
  let s = v;
  if (escapeFormulas && /^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  if (s.includes('"') || s.includes(delimiter) || /[\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function tableToCsv(table: TabularData, opts: CsvExportOptions = {}): string {
  const d = opts.delimiter ?? ',';
  const esc = opts.escapeFormulas !== false;
  const lines = [table.columns, ...table.rows].map((r) => r.map((c) => cell(c ?? '', d, esc)).join(d));
  return lines.join('\r\n');
}

export function rowsToTable(rows: DataRow[]): TabularData {
  const fields = flattenFields(inferFields(rows));
  return {
    columns: fields.map((f) => f.path),
    rows: rows.map((r) =>
      fields.map((f) => {
        const v = getFieldValue(r, f.path);
        return v instanceof Date ? v.toISOString() : formatValue(v, undefined);
      }),
    ),
  };
}

export function documentToCsv(doc: RenderedDocument, opts: CsvExportOptions = {}): string {
  const table = opts.mode === 'data' ? rowsToTable(doc.rows) : doc.table;
  return tableToCsv(table, opts);
}

export function downloadCsv(doc: RenderedDocument, opts: CsvExportOptions = {}) {
  const csv = documentToCsv(doc, opts);
  const blob = new Blob([(opts.bom !== false ? '﻿' : '') + csv], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, opts.fileName ?? `${sanitizeFileName(doc.name)}.csv`);
}
