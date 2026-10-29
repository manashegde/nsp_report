import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { resolveParameters } from '../core/layout';
import type { DataRow, RenderedDocument, ReportDataSource, ReportTemplate } from '../core/types';
import { downloadCsv, type CsvExportOptions } from '../export/csv';
import { downloadPdf, type PdfExportOptions } from '../export/pdf';
import { printDocument } from '../export/print';
import {
  ResolvedConfigProvider,
  useResolvedConfig,
  type EasyReportConfig,
  type ToolbarConfig,
  type ToolbarItem,
} from '../ui/config';
import { cx } from '../ui/primitives';
import { resolveToolbar, Toolbar } from '../ui/Toolbar';
import { PagesView, findMatches, PAGE_GAP } from './PagesView';
import { ParametersPanel } from './ParametersPanel';
import { useReportDocument } from './useReportDocument';

export interface ReportViewerHandle {
  refresh(): void;
  exportPdf(options?: PdfExportOptions): Promise<void>;
  exportCsv(options?: CsvExportOptions): void;
  print(): Promise<void>;
  goToPage(page: number): void;
  getDocument(): RenderedDocument | null;
  setParameters(values: Record<string, unknown>): void;
}

export interface ReportViewerProps {
  template: ReportTemplate;
  /** Rows to render (overrides the template data source). */
  data?: DataRow[];
  /** Data sources (merged over config.dataSources). */
  dataSources?: ReportDataSource[];
  /** Initial / controlled parameter values. */
  parameters?: Record<string, unknown>;
  /** Called when the user submits parameters. */
  onParametersChange?: (values: Record<string, unknown>) => void;
  /**
   * 'auto' (default): show the panel when the template has visible parameters.
   * Rendering waits for required parameters.
   */
  parametersPanel?: 'auto' | 'open' | 'collapsed' | 'hidden';
  config?: EasyReportConfig;
  toolbar?: ToolbarConfig;
  /** Initial zoom: number (1 = 100%) or 'fit-width' / 'fit-page'. */
  zoom?: number | 'fit-width' | 'fit-page';
  className?: string;
  style?: CSSProperties;
  /** Use the data sources' sampleData (designer preview). */
  preferSampleData?: boolean;
  onDocumentReady?: (doc: RenderedDocument) => void;
  onError?: (error: Error) => void;
  /** Click on a rendered element (receives the template element id). */
  onElementClick?: (elementId: string) => void;
  /** Rendered when there is nothing to show (no rows and no static content). */
  emptyState?: ReactNode;
}

const ZOOM_STEPS = [0.25, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 3];

export const ReportViewer = forwardRef<ReportViewerHandle, ReportViewerProps>(function ReportViewer(props, ref) {
  const cfg = useResolvedConfig(props.config);
  const { labels, icon, components } = cfg;
  const { template } = props;
  const dataSources = useMemo(
    () => [...(props.dataSources ?? []), ...cfg.dataSources.filter((d) => !props.dataSources?.some((p) => p.name === d.name))],
    [props.dataSources, cfg.dataSources],
  );

  /* ---------------- parameters ---------------- */
  const visibleParams = template.parameters.filter((p) => p.visible !== false);
  const initialParams = useMemo(
    () => resolveParameters(template, props.parameters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [template.parameters, props.parameters],
  );
  const [params, setParams] = useState(initialParams);
  useEffect(() => setParams(initialParams), [initialParams]);
  const missingRequired = template.parameters.some(
    (p) => p.required && (params[p.name] === null || params[p.name] === undefined || params[p.name] === ''),
  );
  const validateParameters = cfg.validateParameters;
  const validate = useCallback((v: Record<string, unknown>) => validateParameters?.(v, template), [validateParameters, template]);
  const paramErrors = Object.values(validate(params) ?? {}).filter(Boolean);
  // Never run with values the host rejects (e.g. From after To), even if they came from defaults or props.
  const blocked = missingRequired || paramErrors.length > 0;
  const panelMode = props.parametersPanel ?? 'auto';
  const [panelOpen, setPanelOpen] = useState(panelMode === 'open' || (panelMode === 'auto' && visibleParams.length > 0));

  /* ---------------- document ---------------- */
  // Option labels of the chosen values (site name for ?Site) for ParamLabel(), so a header can
  // name the selection even when it returned no rows.
  const { parameterLookups } = cfg;
  const resolveParameterLabels = useCallback(
    async (values: Record<string, unknown>) => {
      const out: Record<string, string> = {};
      const key = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
      await Promise.all(
        template.parameters.map(async (p) => {
          const v = values[p.name];
          if (v === null || v === undefined || v === '' || Array.isArray(v)) return;
          const lookup = p.lookup ? parameterLookups?.[p.lookup] : undefined;
          const options = p.options?.length ? p.options : lookup ? await lookup({ parameters: values, filters: template.dataFilters }) : undefined;
          const hit = options?.find((o) => key(o.value) === key(v));
          if (hit) out[p.name] = hit.label;
        }),
      );
      return out;
    },
    [template.parameters, template.dataFilters, parameterLookups],
  );
  const { document: doc, loading, error, refresh } = useReportDocument({
    template,
    data: props.data,
    dataSources,
    parameters: params,
    enabled: !blocked,
    preferSample: props.preferSampleData,
    config: cfg,
    resolveParameterLabels,
  });
  // A failed run's message goes away once the parameters are edited, not only on the next run.
  const [errorDismissed, setErrorDismissed] = useState(false);
  useEffect(() => setErrorDismissed(false), [error]);

  useEffect(() => {
    if (doc) props.onDocumentReady?.(doc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);
  useEffect(() => {
    if (error) props.onError?.(error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  /* ---------------- zoom & navigation ---------------- */
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoomMode, setZoomMode] = useState<number | 'fit-width' | 'fit-page'>(props.zoom ?? 'fit-width');
  const [viewport, setViewport] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setViewport({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const zoom = useMemo(() => {
    if (typeof zoomMode === 'number') return zoomMode;
    const pw = doc?.pageWidth ?? 794;
    const ph = doc?.pageHeight ?? 1123;
    const fitW = (viewport.w - 48) / pw;
    if (zoomMode === 'fit-width') return Math.max(0.25, Math.min(fitW, 1.5));
    return Math.max(0.2, Math.min(fitW, (viewport.h - 32) / ph));
  }, [zoomMode, viewport, doc?.pageWidth, doc?.pageHeight]);

  const [page, setPage] = useState(1);
  const pageCount = doc?.pages.length ?? 0;
  const goToPage = useCallback(
    (n: number) => {
      const el = scrollRef.current;
      if (!el || !doc) return;
      const p = Math.min(Math.max(1, n), doc.pages.length);
      el.scrollTo({ top: (p - 1) * (doc.pageHeight * zoom + PAGE_GAP) });
      setPage(p);
    },
    [doc, zoom],
  );
  const stepZoom = (dir: 1 | -1) => {
    const idx = ZOOM_STEPS.findIndex((z) => z >= zoom - 0.001);
    const next = dir > 0 ? ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, (ZOOM_STEPS[idx] > zoom + 0.001 ? idx : idx + 1))] : ZOOM_STEPS[Math.max(0, idx - 1)];
    setZoomMode(next ?? 1);
  };

  /* ---------------- search ---------------- */
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const matches = useMemo(() => findMatches(doc, query), [doc, query]);
  const [matchIdx, setMatchIdx] = useState(0);
  useEffect(() => setMatchIdx(0), [matches]);
  const currentMatch = matches[matchIdx] ?? null;
  useEffect(() => {
    const el = scrollRef.current;
    if (!currentMatch || !el || !doc) return;
    const top = currentMatch.page * (doc.pageHeight * zoom + PAGE_GAP) + currentMatch.item.y * zoom - el.clientHeight / 3;
    el.scrollTo({ top: Math.max(0, top) });
  }, [currentMatch, doc, zoom]);

  /* ---------------- exports ---------------- */
  const [busy, setBusy] = useState(false);
  const exportPdf = useCallback(
    async (o?: PdfExportOptions) => {
      if (!doc) return;
      setBusy(true);
      try {
        await downloadPdf(doc, { ...cfg.pdf, ...o });
      } catch (e) {
        props.onError?.(e as Error);
        // eslint-disable-next-line no-console
        if (!props.onError) console.error(e);
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, cfg.pdf],
  );
  const exportCsv = useCallback((o?: CsvExportOptions) => doc && downloadCsv(doc, { ...cfg.csv, ...o }), [doc, cfg.csv]);
  const print = useCallback(async () => {
    if (doc) await printDocument(doc);
  }, [doc]);

  useImperativeHandle(
    ref,
    () => ({
      refresh,
      exportPdf,
      exportCsv: (o) => exportCsv(o),
      print,
      goToPage,
      getDocument: () => doc,
      setParameters: (v) => setParams((p) => ({ ...p, ...v })),
    }),
    [refresh, exportPdf, exportCsv, print, goToPage, doc],
  );

  /* ---------------- toolbar ---------------- */
  const { Input } = components;
  const noDoc = !doc || loading;
  const defaults: ToolbarItem[] = [
    ...(visibleParams.length && panelMode !== 'hidden'
      ? [{ id: 'parameters', icon: icon('params'), title: labels.parameters, active: panelOpen, onClick: () => setPanelOpen((o) => !o) }]
      : []),
    { id: 'first', icon: icon('first'), title: labels.firstPage, disabled: noDoc || page <= 1, onClick: () => goToPage(1), separator: visibleParams.length > 0 },
    { id: 'prev', icon: icon('prev'), title: labels.previousPage, disabled: noDoc || page <= 1, onClick: () => goToPage(page - 1) },
    {
      id: 'pageNumber',
      render: () => (
        <span className="er-pagenum">
          <Input
            className="er-pagenum__input"
            value={String(page)}
            onChange={() => {}}
            onCommit={(v) => goToPage(Number(v) || 1)}
            title={labels.page}
          />
          <span>
            {labels.pageOf} {pageCount}
          </span>
        </span>
      ),
    },
    { id: 'next', icon: icon('next'), title: labels.nextPage, disabled: noDoc || page >= pageCount, onClick: () => goToPage(page + 1) },
    { id: 'last', icon: icon('last'), title: labels.lastPage, disabled: noDoc || page >= pageCount, onClick: () => goToPage(pageCount) },
    { id: 'zoomOut', icon: icon('zoomOut'), title: labels.zoomOut, onClick: () => stepZoom(-1), separator: true },
    {
      id: 'zoomLevel',
      render: () => (
        <components.Select
          className="er-zoom-select"
          value={typeof zoomMode === 'number' ? String(zoomMode) : zoomMode}
          onChange={(v) => setZoomMode(v === 'fit-width' || v === 'fit-page' ? v : Number(v))}
          options={[
            { value: 'fit-width', label: labels.fitWidth },
            { value: 'fit-page', label: labels.fitPage },
            ...(typeof zoomMode === 'number' && !ZOOM_STEPS.includes(zoomMode) ? [{ value: String(zoomMode), label: `${Math.round(zoomMode * 100)}%` }] : []),
            ...ZOOM_STEPS.map((z) => ({ value: String(z), label: `${Math.round(z * 100)}%` })),
          ]}
          title={`${Math.round(zoom * 100)}%`}
        />
      ),
    },
    { id: 'zoomIn', icon: icon('zoomIn'), title: labels.zoomIn, onClick: () => stepZoom(1) },
    { id: 'search', icon: icon('search'), title: labels.search, active: searchOpen, onClick: () => setSearchOpen((s) => !s), separator: true },
    { id: 'refresh', icon: icon('refresh'), title: labels.refresh, onClick: refresh, disabled: blocked },
    { id: 'print', icon: icon('print'), title: labels.print, disabled: noDoc, onClick: print, separator: true, spacer: true },
    { id: 'exportPdf', icon: icon('pdf'), title: labels.exportPdf, disabled: noDoc || busy, onClick: () => void exportPdf() },
    { id: 'exportCsv', icon: icon('csv'), title: labels.exportCsv, disabled: noDoc, onClick: () => exportCsv() },
  ];
  const toolbarItems = resolveToolbar(defaults, props.toolbar);

  const showEmpty = doc && doc.rows.length === 0 && props.emptyState;
  // Without a host empty state, say so above the (header-only) pages.
  const noRows = !!doc && doc.rows.length === 0 && !props.emptyState && !!template.dataSource && !loading && !blocked;

  return (
    <ResolvedConfigProvider value={cfg}>
      <div className={cx('er-root', 'er-viewer', cfg.className, props.className)} style={{ ...cfg.rootStyle, ...props.style }}>
        <Toolbar items={toolbarItems} ariaLabel="Report viewer" />
        {searchOpen && (
          <div className="er-searchbar">
            <Input
              type="search"
              autoFocus
              value={query}
              onChange={setQuery}
              onCommit={() => matches.length && setMatchIdx((i) => (i + 1) % matches.length)}
              placeholder={labels.searchPlaceholder}
            />
            <span className="er-muted">{query ? (matches.length ? `${matchIdx + 1} / ${matches.length}` : labels.noMatches) : ''}</span>
            <components.Button variant="ghost" icon={icon('up')} title={labels.previousPage} disabled={!matches.length} onClick={() => setMatchIdx((i) => (i - 1 + matches.length) % matches.length)} />
            <components.Button variant="ghost" icon={icon('down')} title={labels.nextPage} disabled={!matches.length} onClick={() => setMatchIdx((i) => (i + 1) % matches.length)} />
            <components.Button variant="ghost" icon={icon('close')} title={labels.cancel} onClick={() => (setSearchOpen(false), setQuery(''))} />
          </div>
        )}
        <div className="er-viewer__body">
          {panelOpen && visibleParams.length > 0 && panelMode !== 'hidden' && (
            <aside className="er-viewer__side">
              <ParametersPanel
                parameters={template.parameters}
                values={params}
                defaults={initialParams}
                validate={validate}
                filters={template.dataFilters}
                onEdit={() => setErrorDismissed(true)}
                onSubmit={(v) => {
                  setParams(v);
                  props.onParametersChange?.(v);
                  if (v === params) refresh();
                }}
              />
            </aside>
          )}
          <div className="er-viewer__canvas" ref={scrollRef}>
            {error && !errorDismissed && (
              <div className="er-message er-message--error" role="alert">
                {error.message}
              </div>
            )}
            {noRows && <div className="er-message er-message--empty">{labels.noData}</div>}
            {!error && missingRequired && <div className="er-message">{labels.enterParameters}</div>}
            {!error && !missingRequired && paramErrors.length > 0 && (
              <div className="er-message er-message--error" role="alert">
                {paramErrors.join(' ')}
              </div>
            )}
            {loading && (
              <div className="er-loading" role="status">
                <span className="er-spinner" /> {labels.loading}
              </div>
            )}
            {busy && (
              <div className="er-loading" role="status">
                <span className="er-spinner" /> {labels.exporting}
              </div>
            )}
            {showEmpty ? (
              <div className="er-message">{props.emptyState}</div>
            ) : (
              doc &&
              !blocked && (
                <PagesView
                  doc={doc}
                  zoom={zoom}
                  matches={matches}
                  currentMatch={currentMatch}
                  scrollRef={scrollRef}
                  onPageChange={setPage}
                  onElementClick={props.onElementClick}
                />
              )
            )}
            {doc && doc.warnings.length > 0 && (
              <details className="er-warnings">
                <summary>
                  {icon('warning', 14)} {labels.warnings} ({doc.warnings.length})
                </summary>
                <ul>
                  {doc.warnings.slice(0, 50).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      </div>
    </ResolvedConfigProvider>
  );
});
