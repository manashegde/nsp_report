import { useId, useState, type ReactNode } from 'react';
import { validateExpression } from '../core/expression';
import { useER } from '../ui/config';
import { useDesigner } from './context';

export function Section({ title, children, defaultOpen = true, actions }: { title: string; children: ReactNode; defaultOpen?: boolean; actions?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="er-section">
      <div className="er-section__header">
        <button type="button" className="er-section__toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className={`er-chevron ${open ? 'er-chevron--open' : ''}`}>▸</span>
          {title}
        </button>
        {actions}
      </div>
      {open && <div className="er-section__body">{children}</div>}
    </section>
  );
}

export function Row({ label, children, wide }: { label: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`er-row ${wide ? 'er-row--wide' : ''}`}>
      <div className="er-row__label">{label}</div>
      <div className="er-row__control">{children}</div>
    </div>
  );
}

export function TextField({ value, onChange, placeholder }: { value: string | undefined; onChange: (v: string) => void; placeholder?: string }) {
  const { Input } = useER().components;
  return <Input value={value ?? ''} onChange={onChange} placeholder={placeholder} />;
}

export function NumberField({ value, onChange, min, max, step }: { value: number | undefined; onChange: (v: number | undefined) => void; min?: number; max?: number; step?: number }) {
  const { Input } = useER().components;
  return (
    <Input
      type="number"
      value={value === undefined || value === null ? '' : String(value)}
      min={min}
      max={max}
      step={step}
      onChange={(s) => {
        if (s === '') return onChange(undefined);
        const n = Number(s);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

export function ColorField({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  const { Input, Button } = useER().components;
  const hex = value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  return (
    <div className="er-color">
      <input type="color" className="er-color__swatch" value={hex} onChange={(e) => onChange(e.target.value)} aria-label="Pick color" />
      <Input value={value ?? ''} onChange={(v) => onChange(v || undefined)} placeholder="—" />
      {value && <Button variant="ghost" title="Clear" onClick={() => onChange(undefined)}>×</Button>}
    </div>
  );
}

export function SelectField<T extends string>({ value, onChange, options }: { value: T | undefined; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  const { Select } = useER().components;
  return <Select value={value ?? ''} onChange={(v) => onChange(v as T)} options={options} />;
}

export function BoolField({ value, onChange, label }: { value: boolean | undefined; onChange: (v: boolean) => void; label?: string }) {
  const { Checkbox } = useER().components;
  return <Checkbox checked={!!value} onChange={onChange} label={label} />;
}

/** Text input + "…" button opening the expression editor. */
export function ExpressionField({
  value,
  onChange,
  placeholder,
  title,
  boolean,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  title?: string;
  boolean?: boolean;
}) {
  const { components, labels, icon } = useER();
  const { openExpression } = useDesigner();
  const err = value ? validateExpression(value) : null;
  const id = useId();
  return (
    <div className="er-exprfield">
      <components.Input id={id} value={value ?? ''} onChange={onChange} placeholder={placeholder} invalid={!!err} title={err ?? undefined} className="er-mono" />
      <components.Button
        variant="ghost"
        icon={icon('expression', 14)}
        title={labels.editExpression}
        onClick={() => openExpression({ value: value ?? '', onApply: onChange, title, boolean })}
      />
    </div>
  );
}

const FORMAT_PRESETS = [
  { value: '', label: 'General' },
  { value: 'n0', label: '1,235 (n0)' },
  { value: 'n2', label: '1,234.57 (n2)' },
  { value: 'c2', label: 'Currency (c2)' },
  { value: 'p0', label: 'Percent (p0)' },
  { value: 'p1', label: 'Percent (p1)' },
  { value: 'd', label: 'Short date (d)' },
  { value: 'D', label: 'Long date (D)' },
  { value: 'g', label: 'Date + time (g)' },
  { value: 'yyyy-MM-dd', label: 'yyyy-MM-dd' },
  { value: 'dd/MM/yyyy', label: 'dd/MM/yyyy' },
  { value: 'MMM yyyy', label: 'MMM yyyy' },
  { value: 'Yes|No', label: 'Yes|No' },
];

export function FormatField({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  const { Input, Select } = useER().components;
  const known = FORMAT_PRESETS.some((p) => p.value === (value ?? ''));
  return (
    <div className="er-format">
      <Select
        value={known ? (value ?? '') : '__custom'}
        onChange={(v) => v !== '__custom' && onChange(v || undefined)}
        options={[...FORMAT_PRESETS, ...(known ? [] : [{ value: '__custom', label: 'Custom' }])]}
      />
      <Input value={value ?? ''} onChange={(v) => onChange(v || undefined)} placeholder="#,##0.00" className="er-mono" />
    </div>
  );
}

/** Generic editable list (parameters, sort, calculated fields, groups ...). */
export function ListEditor<T>({
  items,
  onChange,
  create,
  render,
  addLabel,
  itemLabel,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  create: () => T;
  render: (item: T, update: (patch: Partial<T>) => void, index: number) => ReactNode;
  addLabel: string;
  itemLabel: (item: T, index: number) => ReactNode;
}) {
  const { components, labels, icon } = useER();
  const [open, setOpen] = useState<number | null>(null);
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    if (open === i) setOpen(j);
  };
  return (
    <div className="er-list">
      {items.map((item, i) => (
        <div key={i} className={`er-list__item ${open === i ? 'er-list__item--open' : ''}`}>
          <div className="er-list__head">
            <button type="button" className="er-list__title" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
              <span className={`er-chevron ${open === i ? 'er-chevron--open' : ''}`}>▸</span>
              {itemLabel(item, i)}
            </button>
            <components.Button variant="ghost" icon={icon('up', 14)} title={labels.moveUp} disabled={i === 0} onClick={() => move(i, -1)} />
            <components.Button variant="ghost" icon={icon('down', 14)} title={labels.moveDown} disabled={i === items.length - 1} onClick={() => move(i, 1)} />
            <components.Button variant="ghost" icon={icon('trash', 14)} title={labels.remove} onClick={() => onChange(items.filter((_, k) => k !== i))} />
          </div>
          {open === i && (
            <div className="er-list__body">
              {render(item, (patch) => onChange(items.map((x, k) => (k === i ? { ...x, ...patch } : x))), i)}
            </div>
          )}
        </div>
      ))}
      <components.Button
        variant="ghost"
        icon={icon('plus', 14)}
        onClick={() => {
          onChange([...items, create()]);
          setOpen(items.length);
        }}
      >
        {addLabel}
      </components.Button>
    </div>
  );
}
