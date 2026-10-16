/**
 * Value formatting with .NET-style format strings.
 *
 * Numbers:  n2 (grouped, 2 decimals)  f1 (fixed)  c2 (currency)  p1 (percent, x100)
 *           e2 (exponential)  d5 (zero padded integer)  #,##0.00  0.0%  $#,##0
 * Dates:    d (short date) D (long date) t (short time) T g G M Y
 *           custom: yyyy yy MMMM MMM MM M dddd ddd dd d HH H hh h mm m ss s tt 'literal'
 * Boolean:  "Yes|No"
 */

export interface FormatOptions {
  locale?: string;
  currency?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' && ISO_DATE.test(v)) {
    // Date-only strings are parsed as local dates (not UTC) to avoid day shifts.
    const d = v.length === 10 ? new Date(`${v}T00:00:00`) : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v);
  return null;
}

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const nfCache = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: string | undefined, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let nf = nfCache.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, opts);
    nfCache.set(key, nf);
  }
  return nf;
}

function formatNumberStandard(n: number, spec: string, o: FormatOptions): string | null {
  const m = /^([nNfFcCpPeEdDgG])(\d{0,2})$/.exec(spec);
  if (!m) return null;
  const kind = m[1].toLowerCase();
  const digits = m[2] === '' ? undefined : Number(m[2]);
  switch (kind) {
    case 'n':
      return numberFormat(o.locale, {
        minimumFractionDigits: digits ?? 2,
        maximumFractionDigits: digits ?? 2,
      }).format(n);
    case 'f':
      return numberFormat(o.locale, {
        minimumFractionDigits: digits ?? 2,
        maximumFractionDigits: digits ?? 2,
        useGrouping: false,
      }).format(n);
    case 'c':
      return numberFormat(o.locale, {
        style: 'currency',
        currency: o.currency || 'USD',
        minimumFractionDigits: digits ?? 2,
        maximumFractionDigits: digits ?? 2,
      }).format(n);
    case 'p':
      return numberFormat(o.locale, {
        style: 'percent',
        minimumFractionDigits: digits ?? 0,
        maximumFractionDigits: digits ?? 0,
      }).format(n);
    case 'e':
      return n.toExponential(digits ?? 6);
    case 'd': {
      const s = Math.trunc(Math.abs(n)).toString().padStart(digits ?? 0, '0');
      return n < 0 ? `-${s}` : s;
    }
    case 'g':
      return digits ? n.toPrecision(digits) : String(n);
  }
  return null;
}

/** Custom numeric pattern like `#,##0.00`, `0.0%`, `$#,##0;(#,##0)`. */
function formatNumberCustom(n: number, pattern: string, o: FormatOptions): string {
  const sections = pattern.split(';');
  let pat = sections[0];
  let value = n;
  if (n < 0 && sections[1]) {
    pat = sections[1];
    value = -n;
  } else if (n === 0 && sections[2]) {
    pat = sections[2];
  }
  const first = pat.search(/[#0]/);
  if (first < 0) return pat;
  let last = first;
  for (let i = first; i < pat.length; i++) if (/[#0,.]/.test(pat[i])) last = i;
  const prefix = pat.slice(0, first);
  const suffix = pat.slice(last + 1);
  const core = pat.slice(first, last + 1);
  const [intPart, fracPart = ''] = core.split('.');
  const grouping = intPart.includes(',');
  const minInt = (intPart.match(/0/g) || []).length;
  const minFrac = (fracPart.match(/0/g) || []).length;
  const maxFrac = fracPart.replace(/,/g, '').length;
  if (/%/.test(prefix + suffix)) value *= 100;
  const formatted = numberFormat(o.locale, {
    minimumIntegerDigits: Math.max(1, minInt),
    minimumFractionDigits: minFrac,
    maximumFractionDigits: maxFrac,
    useGrouping: grouping,
  }).format(value);
  const out = minInt === 0 && formatted.match(/^-?0(?=\D|$)/) && maxFrac > 0 ? formatted.replace(/^(-?)0/, '$1') : formatted;
  return prefix.replace(/['"]/g, '') + out + suffix.replace(/['"]/g, '');
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function monthName(d: Date, locale: string | undefined, style: 'long' | 'short') {
  return new Intl.DateTimeFormat(locale, { month: style }).format(d);
}
function dayName(d: Date, locale: string | undefined, style: 'long' | 'short') {
  return new Intl.DateTimeFormat(locale, { weekday: style }).format(d);
}

function formatDateCustom(d: Date, pattern: string, o: FormatOptions): string {
  const re = /'[^']*'|"[^"]*"|yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|fff|tt/g;
  return pattern.replace(re, (tok) => {
    switch (tok) {
      case 'yyyy':
        return String(d.getFullYear());
      case 'yy':
        return pad(d.getFullYear() % 100);
      case 'MMMM':
        return monthName(d, o.locale, 'long');
      case 'MMM':
        return monthName(d, o.locale, 'short');
      case 'MM':
        return pad(d.getMonth() + 1);
      case 'M':
        return String(d.getMonth() + 1);
      case 'dddd':
        return dayName(d, o.locale, 'long');
      case 'ddd':
        return dayName(d, o.locale, 'short');
      case 'dd':
        return pad(d.getDate());
      case 'd':
        return String(d.getDate());
      case 'HH':
        return pad(d.getHours());
      case 'H':
        return String(d.getHours());
      case 'hh':
        return pad(d.getHours() % 12 || 12);
      case 'h':
        return String(d.getHours() % 12 || 12);
      case 'mm':
        return pad(d.getMinutes());
      case 'm':
        return String(d.getMinutes());
      case 'ss':
        return pad(d.getSeconds());
      case 's':
        return String(d.getSeconds());
      case 'fff':
        return pad(d.getMilliseconds(), 3);
      case 'tt':
        return d.getHours() < 12 ? 'AM' : 'PM';
      default:
        return tok.slice(1, -1);
    }
  });
}

function formatDateStandard(d: Date, spec: string, o: FormatOptions): string | null {
  const opts: Record<string, Intl.DateTimeFormatOptions> = {
    d: { dateStyle: 'short' },
    D: { dateStyle: 'long' },
    t: { timeStyle: 'short' },
    T: { timeStyle: 'medium' },
    g: { dateStyle: 'short', timeStyle: 'short' },
    G: { dateStyle: 'short', timeStyle: 'medium' },
    f: { dateStyle: 'long', timeStyle: 'short' },
    F: { dateStyle: 'full', timeStyle: 'medium' },
    M: { month: 'long', day: 'numeric' },
    Y: { month: 'long', year: 'numeric' },
  };
  const o2 = opts[spec];
  return o2 ? new Intl.DateTimeFormat(o.locale, o2).format(d) : null;
}

/** Default display of a value without explicit format. */
export function defaultFormat(v: unknown, o: FormatOptions = {}): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return formatDateStandard(v, 'd', o) ?? v.toISOString();
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    return Number.isInteger(v) ? String(v) : numberFormat(o.locale, { maximumFractionDigits: 4 }).format(v);
  }
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (Array.isArray(v)) return v.map((x) => defaultFormat(x, o)).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function formatValue(v: unknown, format: string | undefined, o: FormatOptions = {}): string {
  if (v === null || v === undefined) return '';
  const spec = format?.trim();
  if (!spec) return defaultFormat(v, o);

  if (typeof v === 'boolean') {
    const parts = spec.split('|');
    if (parts.length === 2) return v ? parts[0] : parts[1];
    return defaultFormat(v, o);
  }

  const asDate = v instanceof Date ? v : typeof v === 'string' ? toDate(v) : null;
  const looksLikeDate = /^[dDtTgGfFMY]$/.test(spec) || /(yy|MM|dd|HH|hh|mm|ss)/.test(spec);
  if (asDate && (v instanceof Date || looksLikeDate)) {
    return formatDateStandard(asDate, spec, o) ?? formatDateCustom(asDate, spec, o);
  }

  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (Number.isFinite(n)) {
    return formatNumberStandard(n, spec, o) ?? (/[#0]/.test(spec) ? formatNumberCustom(n, spec, o) : spec);
  }
  return defaultFormat(v, o);
}
