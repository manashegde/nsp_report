import { parseExpression, type Ast } from './expression';
import { formatValue, toDate, toNumber, type FormatOptions } from './format';
import type { DataRow } from './types';

export type ScopeName = 'report' | 'group' | 'page';

export interface ActiveGroup {
  id: string;
  name?: string;
  key: unknown;
  rows: DataRow[];
  /** 1-based index of this group instance among its siblings. */
  index: number;
}

export interface EvalScope {
  report: DataRow[];
  /** Active groups, outermost first. */
  groups: ActiveGroup[];
  /** Rows printed on the current page so far (final for page header/footer). */
  page?: DataRow[];
  pageFinal?: boolean;
}

export interface EvalEnv {
  calculated: Map<string, Ast>;
  functions: Record<string, FunctionDef>;
  format: FormatOptions;
  aggCache: WeakMap<DataRow[], Map<object, unknown>>;
  indexCache: WeakMap<DataRow[], Map<DataRow, number>>;
  depth: number;
}

export interface EvalContext {
  row: DataRow | null;
  scope: EvalScope;
  /** Scope used by aggregates without an explicit scope argument. */
  defaultScope: ScopeName;
  /** True while evaluating against a single detail row. */
  isDetail: boolean;
  params: Record<string, unknown>;
  /** Built-in variables, lowercase keys: pagenumber, totalpages, rownumber, reportname ... */
  vars: Record<string, unknown>;
  env: EvalEnv;
}

export type Evaluate = (ast: Ast, ctx: EvalContext) => unknown;

export type FunctionDef =
  | { lazy?: false; fn: (args: unknown[], ctx: EvalContext) => unknown; minArgs?: number; description?: string }
  | { lazy: true; fn: (args: Ast[], ctx: EvalContext, evaluate: Evaluate) => unknown; minArgs?: number; description?: string };

export class EvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalError';
  }
}

/* ------------------------------------------------------------------ */
/* Field access                                                         */
/* ------------------------------------------------------------------ */

export function getFieldValue(row: DataRow | null | undefined, path: string): unknown {
  if (!row) return null;
  if (path in row) return row[path];
  if (path.includes('.')) {
    let cur: unknown = row;
    for (const part of path.split('.')) {
      if (cur === null || cur === undefined || typeof cur !== 'object') return null;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur ?? null;
  }
  const lower = path.toLowerCase();
  for (const k of Object.keys(row)) if (k.toLowerCase() === lower) return row[k];
  return null;
}

/* ------------------------------------------------------------------ */
/* Core evaluation                                                      */
/* ------------------------------------------------------------------ */

function isEmpty(v: unknown) {
  return v === null || v === undefined || v === '';
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (isEmpty(a)) return isEmpty(b) ? 0 : -1;
  if (isEmpty(b)) return 1;
  if (a instanceof Date || b instanceof Date) {
    const da = toDate(a);
    const db = toDate(b);
    if (da && db) return da.getTime() - db.getTime();
  }
  if (typeof a === 'number' || typeof b === 'number') {
    const na = toNumber(a);
    const nb = toNumber(b);
    if (na !== null && nb !== null) return na - nb;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

function equals(a: unknown, b: unknown): boolean {
  if (isEmpty(a) && isEmpty(b)) return a === b || (a == null && b == null);
  if (isEmpty(a) || isEmpty(b)) return false;
  return compare(a, b) === 0;
}

export function truthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v !== '' && v.toLowerCase() !== 'false' && v !== '0';
  return Boolean(v);
}

function addDays(d: Date, days: number) {
  const r = new Date(d.getTime());
  r.setDate(r.getDate() + days);
  return r;
}

function arithmetic(op: string, a: unknown, b: unknown): unknown {
  if (op === '+' && (typeof a === 'string' || typeof b === 'string')) {
    return `${a ?? ''}${b ?? ''}`;
  }
  if (a instanceof Date && (op === '+' || op === '-') && typeof b === 'number') {
    return addDays(a, op === '+' ? b : -b);
  }
  if (a instanceof Date && b instanceof Date && op === '-') {
    return (a.getTime() - b.getTime()) / 86400000;
  }
  const x = toNumber(a);
  const y = toNumber(b);
  if (x === null || y === null) return null;
  switch (op) {
    case '+':
      return x + y;
    case '-':
      return x - y;
    case '*':
      return x * y;
    case '/':
      return y === 0 ? null : x / y;
    case '%':
      return y === 0 ? null : x % y;
  }
  return null;
}

export const evaluate: Evaluate = (ast, ctx) => {
  switch (ast.t) {
    case 'lit':
      return ast.v;
    case 'field': {
      const calc = ctx.env.calculated.get(ast.path.toLowerCase());
      if (calc) {
        if (ctx.env.depth > 32) throw new EvalError(`Calculated field '${ast.path}' is recursive`);
        ctx.env.depth++;
        try {
          return evaluate(calc, ctx);
        } finally {
          ctx.env.depth--;
        }
      }
      return getFieldValue(ctx.row, ast.path);
    }
    case 'param': {
      if (ast.name in ctx.params) return ctx.params[ast.name] ?? null;
      const lower = ast.name.toLowerCase();
      for (const k of Object.keys(ctx.params)) if (k.toLowerCase() === lower) return ctx.params[k] ?? null;
      throw new EvalError(`Unknown parameter '?${ast.name}'`);
    }
    case 'var': {
      if (ast.name in ctx.vars) return ctx.vars[ast.name];
      const fn = ctx.env.functions[ast.name];
      if (fn && !fn.lazy && (fn.minArgs ?? 0) === 0) return fn.fn([], ctx);
      throw new EvalError(`Unknown identifier '${ast.name}'`);
    }
    case 'un': {
      const v = evaluate(ast.e, ctx);
      if (ast.op === 'not') return !truthy(v);
      const n = toNumber(v);
      return n === null ? null : -n;
    }
    case 'bin': {
      if (ast.op === 'and') return truthy(evaluate(ast.l, ctx)) && truthy(evaluate(ast.r, ctx));
      if (ast.op === 'or') return truthy(evaluate(ast.l, ctx)) || truthy(evaluate(ast.r, ctx));
      const a = evaluate(ast.l, ctx);
      const b = evaluate(ast.r, ctx);
      switch (ast.op) {
        case '=':
          return equals(a, b);
        case '!=':
          return !equals(a, b);
        case '<':
          return !isEmpty(a) && !isEmpty(b) && compare(a, b) < 0;
        case '<=':
          return !isEmpty(a) && !isEmpty(b) && compare(a, b) <= 0;
        case '>':
          return !isEmpty(a) && !isEmpty(b) && compare(a, b) > 0;
        case '>=':
          return !isEmpty(a) && !isEmpty(b) && compare(a, b) >= 0;
        default:
          return arithmetic(ast.op, a, b);
      }
    }
    case 'call': {
      const def = ctx.env.functions[ast.name];
      if (!def) throw new EvalError(`Unknown function '${ast.name}'`);
      if (def.minArgs && ast.args.length < def.minArgs) {
        throw new EvalError(`${ast.name}() expects at least ${def.minArgs} argument(s)`);
      }
      if (def.lazy) return def.fn(ast.args, ctx, evaluate);
      return def.fn(
        ast.args.map((a) => evaluate(a, ctx)),
        ctx,
      );
    }
  }
};

/* ------------------------------------------------------------------ */
/* Aggregates                                                           */
/* ------------------------------------------------------------------ */

interface ResolvedScope {
  rows: DataRow[];
  cacheable: boolean;
}

export function resolveScope(ctx: EvalContext, name: unknown): ResolvedScope {
  const s = name === undefined || name === null || name === '' ? ctx.defaultScope : String(name);
  const lower = s.toLowerCase();
  if (lower === 'report') return { rows: ctx.scope.report, cacheable: true };
  if (lower === 'group') {
    const g = ctx.scope.groups[ctx.scope.groups.length - 1];
    return { rows: g ? g.rows : ctx.scope.report, cacheable: true };
  }
  if (lower === 'page') return { rows: ctx.scope.page ?? [], cacheable: !!ctx.scope.pageFinal };
  const g = ctx.scope.groups.find((x) => x.id.toLowerCase() === lower || x.name?.toLowerCase() === lower);
  if (g) return { rows: g.rows, cacheable: true };
  throw new EvalError(`Unknown aggregate scope '${s}' (use 'report', 'group', 'page' or a group name)`);
}

function rowCtx(ctx: EvalContext, row: DataRow): EvalContext {
  return { ...ctx, row, isDetail: true };
}

function values(rows: DataRow[], expr: Ast | undefined, ctx: EvalContext): unknown[] {
  if (!expr) return rows.map(() => 1);
  return rows.map((r) => evaluate(expr, rowCtx(ctx, r)));
}

function cached(ctx: EvalContext, scope: ResolvedScope, key: object, compute: () => unknown): unknown {
  if (!scope.cacheable) return compute();
  let m = ctx.env.aggCache.get(scope.rows);
  if (!m) {
    m = new Map();
    ctx.env.aggCache.set(scope.rows, m);
  }
  if (m.has(key)) return m.get(key);
  const v = compute();
  m.set(key, v);
  return v;
}

function nums(vs: unknown[]): number[] {
  const out: number[] = [];
  for (const v of vs) {
    const n = toNumber(v);
    if (n !== null) out.push(n);
  }
  return out;
}

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

type Reducer = (vs: unknown[]) => unknown;

const REDUCERS: Record<string, Reducer> = {
  sum: (vs) => sum(nums(vs)),
  avg: (vs) => {
    const ns = nums(vs);
    return ns.length ? sum(ns) / ns.length : null;
  },
  count: (vs) => vs.filter((v) => !isEmpty(v)).length,
  countdistinct: (vs) => new Set(vs.filter((v) => !isEmpty(v)).map((v) => (v instanceof Date ? v.getTime() : v))).size,
  min: (vs) => vs.filter((v) => !isEmpty(v)).reduce<unknown>((m, v) => (m === null || compare(v, m) < 0 ? v : m), null),
  max: (vs) => vs.filter((v) => !isEmpty(v)).reduce<unknown>((m, v) => (m === null || compare(v, m) > 0 ? v : m), null),
  first: (vs) => (vs.length ? vs[0] : null),
  last: (vs) => (vs.length ? vs[vs.length - 1] : null),
  median: (vs) => {
    const ns = nums(vs).sort((a, b) => a - b);
    if (!ns.length) return null;
    const mid = ns.length >> 1;
    return ns.length % 2 ? ns[mid] : (ns[mid - 1] + ns[mid]) / 2;
  },
  stddev: (vs) => {
    const ns = nums(vs);
    if (ns.length < 2) return null;
    const mean = sum(ns) / ns.length;
    return Math.sqrt(sum(ns.map((n) => (n - mean) ** 2)) / (ns.length - 1));
  },
};

function aggregate(name: string): FunctionDef {
  const reduce = REDUCERS[name];
  return {
    lazy: true,
    description: `${name}(expression?, scope?) – aggregate over 'group' | 'report' | 'page' | <group name>`,
    fn: (args, ctx, ev) => {
      const scope = resolveScope(ctx, args[1] ? ev(args[1], ctx) : undefined);
      return cached(ctx, scope, args, () => {
        if (name === 'count' && !args[0]) return scope.rows.length;
        return reduce(values(scope.rows, args[0], ctx));
      });
    },
  };
}

/** SumIf(expr, condition, scope?) / CountIf(condition, scope?) / AvgIf(expr, condition, scope?) */
function conditionalAggregate(name: 'sum' | 'avg' | 'count' | 'min' | 'max'): FunctionDef {
  return {
    lazy: true,
    minArgs: name === 'count' ? 1 : 2,
    fn: (args, ctx, ev) => {
      const [valueExpr, condExpr, scopeExpr] = name === 'count' ? [undefined, args[0], args[1]] : args;
      const scope = resolveScope(ctx, scopeExpr ? ev(scopeExpr, ctx) : undefined);
      return cached(ctx, scope, args, () => {
        const rows = scope.rows.filter((r) => truthy(ev(condExpr, rowCtx(ctx, r))));
        if (name === 'count') return rows.length;
        return REDUCERS[name](values(rows, valueExpr, ctx));
      });
    },
  };
}

function rowIndex(ctx: EvalContext, rows: DataRow[]): number {
  if (!ctx.row) return rows.length - 1;
  let m = ctx.env.indexCache.get(rows);
  if (!m || m.size !== rows.length) {
    m = new Map(rows.map((r, i) => [r, i]));
    ctx.env.indexCache.set(rows, m);
  }
  return m.get(ctx.row) ?? rows.length - 1;
}

/** RunningSum / RunningCount / RunningAvg (expr?, scope?) – cumulative up to the current row. */
function running(kind: 'sum' | 'count' | 'avg'): FunctionDef {
  return {
    lazy: true,
    fn: (args, ctx, ev) => {
      const scope = resolveScope(ctx, args[1] ? ev(args[1], ctx) : undefined);
      const idx = rowIndex(ctx, scope.rows);
      const prefix = cached(ctx, scope, args, () => {
        const acc: { s: number; c: number }[] = [];
        let s = 0;
        let c = 0;
        for (const r of scope.rows) {
          const v = args[0] ? toNumber(ev(args[0], rowCtx(ctx, r))) : 1;
          if (v !== null) {
            s += v;
            c++;
          }
          acc.push({ s, c });
        }
        return acc;
      }) as { s: number; c: number }[];
      const at = prefix[idx];
      if (!at) return kind === 'avg' ? null : 0;
      if (kind === 'sum') return at.s;
      if (kind === 'count') return at.c;
      return at.c ? at.s / at.c : null;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Built-in function library                                           */
/* ------------------------------------------------------------------ */

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown) => toNumber(v) ?? 0;
const date = (v: unknown) => toDate(v);

function dateFn(f: (d: Date, ...rest: number[]) => unknown, minArgs = 1): FunctionDef {
  return {
    minArgs,
    fn: (a) => {
      const d = date(a[0]);
      return d ? f(d, ...a.slice(1).map(num)) : null;
    },
  };
}

export const BUILTIN_FUNCTIONS: Record<string, FunctionDef> = {
  // Logic
  iif: {
    lazy: true,
    minArgs: 3,
    description: 'Iif(condition, whenTrue, whenFalse [, cond2, val2, ..., else])',
    fn: (args, ctx, ev) => {
      for (let i = 0; i + 1 < args.length; i += 2) {
        if (truthy(ev(args[i], ctx))) return ev(args[i + 1], ctx);
      }
      return args.length % 2 ? ev(args[args.length - 1], ctx) : null;
    },
  },
  isnull: { minArgs: 1, fn: (a) => (a.length > 1 ? (a[0] ?? a[1]) : a[0] === null || a[0] === undefined) },
  isnullorempty: { minArgs: 1, fn: (a) => isEmpty(a[0]) },
  coalesce: { fn: (a) => a.find((v) => !isEmpty(v)) ?? null },
  in: { minArgs: 2, fn: (a) => a.slice(1).some((v) => equals(a[0], v)) },
  between: { minArgs: 3, fn: (a) => compare(a[0], a[1]) >= 0 && compare(a[0], a[2]) <= 0 },

  // String
  upper: { minArgs: 1, fn: (a) => str(a[0]).toUpperCase() },
  lower: { minArgs: 1, fn: (a) => str(a[0]).toLowerCase() },
  trim: { minArgs: 1, fn: (a) => str(a[0]).trim() },
  len: { minArgs: 1, fn: (a) => str(a[0]).length },
  substring: { minArgs: 2, fn: (a) => str(a[0]).substr(num(a[1]), a.length > 2 ? num(a[2]) : undefined) },
  left: { minArgs: 2, fn: (a) => str(a[0]).slice(0, num(a[1])) },
  right: { minArgs: 2, fn: (a) => (num(a[1]) <= 0 ? '' : str(a[0]).slice(-num(a[1]))) },
  replace: { minArgs: 3, fn: (a) => str(a[0]).split(str(a[1])).join(str(a[2])) },
  contains: { minArgs: 2, fn: (a) => str(a[0]).toLowerCase().includes(str(a[1]).toLowerCase()) },
  startswith: { minArgs: 2, fn: (a) => str(a[0]).toLowerCase().startsWith(str(a[1]).toLowerCase()) },
  endswith: { minArgs: 2, fn: (a) => str(a[0]).toLowerCase().endsWith(str(a[1]).toLowerCase()) },
  concat: { fn: (a) => a.map(str).join('') },
  padleft: { minArgs: 2, fn: (a) => str(a[0]).padStart(num(a[1]), a[2] === undefined ? ' ' : str(a[2])) },
  padright: { minArgs: 2, fn: (a) => str(a[0]).padEnd(num(a[1]), a[2] === undefined ? ' ' : str(a[2])) },
  tostr: { minArgs: 1, fn: (a) => str(a[0]) },
  format: { minArgs: 1, fn: (a, ctx) => formatValue(a[0], a[1] === undefined ? undefined : str(a[1]), ctx.env.format) },

  // Math
  abs: { minArgs: 1, fn: (a) => (toNumber(a[0]) === null ? null : Math.abs(num(a[0]))) },
  round: {
    minArgs: 1,
    fn: (a) => {
      const n = toNumber(a[0]);
      if (n === null) return null;
      const f = 10 ** num(a[1] ?? 0);
      return Math.round((n + Number.EPSILON) * f) / f;
    },
  },
  floor: { minArgs: 1, fn: (a) => (toNumber(a[0]) === null ? null : Math.floor(num(a[0]))) },
  ceiling: { minArgs: 1, fn: (a) => (toNumber(a[0]) === null ? null : Math.ceil(num(a[0]))) },
  power: { minArgs: 2, fn: (a) => num(a[0]) ** num(a[1]) },
  sqrt: { minArgs: 1, fn: (a) => Math.sqrt(num(a[0])) },
  tonumber: { minArgs: 1, fn: (a) => toNumber(a[0]) },
  minof: { minArgs: 2, fn: (a) => a.reduce((m, v) => (compare(v, m) < 0 ? v : m)) },
  maxof: { minArgs: 2, fn: (a) => a.reduce((m, v) => (compare(v, m) > 0 ? v : m)) },
  percent: {
    minArgs: 2,
    description: 'Percent(part, whole) – part / whole, null when whole is 0',
    fn: (a) => {
      const p = toNumber(a[0]);
      const w = toNumber(a[1]);
      return p === null || !w ? null : p / w;
    },
  },

  // Date
  now: { fn: () => new Date() },
  today: {
    fn: () => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    },
  },
  todate: { minArgs: 1, fn: (a) => date(a[0]) },
  year: dateFn((d) => d.getFullYear()),
  month: dateFn((d) => d.getMonth() + 1),
  day: dateFn((d) => d.getDate()),
  hour: dateFn((d) => d.getHours()),
  minute: dateFn((d) => d.getMinutes()),
  dayofweek: dateFn((d) => d.getDay()),
  quarter: dateFn((d) => Math.floor(d.getMonth() / 3) + 1),
  monthname: { minArgs: 1, fn: (a, ctx) => formatValue(date(a[0]), 'MMMM', ctx.env.format) },
  adddays: dateFn((d, n) => addDays(d, n), 2),
  addmonths: dateFn((d, n) => {
    const r = new Date(d.getTime());
    r.setMonth(r.getMonth() + n);
    return r;
  }, 2),
  addyears: dateFn((d, n) => {
    const r = new Date(d.getTime());
    r.setFullYear(r.getFullYear() + n);
    return r;
  }, 2),
  datediffday: {
    minArgs: 2,
    fn: (a) => {
      const x = date(a[0]);
      const y = date(a[1]);
      return x && y ? Math.round((y.getTime() - x.getTime()) / 86400000) : null;
    },
  },
  datediffmonth: {
    minArgs: 2,
    fn: (a) => {
      const x = date(a[0]);
      const y = date(a[1]);
      return x && y ? (y.getFullYear() - x.getFullYear()) * 12 + y.getMonth() - x.getMonth() : null;
    },
  },

  // Aggregates
  sum: aggregate('sum'),
  avg: aggregate('avg'),
  count: aggregate('count'),
  countdistinct: aggregate('countdistinct'),
  min: aggregate('min'),
  max: aggregate('max'),
  first: aggregate('first'),
  last: aggregate('last'),
  median: aggregate('median'),
  stddev: aggregate('stddev'),
  sumif: conditionalAggregate('sum'),
  avgif: conditionalAggregate('avg'),
  countif: conditionalAggregate('count'),
  minif: conditionalAggregate('min'),
  maxif: conditionalAggregate('max'),
  runningsum: running('sum'),
  runningcount: running('count'),
  runningavg: running('avg'),
  percentoftotal: {
    lazy: true,
    minArgs: 1,
    description:
      "PercentOfTotal(expression, scope = 'report') – the current row's (or current group's) share of the scope total",
    fn: (args, ctx, ev) => {
      const totalScope = resolveScope(ctx, args[1] ? ev(args[1], ctx) : 'report');
      const total = cached(ctx, totalScope, args[0], () => sum(nums(values(totalScope.rows, args[0], ctx)))) as number;
      let part: number | null;
      if (ctx.isDetail && ctx.row) {
        part = toNumber(ev(args[0], ctx));
      } else {
        const partScope = resolveScope(ctx, undefined);
        part = cached(ctx, partScope, args[0], () => sum(nums(values(partScope.rows, args[0], ctx)))) as number;
      }
      return part === null || !total ? null : part / total;
    },
  },
};

/** Names offered by the designer's expression editor. */
export const FUNCTION_CATALOG: { category: string; items: { name: string; signature: string; description: string }[] }[] = [
  {
    category: 'Aggregate',
    items: [
      { name: 'Sum', signature: "Sum([Field], 'group')", description: "Total. Scope: 'group' (default in groups), 'report', 'page' or a group name." },
      { name: 'Avg', signature: 'Avg([Field])', description: 'Average, ignoring empty values.' },
      { name: 'Count', signature: 'Count()', description: 'Number of rows, or non-empty values when an expression is given.' },
      { name: 'CountDistinct', signature: 'CountDistinct([Field])', description: 'Number of distinct values.' },
      { name: 'Min', signature: 'Min([Field])', description: 'Smallest value.' },
      { name: 'Max', signature: 'Max([Field])', description: 'Largest value.' },
      { name: 'First', signature: 'First([Field])', description: 'Value from the first row in scope.' },
      { name: 'Last', signature: 'Last([Field])', description: 'Value from the last row in scope.' },
      { name: 'Median', signature: 'Median([Field])', description: 'Median value.' },
      { name: 'StdDev', signature: 'StdDev([Field])', description: 'Sample standard deviation.' },
      { name: 'PercentOfTotal', signature: "PercentOfTotal([Field], 'report')", description: "Share of the scope total. Format with 'p1'." },
      { name: 'RunningSum', signature: 'RunningSum([Field])', description: 'Cumulative total up to the current row.' },
      { name: 'RunningCount', signature: 'RunningCount()', description: 'Row counter within the scope.' },
      { name: 'RunningAvg', signature: 'RunningAvg([Field])', description: 'Cumulative average up to the current row.' },
      { name: 'SumIf', signature: "SumIf([Field], [Status] = 'Paid')", description: 'Total of rows matching a condition.' },
      { name: 'CountIf', signature: "CountIf([Status] = 'Paid')", description: 'Rows matching a condition.' },
      { name: 'AvgIf', signature: 'AvgIf([Field], condition)', description: 'Average of rows matching a condition.' },
      { name: 'MinIf', signature: 'MinIf([Field], condition)', description: 'Smallest value among rows matching a condition.' },
      { name: 'MaxIf', signature: 'MaxIf([Field], condition)', description: 'Largest value among rows matching a condition.' },
    ],
  },
  {
    category: 'Logical',
    items: [
      { name: 'Iif', signature: "Iif([Qty] > 10, 'Bulk', 'Single')", description: 'Conditional value. Accepts extra condition/value pairs.' },
      { name: 'IsNull', signature: 'IsNull([Field], 0)', description: 'Fallback when null; with one argument returns true/false.' },
      { name: 'IsNullOrEmpty', signature: 'IsNullOrEmpty([Field])', description: 'True for null or empty string.' },
      { name: 'Coalesce', signature: 'Coalesce([A], [B], 0)', description: 'First non-empty value.' },
      { name: 'In', signature: "In([Status], 'A', 'B')", description: 'True when the value matches any of the options.' },
      { name: 'Between', signature: 'Between([Qty], 1, 10)', description: 'Inclusive range check.' },
    ],
  },
  {
    category: 'Text',
    items: [
      { name: 'Format', signature: "Format([Amount], 'c2')", description: 'Format a value as text.' },
      { name: 'Concat', signature: "Concat([First], ' ', [Last])", description: 'Join text.' },
      { name: 'Upper', signature: 'Upper([Field])', description: 'Upper case.' },
      { name: 'Lower', signature: 'Lower([Field])', description: 'Lower case.' },
      { name: 'Trim', signature: 'Trim([Field])', description: 'Remove surrounding spaces.' },
      { name: 'Len', signature: 'Len([Field])', description: 'Text length.' },
      { name: 'Substring', signature: 'Substring([Field], 0, 3)', description: 'Part of a text (zero-based start).' },
      { name: 'Left', signature: 'Left([Field], 3)', description: 'First n characters.' },
      { name: 'Right', signature: 'Right([Field], 3)', description: 'Last n characters.' },
      { name: 'Replace', signature: "Replace([Field], 'a', 'b')", description: 'Replace text.' },
      { name: 'Contains', signature: "Contains([Field], 'abc')", description: 'Case-insensitive substring check.' },
      { name: 'PadLeft', signature: "PadLeft([Code], 6, '0')", description: 'Pad on the left.' },
    ],
  },
  {
    category: 'Math',
    items: [
      { name: 'Round', signature: 'Round([Value], 2)', description: 'Round to decimals.' },
      { name: 'Abs', signature: 'Abs([Value])', description: 'Absolute value.' },
      { name: 'Floor', signature: 'Floor([Value])', description: 'Round down.' },
      { name: 'Ceiling', signature: 'Ceiling([Value])', description: 'Round up.' },
      { name: 'Power', signature: 'Power([Value], 2)', description: 'Exponent.' },
      { name: 'Percent', signature: 'Percent([Part], [Whole])', description: 'Safe division for ratios.' },
      { name: 'MinOf', signature: 'MinOf([A], [B])', description: 'Smaller of the values.' },
      { name: 'MaxOf', signature: 'MaxOf([A], [B])', description: 'Larger of the values.' },
    ],
  },
  {
    category: 'Date',
    items: [
      { name: 'Today', signature: 'Today()', description: "Today's date." },
      { name: 'Now', signature: 'Now()', description: 'Current date and time.' },
      { name: 'Year', signature: 'Year([Date])', description: 'Year number.' },
      { name: 'Month', signature: 'Month([Date])', description: 'Month number (1-12).' },
      { name: 'MonthName', signature: 'MonthName([Date])', description: 'Month name.' },
      { name: 'Quarter', signature: 'Quarter([Date])', description: 'Quarter (1-4).' },
      { name: 'Day', signature: 'Day([Date])', description: 'Day of month.' },
      { name: 'AddDays', signature: 'AddDays([Date], 30)', description: 'Add days.' },
      { name: 'AddMonths', signature: 'AddMonths([Date], 1)', description: 'Add months.' },
      { name: 'DateDiffDay', signature: 'DateDiffDay([Start], [End])', description: 'Days between dates.' },
    ],
  },
  {
    category: 'Variables',
    items: [
      { name: 'PageNumber', signature: 'PageNumber', description: 'Current page number (page header/footer).' },
      { name: 'TotalPages', signature: 'TotalPages', description: 'Total number of pages (page header/footer).' },
      { name: 'RowNumber', signature: 'RowNumber', description: 'Row number within the current group (or report).' },
      { name: 'GroupNumber', signature: 'GroupNumber', description: 'Index of the current group instance.' },
      { name: 'ReportName', signature: 'ReportName', description: 'Template name.' },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Environment helpers                                                  */
/* ------------------------------------------------------------------ */

export type HostFunction = (args: unknown[], ctx: EvalContext) => unknown;

export function createEnv(opts: {
  calculatedFields?: { name: string; expression: string }[];
  functions?: Record<string, HostFunction | FunctionDef>;
  format?: FormatOptions;
}): EvalEnv {
  const functions: Record<string, FunctionDef> = { ...BUILTIN_FUNCTIONS };
  for (const [name, f] of Object.entries(opts.functions ?? {})) {
    functions[name.toLowerCase()] = typeof f === 'function' ? { fn: f } : f;
  }
  const calculated = new Map<string, Ast>();
  for (const cf of opts.calculatedFields ?? []) {
    if (cf.name && cf.expression) calculated.set(cf.name.toLowerCase(), parseExpression(cf.expression));
  }
  return {
    calculated,
    functions,
    format: opts.format ?? {},
    aggCache: new WeakMap(),
    indexCache: new WeakMap(),
    depth: 0,
  };
}

/** Convenience: evaluate an expression string against a single row. */
export function evaluateExpression(
  src: string,
  opts: { row?: DataRow; rows?: DataRow[]; params?: Record<string, unknown>; env?: EvalEnv } = {},
): unknown {
  const env = opts.env ?? createEnv({});
  return evaluate(parseExpression(src), {
    row: opts.row ?? null,
    scope: { report: opts.rows ?? (opts.row ? [opts.row] : []), groups: [] },
    defaultScope: 'report',
    isDetail: !!opts.row,
    params: opts.params ?? {},
    vars: {},
    env,
  });
}
