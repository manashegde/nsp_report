/**
 * Template storage. A host application decides where saved reports live by passing a
 * `ReportTemplateStore` to `<ReportStudio>` (or using it directly). Ready-made stores:
 * in-memory, browser localStorage and a generic REST client.
 */
import { normalizeTemplate, uid } from './template';
import type { ReportTemplate } from './types';

export type TemplateStatus = 'draft' | 'published';

export interface TemplateSummary {
  id: string;
  name: string;
  description?: string;
  /** Free-form grouping shown in the library, e.g. "Energy", "BESS". */
  category?: string;
  /** Viewers only see published reports. */
  status: TemplateStatus;
  /** Optimistic-concurrency token; send it back on save. */
  version?: number;
  updatedAt?: string;
  /** Store-provided hint that the current user may edit (defaults to true for admins). */
  canEdit?: boolean;
}

export interface StoredTemplate extends TemplateSummary {
  template: ReportTemplate;
}

export interface SaveTemplateInput {
  /** Omit to create a new template. */
  id?: string;
  name: string;
  description?: string;
  category?: string;
  status: TemplateStatus;
  template: ReportTemplate;
  /** Version last read; stores reject the save if it changed meanwhile. */
  version?: number;
}

export interface ListTemplatesOptions {
  /**
   * Only templates with this status. `ReportStudio` asks for `published` for viewers; a backend
   * store must enforce this on the server too (never send drafts to viewers).
   */
  status?: TemplateStatus;
}

export interface ReportTemplateStore {
  list(options?: ListTemplatesOptions): Promise<TemplateSummary[]>;
  get(id: string): Promise<StoredTemplate>;
  save(input: SaveTemplateInput): Promise<StoredTemplate>;
  remove(id: string): Promise<void>;
}

/** Thrown by stores when a save is based on an outdated version. */
export class TemplateConflictError extends Error {
  constructor(
    message = 'The report was changed by someone else. Reload it and try again.',
    public readonly currentVersion?: number,
  ) {
    super(message);
    this.name = 'TemplateConflictError';
  }
}

const withStatus = (options: ListTemplatesOptions | undefined) => (t: TemplateSummary) => !options?.status || t.status === options.status;

const summaryOf = (t: StoredTemplate): TemplateSummary => {
  const { template: _template, ...summary } = t;
  void _template;
  return summary;
};

function applySave(existing: StoredTemplate | undefined, input: SaveTemplateInput): StoredTemplate {
  if (existing && input.version !== undefined && existing.version !== input.version) {
    throw new TemplateConflictError(undefined, existing.version);
  }
  return {
    id: existing?.id ?? input.id ?? uid('rpt'),
    name: input.name.trim() || 'Untitled report',
    description: input.description,
    category: input.category,
    status: input.status,
    version: (existing?.version ?? 0) + 1,
    updatedAt: new Date().toISOString(),
    canEdit: true,
    template: { ...input.template, name: input.name.trim() || input.template.name },
  };
}

/** Keeps templates in memory (tests, demos, or a host that persists elsewhere). */
export function createMemoryTemplateStore(initial: StoredTemplate[] = []): ReportTemplateStore & { snapshot(): StoredTemplate[] } {
  const items = new Map(initial.map((t) => [t.id, structuredClone(t)]));
  return {
    async list(options) {
      return [...items.values()].map(summaryOf).filter(withStatus(options));
    },
    async get(id) {
      const t = items.get(id);
      if (!t) throw new Error(`Report '${id}' not found`);
      return structuredClone(t);
    },
    async save(input) {
      const saved = applySave(input.id ? items.get(input.id) : undefined, input);
      items.set(saved.id, structuredClone(saved));
      return structuredClone(saved);
    },
    async remove(id) {
      items.delete(id);
    },
    snapshot: () => [...items.values()].map((t) => structuredClone(t)),
  };
}

/** Persists templates in the browser's localStorage (per user + device; good for demos/POCs). */
export function createLocalStorageTemplateStore(key = 'easy-report.templates'): ReportTemplateStore {
  const read = (): StoredTemplate[] => {
    try {
      const raw = globalThis.localStorage?.getItem(key);
      return raw ? (JSON.parse(raw) as StoredTemplate[]) : [];
    } catch {
      return [];
    }
  };
  const write = (all: StoredTemplate[]) => {
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(all));
    } catch {
      /* storage unavailable or full */
    }
  };
  return {
    async list(options) {
      return read().map(summaryOf).filter(withStatus(options));
    },
    async get(id) {
      const t = read().find((x) => x.id === id);
      if (!t) throw new Error(`Report '${id}' not found`);
      return { ...t, template: normalizeTemplate(t.template) };
    },
    async save(input) {
      const all = read();
      const idx = input.id ? all.findIndex((x) => x.id === input.id) : -1;
      const saved = applySave(idx >= 0 ? all[idx] : undefined, input);
      if (idx >= 0) all[idx] = saved;
      else all.push(saved);
      write(all);
      return saved;
    },
    async remove(id) {
      write(read().filter((x) => x.id !== id));
    },
  };
}

export interface RestTemplateStoreOptions {
  /** Collection URL, e.g. `/api/v1/Reports/templates`. */
  baseUrl: string;
  /** Extra headers per request (e.g. `Authorization`). */
  headers?: () => HeadersInit | Promise<HeadersInit>;
  fetch?: typeof fetch;
  /** Map a server record to a summary/stored template (default: identity on the shape above). */
  fromServer?: (raw: Record<string, unknown>) => StoredTemplate | TemplateSummary;
  /** Map a save to the request body (default: the input as-is). */
  toServer?: (input: SaveTemplateInput) => unknown;
}

/**
 * Generic REST store: `GET base`, `GET base/{id}`, `POST base`, `PUT base/{id}`, `DELETE base/{id}`.
 * A 409 response becomes `TemplateConflictError`. `list({ status })` sends `GET base?status=…`;
 * the server must apply it (and its own role checks) itself.
 */
export function createRestTemplateStore(opts: RestTemplateStoreOptions): ReportTemplateStore {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const from = opts.fromServer ?? ((raw) => raw as unknown as StoredTemplate);
  const to = opts.toServer ?? ((input) => input);
  const base = opts.baseUrl.replace(/\/$/, '');

  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    const headers = new Headers(opts.headers ? await opts.headers() : undefined);
    if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const res = await doFetch(base + path, { ...init, headers });
    const text = await res.text();
    const body = text ? (JSON.parse(text) as unknown) : undefined;
    if (res.status === 409) {
      const b = (body ?? {}) as { error?: string; message?: string; currentVersion?: number };
      throw new TemplateConflictError(b.error ?? b.message, b.currentVersion);
    }
    if (!res.ok) {
      const b = (body ?? {}) as { error?: string; message?: string };
      throw new Error(b.error ?? b.message ?? `Request failed (${res.status})`);
    }
    return body;
  }

  return {
    async list(options) {
      const query = options?.status ? `?status=${encodeURIComponent(options.status)}` : '';
      const body = (await call(query)) as Record<string, unknown>[];
      return (Array.isArray(body) ? body : []).map((r) => summaryOf(from(r) as StoredTemplate)).filter(withStatus(options));
    },
    async get(id) {
      const t = from((await call(`/${encodeURIComponent(id)}`)) as Record<string, unknown>) as StoredTemplate;
      return { ...t, template: normalizeTemplate(t.template) };
    },
    async save(input) {
      const body = JSON.stringify(to(input));
      const raw = input.id
        ? await call(`/${encodeURIComponent(input.id)}`, { method: 'PUT', body })
        : await call('', { method: 'POST', body });
      return from(raw as Record<string, unknown>) as StoredTemplate;
    },
    async remove(id) {
      await call(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}
