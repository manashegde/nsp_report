import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createTemplate, normalizeTemplate } from '../core/template';
import {
  TemplateConflictError,
  type ReportTemplateStore,
  type StoredTemplate,
  type TemplateStatus,
  type TemplateSummary,
} from '../core/store';
import type { ReportDataSource, ReportTemplate } from '../core/types';
import { ReportDesigner } from '../designer/ReportDesigner';
import { ReportViewer } from '../viewer/ReportViewer';
import { ResolvedConfigProvider, useResolvedConfig, type EasyReportConfig, type ToolbarConfig } from '../ui/config';
import { cx } from '../ui/primitives';

export interface StarterTemplate {
  id: string;
  label: string;
  description?: string;
  create: () => ReportTemplate;
}

export interface ReportStudioProps {
  /** Where saved reports live (REST API, localStorage, memory …). */
  store: ReportTemplateStore;
  /** `admin` builds and publishes reports; `viewer` only opens published ones. */
  role?: 'admin' | 'viewer';
  /** Admins may delete (default true for admins). */
  canDelete?: boolean;
  dataSources?: ReportDataSource[];
  config?: EasyReportConfig;
  /** Layouts offered by "New report"; a blank report is always available. */
  starters?: StarterTemplate[];
  /** Suggested categories (existing ones are offered too). */
  categories?: string[];
  /** Report to open initially. */
  initialReportId?: string;
  /** Called when the open report changes (e.g. to sync the URL). */
  onReportChange?: (id: string | null) => void;
  onError?: (error: Error) => void;
  viewerToolbar?: ToolbarConfig;
  designerToolbar?: ToolbarConfig;
  className?: string;
  style?: CSSProperties;
}

interface Draft {
  id?: string;
  version?: number;
  name: string;
  description: string;
  category: string;
  status: TemplateStatus;
  template: ReportTemplate;
}

type Pending = { kind: 'open'; id: string } | { kind: 'new'; starter?: StarterTemplate } | { kind: 'close' };

const byName = (a: TemplateSummary, b: TemplateSummary) => a.name.localeCompare(b.name);

/** Report library + viewer for everyone, plus the designer for admins. */
export function ReportStudio(props: ReportStudioProps) {
  const cfg = useResolvedConfig(props.config);
  const { labels, components, icon } = cfg;
  const { Button, Input, Dialog, Select, TextArea } = components;
  const { store } = props;
  const isAdmin = props.role === 'admin';
  const canDelete = isAdmin && props.canDelete !== false;

  const [list, setList] = useState<TemplateSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(props.initialReportId ?? null);
  const [current, setCurrent] = useState<StoredTemplate | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [starterPicker, setStarterPicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fail = useCallback(
    (e: unknown) => {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err instanceof TemplateConflictError ? labels.conflict : err.message);
      props.onError?.(err);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labels.conflict, props.onError],
  );

  const refreshList = useCallback(async () => {
    try {
      setList(await store.list());
    } catch (e) {
      fail(e);
      setList([]);
    }
  }, [store, fail]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // Load the open report.
  useEffect(() => {
    props.onReportChange?.(openId);
    if (!openId) {
      setCurrent(null);
      return;
    }
    let live = true;
    setLoadingReport(true);
    store
      .get(openId)
      .then((r) => live && setCurrent({ ...r, template: normalizeTemplate(r.template) }))
      .catch((e) => {
        if (!live) return;
        fail(e);
        setOpenId(null);
      })
      .finally(() => live && setLoadingReport(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, store]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list ?? [])
      .filter((r) => isAdmin || r.status === 'published')
      .filter((r) => !q || r.name.toLowerCase().includes(q) || (r.category ?? '').toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q));
  }, [list, query, isAdmin]);

  const grouped = useMemo(() => {
    const m = new Map<string, TemplateSummary[]>();
    for (const r of visible) {
      const k = r.category?.trim() || labels.uncategorized;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === labels.uncategorized ? 1 : b === labels.uncategorized ? -1 : a.localeCompare(b))).map(([k, v]) => [k, v.sort(byName)] as const);
  }, [visible, labels.uncategorized]);

  const knownCategories = useMemo(
    () => [...new Set([...(props.categories ?? []), ...(list ?? []).map((r) => r.category).filter((c): c is string => !!c)])].sort(),
    [props.categories, list],
  );

  /* ---------------- actions ---------------- */

  const run = (p: Pending) => {
    setError(null);
    setNotice(null);
    if (p.kind === 'open') {
      setDraft(null);
      setDirty(false);
      setOpenId(p.id);
    } else if (p.kind === 'close') {
      setDraft(null);
      setDirty(false);
    } else {
      const template = p.starter ? p.starter.create() : createTemplate(labels.newReport);
      setOpenId(null);
      setDraft({ name: template.name || labels.newReport, description: '', category: '', status: 'draft', template });
      setDirty(true);
    }
  };
  const guarded = (p: Pending) => (draft && dirty ? setPending(p) : run(p));

  const startNew = () => {
    if (props.starters?.length) setStarterPicker(true);
    else guarded({ kind: 'new' });
  };

  const edit = () => {
    if (!current) return;
    setDraft({
      id: current.id,
      version: current.version,
      name: current.name,
      description: current.description ?? '',
      category: current.category ?? '',
      status: current.status,
      template: current.template,
    });
    setDirty(false);
  };

  const duplicate = () => {
    if (!current) return;
    const name = `${labels.copyOf} ${current.name}`;
    setOpenId(null);
    setDraft({ name, description: current.description ?? '', category: current.category ?? '', status: 'draft', template: { ...structuredClone(current.template), name } });
    setDirty(true);
  };

  const save = async (status: TemplateStatus, template?: ReportTemplate) => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await store.save({
        id: draft.id,
        version: draft.version,
        name: draft.name,
        description: draft.description || undefined,
        category: draft.category || undefined,
        status,
        template: { ...(template ?? draft.template), name: draft.name },
      });
      setDraft({ ...draft, id: saved.id, version: saved.version, status: saved.status, template: saved.template });
      setDirty(false);
      setCurrent(saved);
      setOpenId(saved.id);
      setNotice(status === 'published' ? labels.reportPublished : labels.reportSaved);
      await refreshList();
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: TemplateStatus) => {
    if (!current) return;
    setError(null);
    try {
      const saved = await store.save({ ...current, status, version: current.version });
      setCurrent(saved);
      setNotice(status === 'published' ? labels.reportPublished : labels.reportUnpublished);
      await refreshList();
    } catch (e) {
      fail(e);
    }
  };

  const remove = async () => {
    if (!current) return;
    try {
      await store.remove(current.id);
      setConfirmDelete(false);
      setOpenId(null);
      setDraft(null);
      setNotice(labels.reportDeleted);
      await refreshList();
    } catch (e) {
      fail(e);
    }
  };

  /* ---------------- render ---------------- */

  const editing = !!draft;
  const updateDraft = (patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  };
  const designerToolbar: ToolbarConfig =
    props.designerToolbar ?? ((items) => items.filter((i) => i.id !== 'new' && i.id !== 'open'));

  return (
    <ResolvedConfigProvider value={cfg}>
      <div className={cx('er-root', 'er-studio', cfg.className, props.className)} style={{ ...cfg.rootStyle, ...props.style }}>
        <aside className="er-studio__library" aria-label={labels.reportLibrary}>
          <div className="er-studio__libhead">
            <div className="er-studio__title">{labels.reportLibrary}</div>
            {isAdmin && (
              <Button variant="primary" icon={icon('plus', 14)} onClick={startNew}>
                {labels.newReport}
              </Button>
            )}
          </div>
          <Input type="search" value={query} onChange={setQuery} placeholder={labels.searchReports} />
          <div className="er-studio__list">
            {list === null && <div className="er-muted er-studio__empty">{labels.loadingOptions}</div>}
            {list !== null && visible.length === 0 && <div className="er-muted er-studio__empty">{isAdmin ? labels.noReportsAdmin : labels.noReports}</div>}
            {grouped.map(([category, items]) => (
              <div key={category} className="er-studio__group">
                <div className="er-subtitle">{category}</div>
                {items.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={cx('er-studio__item', (draft?.id ?? openId) === r.id && 'er-studio__item--active')}
                    onClick={() => guarded({ kind: 'open', id: r.id })}
                    title={r.description || r.name}
                  >
                    <span className="er-studio__itemname">{r.name}</span>
                    {isAdmin && r.status === 'draft' && <span className="er-badge">{labels.draft}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </aside>

        <main className="er-studio__main">
          {(error || notice) && (
            <div className={cx('er-studio__banner', error ? 'er-studio__banner--error' : 'er-studio__banner--ok')} role={error ? 'alert' : 'status'}>
              <span>{error ?? notice}</span>
              <button type="button" className="er-btn er-btn--ghost er-btn--icon" aria-label={labels.cancel} onClick={() => (setError(null), setNotice(null))}>
                ×
              </button>
            </div>
          )}

          {editing && draft ? (
            <>
              <div className="er-studio__bar er-studio__bar--edit">
                <div className="er-studio__meta">
                  <Input value={draft.name} onChange={(v) => updateDraft({ name: v })} placeholder={labels.name} className="er-studio__name" />
                  <Input value={draft.category} onChange={(v) => updateDraft({ category: v })} placeholder={labels.category} className="er-studio__category" />
                  {knownCategories.length > 0 && (
                    <Select
                      className="er-studio__catpick"
                      value=""
                      onChange={(v) => v && updateDraft({ category: v })}
                      options={[{ value: '', label: '▾' }, ...knownCategories.map((c) => ({ value: c, label: c }))]}
                      title={labels.category}
                    />
                  )}
                  <span className={cx('er-badge', draft.status === 'published' && 'er-badge--ok')}>{draft.status === 'published' ? labels.published : labels.draft}</span>
                  {dirty && <span className="er-muted">{labels.unsavedChanges}</span>}
                </div>
                <div className="er-studio__actions">
                  <Button onClick={() => guarded({ kind: 'close' })}>{labels.closeEditor}</Button>
                  <Button onClick={() => void save('draft')} disabled={saving}>
                    {labels.saveDraft}
                  </Button>
                  <Button variant="primary" onClick={() => void save('published')} disabled={saving}>
                    {labels.saveAndPublish}
                  </Button>
                </div>
              </div>
              <div className="er-studio__desc">
                <TextArea value={draft.description} onChange={(v) => updateDraft({ description: v })} rows={1} placeholder={labels.description} />
              </div>
              <div className="er-studio__content">
                <ReportDesigner
                  template={draft.template}
                  dataSources={props.dataSources}
                  config={props.config}
                  toolbar={designerToolbar}
                  onChange={(t) => {
                    setDraft((d) => (d ? { ...d, template: t } : d));
                    setDirty(true);
                  }}
                  onSave={(t) => void save(draft.status, t)}
                />
              </div>
            </>
          ) : current && openId ? (
            <>
              <div className="er-studio__bar">
                <div className="er-studio__meta">
                  <div>
                    <div className="er-studio__reportname">{current.name}</div>
                    {(current.category || current.description) && (
                      <div className="er-muted er-studio__sub">{[current.category, current.description].filter(Boolean).join(' · ')}</div>
                    )}
                  </div>
                  {isAdmin && <span className={cx('er-badge', current.status === 'published' && 'er-badge--ok')}>{current.status === 'published' ? labels.published : labels.draft}</span>}
                </div>
                {isAdmin && current.canEdit !== false && (
                  <div className="er-studio__actions">
                    <Button icon={icon('design', 14)} onClick={edit}>
                      {labels.edit}
                    </Button>
                    <Button icon={icon('copy', 14)} onClick={duplicate}>
                      {labels.duplicate}
                    </Button>
                    {current.status === 'published' ? (
                      <Button onClick={() => void setStatus('draft')}>{labels.unpublish}</Button>
                    ) : (
                      <Button variant="primary" onClick={() => void setStatus('published')}>
                        {labels.publish}
                      </Button>
                    )}
                    {canDelete && <Button variant="danger" icon={icon('trash', 14)} title={labels.delete} onClick={() => setConfirmDelete(true)} />}
                  </div>
                )}
              </div>
              <div className="er-studio__content">
                <ReportViewer key={current.id + ':' + current.version} template={current.template} dataSources={props.dataSources} config={props.config} toolbar={props.viewerToolbar} />
              </div>
            </>
          ) : (
            <div className="er-studio__placeholder">
              {icon('file', 32)}
              <div>{loadingReport ? labels.loadingOptions : isAdmin ? labels.selectOrCreate : labels.selectReport}</div>
            </div>
          )}
        </main>

        {starterPicker && (
          <Dialog open title={labels.newReport} onClose={() => setStarterPicker(false)} width={560}>
            <div className="er-studio__starters">
              {[{ id: '__blank', label: labels.blankReport, description: labels.blankReportHint, create: () => createTemplate(labels.newReport) }, ...(props.starters ?? [])].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="er-studio__starter"
                  onClick={() => {
                    setStarterPicker(false);
                    guarded({ kind: 'new', starter: s });
                  }}
                >
                  <strong>{s.label}</strong>
                  {s.description && <span className="er-muted">{s.description}</span>}
                </button>
              ))}
            </div>
          </Dialog>
        )}

        <Dialog
          open={pending !== null}
          title={labels.discardTitle}
          onClose={() => setPending(null)}
          width={420}
          footer={
            <>
              <Button onClick={() => setPending(null)}>{labels.cancel}</Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (pending) run(pending);
                  setPending(null);
                }}
              >
                {labels.discard}
              </Button>
            </>
          }
        >
          {labels.discardBody}
        </Dialog>

        <Dialog
          open={confirmDelete}
          title={labels.deleteReport}
          onClose={() => setConfirmDelete(false)}
          width={420}
          footer={
            <>
              <Button onClick={() => setConfirmDelete(false)}>{labels.cancel}</Button>
              <Button variant="danger" onClick={() => void remove()}>
                {labels.delete}
              </Button>
            </>
          }
        >
          {labels.deleteReportBody.replace('{name}', current?.name ?? '')}
        </Dialog>
      </div>
    </ResolvedConfigProvider>
  );
}
