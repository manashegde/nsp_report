import { useEffect, useMemo, useRef, useState } from 'react';
import { createEnv, evaluate, FUNCTION_CATALOG } from '../core/evaluator';
import { parseExpression, validateExpression } from '../core/expression';
import { formatValue } from '../core/format';
import { resolveParameters } from '../core/layout';
import { useER } from '../ui/config';
import { useDesigner, type ExpressionRequest } from './context';
import { TypeIcon } from './registry';

const OPERATORS = ['+', '-', '*', '/', '%', '=', '!=', '<', '<=', '>', '>=', 'and', 'or', 'not', '(', ')', "''"];

type Tab = 'fields' | 'parameters' | 'functions' | 'operators';

export function ExpressionEditorDialog({ request, onClose }: { request: ExpressionRequest | null; onClose: () => void }) {
  const cfg = useER();
  const { labels, components } = cfg;
  const { Dialog, Button, TextArea, Input } = components;
  const { fields, store, sampleRows } = useDesigner();
  const t = store.template;
  const [value, setValue] = useState('');
  const [tab, setTab] = useState<Tab>('fields');
  const [filter, setFilter] = useState('');
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const caret = useRef<[number, number]>([0, 0]);

  useEffect(() => {
    if (request) {
      setValue(request.value);
      caret.current = [request.value.length, request.value.length];
      setFilter('');
    }
  }, [request]);

  const error = validateExpression(value);

  const preview = useMemo(() => {
    if (!value.trim() || error) return '';
    try {
      const env = createEnv({ calculatedFields: t.calculatedFields, functions: cfg.functions, format: { locale: cfg.locale ?? t.locale, currency: t.currency } });
      const v = evaluate(parseExpression(value), {
        row: sampleRows[0] ?? null,
        scope: { report: sampleRows, groups: [], page: sampleRows, pageFinal: true },
        defaultScope: 'report',
        isDetail: !!sampleRows[0],
        params: resolveParameters(t, {}, env),
        vars: { pagenumber: 1, totalpages: 1, rownumber: 1, groupnumber: 1, reportname: t.name },
        env,
      });
      return formatValue(v, undefined, env.format);
    } catch (e) {
      return `⚠ ${(e as Error).message}`;
    }
  }, [value, error, sampleRows, t, cfg.functions, cfg.locale]);

  const insert = (snippet: string) => {
    const [a, b] = caret.current;
    const next = value.slice(0, a) + snippet + value.slice(b);
    setValue(next);
    const pos = a + snippet.length;
    caret.current = [pos, pos];
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(pos, pos);
      }
    });
  };

  const f = filter.trim().toLowerCase();
  const match = (s: string) => !f || s.toLowerCase().includes(f);

  type Item = { key: string; label: string; detail?: string; insert: string; icon?: React.ReactNode };
  const items: Item[] = ((): Item[] => {
    switch (tab) {
      case 'fields':
        return [
          ...fields.map((x) => ({ key: x.path, label: x.label ?? x.path, detail: x.path, insert: `[${x.path}]`, icon: <TypeIcon type={x.type} cfg={cfg} /> })),
          ...t.calculatedFields.map((c) => ({ key: `calc:${c.name}`, label: c.name, detail: c.expression, insert: `[${c.name}]`, icon: cfg.icon('calc', 14) })),
        ];
      case 'parameters':
        return t.parameters.map((p) => ({ key: p.name, label: p.label || p.name, detail: `?${p.name}`, insert: `?${p.name}`, icon: <TypeIcon type={p.type} cfg={cfg} /> }));
      case 'functions':
        return FUNCTION_CATALOG.flatMap((c) =>
          c.items.map((i) => ({ key: `${c.category}:${i.name}`, label: i.name, detail: `${c.category} · ${i.description}`, insert: i.signature })),
        );
      case 'operators':
        return OPERATORS.map((o) => ({ key: o, label: o, insert: o.length > 2 ? ` ${o} ` : o }));
    }
  })().filter((i) => match(i.label) || match(i.detail ?? ''));

  return (
    <Dialog
      open={!!request}
      title={request?.title ?? labels.expressionEditor}
      onClose={onClose}
      width={760}
      footer={
        <>
          <span className={`er-expr__status ${error ? 'er-expr__status--error' : ''}`}>{error ?? (value.trim() ? `✓ ${labels.valid}` : '')}</span>
          <Button onClick={onClose}>{labels.cancel}</Button>
          <Button
            variant="primary"
            disabled={!!error}
            onClick={() => {
              request?.onApply(value.trim());
              onClose();
            }}
          >
            {labels.ok}
          </Button>
        </>
      }
    >
      <div className="er-expr">
        <TextArea
          value={value}
          onChange={setValue}
          rows={4}
          invalid={!!error}
          className="er-expr__input"
          textareaRef={(el) => {
            taRef.current = el;
          }}
          onSelect={() => {
            const ta = taRef.current;
            if (ta) caret.current = [ta.selectionStart, ta.selectionEnd];
          }}
          placeholder={request?.boolean ? "[Amount] > 100 and [Status] = 'Open'" : "[Price] * [Quantity]"}
        />
        {preview && (
          <div className="er-expr__preview" title="Evaluated against the first sample row">
            = {preview}
          </div>
        )}
        <div className="er-expr__browser">
          <div className="er-expr__tabs" role="tablist">
            {(['fields', 'parameters', 'functions', 'operators'] as Tab[]).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={`er-tab ${tab === k ? 'er-tab--active' : ''}`} onClick={() => setTab(k)}>
                {labels[k]}
              </button>
            ))}
            <Input value={filter} onChange={setFilter} placeholder={labels.search} type="search" className="er-expr__filter" />
          </div>
          <ul className="er-expr__list">
            {items.map((i) => (
              <li key={i.key}>
                <button type="button" onClick={() => insert(i.insert)} title={i.detail}>
                  {i.icon}
                  <span className="er-expr__name">{i.label}</span>
                  {i.detail && <span className="er-expr__detail">{i.detail}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}
