import { useEffect, useMemo, useState } from 'react';
import { metricAggregatesFor, metricExpression, PERIOD_GROUPINGS, type MetricAggregate } from '../core/metrics';
import { listBands, uid, type BandRef } from '../core/template';
import { pageDimensions } from '../core/measure';
import type { ReportTemplate } from '../core/types';

const contentWidth = (t: ReportTemplate) => pageDimensions(t.page).width - t.page.margins.left - t.page.margins.right;
import type { DataSourceFilterDef, ParameterOption, ReportDataSource, TextElement } from '../core/types';
import { useER } from '../ui/config';
import { Row } from './controls';
import { useDesigner } from './context';

/**
 * Options of a named lookup (HostConfig.parameterLookups), with the template's data filters as context.
 * `fixed` options are used when there is no lookup.
 */
function useLookupOptions(lookup: string | undefined, filters: Record<string, unknown> | undefined, fixed?: ParameterOption[]) {
  const { parameterLookups } = useER();
  const fn = lookup ? parameterLookups?.[lookup] : undefined;
  const [state, setState] = useState<{ options: ParameterOption[]; loading: boolean; error?: string }>({ options: [], loading: !!fn });
  const key = JSON.stringify(filters ?? {});
  useEffect(() => {
    if (!fn) {
      setState({ options: [], loading: false });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    Promise.resolve(fn({ parameters: {}, filters }))
      .then((options) => live && setState({ options, loading: false }))
      .catch((e: unknown) => live && setState({ options: [], loading: false, error: (e as Error)?.message ?? String(e) }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, key]);
  return !fn && fixed ? { options: fixed, loading: false } : state;
}

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === undefined || v === null || v === '' ? [] : [String(v)]);

/** Searchable checklist for multi-select design-time filters (tag lists can be long). */
function MultiFilter({ def, value, onChange, filters }: { def: DataSourceFilterDef; value: unknown; onChange: (v: string[]) => void; filters?: Record<string, unknown> }) {
  const { components, labels } = useER();
  const { options, loading, error } = useLookupOptions(def.lookup, filters, def.options);
  const [q, setQ] = useState('');
  const selected = asList(value);
  const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()) || String(o.value).toLowerCase().includes(q.toLowerCase()));
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div className="er-multifilter">
      <div className="er-inline">
        <components.Input type="search" value={q} onChange={setQ} placeholder={labels.searchOptions} />
        {selected.length > 0 && (
          <components.Button variant="ghost" onClick={() => onChange([])} title={labels.clearSelection}>
            ×
          </components.Button>
        )}
      </div>
      <div className="er-muted er-multifilter__count">
        {selected.length ? `${selected.length} ${labels.selectedCount}` : labels.allIncluded}
      </div>
      <div className="er-multifilter__list" role="group" aria-label={def.label}>
        {loading && <div className="er-muted">{labels.loadingOptions}</div>}
        {error && <div className="er-error-text">{error}</div>}
        {!loading && !error && options.length === 0 && <div className="er-muted">{labels.noOptions}</div>}
        {shown.map((o) => (
          <components.Checkbox key={String(o.value)} checked={selected.includes(String(o.value))} onChange={() => toggle(String(o.value))} label={o.label} />
        ))}
      </div>
    </div>
  );
}

function SingleFilter({ def, value, onChange, filters }: { def: DataSourceFilterDef; value: unknown; onChange: (v: string | undefined) => void; filters?: Record<string, unknown> }) {
  const { components, labels } = useER();
  const { options } = useLookupOptions(def.lookup, filters, def.options);
  return (
    <components.Select
      value={value === undefined || value === null ? '' : String(value)}
      onChange={(v) => onChange(v || undefined)}
      options={[{ value: '', label: labels.allIncluded }, ...options.map((o) => ({ value: String(o.value), label: o.label }))]}
    />
  );
}

/** Report-level design-time filters for the selected data source (e.g. which tags this report covers). */
export function DataFiltersEditor() {
  const { components } = useER();
  const { store, dataSources, readOnly } = useDesigner();
  const t = store.template;
  const ds = dataSources.find((d) => d.name === t.dataSource);
  if (!ds?.filters?.length) return null;
  const filters = t.dataFilters ?? {};
  const set = (name: string, v: unknown) =>
    store.update((d) => {
      const next = { ...(d.dataFilters ?? {}) };
      if (v === undefined || (Array.isArray(v) && v.length === 0) || v === '') delete next[name];
      else next[name] = v;
      d.dataFilters = Object.keys(next).length ? next : undefined;
    }, `dataFilters:${name}`);

  return (
    <>
      {ds.filters.map((def) => (
        <Row key={def.name} label={def.label} wide>
          {readOnly ? (
            <span className="er-muted">{asList(filters[def.name]).join(', ') || '—'}</span>
          ) : def.type === 'multi' ? (
            <MultiFilter def={def} value={filters[def.name]} onChange={(v) => set(def.name, v)} filters={filters} />
          ) : def.type === 'single' ? (
            <SingleFilter def={def} value={filters[def.name]} onChange={(v) => set(def.name, v)} filters={filters} />
          ) : (
            <components.Input value={String(filters[def.name] ?? '')} onChange={(v) => set(def.name, v)} />
          )}
          {def.description && <div className="er-field__hint">{def.description}</div>}
        </Row>
      ))}
    </>
  );
}

/** Quick "group by Day / Month / Quarter / Year of <date field>" presets. */
export function PeriodGroupPreset({ onPick }: { onPick: (expression: string) => void }) {
  const { components, labels } = useER();
  const { fields } = useDesigner();
  const dateFields = fields.filter((f) => f.type === 'date');
  if (!dateFields.length) return null;
  const options = dateFields.flatMap((f) =>
    PERIOD_GROUPINGS.map((p) => ({ value: p.expression(f.path), label: `${p.label} · ${f.label ?? f.path}` })),
  );
  return (
    <Row label={labels.groupByPeriod}>
      <components.Select value="" onChange={(v) => v && onPick(v)} options={[{ value: '', label: '…' }, ...options]} />
    </Row>
  );
}

function bandTargets(refs: BandRef[]): BandRef[] {
  const order: BandRef['kind'][] = ['groupFooter', 'groupHeader', 'reportFooter', 'reportHeader'];
  return refs.filter((r) => order.includes(r.kind)).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

/** Dialog that turns "item + value + aggregate" into a labelled column (header caption + value cell). */
export function MetricColumnDialog({ ds, onClose }: { ds: ReportDataSource & { metrics: NonNullable<ReportDataSource['metrics']> }; onClose: () => void }) {
  const { components, labels } = useER();
  const { store } = useDesigner();
  const t = store.template;
  const m = ds.metrics;
  const filterSelection = m.filter ? asList(t.dataFilters?.[m.filter]) : [];
  const lookupName = m.lookup ?? ds.filters?.find((f) => f.name === m.filter)?.lookup;
  const { options, loading } = useLookupOptions(lookupName, t.dataFilters);
  // Offer the author's selected items first (or only those, when a selection exists).
  const items = useMemo(
    () => (filterSelection.length ? options.filter((o) => filterSelection.includes(String(o.value))) : options),
    [options, filterSelection],
  );
  const targets = bandTargets(listBands(t));
  const [item, setItem] = useState('');
  const [valueField, setValueField] = useState(m.valueFields[0]?.name ?? '');
  const [aggregateChoice, setAggregate] = useState<MetricAggregate>('sum');
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState(targets[0]?.band.id ?? '');
  const itemLabel = items.find((o) => String(o.value) === item)?.label ?? item;
  const targetBand = targets.find((r) => r.band.id === target)?.band;
  const used = Math.max(
    ...(targetBand?.elements ?? []).map((e) => e.x + e.width),
    ...(t.bands.pageHeader?.elements ?? []).map((e) => e.x + e.width),
    0,
  );
  const noRoom = contentWidth(t) - used < 100;
  const vf = m.valueFields.find((f) => f.name === valueField);
  // Pre-aggregated values only support the aggregates whose parts the rows carry.
  const aggregates = metricAggregatesFor(vf);
  const aggregate = aggregates.some((a) => a.value === aggregateChoice) ? aggregateChoice : (aggregates[0]?.value ?? 'sum');

  const insert = () => {
    const expression = metricExpression(m, item, valueField, aggregate);
    const caption = label.trim() || itemLabel;
    const newId = uid();
    store.update((d) => {
      const refs = listBands(d);
      const band = refs.find((r) => r.band.id === target)?.band;
      if (!band) return;
      const header = d.bands.pageHeader;
      const right = (els: { x: number; width: number }[]) => els.reduce((mx, e) => Math.max(mx, e.x + e.width), 0);
      const width = 100;
      // Next free slot on the right, kept inside the page (the author can move it from there).
      const x = Math.max(0, Math.min(Math.max(right(band.elements), header ? right(header.elements) : 0), contentWidth(d) - width));
      const el: TextElement = {
        id: newId,
        type: 'text',
        x,
        y: 2,
        width,
        height: 20,
        expression,
        format: aggregate === 'count' ? 'n0' : (vf?.format ?? 'n2'),
        style: { textAlign: 'right', padding: 4, fontSize: 9 },
        exportName: caption,
      };
      band.elements.push(el);
      band.height = Math.max(band.height, 24);
      if (header) {
        header.elements.push({ id: uid(), type: 'text', x, y: Math.max(0, header.height - 24), width, height: 22, text: caption, style: { bold: true, textAlign: 'right', padding: 4, fontSize: 9 } } as TextElement);
      }
    });
    store.select([newId]);
    onClose();
  };

  return (
    <components.Dialog
      open
      title={labels.addMetricColumn}
      onClose={onClose}
      width={480}
      footer={
        <>
          <components.Button onClick={onClose}>{labels.cancel}</components.Button>
          <components.Button variant="primary" disabled={!item || !valueField || !target} onClick={insert}>
            {labels.insert}
          </components.Button>
        </>
      }
    >
      <div className="er-form">
        <p className="er-muted">{labels.metricHint}</p>
        <Row label={labels.metricItem}>
          <components.Select
            value={item}
            onChange={setItem}
            disabled={loading}
            options={[{ value: '', label: loading ? labels.loadingOptions : '…' }, ...items.map((o) => ({ value: String(o.value), label: o.label }))]}
          />
        </Row>
        <Row label={labels.metricValue}>
          <components.Select value={valueField} onChange={setValueField} options={m.valueFields.map((f) => ({ value: f.name, label: f.label }))} />
        </Row>
        <Row label={labels.metricAggregate}>
          <components.Select value={aggregate} onChange={(v) => setAggregate(v as MetricAggregate)} options={aggregates} />
        </Row>
        <Row label={labels.metricLabel}>
          <components.Input value={label} onChange={setLabel} placeholder={itemLabel || labels.metricLabel} />
        </Row>
        <Row label={labels.metricTarget}>
          <components.Select value={target} onChange={setTarget} options={targets.map((r) => ({ value: r.band.id, label: r.label }))} />
        </Row>
        {noRoom && <div className="er-warning-text">{labels.metricNoRoom}</div>}
        {item && (
          <div className="er-expr__preview" title={labels.expression}>
            {metricExpression(m, item, valueField, aggregate)}
          </div>
        )}
      </div>
    </components.Dialog>
  );
}
