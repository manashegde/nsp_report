import type { ReactNode } from 'react';
import { PAGE_SIZE_NAMES } from '../core/measure';
import { createBand, createGroup, findElement, listBands } from '../core/template';
import type {
  AnyElement,
  Band,
  BandKind,
  CalculatedField,
  CheckboxElement,
  ConditionalStyle,
  ElementStyle,
  FieldType,
  GroupDef,
  ImageElement,
  LineElement,
  ParameterDef,
  ReportTemplate,
  ShapeElement,
  SortSpec,
  TextElement,
} from '../core/types';
import { useER, type PropertyDescriptor } from '../ui/config';
import {
  BoolField,
  ColorField,
  ExpressionField,
  FormatField,
  ListEditor,
  NumberField,
  Row,
  Section,
  SelectField,
  TextField,
} from './controls';
import { useDesigner } from './context';
import { DataFiltersEditor, PeriodGroupPreset } from './DataTools';

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let cur = obj;
  for (const k of keys.slice(0, -1)) {
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1];
  if (value === undefined || value === '') delete cur[last];
  else cur[last] = value;
}

const FONT_FAMILIES = ['Helvetica, Arial, sans-serif', 'Times New Roman, Times, serif', 'Courier New, Courier, monospace'];

const TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Boolean' },
];

/* ------------------------------------------------------------------ */
/* Summary builder                                                      */
/* ------------------------------------------------------------------ */

const SUMMARY_FUNCS = ['Sum', 'Avg', 'Count', 'CountDistinct', 'Min', 'Max', 'PercentOfTotal', 'RunningSum', 'RunningCount', 'Median', 'StdDev', 'First', 'Last'];
const SUMMARY_RE = /^\s*(\w+)\(\s*\[([^\]]+)\]\s*(?:,\s*'([^']+)')?\s*\)\s*$/;

function defaultScope(kind: BandKind | undefined, fn: string, hasGroups: boolean): string {
  if (fn === 'PercentOfTotal') return 'report';
  if (kind === 'groupFooter' || kind === 'groupHeader') return 'group';
  if (kind === 'pageFooter' || kind === 'pageHeader') return 'page';
  if (kind === 'detail') return hasGroups ? 'group' : 'report';
  return 'report';
}

function SummaryEditor({ el, kind, onChange }: { el: TextElement; kind: BandKind | undefined; onChange: (expression: string, format?: string) => void }) {
  const { labels } = useER();
  const { fields, store } = useDesigner();
  const t = store.template;
  const m = SUMMARY_RE.exec(el.expression ?? '');
  const fn = m && SUMMARY_FUNCS.some((f) => f.toLowerCase() === m[1].toLowerCase()) ? SUMMARY_FUNCS.find((f) => f.toLowerCase() === m[1].toLowerCase())! : '';
  const field = fn ? m![2] : '';
  const scope = fn ? (m![3] ?? defaultScope(kind, fn, t.groups.length > 0)) : '';
  const allFields = [...fields.map((f) => ({ value: f.path, label: f.label ?? f.path })), ...t.calculatedFields.map((c) => ({ value: c.name, label: c.name }))];
  const scopes = [
    { value: 'group', label: 'Group' },
    { value: 'report', label: 'Report' },
    { value: 'page', label: 'Page' },
    ...t.groups.filter((g) => g.name).map((g) => ({ value: g.name!, label: `Group: ${g.name}` })),
  ];

  const emit = (f: string, fld: string, sc: string) => {
    if (!f) return onChange(fld ? `[${fld}]` : '');
    const target = fld || allFields[0]?.value || 'Field';
    const fmt = f === 'PercentOfTotal' ? 'p1' : f === 'Count' || f === 'CountDistinct' || f === 'RunningCount' ? 'n0' : el.format;
    onChange(`${f}([${target}], '${sc || defaultScope(kind, f, t.groups.length > 0)}')`, fmt);
  };

  return (
    <>
      <Row label={labels.summaryFunction}>
        <SelectField value={fn} onChange={(v) => emit(v, field || (SUMMARY_RE.exec(el.expression ?? '') ? '' : (/^\s*\[([^\]]+)\]\s*$/.exec(el.expression ?? '')?.[1] ?? '')), scope)} options={[{ value: '', label: labels.none }, ...SUMMARY_FUNCS.map((f) => ({ value: f, label: f }))]} />
      </Row>
      {fn && (
        <>
          <Row label={labels.summaryField}>
            <SelectField value={field} onChange={(v) => emit(fn, v, scope)} options={allFields} />
          </Row>
          <Row label={labels.summaryScope}>
            <SelectField value={scope} onChange={(v) => emit(fn, field, v)} options={scopes} />
          </Row>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Style editor (shared by single and multi selection)                  */
/* ------------------------------------------------------------------ */

function StyleEditor({ style, onChange, textual }: { style: ElementStyle; onChange: (key: string, v: unknown) => void; textual: boolean }) {
  const { labels, icon, components, pdf } = useER();
  const families = [...FONT_FAMILIES, ...(pdf?.fonts ?? []).map((f) => f.family)];
  const uniq = [...new Set(families)];
  const toggle = (key: 'bold' | 'italic' | 'underline', ic: 'bold' | 'italic' | 'underline') => (
    <components.Button variant="ghost" icon={icon(ic, 14)} title={key} active={!!style[key]} onClick={() => onChange(key, style[key] ? undefined : true)} />
  );
  return (
    <>
      {textual && (
        <>
          <Row label={labels.font}>
            <SelectField
              value={style.fontFamily ?? ''}
              onChange={(v) => onChange('fontFamily', v || undefined)}
              options={[{ value: '', label: '(default)' }, ...uniq.map((f) => ({ value: f, label: f.split(',')[0] })), ...(style.fontFamily && !uniq.includes(style.fontFamily) ? [{ value: style.fontFamily, label: style.fontFamily }] : [])]}
            />
          </Row>
          <Row label={labels.fontSize}>
            <div className="er-inline">
              <NumberField value={style.fontSize} min={4} max={96} step={0.5} onChange={(v) => onChange('fontSize', v)} />
              {toggle('bold', 'bold')}
              {toggle('italic', 'italic')}
              {toggle('underline', 'underline')}
            </div>
          </Row>
          <Row label={labels.align}>
            <div className="er-inline">
              {(['left', 'center', 'right'] as const).map((a) => (
                <components.Button
                  key={a}
                  variant="ghost"
                  icon={icon(a === 'left' ? 'alignLeft' : a === 'center' ? 'alignCenter' : 'alignRight', 14)}
                  title={a}
                  active={(style.textAlign ?? 'left') === a}
                  onClick={() => onChange('textAlign', a === 'left' ? undefined : a)}
                />
              ))}
              <SelectField
                value={style.verticalAlign ?? 'top'}
                onChange={(v) => onChange('verticalAlign', v === 'top' ? undefined : v)}
                options={[
                  { value: 'top', label: 'Top' },
                  { value: 'middle', label: 'Middle' },
                  { value: 'bottom', label: 'Bottom' },
                ]}
              />
            </div>
          </Row>
        </>
      )}
      <Row label={labels.color}>
        <ColorField value={style.color} onChange={(v) => onChange('color', v)} />
      </Row>
      <Row label={labels.background}>
        <ColorField value={style.backgroundColor} onChange={(v) => onChange('backgroundColor', v)} />
      </Row>
      {textual && (
        <Row label={labels.padding}>
          <NumberField value={style.padding} min={0} onChange={(v) => onChange('padding', v)} />
        </Row>
      )}
      <Row label={labels.border}>
        <div className="er-inline">
          <NumberField value={style.border?.width} min={0} step={0.5} onChange={(v) => onChange('border.width', v)} />
          <SelectField
            value={style.border?.style ?? 'solid'}
            onChange={(v) => onChange('border.style', v)}
            options={[
              { value: 'solid', label: 'Solid' },
              { value: 'dashed', label: 'Dashed' },
              { value: 'dotted', label: 'Dotted' },
            ]}
          />
        </div>
      </Row>
      {!!style.border?.width && (
        <>
          <Row label="">
            <ColorField value={style.border?.color} onChange={(v) => onChange('border.color', v)} />
          </Row>
          <Row label="">
            <div className="er-inline er-sides">
              {(['top', 'right', 'bottom', 'left'] as const).map((side) => {
                const sides = style.border?.sides;
                const on = !sides || !!sides[side];
                return (
                  <components.Checkbox
                    key={side}
                    checked={on}
                    label={side[0].toUpperCase()}
                    title={side}
                    onChange={(c) => {
                      const base = sides ?? { top: true, right: true, bottom: true, left: true };
                      onChange('border.sides', { ...base, [side]: c });
                    }}
                  />
                );
              })}
            </div>
          </Row>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Element properties                                                    */
/* ------------------------------------------------------------------ */

function CustomProps({ descriptors, el, set }: { descriptors: PropertyDescriptor[]; el: AnyElement; set: (key: string, v: unknown) => void }) {
  return (
    <>
      {descriptors.map((d) => {
        const v = getPath(el, d.key);
        let control: ReactNode;
        switch (d.type) {
          case 'number':
            control = <NumberField value={v as number} onChange={(x) => set(d.key, x)} />;
            break;
          case 'color':
            control = <ColorField value={v as string} onChange={(x) => set(d.key, x)} />;
            break;
          case 'boolean':
            control = <BoolField value={!!v} onChange={(x) => set(d.key, x)} />;
            break;
          case 'select':
            control = <SelectField value={String(v ?? '')} onChange={(x) => set(d.key, x)} options={d.options ?? []} />;
            break;
          case 'expression':
            control = <ExpressionField value={v as string} onChange={(x) => set(d.key, x)} placeholder={d.placeholder} />;
            break;
          case 'format':
            control = <FormatField value={v as string} onChange={(x) => set(d.key, x)} />;
            break;
          default:
            control = <TextField value={v as string} onChange={(x) => set(d.key, x)} placeholder={d.placeholder} />;
        }
        return (
          <Row key={d.key} label={d.label}>
            {control}
          </Row>
        );
      })}
    </>
  );
}

function ElementProps({ id }: { id: string }) {
  const cfg = useER();
  const { labels, components } = cfg;
  const { store } = useDesigner();
  const t = store.template;
  const hit = findElement(t, id);
  if (!hit) return null;
  const { element: el, band } = hit;
  const bandRef = listBands(t).find((b) => b.band.id === band.id);
  const custom = cfg.elementTypes.find((x) => x.type === el.type);

  const set = (key: string, v: unknown) =>
    store.update((d) => {
      const h = findElement(d, id);
      if (h) {
        setPath(h.element as unknown as Record<string, unknown>, key, v);
        h.band.height = Math.max(h.band.height, h.element.y + h.element.height);
      }
    }, `${id}:${key}`);

  const textual = el.type === 'text';
  const te = el as TextElement;
  const isBound = te.expression !== undefined;

  const typeLabel =
    custom?.label ??
    ({ text: isBound ? labels.expression : labels.label, image: 'Image', line: 'Line', shape: 'Shape', checkbox: 'Check box' } as Record<string, string>)[el.type] ??
    el.type;

  return (
    <div className="er-props">
      <div className="er-props__title">
        <span>{typeLabel}</span>
        <span className="er-muted">{bandRef?.label}</span>
      </div>
      <Section title={labels.data}>
        <Row label={labels.name}>
          <TextField value={el.name} onChange={(v) => set('name', v)} placeholder={el.id} />
        </Row>
        {el.type === 'text' && (
          <>
            <Row label={labels.type}>
              <SelectField
                value={isBound ? 'expression' : 'text'}
                onChange={(v) =>
                  store.update((d) => {
                    const h = findElement(d, id);
                    if (!h) return;
                    const e = h.element as TextElement;
                    if (v === 'expression') e.expression = e.expression ?? (e.text ? `'${e.text.replace(/'/g, "''")}'` : '');
                    else {
                      delete e.expression;
                      e.text = e.text ?? '';
                    }
                  })
                }
                options={[
                  { value: 'text', label: labels.text },
                  { value: 'expression', label: labels.expression },
                ]}
              />
            </Row>
            {isBound ? (
              <>
                <Row label={labels.expression}>
                  <ExpressionField value={te.expression} onChange={(v) => set('expression', v)} />
                </Row>
                <SummaryEditor
                  el={te}
                  kind={bandRef?.kind}
                  onChange={(expr, fmt) =>
                    store.update((d) => {
                      const h = findElement(d, id);
                      if (!h) return;
                      const e = h.element as TextElement;
                      e.expression = expr;
                      if (fmt !== undefined) e.format = fmt;
                    })
                  }
                />
              </>
            ) : (
              <Row label={labels.text} wide>
                <components.TextArea value={te.text ?? ''} onChange={(v) => set('text', v)} rows={2} />
                <div className="er-field__hint">{'Use {[Field]} or {Sum([Amount]):c2} to embed values.'}</div>
              </Row>
            )}
            <Row label={labels.format}>
              <FormatField value={te.format} onChange={(v) => set('format', v)} />
            </Row>
          </>
        )}
        {el.type === 'image' && (
          <>
            <Row label={labels.imageSource}>
              <TextField value={(el as ImageElement).src} onChange={(v) => set('src', v)} placeholder="https://… or data:image/…" />
            </Row>
            <Row label={labels.expression}>
              <ExpressionField value={(el as ImageElement).expression} onChange={(v) => set('expression', v)} placeholder="[PhotoUrl]" />
            </Row>
            <Row label={labels.fit}>
              <SelectField
                value={(el as ImageElement).fit ?? 'contain'}
                onChange={(v) => set('fit', v)}
                options={[
                  { value: 'contain', label: 'Contain' },
                  { value: 'cover', label: 'Cover' },
                  { value: 'stretch', label: 'Stretch' },
                ]}
              />
            </Row>
          </>
        )}
        {el.type === 'checkbox' && (
          <Row label={labels.expression}>
            <ExpressionField value={(el as CheckboxElement).expression} onChange={(v) => set('expression', v)} boolean placeholder="[IsPaid]" />
          </Row>
        )}
        {el.type === 'line' && (
          <>
            <Row label={labels.lineDirection}>
              <SelectField
                value={(el as LineElement).direction}
                onChange={(v) => set('direction', v)}
                options={[
                  { value: 'horizontal', label: 'Horizontal' },
                  { value: 'vertical', label: 'Vertical' },
                ]}
              />
            </Row>
            <Row label={labels.color}>
              <ColorField value={(el as LineElement).color} onChange={(v) => set('color', v)} />
            </Row>
            <Row label={labels.thickness}>
              <NumberField value={(el as LineElement).thickness} min={0.25} step={0.25} onChange={(v) => set('thickness', v)} />
            </Row>
            <Row label={labels.lineStyle}>
              <SelectField
                value={(el as LineElement).lineStyle ?? 'solid'}
                onChange={(v) => set('lineStyle', v)}
                options={[
                  { value: 'solid', label: 'Solid' },
                  { value: 'dashed', label: 'Dashed' },
                  { value: 'dotted', label: 'Dotted' },
                ]}
              />
            </Row>
          </>
        )}
        {el.type === 'shape' && (
          <>
            <Row label={labels.shape}>
              <SelectField
                value={(el as ShapeElement).shape}
                onChange={(v) => set('shape', v)}
                options={[
                  { value: 'rectangle', label: 'Rectangle' },
                  { value: 'ellipse', label: 'Ellipse' },
                ]}
              />
            </Row>
            <Row label={labels.fill}>
              <ColorField value={(el as ShapeElement).fill} onChange={(v) => set('fill', v)} />
            </Row>
            <Row label={labels.stroke}>
              <ColorField value={(el as ShapeElement).stroke} onChange={(v) => set('stroke', v)} />
            </Row>
            <Row label={labels.strokeWidth}>
              <NumberField value={(el as ShapeElement).strokeWidth} min={0} step={0.5} onChange={(v) => set('strokeWidth', v)} />
            </Row>
            <Row label={labels.radius}>
              <NumberField value={(el as ShapeElement).radius} min={0} onChange={(v) => set('radius', v)} />
            </Row>
          </>
        )}
        {custom?.properties && <CustomProps descriptors={custom.properties} el={el} set={set} />}
      </Section>

      {(textual || el.type === 'checkbox' || el.type === 'image') && (
        <Section title={labels.appearance}>
          <StyleEditor style={el.style ?? {}} textual={textual} onChange={(k, v) => set(`style.${k}`, v)} />
        </Section>
      )}

      <Section title={labels.layout}>
        <Row label={`${labels.x} / ${labels.y}`}>
          <div className="er-inline">
            <NumberField value={el.x} min={0} onChange={(v) => set('x', v ?? 0)} />
            <NumberField value={el.y} min={0} onChange={(v) => set('y', v ?? 0)} />
          </div>
        </Row>
        <Row label={`${labels.width} / ${labels.height}`}>
          <div className="er-inline">
            <NumberField value={el.width} min={1} onChange={(v) => set('width', v ?? 1)} />
            <NumberField value={el.height} min={1} onChange={(v) => set('height', v ?? 1)} />
          </div>
        </Row>
        {textual && (
          <>
            <Row label="">
              <BoolField value={te.canGrow} onChange={(v) => set('canGrow', v || undefined)} label={labels.canGrow} />
            </Row>
            <Row label="">
              <BoolField value={te.wordWrap !== false} onChange={(v) => set('wordWrap', v ? undefined : false)} label={labels.wordWrap} />
            </Row>
          </>
        )}
      </Section>

      <Section title={labels.behavior} defaultOpen={!!el.visible || !!el.conditionalStyles?.length}>
        <Row label={labels.visibleWhen}>
          <ExpressionField value={el.visible} onChange={(v) => set('visible', v)} boolean placeholder="[Qty] > 0" />
        </Row>
        {textual && (
          <Row label={labels.exportName}>
            <TextField value={te.exportName} onChange={(v) => set('exportName', v)} />
          </Row>
        )}
        <div className="er-subtitle">{labels.conditionalFormatting}</div>
        <ListEditor<ConditionalStyle>
          items={el.conditionalStyles ?? []}
          onChange={(items) =>
            store.update((d) => {
              const h = findElement(d, id);
              if (h) h.element.conditionalStyles = items.length ? items : undefined;
            })
          }
          create={() => ({ condition: '', style: { color: '#d92d20' } })}
          addLabel={labels.addCondition}
          itemLabel={(c) => <span className="er-mono">{c.condition || '…'}</span>}
          render={(c, upd) => (
            <>
              <Row label={labels.condition}>
                <ExpressionField value={c.condition} onChange={(v) => upd({ condition: v })} boolean placeholder="[Amount] < 0" />
              </Row>
              <StyleEditor
                style={c.style}
                textual={textual}
                onChange={(k, v) => {
                  const s = structuredClone(c.style) as Record<string, unknown>;
                  setPath(s, k, v);
                  upd({ style: s as ElementStyle });
                }}
              />
            </>
          )}
        />
      </Section>
    </div>
  );
}

function MultiProps({ ids }: { ids: string[] }) {
  const { labels } = useER();
  const { store } = useDesigner();
  const first = findElement(store.template, ids[0])?.element;
  return (
    <div className="er-props">
      <div className="er-props__title">
        <span>
          {ids.length} {labels.multipleSelected}
        </span>
      </div>
      <Section title={labels.appearance}>
        <StyleEditor
          style={first?.style ?? {}}
          textual
          onChange={(k, v) =>
            store.updateSelected((el) => {
              el.style = el.style ?? {};
              setPath(el.style as Record<string, unknown>, k, v);
            }, `multi:${k}`)
          }
        />
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Band & group properties                                              */
/* ------------------------------------------------------------------ */

function GroupFields({ g, upd }: { g: GroupDef; upd: (patch: Partial<GroupDef>) => void }) {
  const { labels } = useER();
  return (
    <>
      <Row label={labels.name}>
        <TextField value={g.name} onChange={(v) => upd({ name: v || undefined })} />
      </Row>
      <Row label={labels.expression}>
        <ExpressionField value={g.expression} onChange={(v) => upd({ expression: v })} placeholder="[Category]" />
      </Row>
      <PeriodGroupPreset onPick={(expression) => upd({ expression })} />
      <Row label={labels.sorting}>
        <SelectField
          value={g.direction}
          onChange={(v) => upd({ direction: v })}
          options={[
            { value: 'asc', label: labels.ascending },
            { value: 'desc', label: labels.descending },
          ]}
        />
      </Row>
      <Row label="">
        <BoolField value={!!g.header} label={labels.groupHeader} onChange={(v) => upd({ header: v ? createBand(26) : undefined })} />
      </Row>
      <Row label="">
        <BoolField value={!!g.footer} label={labels.groupFooter} onChange={(v) => upd({ footer: v ? createBand(26) : undefined })} />
      </Row>
      <Row label="">
        <BoolField value={g.keepWithFirstRow !== false} label={labels.keepWithFirstRow} onChange={(v) => upd({ keepWithFirstRow: v })} />
      </Row>
    </>
  );
}

function BandProps({ bandId }: { bandId: string }) {
  const { labels } = useER();
  const { store } = useDesigner();
  const t = store.template;
  const ref = listBands(t).find((b) => b.band.id === bandId);
  if (!ref) return null;
  const band = ref.band;
  const set = <K extends keyof Band>(key: K, v: Band[K]) =>
    store.update((d) => {
      const b = listBands(d).find((x) => x.band.id === bandId)?.band;
      if (!b) return;
      if (v === undefined || v === false || v === '') delete b[key];
      else b[key] = v;
    }, `${bandId}:${String(key)}`);
  const group = ref.groupId ? t.groups.find((g) => g.id === ref.groupId) : undefined;
  const removable: Partial<Record<BandKind, keyof ReportTemplate['bands']>> = {
    reportHeader: 'reportHeader',
    pageHeader: 'pageHeader',
    reportFooter: 'reportFooter',
    pageFooter: 'pageFooter',
  };

  return (
    <div className="er-props">
      <div className="er-props__title">
        <span>{ref.label}</span>
      </div>
      <Section title={labels.band}>
        <Row label={labels.height}>
          <NumberField value={band.height} min={0} onChange={(v) => set('height', Math.max(0, v ?? 0))} />
        </Row>
        <Row label={labels.background}>
          <ColorField value={band.backgroundColor} onChange={(v) => set('backgroundColor', v)} />
        </Row>
        {ref.kind === 'detail' && (
          <Row label={labels.alternateRowColor}>
            <ColorField value={band.alternateBackgroundColor} onChange={(v) => set('alternateBackgroundColor', v)} />
          </Row>
        )}
        <Row label={labels.visibleWhen}>
          <ExpressionField value={band.visible} onChange={(v) => set('visible', v)} boolean />
        </Row>
        {ref.kind !== 'pageHeader' && ref.kind !== 'pageFooter' && (
          <>
            <Row label="">
              <BoolField value={band.pageBreakBefore} onChange={(v) => set('pageBreakBefore', v)} label={labels.pageBreakBefore} />
            </Row>
            <Row label="">
              <BoolField value={band.pageBreakAfter} onChange={(v) => set('pageBreakAfter', v)} label={labels.pageBreakAfter} />
            </Row>
          </>
        )}
        {ref.kind === 'groupHeader' && (
          <Row label="">
            <BoolField value={band.repeatOnEveryPage} onChange={(v) => set('repeatOnEveryPage', v)} label={labels.repeatHeader} />
          </Row>
        )}
      </Section>
      {group && (
        <Section title={labels.groups}>
          <GroupFields
            g={group}
            upd={(patch) =>
              store.update((d) => {
                const g = d.groups.find((x) => x.id === group.id);
                if (g) Object.assign(g, patch);
              }, `${group.id}:${Object.keys(patch).join()}`)
            }
          />
        </Section>
      )}
      {removable[ref.kind] && (
        <Section title={labels.remove} defaultOpen={false}>
          <RemoveBand which={removable[ref.kind]!} />
        </Section>
      )}
    </div>
  );
}

function RemoveBand({ which }: { which: keyof ReportTemplate['bands'] }) {
  const { labels, components } = useER();
  const { store } = useDesigner();
  return (
    <components.Button
      variant="danger"
      onClick={() =>
        store.update((d) => {
          delete d.bands[which];
        })
      }
    >
      {labels.remove}
    </components.Button>
  );
}

/* ------------------------------------------------------------------ */
/* Report properties                                                    */
/* ------------------------------------------------------------------ */

function parseOptions(text: string) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [v, ...rest] = l.split('=');
      return { value: v.trim(), label: (rest.join('=') || v).trim() };
    });
}

function ParameterFields({ p, upd }: { p: ParameterDef; upd: (patch: Partial<ParameterDef>) => void }) {
  const { labels, components, parameterLookups } = useER();
  const lookups = Object.keys(parameterLookups ?? {});
  const coerce = (s: string): unknown => {
    if (s === '') return undefined;
    if (s.startsWith('=')) return s;
    if (p.type === 'number') return Number.isFinite(Number(s)) ? Number(s) : s;
    return s;
  };
  return (
    <>
      <Row label={labels.name}>
        <TextField value={p.name} onChange={(v) => upd({ name: v.replace(/[^\w]/g, '') })} />
      </Row>
      <Row label={labels.label}>
        <TextField value={p.label} onChange={(v) => upd({ label: v || undefined })} />
      </Row>
      <Row label={labels.type}>
        <SelectField value={p.type} onChange={(v) => upd({ type: v })} options={TYPE_OPTIONS} />
      </Row>
      <Row label={labels.defaultValue}>
        {p.type === 'boolean' ? (
          <BoolField value={!!p.defaultValue} onChange={(v) => upd({ defaultValue: v })} />
        ) : (
          <TextField value={p.defaultValue === undefined || p.defaultValue === null ? '' : String(p.defaultValue)} onChange={(v) => upd({ defaultValue: coerce(v) })} placeholder={p.type === 'date' ? '=Today()  or  2024-01-31' : ''} />
        )}
      </Row>
      <Row label="">
        <BoolField value={p.required} onChange={(v) => upd({ required: v || undefined })} label={labels.required_} />
      </Row>
      <Row label="">
        <BoolField value={p.multiValue} onChange={(v) => upd({ multiValue: v || undefined })} label={labels.multiValue} />
      </Row>
      <Row label="">
        <BoolField value={p.visible !== false} onChange={(v) => upd({ visible: v ? undefined : false })} label="Visible" />
      </Row>
      {lookups.length > 0 && (
        <Row label={labels.lookup}>
          <SelectField value={p.lookup ?? ''} onChange={(v) => upd({ lookup: v || undefined })} options={[{ value: '', label: labels.none }, ...lookups.map((l) => ({ value: l, label: l }))]} />
        </Row>
      )}
      <Row label={labels.options} wide>
        <components.TextArea
          rows={3}
          value={(p.options ?? []).map((o) => (String(o.value) === o.label ? String(o.value) : `${o.value}=${o.label}`)).join('\n')}
          onChange={(v) => {
            const opts = parseOptions(v).map((o) => ({ ...o, value: p.type === 'number' && Number.isFinite(Number(o.value)) ? Number(o.value) : o.value }));
            upd({ options: opts.length ? opts : undefined });
          }}
          placeholder={'value=Label (one per line)'}
        />
      </Row>
      <Row label={labels.description}>
        <TextField value={p.description} onChange={(v) => upd({ description: v || undefined })} />
      </Row>
    </>
  );
}

function ReportProps() {
  const { labels } = useER();
  const { store, dataSources } = useDesigner();
  const t = store.template;
  const upd = (fn: (d: ReportTemplate) => void, key: string) => store.update(fn, `report:${key}`);
  const isCustom = typeof t.page.size !== 'string';
  const bandToggle = (key: 'reportHeader' | 'pageHeader' | 'reportFooter' | 'pageFooter', label: string) => (
    <Row label="">
      <BoolField
        value={!!t.bands[key]}
        label={label}
        onChange={(v) =>
          store.update((d) => {
            if (v) d.bands[key] = createBand(key === 'reportHeader' ? 50 : 28);
            else delete d.bands[key];
          })
        }
      />
    </Row>
  );

  return (
    <div className="er-props">
      <div className="er-props__title">
        <span>{labels.report}</span>
      </div>
      <Section title={labels.general}>
        <Row label={labels.name}>
          <TextField value={t.name} onChange={(v) => upd((d) => void (d.name = v), 'name')} />
        </Row>
        <Row label={labels.description}>
          <TextField value={t.description} onChange={(v) => upd((d) => void (d.description = v || undefined), 'description')} />
        </Row>
      </Section>

      <Section title={labels.data}>
        <Row label={labels.dataSource}>
          <SelectField
            value={t.dataSource ?? ''}
            onChange={(v) => upd((d) => void (d.dataSource = v || undefined), 'ds')}
            options={[{ value: '', label: labels.noDataSource }, ...dataSources.map((d) => ({ value: d.name, label: d.label ?? d.name }))]}
          />
        </Row>
        <DataFiltersEditor />
        <Row label={labels.filter}>
          <ExpressionField value={t.filter} onChange={(v) => upd((d) => void (d.filter = v || undefined), 'filter')} boolean placeholder="[Date] >= ?StartDate" />
        </Row>
        <div className="er-subtitle">{labels.sorting}</div>
        <ListEditor<SortSpec>
          items={t.sort}
          onChange={(items) => upd((d) => void (d.sort = items), 'sort')}
          create={() => ({ expression: '', direction: 'asc' })}
          addLabel={labels.addSort}
          itemLabel={(s) => (
            <span className="er-mono">
              {s.expression || '…'} {s.direction === 'desc' ? '↓' : '↑'}
            </span>
          )}
          render={(s, u) => (
            <>
              <Row label={labels.expression}>
                <ExpressionField value={s.expression} onChange={(v) => u({ expression: v })} placeholder="[Name]" />
              </Row>
              <Row label="">
                <SelectField
                  value={s.direction}
                  onChange={(v) => u({ direction: v })}
                  options={[
                    { value: 'asc', label: labels.ascending },
                    { value: 'desc', label: labels.descending },
                  ]}
                />
              </Row>
            </>
          )}
        />
      </Section>

      <Section title={labels.groups}>
        <ListEditor<GroupDef>
          items={t.groups}
          onChange={(items) => upd((d) => void (d.groups = items), 'groups')}
          create={() => createGroup('', `Group${t.groups.length + 1}`)}
          addLabel={labels.addGroup}
          itemLabel={(g, i) => (
            <span>
              {i + 1}. {g.name || g.expression || '…'}
            </span>
          )}
          render={(g, u) => <GroupFields g={g} upd={u} />}
        />
      </Section>

      <Section title={labels.parameters}>
        <ListEditor<ParameterDef>
          items={t.parameters}
          onChange={(items) => upd((d) => void (d.parameters = items), 'params')}
          create={() => ({ name: `Param${t.parameters.length + 1}`, type: 'string' })}
          addLabel={labels.addParameter}
          itemLabel={(p) => (
            <span>
              <span className="er-mono">?{p.name}</span> <span className="er-muted">{p.type}</span>
            </span>
          )}
          render={(p, u) => <ParameterFields p={p} upd={u} />}
        />
      </Section>

      <Section title={labels.calculatedFields} defaultOpen={t.calculatedFields.length > 0}>
        <ListEditor<CalculatedField>
          items={t.calculatedFields}
          onChange={(items) => upd((d) => void (d.calculatedFields = items), 'calc')}
          create={() => ({ name: `Calc${t.calculatedFields.length + 1}`, expression: '', type: 'number' })}
          addLabel={labels.addCalculatedField}
          itemLabel={(c) => <span className="er-mono">{c.name}</span>}
          render={(c, u) => (
            <>
              <Row label={labels.name}>
                <TextField value={c.name} onChange={(v) => u({ name: v.replace(/[[\]]/g, '') })} />
              </Row>
              <Row label={labels.expression}>
                <ExpressionField value={c.expression} onChange={(v) => u({ expression: v })} placeholder="[Price] * [Qty]" />
              </Row>
              <Row label={labels.type}>
                <SelectField value={c.type ?? 'number'} onChange={(v) => u({ type: v })} options={TYPE_OPTIONS} />
              </Row>
            </>
          )}
        />
      </Section>

      <Section title={labels.page} defaultOpen={false}>
        <Row label={labels.pageSize}>
          <SelectField
            value={isCustom ? 'Custom' : (t.page.size as string)}
            onChange={(v) =>
              upd((d) => {
                d.page.size = v === 'Custom' ? { width: 794, height: 1123 } : (v as ReportTemplate['page']['size']);
              }, 'size')
            }
            options={[...PAGE_SIZE_NAMES.map((n) => ({ value: n, label: n })), { value: 'Custom', label: 'Custom' }]}
          />
        </Row>
        {isCustom && (
          <Row label={`${labels.width} / ${labels.height}`}>
            <div className="er-inline">
              <NumberField value={(t.page.size as { width: number }).width} min={100} onChange={(v) => upd((d) => void ((d.page.size as { width: number }).width = v ?? 794), 'w')} />
              <NumberField value={(t.page.size as { height: number }).height} min={100} onChange={(v) => upd((d) => void ((d.page.size as { height: number }).height = v ?? 1123), 'h')} />
            </div>
          </Row>
        )}
        <Row label={labels.orientation}>
          <SelectField
            value={t.page.orientation}
            onChange={(v) => upd((d) => void (d.page.orientation = v), 'orientation')}
            options={[
              { value: 'portrait', label: labels.portrait },
              { value: 'landscape', label: labels.landscape },
            ]}
          />
        </Row>
        <Row label={labels.margins}>
          <div className="er-margins">
            {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
              <label key={side} title={side}>
                <span>{side[0].toUpperCase()}</span>
                <NumberField value={t.page.margins[side]} min={0} onChange={(v) => upd((d) => void (d.page.margins[side] = v ?? 0), `m${side}`)} />
              </label>
            ))}
          </div>
        </Row>
      </Section>

      <Section title={labels.bands} defaultOpen={false}>
        {bandToggle('reportHeader', labels.reportHeader)}
        {bandToggle('pageHeader', labels.pageHeader)}
        {bandToggle('reportFooter', labels.reportFooter)}
        {bandToggle('pageFooter', labels.pageFooter)}
      </Section>

      <Section title={labels.defaultFont} defaultOpen={false}>
        <StyleEditor
          style={t.defaultStyle ?? {}}
          textual
          onChange={(k, v) =>
            upd((d) => {
              d.defaultStyle = d.defaultStyle ?? {};
              setPath(d.defaultStyle as Record<string, unknown>, k, v);
            }, `default:${k}`)
          }
        />
        <Row label={labels.locale}>
          <TextField value={t.locale} onChange={(v) => upd((d) => void (d.locale = v || undefined), 'locale')} placeholder="en-US" />
        </Row>
        <Row label={labels.currency}>
          <TextField value={t.currency} onChange={(v) => upd((d) => void (d.currency = v.toUpperCase() || undefined), 'currency')} placeholder="USD" />
        </Row>
      </Section>
    </div>
  );
}

export function PropertiesPanel() {
  const { store } = useDesigner();
  const { selection, bandId } = store.state;
  if (selection.length === 1) return <ElementProps id={selection[0]} />;
  if (selection.length > 1) return <MultiProps ids={selection} />;
  if (bandId) return <BandProps bandId={bandId} />;
  return <ReportProps />;
}
