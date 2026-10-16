/**
 * Data sources backed by the host's report API. The browser only names a dataset (a query the
 * backend owns) and sends parameter values and the author's design-time filters — never SQL.
 * The backend authorizes, aggregates and returns rows.
 */
import { DataLimitError } from './data';
import type { DataFetchContext, DataRow, ReportDataSource } from './types';

/** What a rows endpoint may return: plain rows, or rows plus a truncation flag. */
export type RestRowsResponse = DataRow[] | { rows: DataRow[]; truncated?: boolean; rowLimit?: number };

export interface RestDataSourceOptions extends Omit<ReportDataSource, 'data'> {
  /**
   * Rows endpoint, e.g. `/api/v1/Reports/datasets/energy/rows`. Called with `POST` and a JSON body
   * of `{ parameters, filters }` (see `toServer`).
   */
  url: string | ((ctx: DataFetchContext) => string);
  /** Extra headers per request (e.g. `Authorization`). */
  headers?: () => HeadersInit | Promise<HeadersInit>;
  fetch?: typeof fetch;
  /** Map the fetch context to the request body (default `{ parameters, filters }`, dates as local ISO). */
  toServer?: (ctx: DataFetchContext) => unknown;
  /** Map the response body to rows (default: an array, or `{ rows, truncated, rowLimit }`). */
  fromServer?: (body: unknown) => RestRowsResponse;
  /**
   * Called when the backend says it cut the result off. Without it, truncated data is refused with
   * `DataLimitError`, because totals over a partial result would be silently wrong.
   */
  onTruncated?: (info: { dataSource: string; rowLimit?: number }) => void;
}

const pad = (n: number, w = 2) => String(Math.abs(Math.trunc(n))).padStart(w, '0');

/** `2026-07-01T00:00:00+05:30` — keeps the picked local date, unlike `toISOString()` (UTC). */
export function toLocalIsoString(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(off / 60)}:${pad(off % 60)}`
  );
}

const defaultBody = (ctx: DataFetchContext) => ({ parameters: ctx.parameters, filters: ctx.filters ?? {} });

function errorMessage(body: unknown, status: number): string {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  // Plain `{ error }` / `{ message }` bodies, or ASP.NET Core ProblemDetails (`title`, `detail`).
  const msg = [b.error, b.message, b.detail, b.title].find((x) => typeof x === 'string' && x);
  return (msg as string | undefined) ?? `Request failed (${status})`;
}

/** A `ReportDataSource` whose rows come from a REST endpoint on the host backend. */
export function createRestDataSource(opts: RestDataSourceOptions): ReportDataSource {
  const { url, headers, fetch: customFetch, toServer, fromServer, onTruncated, ...ds } = opts;
  const name = ds.label ?? ds.name;

  return {
    ...ds,
    data: async (ctx) => {
      const doFetch = customFetch ?? globalThis.fetch.bind(globalThis);
      const h = new Headers(headers ? await headers() : undefined);
      if (!h.has('Content-Type')) h.set('Content-Type', 'application/json');
      const body = JSON.stringify((toServer ?? defaultBody)(ctx), function (key, value: unknown) {
        // `this[key]` is the raw value; Date#toJSON has already run on `value`.
        const raw = (this as Record<string, unknown>)[key];
        return raw instanceof Date ? toLocalIsoString(raw) : value;
      });
      const res = await doFetch(typeof url === 'function' ? url(ctx) : url, { method: 'POST', headers: h, body, signal: ctx.signal });
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = undefined;
      }
      if (!res.ok) throw new Error(errorMessage(parsed, res.status));

      const result = fromServer ? fromServer(parsed) : (parsed as RestRowsResponse | undefined);
      if (Array.isArray(result)) return result;
      if (!result || !Array.isArray(result.rows)) throw new Error(`'${name}' returned an unexpected response`);
      if (result.truncated) {
        if (!onTruncated) {
          throw new DataLimitError(
            name,
            undefined,
            result.rowLimit,
            `'${name}' was cut off at ${result.rowLimit?.toLocaleString() ?? 'the server limit of'} rows, so totals would be wrong. ` +
              'Narrow the date range or sites, or choose a coarser aggregation (e.g. per month).',
          );
        }
        onTruncated({ dataSource: ds.name, rowLimit: result.rowLimit });
      }
      return result.rows;
    },
  };
}
