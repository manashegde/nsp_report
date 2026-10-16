import { useState } from 'react';
import { createTabularTemplate } from '../core/template';
import { useER } from '../ui/config';
import { useDesigner } from './context';
import { setDragPayload, TypeIcon } from './registry';
import { MetricColumnDialog } from './DataTools';
import { findBand, uid } from '../core/template';
import type { AnyElement } from '../core/types';

export function Toolbox() {
  const { toolbox, store, readOnly } = useDesigner();
  const { labels } = useER();

  /** Click inserts into the selected band (or Detail). */
  const insert = (id: string) => {
    const item = toolbox.find((i) => i.id === id);
    if (!item || readOnly) return;
    const s = store.state;
    const bandId = s.bandId ?? store.template.bands.detail.id;
    const newId = uid();
    store.update((d) => {
      const band = findBand(d, bandId) ?? d.bands.detail;
      const y = 0;
      const x = band.elements.reduce((m, e) => (e.y < 20 ? Math.max(m, e.x + e.width) : m), 0);
      const el = { ...item.create(), id: newId, x: x + (x ? 4 : 0), y } as AnyElement;
      band.elements.push(el);
      band.height = Math.max(band.height, el.y + el.height);
    });
    store.select([newId]);
  };

  return (
    <div className="er-toolbox" role="list" aria-label={labels.toolbox}>
      {toolbox.map((item) => (
        <button
          key={item.id}
          type="button"
          role="listitem"
          className="er-toolbox__item"
          draggable={!readOnly}
          onDragStart={(e) => setDragPayload(e, { kind: 'toolbox', id: item.id })}
          onClick={() => insert(item.id)}
          title={item.label}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

export function FieldList() {
  const cfg = useER();
  const { labels, components, icon } = cfg;
  const { fields, store, dataSources, readOnly } = useDesigner();
  const t = store.template;
  const [quick, setQuick] = useState(false);
  const [metricOpen, setMetricOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const ds = dataSources.find((d) => d.name === t.dataSource);
  const f = filter.toLowerCase();
  const visibleFields = fields.filter((x) => !f || x.path.toLowerCase().includes(f) || x.label?.toLowerCase().includes(f));

  return (
    <div className="er-fieldlist">
      {dataSources.length > 0 && (
        <div className="er-fieldlist__ds">
          {icon('db', 14)}
          <components.Select
            value={t.dataSource ?? ''}
            disabled={readOnly}
            onChange={(v) =>
              store.update((d) => {
                d.dataSource = v || undefined;
              })
            }
            options={[{ value: '', label: labels.noDataSource }, ...dataSources.map((d) => ({ value: d.name, label: d.label ?? d.name }))]}
          />
        </div>
      )}
      {fields.length > 8 && <components.Input type="search" value={filter} onChange={setFilter} placeholder={labels.search} />}
      <ul className="er-tree">
        {visibleFields.map((x) => (
          <li
            key={x.path}
            className="er-tree__item"
            draggable={!readOnly}
            onDragStart={(e) => setDragPayload(e, { kind: 'field', path: x.path, label: x.label ?? x.name, fieldType: x.type })}
            title={`[${x.path}] · ${x.type}`}
          >
            <TypeIcon type={x.type} cfg={cfg} />
            <span>{x.label ?? x.path}</span>
          </li>
        ))}
        {t.calculatedFields.map((c) => (
          <li
            key={`calc:${c.name}`}
            className="er-tree__item er-tree__item--calc"
            draggable={!readOnly}
            onDragStart={(e) => setDragPayload(e, { kind: 'field', path: c.name, label: c.name, fieldType: c.type ?? 'number' })}
            title={c.expression}
          >
            {icon('calc', 14)}
            <span>{c.name}</span>
          </li>
        ))}
      </ul>
      {t.parameters.length > 0 && (
        <>
          <div className="er-subtitle">{labels.parameters}</div>
          <ul className="er-tree">
            {t.parameters.map((p) => (
              <li
                key={p.name}
                className="er-tree__item"
                draggable={!readOnly}
                onDragStart={(e) => setDragPayload(e, { kind: 'parameter', name: p.name, label: p.label ?? p.name, fieldType: p.type })}
                title={`?${p.name}`}
              >
                {icon('params', 14)}
                <span>{p.label || p.name}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {fields.length > 0 && !readOnly && (
        <components.Button variant="ghost" icon={icon('grid', 14)} onClick={() => setQuick(true)} title={labels.quickReportHint}>
          {labels.quickReport}
        </components.Button>
      )}
      {ds?.metrics && !readOnly && (
        <components.Button variant="ghost" icon={icon('sigma', 14)} onClick={() => setMetricOpen(true)} title={labels.metricHint}>
          {labels.addMetricColumn}
        </components.Button>
      )}
      {quick && <QuickReportDialog onClose={() => setQuick(false)} />}
      {metricOpen && ds?.metrics && <MetricColumnDialog ds={{ ...ds, metrics: ds.metrics }} onClose={() => setMetricOpen(false)} />}
    </div>
  );
}

function QuickReportDialog({ onClose }: { onClose: () => void }) {
  const cfg = useER();
  const { labels, components } = cfg;
  const { fields, store } = useDesigner();
  const t = store.template;
  const [selected, setSelected] = useState<string[]>(fields.slice(0, 6).map((f) => f.path));
  const [groupBy, setGroupBy] = useState<string>('');
  const [totals, setTotals] = useState<string[]>(fields.filter((f) => f.type === 'number').slice(0, 2).map((f) => f.path));
  const [landscape, setLandscape] = useState(false);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <components.Dialog
      open
      title={labels.quickReport}
      onClose={onClose}
      width={520}
      footer={
        <>
          <components.Button onClick={onClose}>{labels.cancel}</components.Button>
          <components.Button
            variant="primary"
            disabled={!selected.length}
            onClick={() => {
              const next = createTabularTemplate({
                name: t.name,
                dataSource: t.dataSource ?? '',
                fields: fields.filter((f) => selected.includes(f.path) || f.path === groupBy).map((f) => ({ name: f.path, label: f.label ?? f.name, type: f.type })),
                groupBy: groupBy ? [groupBy] : [],
                totals,
                landscape,
              });
              next.parameters = t.parameters;
              next.calculatedFields = t.calculatedFields;
              next.filter = t.filter;
              store.replace(next);
              onClose();
            }}
          >
            {labels.generate}
          </components.Button>
        </>
      }
    >
      <p className="er-muted">{labels.quickReportHint}</p>
      <div className="er-quick">
        <div>
          <div className="er-subtitle">{labels.selectFields}</div>
          {fields.map((f) => (
            <components.Checkbox key={f.path} checked={selected.includes(f.path)} onChange={() => setSelected(toggle(selected, f.path))} label={f.label ?? f.path} />
          ))}
        </div>
        <div>
          <div className="er-subtitle">{labels.groupBy}</div>
          <components.Select value={groupBy} onChange={setGroupBy} options={[{ value: '', label: labels.none }, ...fields.map((f) => ({ value: f.path, label: f.label ?? f.path }))]} />
          <div className="er-subtitle">{labels.totals}</div>
          {fields
            .filter((f) => f.type === 'number')
            .map((f) => (
              <components.Checkbox key={f.path} checked={totals.includes(f.path)} onChange={() => setTotals(toggle(totals, f.path))} label={f.label ?? f.path} />
            ))}
          <div className="er-subtitle">{labels.orientation}</div>
          <components.Checkbox checked={landscape} onChange={setLandscape} label={labels.landscape} />
        </div>
      </div>
    </components.Dialog>
  );
}
