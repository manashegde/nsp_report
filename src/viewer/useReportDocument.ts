import { useCallback, useEffect, useRef, useState } from 'react';
import { loadData, prepareRows, getFields } from '../core/data';
import { renderReport, type ElementLayout } from '../core/layout';
import type { DataRow, RenderedDocument, ReportDataSource, ReportTemplate } from '../core/types';
import type { EasyReportConfig } from '../ui/config';

export interface UseReportDocumentOptions {
  template: ReportTemplate;
  /** Rows to use instead of the template's data source. */
  data?: DataRow[];
  dataSources?: ReportDataSource[];
  parameters: Record<string, unknown>;
  /** Run automatically when inputs change (default true). */
  enabled?: boolean;
  /** Use data source sampleData (designer preview). */
  preferSample?: boolean;
  config?: Pick<EasyReportConfig, 'functions' | 'locale' | 'currency' | 'measurer' | 'elementTypes'>;
}

export interface ReportDocumentState {
  document: RenderedDocument | null;
  loading: boolean;
  error: Error | null;
  /** Re-fetch data and re-render. */
  refresh: () => void;
}

/** Headless hook: fetch data + lay out the report. */
export function useReportDocument(opts: UseReportDocumentOptions): ReportDocumentState {
  const [state, setState] = useState<Omit<ReportDocumentState, 'refresh'>>({ document: null, loading: false, error: null });
  const [nonce, setNonce] = useState(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const { template, data, dataSources, parameters, enabled = true, preferSample } = opts;
  // Hosts often pass inline objects; key on content so a parent re-render doesn't refetch.
  const paramsKey = stableKey(parameters);
  const dsKey = `${template.dataSource ?? ''}|${dataSources?.some((d) => d.name === template.dataSource) ? 1 : 0}`;

  useEffect(() => {
    if (!enabled) return;
    const { dataSources, parameters } = optsRef.current;
    const ctrl = new AbortController();
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      const { config } = optsRef.current;
      const ds = dataSources?.find((d) => d.name === template.dataSource);
      const rows = data ? prepareRows(data, getFields(ds, template.dataFilters)) : await loadData(ds, { parameters, filters: template.dataFilters, signal: ctrl.signal }, preferSample);
      if (cancelled) return;
      // Yield so the loading indicator paints before a potentially long layout.
      await new Promise((r) => setTimeout(r, 0));
      if (cancelled) return;
      const elementLayouts: Record<string, ElementLayout> = {};
      for (const et of config?.elementTypes ?? []) elementLayouts[et.type] = et.layout;
      const doc = renderReport(template, rows, {
        parameters,
        functions: config?.functions,
        locale: config?.locale,
        currency: config?.currency,
        measurer: config?.measurer,
        elementLayouts,
      });
      if (!cancelled) setState({ document: doc, loading: false, error: null });
    })().catch((e: unknown) => {
      if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
      setState({ document: null, loading: false, error: e instanceof Error ? e : new Error(String(e)) });
    });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [template, data, dsKey, paramsKey, enabled, preferSample, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, refresh };
}

function stableKey(v: Record<string, unknown>): string {
  return JSON.stringify(v, (_k, x) => (x instanceof Date ? `D:${x.getTime()}` : x));
}
