import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { flattenFields, getFields, inferFields, loadData } from '../core/data';
import { resolveParameters } from '../core/layout';
import { createTemplate, findElement, listBands, normalizeTemplate } from '../core/template';
import type { AnyElement, DataRow, ReportDataSource, ReportTemplate } from '../core/types';
import { downloadBlob, sanitizeFileName } from '../export/pdf';
import {
  ResolvedConfigProvider,
  useResolvedConfig,
  type EasyReportConfig,
  type ToolbarConfig,
  type ToolbarItem,
} from '../ui/config';
import { cx } from '../ui/primitives';
import { resolveToolbar, Toolbar } from '../ui/Toolbar';
import { ReportViewer } from '../viewer/ReportViewer';
import { DesignerContext, type DesignerContextValue, type ExpressionRequest } from './context';
import { ExpressionEditorDialog } from './ExpressionEditor';
import { FieldList, Toolbox } from './LeftPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { resolveToolbox, type ToolboxConfig } from './registry';
import { useDesignerStore } from './store';
import { DesignSurface } from './Surface';
import { Section } from './controls';

export interface ReportDesignerHandle {
  getTemplate(): ReportTemplate;
  setTemplate(t: ReportTemplate): void;
  undo(): void;
  redo(): void;
  setMode(mode: 'design' | 'preview'): void;
}

export interface ReportDesignerProps {
  /** Template to edit. Changing the object identity loads it (history is reset). */
  template?: ReportTemplate;
  /** Called after every change. */
  onChange?: (template: ReportTemplate) => void;
  /** Called by the Save button (defaults to downloading the JSON file). */
  onSave?: (template: ReportTemplate) => void | Promise<void>;
  dataSources?: ReportDataSource[];
  config?: EasyReportConfig;
  toolbar?: ToolbarConfig;
  /** Filter / reorder / extend toolbox items. */
  toolbox?: ToolboxConfig;
  /** Toggle panels. */
  panels?: { toolbox?: boolean; fields?: boolean; properties?: boolean };
  readOnly?: boolean;
  initialMode?: 'design' | 'preview';
  /** Grid size in px (default 8). */
  gridSize?: number;
  /** Viewer toolbar config used by the Preview tab. */
  previewToolbar?: ToolbarConfig;
  className?: string;
  style?: CSSProperties;
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export const ReportDesigner = forwardRef<ReportDesignerHandle, ReportDesignerProps>(function ReportDesigner(props, ref) {
  const cfg = useResolvedConfig(props.config);
  const { labels, icon, components } = cfg;
  const initial = useMemo(() => normalizeTemplate(props.template ?? createTemplate()), []); // eslint-disable-line react-hooks/exhaustive-deps
  const store = useDesignerStore(initial);
  const t = store.template;
  const readOnly = !!props.readOnly;

  /* ---- sync external template / emit changes ---- */
  const lastExternal = useRef(props.template);
  // Templates that came from the host (initial or later loads) are not user edits and must not
  // echo back through onChange. Identity checks keep this correct when effects run twice
  // (React StrictMode), unlike a "skip the first run" flag.
  const loaded = useRef<ReportTemplate>(initial);
  const lastEmitted = useRef<ReportTemplate>(initial);
  useEffect(() => {
    if (props.template && props.template !== lastExternal.current && props.template !== store.template) {
      const next = normalizeTemplate(props.template);
      loaded.current = next;
      store.replace(next, true);
    }
    lastExternal.current = props.template;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.template]);
  useEffect(() => {
    if (t === loaded.current || t === lastEmitted.current) return;
    lastEmitted.current = t;
    props.onChange?.(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  /* ---- data sources, fields & sample rows ---- */
  const dataSources = useMemo(
    () => [...(props.dataSources ?? []), ...cfg.dataSources.filter((d) => !props.dataSources?.some((p) => p.name === d.name))],
    [props.dataSources, cfg.dataSources],
  );
  const ds = dataSources.find((d) => d.name === t.dataSource);
  const [sampleRows, setSampleRows] = useState<DataRow[]>([]);
  useEffect(() => {
    let live = true;
    setSampleRows([]);
    if (!ds) return;
    loadData(ds, { parameters: resolveParameters(t), filters: t.dataFilters }, true)
      .then((rows) => live && setSampleRows(rows.slice(0, 500)))
      .catch(() => live && setSampleRows([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds, JSON.stringify(t.dataFilters ?? {})]);
  const fields = useMemo(() => {
    const defs = ds ? getFields(ds) : [];
    return flattenFields(defs.length ? defs : inferFields(sampleRows));
  }, [ds, sampleRows]);

  /* ---- view state ---- */
  const [mode, setMode] = useState<'design' | 'preview'>(props.initialMode ?? 'design');
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [snap, setSnap] = useState(true);
  const [expr, setExpr] = useState<ExpressionRequest | null>(null);
  const toolbox = useMemo(() => resolveToolbox(cfg, props.toolbox), [cfg, props.toolbox]);
  const fileInput = useRef<HTMLInputElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      getTemplate: () => store.template,
      setTemplate: (tpl) => store.replace(normalizeTemplate(tpl), true),
      undo: store.undo,
      redo: store.redo,
      setMode,
    }),
    [store],
  );

  /* ---- arrangement commands ---- */
  const selectedEls = store.state.selection
    .map((id) => findElement(t, id)?.element)
    .filter((e): e is AnyElement => !!e);
  const multi = selectedEls.length > 1;

  const align = useCallback(
    (kind: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'width' | 'height') => {
      const els = store.state.selection.map((id) => findElement(store.template, id)?.element).filter((e): e is AnyElement => !!e);
      if (els.length < 2) return;
      const ref0 = els[0];
      const minX = Math.min(...els.map((e) => e.x));
      const maxR = Math.max(...els.map((e) => e.x + e.width));
      const minY = Math.min(...els.map((e) => e.y));
      const maxB = Math.max(...els.map((e) => e.y + e.height));
      store.updateSelected((el) => {
        switch (kind) {
          case 'left':
            el.x = minX;
            break;
          case 'right':
            el.x = maxR - el.width;
            break;
          case 'center':
            el.x = Math.round(ref0.x + ref0.width / 2 - el.width / 2);
            break;
          case 'top':
            el.y = minY;
            break;
          case 'bottom':
            el.y = maxB - el.height;
            break;
          case 'middle':
            el.y = Math.round(ref0.y + ref0.height / 2 - el.height / 2);
            break;
          case 'width':
            el.width = ref0.width;
            break;
          case 'height':
            el.height = ref0.height;
            break;
        }
      });
    },
    [store],
  );

  const reorder = (front: boolean) =>
    store.update((d) => {
      const ids = new Set(store.state.selection);
      for (const { band } of listBands(d)) {
        const sel = band.elements.filter((e) => ids.has(e.id));
        if (!sel.length) continue;
        const rest = band.elements.filter((e) => !ids.has(e.id));
        band.elements = front ? [...rest, ...sel] : [...sel, ...rest];
      }
    });

  const save = async () => {
    if (props.onSave) return props.onSave(store.template);
    const blob = new Blob([JSON.stringify(store.template, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${sanitizeFileName(store.template.name)}.json`);
  };

  const openFile = (file: File) => {
    file.text().then((txt) => {
      try {
        store.replace(normalizeTemplate(JSON.parse(txt)), true);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('easy-report: invalid template file', e);
      }
    });
  };

  /* ---- toolbar ---- */
  const hasSel = selectedEls.length > 0;
  const design = mode === 'design';
  const defaults: ToolbarItem[] = [
    {
      id: 'mode',
      render: () => (
        <div className="er-segmented" role="tablist">
          <button type="button" role="tab" aria-selected={design} className={cx('er-segmented__btn', design && 'er-segmented__btn--active')} onClick={() => setMode('design')}>
            {icon('design', 14)} {labels.design}
          </button>
          <button type="button" role="tab" aria-selected={!design} className={cx('er-segmented__btn', !design && 'er-segmented__btn--active')} onClick={() => setMode('preview')}>
            {icon('eye', 14)} {labels.preview}
          </button>
        </div>
      ),
    },
    ...(!readOnly
      ? [
          {
            id: 'new',
            icon: icon('file'),
            title: labels.newReport,
            separator: true,
            onClick: () => {
              if (typeof window === 'undefined' || window.confirm(labels.confirmNew)) {
                const n = createTemplate();
                n.dataSource = store.template.dataSource;
                store.replace(n, true);
              }
            },
          },
          { id: 'open', icon: icon('open'), title: labels.open, onClick: () => fileInput.current?.click() },
        ]
      : []),
    { id: 'save', icon: icon('save'), title: labels.save, onClick: () => void save(), disabled: readOnly && !props.onSave },
    { id: 'undo', icon: icon('undo'), title: `${labels.undo} (Ctrl+Z)`, disabled: !store.canUndo || !design || readOnly, onClick: store.undo, separator: true },
    { id: 'redo', icon: icon('redo'), title: `${labels.redo} (Ctrl+Y)`, disabled: !store.canRedo || !design || readOnly, onClick: store.redo },
    { id: 'copy', icon: icon('copy'), title: `${labels.copy} (Ctrl+C)`, disabled: !hasSel || !design, onClick: store.copy, separator: true },
    { id: 'paste', icon: icon('paste'), title: `${labels.paste} (Ctrl+V)`, disabled: !design || readOnly, onClick: store.paste },
    { id: 'delete', icon: icon('trash'), title: `${labels.delete} (Del)`, disabled: !hasSel || !design || readOnly, onClick: store.deleteSelected },
    { id: 'alignLeft', icon: icon('alignLeft'), title: labels.alignLeft, disabled: !multi || !design || readOnly, onClick: () => align('left'), separator: true },
    { id: 'alignCenter', icon: icon('alignCenter'), title: labels.alignCenter, disabled: !multi || !design || readOnly, onClick: () => align('center') },
    { id: 'alignRight', icon: icon('alignRight'), title: labels.alignRight, disabled: !multi || !design || readOnly, onClick: () => align('right') },
    { id: 'alignTop', icon: icon('alignTop'), title: labels.alignTop, disabled: !multi || !design || readOnly, onClick: () => align('top') },
    { id: 'alignMiddle', icon: icon('alignMiddle'), title: labels.alignMiddle, disabled: !multi || !design || readOnly, onClick: () => align('middle') },
    { id: 'alignBottom', icon: icon('alignBottom'), title: labels.alignBottom, disabled: !multi || !design || readOnly, onClick: () => align('bottom') },
    { id: 'sameWidth', icon: icon('sameWidth'), title: labels.sameWidth, disabled: !multi || !design || readOnly, onClick: () => align('width') },
    { id: 'sameHeight', icon: icon('sameHeight'), title: labels.sameHeight, disabled: !multi || !design || readOnly, onClick: () => align('height') },
    { id: 'front', icon: icon('front'), title: labels.bringToFront, disabled: !hasSel || !design || readOnly, onClick: () => reorder(true) },
    { id: 'back', icon: icon('back'), title: labels.sendToBack, disabled: !hasSel || !design || readOnly, onClick: () => reorder(false) },
    { id: 'grid', icon: icon('grid'), title: labels.showGrid, active: showGrid, disabled: !design, onClick: () => setShowGrid((g) => !g), separator: true, spacer: true },
    { id: 'snap', icon: icon('magnet'), title: labels.snapToGrid, active: snap, disabled: !design, onClick: () => setSnap((s) => !s) },
    {
      id: 'zoom',
      render: () => (
        <components.Select
          className="er-zoom-select"
          value={String(zoom)}
          disabled={!design}
          onChange={(v) => setZoom(Number(v))}
          options={ZOOMS.map((z) => ({ value: String(z), label: `${z * 100}%` }))}
        />
      ),
    },
  ];
  const toolbarItems = resolveToolbar(defaults, props.toolbar);

  const ctx: DesignerContextValue = {
    store,
    dataSources,
    fields,
    sampleRows,
    toolbox,
    zoom,
    grid: { size: props.gridSize ?? 8, show: showGrid, snap },
    openExpression: setExpr,
    readOnly,
  };
  const panels = { toolbox: true, fields: true, properties: !readOnly, ...props.panels };
  const showLeft = (panels.toolbox || panels.fields) && design;

  return (
    <ResolvedConfigProvider value={cfg}>
      <DesignerContext.Provider value={ctx}>
        <div className={cx('er-root', 'er-designer', cfg.className, props.className)} style={{ ...cfg.rootStyle, ...props.style }}>
          <Toolbar items={toolbarItems} ariaLabel="Report designer" />
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) openFile(f);
              e.target.value = '';
            }}
          />
          <div className={cx('er-designer__body', !showLeft && 'er-designer__body--noleft', (!panels.properties || !design) && 'er-designer__body--noright')}>
            {showLeft && (
              <aside className="er-designer__left">
                {panels.toolbox && !readOnly && (
                  <Section title={labels.toolbox}>
                    <Toolbox />
                  </Section>
                )}
                {panels.fields && (
                  <Section title={labels.fieldList}>
                    <FieldList />
                  </Section>
                )}
              </aside>
            )}
            <main className="er-designer__center">
              {design ? (
                <DesignSurface />
              ) : (
                <ReportViewer
                  template={t}
                  dataSources={dataSources}
                  config={props.config}
                  preferSampleData
                  toolbar={props.previewToolbar}
                  onElementClick={(id) => {
                    setMode('design');
                    store.select([id]);
                  }}
                />
              )}
            </main>
            {panels.properties && design && (
              <aside className="er-designer__right">
                <PropertiesPanel />
              </aside>
            )}
          </div>
          <ExpressionEditorDialog request={expr} onClose={() => setExpr(null)} />
        </div>
      </DesignerContext.Provider>
    </ResolvedConfigProvider>
  );
});
