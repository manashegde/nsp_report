import { useEffect, useState } from 'react';
import { formatValue, toDate } from '../core/format';
import type { ParameterDef, ParameterLookup, ParameterOption } from '../core/types';
import { useER } from '../ui/config';

function toInputValue(p: ParameterDef, v: unknown): string {
  if (v === null || v === undefined) return '';
  if (p.type === 'date') {
    const d = toDate(v);
    return d ? formatValue(d, 'yyyy-MM-dd') : '';
  }
  return String(v);
}

function fromInputValue(p: ParameterDef, s: string): unknown {
  if (s === '') return null;
  if (p.type === 'number') {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (p.type === 'date') return toDate(s);
  if (p.type === 'boolean') return s === 'true';
  return s;
}

const key = (v: unknown) => (v instanceof Date ? formatValue(v, 'yyyy-MM-dd') : String(v));

function useOptions(
  p: ParameterDef,
  lookups: Record<string, ParameterLookup> | undefined,
  values: Record<string, unknown>,
  filters: Record<string, unknown> | undefined,
) {
  const [opts, setOpts] = useState<ParameterOption[] | undefined>(p.options?.length ? p.options : undefined);
  const lookup = p.lookup ? lookups?.[p.lookup] : undefined;
  useEffect(() => {
    if (!lookup) {
      setOpts(p.options?.length ? p.options : undefined);
      return;
    }
    let live = true;
    // The report's design-time selection (e.g. its tags) lets a lookup offer only relevant options.
    Promise.resolve(lookup({ parameters: values, filters })).then((o) => live && setOpts(o));
    return () => {
      live = false;
    };
    // Lookups may depend on other parameter values (cascading).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup, p.options, JSON.stringify(values), JSON.stringify(filters)]);
  return opts;
}

function ParameterInput({
  p,
  value,
  onChange,
  all,
  filters,
}: {
  p: ParameterDef;
  value: unknown;
  onChange: (v: unknown) => void;
  all: Record<string, unknown>;
  filters?: Record<string, unknown>;
}) {
  const { components, labels, parameterLookups, dateLimits } = useER();
  const { Input, Select, Checkbox } = components;
  const options = useOptions(p, parameterLookups, all, filters);
  const id = `er-param-${p.name}`;

  if (options) {
    if (p.multiValue) {
      const vals = Array.isArray(value) ? value.map(key) : [];
      return (
        <Select
          id={id}
          multiple
          value=""
          values={vals}
          onChange={() => {}}
          onChangeMultiple={(vs) => onChange(options.filter((o) => vs.includes(key(o.value))).map((o) => o.value))}
          options={options.map((o) => ({ value: key(o.value), label: o.label }))}
        />
      );
    }
    return (
      <Select
        id={id}
        value={value === null || value === undefined ? '' : key(value)}
        onChange={(v) => onChange(v === '' ? null : (options.find((o) => key(o.value) === v)?.value ?? v))}
        // An optional filter left empty means "no filter", so say so rather than showing a blank.
        options={[{ value: '', label: p.required ? '' : labels.all }, ...options.map((o) => ({ value: key(o.value), label: o.label }))]}
      />
    );
  }
  if (p.type === 'boolean') {
    return <Checkbox id={id} checked={!!value} onChange={onChange} label={p.label || p.name} />;
  }
  return (
    <Input
      id={id}
      type={p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : 'text'}
      value={toInputValue(p, value)}
      onChange={(s) => onChange(fromInputValue(p, s))}
      placeholder={p.required ? labels.required : ''}
      required={p.required}
      min={p.type === 'date' ? dateLimits?.min : undefined}
      max={p.type === 'date' ? dateLimits?.max : undefined}
    />
  );
}

export function ParametersPanel({
  parameters,
  values,
  defaults = values,
  onSubmit,
  validate,
  filters,
  onEdit,
}: {
  parameters: ParameterDef[];
  values: Record<string, unknown>;
  /** What Reset restores (and runs): the values the report opened with. Defaults to `values`. */
  defaults?: Record<string, unknown>;
  /** The template's design-time selection, passed to lookups. */
  filters?: Record<string, unknown>;
  /** Called whenever a value is changed in the panel. */
  onEdit?: () => void;
  onSubmit: (values: Record<string, unknown>) => void;
  /** Messages keyed by parameter name; any message blocks Submit. */
  validate?: (values: Record<string, unknown>) => Record<string, string> | null | undefined;
}) {
  const { components, labels } = useER();
  const { Button } = components;
  const [draft, setDraft] = useState(values);
  useEffect(() => setDraft(values), [values]);
  const visible = parameters.filter((p) => p.visible !== false);
  const isMissing = (v: Record<string, unknown>) =>
    visible.some((p) => p.required && (v[p.name] === null || v[p.name] === undefined || v[p.name] === ''));
  const isInvalid = (v: Record<string, unknown>) => Object.values(validate?.(v) ?? {}).some(Boolean);
  const missing = isMissing(draft);
  const errors = validate?.(draft) ?? {};
  const invalid = Object.values(errors).some(Boolean);
  // Reset goes back to the opening values and re-runs the report with them.
  const reset = () => {
    setDraft(defaults);
    if (!isMissing(defaults) && !isInvalid(defaults)) onSubmit(defaults);
  };

  return (
    <form
      className="er-params"
      onSubmit={(e) => {
        e.preventDefault();
        if (!missing && !invalid) onSubmit(draft);
      }}
    >
      <div className="er-params__title">{labels.parameters}</div>
      <div className="er-params__list">
        {visible.map((p) => (
          <div className="er-field" key={p.name}>
            {p.type !== 'boolean' || p.options?.length || p.lookup ? (
              <label className="er-field__label" htmlFor={`er-param-${p.name}`}>
                {p.label || p.name}
                {p.required && <span className="er-required">*</span>}
              </label>
            ) : null}
            <ParameterInput
              p={p}
              value={draft[p.name]}
              all={draft}
              filters={filters}
              onChange={(v) => {
                setDraft((d) => ({ ...d, [p.name]: v }));
                onEdit?.();
              }}
            />
            {errors[p.name] && (
              <div className="er-field__error" role="alert">
                {errors[p.name]}
              </div>
            )}
            {p.description && <div className="er-field__hint">{p.description}</div>}
          </div>
        ))}
      </div>
      <div className="er-params__actions">
        <Button variant="ghost" onClick={reset}>
          {labels.reset}
        </Button>
        <Button variant="primary" type="submit" disabled={missing || invalid}>
          {labels.submit}
        </Button>
      </div>
    </form>
  );
}
