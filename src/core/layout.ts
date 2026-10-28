import {
  createEnv,
  evaluate,
  EvalError,
  truthy,
  type ActiveGroup,
  type EvalContext,
  type EvalEnv,
  type FunctionDef,
  type HostFunction,
  type ScopeName,
} from './evaluator';
import { ExpressionError, isPageDependent, parseExpression, referencedFields } from './expression';
import { formatValue, plainNumber, toDate } from './format';
import { defaultMeasurer, lineHeightPx, pageDimensions, wrapText, type TextMeasurer } from './measure';
import type {
  AnyElement,
  Band,
  CheckboxElement,
  DataRow,
  ElementStyle,
  GroupDef,
  ImageElement,
  LineElement,
  RenderedDocument,
  RenderedItem,
  RenderedPage,
  ReportTemplate,
  ResolvedTextStyle,
  ShapeElement,
  TextElement,
} from './types';

/* ------------------------------------------------------------------ */
/* Element layout registry                                              */
/* ------------------------------------------------------------------ */

export interface ElementLayoutApi {
  ctx: EvalContext;
  measurer: TextMeasurer;
  /** Evaluate an expression; errors are reported as warnings and return the `#ERR` marker. */
  evaluate(expression: string): unknown;
  format(value: unknown, format?: string): string;
  /** Interpolate `{expression}` segments inside static text. */
  interpolate(text: string): string;
  /** Element style merged with template defaults and matching conditional styles. */
  resolveStyle(el: AnyElement): ResolvedTextStyle;
  /** Lay out text inside a box; handles wrapping and can-grow. */
  layoutText(el: AnyElement, text: string, opts?: { canGrow?: boolean; wordWrap?: boolean }): ElementLayoutResult;
  warn(message: string): void;
}

export interface ElementLayoutResult {
  items: RenderedItem[];
  /** Final element height (>= declared height when the element grows). */
  height: number;
  /** Display value used for CSV export. */
  value?: string;
  /** Data value for CSV export when it differs from the display (plain numbers); defaults to `value`. */
  exportValue?: string;
}

export type ElementLayout = (el: AnyElement, api: ElementLayoutApi) => ElementLayoutResult | null;

const ERR = '#ERR';

const DEFAULT_TEXT_STYLE: ResolvedTextStyle = {
  fontFamily: 'Helvetica, Arial, sans-serif',
  fontSize: 10,
  bold: false,
  italic: false,
  underline: false,
  color: '#000000',
  textAlign: 'left',
  verticalAlign: 'top',
  padding: 2,
  lineHeight: 1.2,
};

export function mergeStyle(base: ResolvedTextStyle, ...over: (ElementStyle | undefined)[]): ResolvedTextStyle {
  const out = { ...base };
  for (const s of over) {
    if (!s) continue;
    for (const [k, v] of Object.entries(s)) {
      if (v !== undefined && v !== null && v !== '') (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

const textLayout: ElementLayout = (el, api) => {
  const t = el as TextElement;
  let text: string;
  let exportValue: string | undefined;
  if (t.expression && t.expression.trim()) {
    const v = api.evaluate(t.expression);
    text = v === ERR ? ERR : api.format(v, t.format);
    exportValue = plainNumber(v, t.format) ?? undefined;
  } else {
    text = api.interpolate(t.text ?? '');
  }
  const res = api.layoutText(el, text, { canGrow: t.canGrow, wordWrap: t.wordWrap });
  res.value = text;
  res.exportValue = exportValue;
  return res;
};

const imageLayout: ElementLayout = (el, api) => {
  const img = el as ImageElement;
  const src = img.expression?.trim() ? String(api.evaluate(img.expression) ?? '') : (img.src ?? '');
  const style = api.resolveStyle(el);
  const items: RenderedItem[] = [];
  if (src && src !== ERR) {
    items.push({
      kind: 'image',
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      src,
      fit: img.fit ?? 'contain',
      border: style.border,
      backgroundColor: style.backgroundColor,
      elementId: el.id,
    });
  }
  return { items, height: el.height };
};

const lineLayout: ElementLayout = (el) => {
  const l = el as LineElement;
  const thickness = l.thickness ?? 1;
  const horizontal = l.direction !== 'vertical';
  const x = horizontal ? el.x : el.x + el.width / 2;
  const y = horizontal ? el.y + el.height / 2 : el.y;
  return {
    items: [
      {
        kind: 'line',
        x,
        y,
        x2: horizontal ? el.x + el.width : x,
        y2: horizontal ? y : el.y + el.height,
        width: el.width,
        height: el.height,
        color: l.color ?? '#000000',
        thickness,
        lineStyle: l.lineStyle ?? 'solid',
        elementId: el.id,
      },
    ],
    height: el.height,
  };
};

const shapeLayout: ElementLayout = (el) => {
  const s = el as ShapeElement;
  return {
    items: [
      {
        kind: 'rect',
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        fill: s.fill,
        stroke: s.stroke ?? '#000000',
        strokeWidth: s.strokeWidth ?? 1,
        radius: s.radius ?? 0,
        ellipse: s.shape === 'ellipse',
        elementId: el.id,
      },
    ],
    height: el.height,
  };
};

const checkboxLayout: ElementLayout = (el, api) => {
  const c = el as CheckboxElement;
  const checked = c.expression ? truthy(api.evaluate(c.expression)) : false;
  const style = api.resolveStyle(el);
  const size = Math.min(el.width, el.height, 14);
  return {
    items: [
      {
        kind: 'checkbox',
        x: el.x + (el.width - size) / 2,
        y: el.y + (el.height - size) / 2,
        width: size,
        height: size,
        checked,
        color: style.color,
        elementId: el.id,
      },
    ],
    height: el.height,
    value: checked ? 'true' : 'false',
  };
};

export const BUILTIN_LAYOUTS: Record<string, ElementLayout> = {
  text: textLayout,
  image: imageLayout,
  line: lineLayout,
  shape: shapeLayout,
  checkbox: checkboxLayout,
};

/* ------------------------------------------------------------------ */
/* Options                                                              */
/* ------------------------------------------------------------------ */

export interface RenderOptions {
  parameters?: Record<string, unknown>;
  functions?: Record<string, HostFunction | FunctionDef>;
  measurer?: TextMeasurer;
  locale?: string;
  currency?: string;
  /** Layout functions for host-defined element types. */
  elementLayouts?: Record<string, ElementLayout>;
  /** Safety valve against runaway layouts. */
  maxPages?: number;
}

/** Resolve parameter values: provided → default (`=Expression` defaults are evaluated). */
export function resolveParameters(
  template: ReportTemplate,
  provided: Record<string, unknown> = {},
  env?: EvalEnv,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...provided };
  const e = env ?? createEnv({});
  for (const p of template.parameters) {
    let v = provided[p.name];
    if (v === undefined) {
      v = p.defaultValue;
      if (typeof v === 'string' && v.startsWith('=')) {
        try {
          v = evaluate(parseExpression(v.slice(1)), {
            row: null,
            scope: { report: [], groups: [] },
            defaultScope: 'report',
            isDetail: false,
            params: out,
            vars: {},
            env: e,
          });
        } catch {
          v = null;
        }
      }
    }
    if (p.type === 'date' && v !== null && v !== undefined && !(v instanceof Date)) {
      v = Array.isArray(v) ? v.map((x) => toDate(x)) : toDate(v);
    } else if (p.type === 'number' && typeof v === 'string' && v.trim() !== '') {
      v = Number(v);
    } else if (p.type === 'boolean' && typeof v === 'string') {
      v = v === 'true';
    }
    out[p.name] = v ?? null;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Engine                                                               */
/* ------------------------------------------------------------------ */

interface BandResult {
  items: RenderedItem[];
  deferred: { el: AnyElement; dy: number }[];
  height: number;
  values: Map<string, string>;
}

interface Deferred {
  page: RenderedPage;
  el: AnyElement;
  offsetX: number;
  offsetY: number;
  ctx: EvalContext;
  bandWidth: number;
}

class LayoutEngine {
  readonly warnings = new Set<string>();
  private env: EvalEnv;
  private params: Record<string, unknown>;
  private measurer: TextMeasurer;
  private layouts: Record<string, ElementLayout>;
  private pageW: number;
  private pageH: number;
  private left: number;
  private top: number;
  private bottom: number;
  private contentW: number;

  private pages: RenderedPage[] = [];
  private pageRows: DataRow[][] = [];
  private page!: RenderedPage;
  private y = 0;
  private pageContentStart = 0;
  private pendingBreak = false;
  private deferred: Deferred[] = [];
  private activeGroups: { def: GroupDef; group: ActiveGroup }[] = [];
  private reportRows: DataRow[] = [];
  private tableRows: string[][] = [];
  private detailRowCounter = 0;

  constructor(
    private template: ReportTemplate,
    private opts: RenderOptions,
  ) {
    this.env = createEnv({
      calculatedFields: template.calculatedFields,
      functions: opts.functions,
      format: { locale: opts.locale ?? template.locale, currency: template.currency ?? opts.currency },
    });
    this.params = resolveParameters(template, opts.parameters, this.env);
    this.measurer = opts.measurer ?? defaultMeasurer;
    this.layouts = { ...BUILTIN_LAYOUTS, ...opts.elementLayouts };
    const dims = pageDimensions(template.page);
    this.pageW = dims.width;
    this.pageH = dims.height;
    const m = template.page.margins;
    this.left = m.left;
    this.top = m.top;
    this.bottom = this.pageH - m.bottom;
    this.contentW = this.pageW - m.left - m.right;
  }

  private warn(msg: string) {
    this.warnings.add(msg);
  }

  private safeEval(expr: string, ctx: EvalContext): unknown {
    try {
      return evaluate(parseExpression(expr), ctx);
    } catch (e) {
      if (e instanceof ExpressionError || e instanceof EvalError) this.warn(`${e.message} in "${expr}"`);
      else this.warn(`Error evaluating "${expr}": ${String(e)}`);
      return ERR;
    }
  }

  private ctxFor(
    row: DataRow | null,
    defaultScope: ScopeName,
    isDetail: boolean,
    extraVars: Record<string, unknown> = {},
    groupDepth = this.activeGroups.length,
  ): EvalContext {
    const groups = this.activeGroups.slice(0, groupDepth).map((g) => g.group);
    const inner = groups[groups.length - 1];
    return {
      row,
      scope: {
        report: this.reportRows,
        groups,
        page: this.pageRows[this.pageRows.length - 1] ?? [],
      },
      defaultScope,
      isDetail,
      params: this.params,
      vars: {
        reportname: this.template.name,
        pagenumber: this.pages.length,
        groupnumber: inner?.index ?? 1,
        ...extraVars,
      },
      env: this.env,
    };
  }

  private api(ctx: EvalContext): ElementLayoutApi {
    const base = mergeStyle(DEFAULT_TEXT_STYLE, this.template.defaultStyle);
    const api: ElementLayoutApi = {
      ctx,
      measurer: this.measurer,
      evaluate: (expr) => this.safeEval(expr, ctx),
      format: (v, f) => formatValue(v, f, this.env.format),
      interpolate: (text) => {
        if (!text.includes('{')) return text;
        return text.replace(/\{\{|\}\}|\{([^{}]+)\}/g, (m, expr: string | undefined) => {
          if (m === '{{') return '{';
          if (m === '}}') return '}';
          const [e, fmt] = splitFormat(expr!);
          const v = this.safeEval(e, ctx);
          return v === ERR ? ERR : formatValue(v, fmt, this.env.format);
        });
      },
      resolveStyle: (el) => {
        const conds = (el.conditionalStyles ?? [])
          .filter((c) => c.condition && truthy(this.safeEval(c.condition, ctx)))
          .map((c) => c.style);
        return mergeStyle(base, el.style, ...conds);
      },
      layoutText: (el, text, o = {}) => {
        const style = api.resolveStyle(el);
        const pad = style.padding;
        const lh = lineHeightPx(style);
        const innerW = Math.max(1, el.width - pad * 2);
        let lines = wrapText(text, innerW, style, this.measurer, o.wordWrap !== false);
        let height = el.height;
        const needed = lines.length * lh + pad * 2;
        if (o.canGrow && needed > height) height = Math.ceil(needed);
        else if (!o.canGrow) {
          const fit = Math.max(1, Math.floor((height - pad * 2 + 0.5) / lh));
          if (lines.length > fit) lines = lines.slice(0, fit);
        }
        return {
          items: [{ kind: 'text', x: el.x, y: el.y, width: el.width, height, lines, style, elementId: el.id }],
          height,
        };
      },
      warn: (m) => this.warn(m),
    };
    return api;
  }

  /** Lay out a band's elements relative to the band origin. */
  private layoutBand(band: Band, ctx: EvalContext, deferMode: 'none' | 'page-dependent' | 'all', bg?: string): BandResult | null {
    if (band.visible && !truthy(this.safeEval(band.visible, ctx))) return null;
    const api = this.api(ctx);
    // Layout runs top-to-bottom (for can-grow shifting) but output keeps the band's z-order.
    const byElement = new Map<string, RenderedItem[]>();
    const deferred: BandResult['deferred'] = [];
    const values = new Map<string, string>();
    const sorted = [...band.elements].sort((a, b) => a.y - b.y || a.x - b.x);
    // growth[i] = extra height added by element i
    const placed: { el: AnyElement; growth: number }[] = [];
    let bottom = band.height;

    for (const el of sorted) {
      // Shift down by growth of elements fully above and horizontally overlapping.
      let shift = 0;
      for (const p of placed) {
        if (p.growth > 0 && p.el.y + p.el.height <= el.y + 0.5 && overlapsX(p.el, el)) shift = Math.max(shift, p.growth);
      }
      const shifted = shift ? { ...el, y: el.y + shift } : el;

      if (el.visible && !truthy(this.safeEval(el.visible, ctx))) {
        placed.push({ el, growth: 0 });
        continue;
      }
      const exprs = elementExpressions(el);
      if (deferMode === 'all' || (deferMode === 'page-dependent' && exprs.some(isPageDependent))) {
        deferred.push({ el: shifted, dy: 0 });
        placed.push({ el, growth: 0 });
        continue;
      }
      const layout = this.layouts[el.type];
      if (!layout) {
        this.warn(`Unknown element type '${el.type}'`);
        placed.push({ el, growth: 0 });
        continue;
      }
      const res = layout(shifted, api);
      if (!res) {
        placed.push({ el, growth: 0 });
        continue;
      }
      byElement.set(el.id, res.items);
      const value = res.exportValue ?? res.value;
      if (value !== undefined) values.set(el.id, value);
      const growth = Math.max(0, res.height - el.height);
      placed.push({ el, growth });
      bottom = Math.max(bottom, shifted.y + res.height);
    }

    const items: RenderedItem[] = band.elements.flatMap((el) => byElement.get(el.id) ?? []);
    const background = bg ?? band.backgroundColor;
    if (background) {
      items.unshift({
        kind: 'rect',
        x: 0,
        y: 0,
        width: this.contentW,
        height: bottom,
        fill: background,
        strokeWidth: 0,
        radius: 0,
      });
    }
    return { items, deferred, height: bottom, values };
  }

  /* ---------------- page management ---------------- */

  private startPage() {
    if (this.pages.length >= (this.opts.maxPages ?? 5000)) {
      throw new Error(`Report exceeded maxPages (${this.opts.maxPages ?? 5000})`);
    }
    this.page = { index: this.pages.length, width: this.pageW, height: this.pageH, items: [] };
    this.pages.push(this.page);
    this.pageRows.push([]);
    this.y = this.top;
    this.pendingBreak = false;
  }

  private placePageHeader() {
    const ph = this.template.bands.pageHeader;
    if (!ph) return;
    this.placeDeferredBand(ph, this.y);
    this.y += ph.height;
  }

  /** Page header/footer: everything is resolved after pagination (page rows, TotalPages). */
  private placeDeferredBand(band: Band, y: number) {
    const ctx = this.ctxFor(null, 'page', false, {}, 0);
    const page = this.page;
    const res = this.layoutBand(band, ctx, 'all');
    if (!res) return;
    page.items.push(...translate(res.items, this.left, y));
    for (const d of res.deferred) {
      this.deferred.push({ page, el: d.el, offsetX: this.left, offsetY: y, ctx, bandWidth: this.contentW });
    }
  }

  private newPage() {
    this.startPage();
    this.placePageHeader();
    // Repeat headers of groups that are still open.
    this.activeGroups.forEach((g, i) => {
      if (!g.def.header?.repeatOnEveryPage) return;
      const ctx = this.ctxFor(g.group.rows[0] ?? null, 'group', false, {}, i + 1);
      const res = this.layoutBand(g.def.header, ctx, 'page-dependent');
      if (res) this.commit(res, ctx);
    });
    this.pageContentStart = this.y;
  }

  private get limit() {
    return this.bottom - (this.template.bands.pageFooter?.height ?? 0);
  }

  /** Place a band result on the current page, breaking first if needed. */
  private place(res: BandResult, ctx: EvalContext, band?: Band) {
    if (band?.pageBreakBefore && this.y > this.pageContentStart) this.newPage();
    else if (this.pendingBreak) this.newPage();
    if (this.y + res.height > this.limit + 0.01 && this.y > this.pageContentStart) {
      this.newPage();
    }
    this.commit(res, ctx);
    if (band?.pageBreakAfter) this.pendingBreak = true;
  }

  private commit(res: BandResult, ctx: EvalContext) {
    this.page.items.push(...translate(res.items, this.left, this.y));
    for (const d of res.deferred) {
      this.deferred.push({ page: this.page, el: d.el, offsetX: this.left, offsetY: this.y, ctx, bandWidth: this.contentW });
    }
    this.y += res.height;
  }

  private fits(height: number) {
    return this.y + height <= this.limit + 0.01;
  }

  /* ---------------- report traversal ---------------- */

  private renderDetail(row: DataRow, rowInGroup: number) {
    const band = this.template.bands.detail;
    const ctx = this.ctxFor(row, this.template.groups.length ? 'group' : 'report', true, {
      rownumber: rowInGroup,
      reportrownumber: ++this.detailRowCounter,
    });
    const alt = band.alternateBackgroundColor && rowInGroup % 2 === 0 ? band.alternateBackgroundColor : undefined;
    const res = this.layoutBand(band, ctx, 'page-dependent', alt);
    if (!res) return;
    this.place(res, ctx, band);
    this.pageRows[this.pageRows.length - 1].push(row);
    this.addTableRow(band, res.values, ctx.scope.groups);
  }

  private renderLevel(rows: DataRow[], level: number) {
    const groups = this.template.groups;
    if (level >= groups.length) {
      rows.forEach((r, i) => this.renderDetail(r, i + 1));
      return;
    }
    const def = groups[level];
    const keyAst = parseExpression(def.expression || "''");
    let index = 0;
    for (const chunk of chunkBy(rows, (r) => keyValue(this.safeEvalAst(keyAst, this.ctxFor(r, 'report', true))))) {
      index++;
      const group: ActiveGroup = { id: def.id, name: def.name, key: chunk.key, rows: chunk.rows, index };
      // Contexts snapshot the group stack, so the group can be off the stack while its
      // own header/footer are placed (a page break then won't repeat that header).
      this.activeGroups.push({ def, group });
      const ctx = this.ctxFor(chunk.rows[0] ?? null, 'group', false);
      this.activeGroups.pop();

      if (def.header) {
        const res = this.layoutBand(def.header, ctx, 'page-dependent');
        if (res) {
          if (def.keepWithFirstRow !== false && chunk.rows.length) {
            const firstCtx = { ...ctx, row: chunk.rows[0], isDetail: true };
            const probe = this.layoutBand(this.template.bands.detail, firstCtx, 'page-dependent');
            if (!this.fits(res.height + (probe?.height ?? 0)) && this.y > this.pageContentStart) this.newPage();
          }
          this.place(res, ctx, def.header);
          this.addTableRow(def.header, res.values, ctx.scope.groups);
        }
      }

      this.activeGroups.push({ def, group });
      this.renderLevel(chunk.rows, level + 1);
      this.activeGroups.pop();

      if (def.footer) {
        const res = this.layoutBand(def.footer, ctx, 'page-dependent');
        if (res) {
          this.place(res, ctx, def.footer);
          this.addTableRow(def.footer, res.values, ctx.scope.groups);
        }
      }
    }
  }

  private safeEvalAst(ast: ReturnType<typeof parseExpression>, ctx: EvalContext): unknown {
    try {
      return evaluate(ast, ctx);
    } catch (e) {
      this.warn(String((e as Error).message));
      return null;
    }
  }

  /* ---------------- CSV projection ---------------- */

  private columns: { el: AnyElement; header: string }[] = [];
  /** Group key columns written before the element columns (indices into `template.groups`). */
  private groupColumns: number[] = [];
  /**
   * Band whose instances become CSV rows: the detail band, or, for summary reports whose
   * detail band is empty, the innermost group footer/header that shows values.
   */
  private rowBand: Band | null = null;
  /** Column elements rendered in at least one row (always-hidden ones are dropped). */
  private renderedColumns = new Set<string>();

  private buildColumns() {
    const t = this.template;
    const exportable = (band: Band | undefined) =>
      (band?.elements ?? []).filter((e) => {
        const te = e as TextElement;
        if (e.type === 'checkbox') return true;
        return e.type === 'text' && (!!te.expression?.trim() || (te.text ?? '').includes('{'));
      });

    let elements = exportable(t.bands.detail);
    let depth = t.groups.length;
    this.rowBand = t.bands.detail;
    if (!elements.length) {
      for (let i = t.groups.length - 1; i >= 0 && !elements.length; i--) {
        for (const band of [t.groups[i].footer, t.groups[i].header]) {
          const found = exportable(band);
          if (found.length) {
            elements = found;
            depth = i + 1;
            this.rowBand = band!;
            break;
          }
        }
      }
    }

    const labels: AnyElement[] = [
      ...(t.bands.pageHeader?.elements ?? []),
      ...t.groups.flatMap((g) => g.header?.elements ?? []),
    ].filter((e) => e.type === 'text' && !(e as TextElement).expression);

    // A group whose key is already shown as a column (e.g. `[tagName]`) needs no key column.
    const norm = (s: string | undefined) => (s ?? '').replace(/\s+/g, '').toLowerCase();
    const shown = new Set(elements.map((e) => norm((e as TextElement).expression)).filter(Boolean));
    this.groupColumns = t.groups.slice(0, depth).flatMap((g, i) => (shown.has(norm(g.expression)) ? [] : [i]));

    this.columns = elements
      .sort((a, b) => a.x - b.x || a.y - b.y)
      .map((el, i) => {
        const t = el as TextElement;
        if (t.exportName) return { el, header: t.exportName };
        let best: AnyElement | undefined;
        let bestOverlap = 0;
        for (const l of labels) {
          const ov = Math.min(l.x + l.width, el.x + el.width) - Math.max(l.x, el.x);
          if (ov > bestOverlap && ov >= Math.min(l.width, el.width) * 0.5) {
            bestOverlap = ov;
            best = l;
          }
        }
        if (best) return { el, header: ((best as TextElement).text ?? '').trim() };
        const fields = t.expression ? referencedFields(t.expression) : [];
        return { el, header: t.name || fields[0] || t.text || `Column ${i + 1}` };
      });
  }

  /** Record a CSV row when `band` is the row band; `groups` is the open group stack, outermost first. */
  private addTableRow(band: Band, values: Map<string, string>, groups: ActiveGroup[]) {
    if (band !== this.rowBand) return;
    const key = (v: unknown) => plainNumber(v) ?? formatValue(v, undefined, this.env.format);
    for (const c of this.columns) if (values.has(c.el.id)) this.renderedColumns.add(c.el.id);
    this.tableRows.push([
      ...this.groupColumns.map((i) => key(groups[i]?.key)),
      ...this.columns.map((c) => values.get(c.el.id) ?? ''),
    ]);
  }

  /** Report header text as lines (elements sharing a row become cells), for self-describing exports. */
  private contextLines(res: BandResult | null): string[][] {
    const els = (this.template.bands.reportHeader?.elements ?? [])
      .filter((e) => res?.values.get(e.id)?.trim())
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const lines: { top: number; bottom: number; els: AnyElement[] }[] = [];
    for (const el of els) {
      const mid = el.y + el.height / 2;
      const line = lines.find((l) => mid >= l.top && mid < l.bottom);
      if (line) line.els.push(el);
      else lines.push({ top: el.y, bottom: el.y + el.height, els: [el] });
    }
    const out = lines.map((l) => l.els.sort((a, b) => a.x - b.x).map((e) => res!.values.get(e.id)!.trim()));
    return out.length ? out : [[this.template.name]];
  }

  /* ---------------- entry point ---------------- */

  run(input: DataRow[]): RenderedDocument {
    const t = this.template;
    // Filter
    let rows = input;
    if (t.filter?.trim()) {
      const ast = parseExpression(t.filter);
      rows = rows.filter((r) => truthy(this.safeEvalAst(ast, this.ctxFor(r, 'report', true))));
    }
    // Sort: group keys first, then explicit sort.
    const specs = [
      ...t.groups.map((g) => ({ expression: g.expression, direction: g.direction })),
      ...t.sort,
    ].filter((s) => s.expression?.trim());
    if (specs.length) {
      const asts = specs.map((s) => parseExpression(s.expression));
      const keyed = rows.map((r, i) => ({
        r,
        i,
        k: asts.map((a) => keyValue(this.safeEvalAst(a, this.ctxFor(r, 'report', true)))),
      }));
      keyed.sort((a, b) => {
        for (let j = 0; j < specs.length; j++) {
          const c = compareKeys(a.k[j], b.k[j]);
          if (c) return specs[j].direction === 'desc' ? -c : c;
        }
        return a.i - b.i;
      });
      rows = keyed.map((k) => k.r);
    }
    this.reportRows = rows;
    this.buildColumns();

    this.startPage();
    const pf = t.bands.pageFooter;

    // Report header, then page header on the first page.
    const rh = t.bands.reportHeader;
    let context: string[][] = [[t.name]];
    if (rh) {
      const ctx = this.ctxFor(rows[0] ?? null, 'report', false);
      const res = this.layoutBand(rh, ctx, 'page-dependent');
      context = this.contextLines(res);
      if (res) this.commit(res, ctx);
      if (rh.pageBreakAfter) this.pendingBreak = true;
    }
    if (this.pendingBreak) {
      this.newPage();
    } else {
      this.placePageHeader();
      this.pageContentStart = this.y;
    }

    this.renderLevel(rows, 0);

    const rf = t.bands.reportFooter;
    if (rf) {
      const ctx = this.ctxFor(rows[0] ?? null, 'report', false);
      const res = this.layoutBand(rf, ctx, 'page-dependent');
      if (res) this.place(res, ctx, rf);
    }

    // Page footers.
    if (pf) {
      for (let i = 0; i < this.pages.length; i++) {
        this.page = this.pages[i];
        this.placeDeferredBand(pf, this.bottom - pf.height);
      }
    }

    // Resolve deferred (page-dependent) elements now that page count is known.
    const total = this.pages.length;
    for (const d of this.deferred) {
      const rowsOnPage = this.pageRows[d.page.index];
      const ctx: EvalContext = {
        ...d.ctx,
        row: d.ctx.row ?? rowsOnPage[0] ?? null,
        scope: { ...d.ctx.scope, page: rowsOnPage, pageFinal: true },
        vars: { ...d.ctx.vars, pagenumber: d.page.index + 1, totalpages: total },
      };
      const layout = this.layouts[d.el.type];
      const res = layout?.(d.el, this.api(ctx));
      if (res) d.page.items.push(...translate(res.items, d.offsetX, d.offsetY));
    }

    const groupHeaders = this.groupColumns.map((i) => {
      const g = t.groups[i];
      return g.name || referencedFields(g.expression)[0] || `Group ${i + 1}`;
    });
    // Drop columns that were never rendered (e.g. always-hidden elements).
    const keep = [...groupHeaders.map(() => true), ...this.columns.map((c) => this.renderedColumns.has(c.el.id))];
    const pick = <T,>(arr: T[]) => arr.filter((_, i) => keep[i]);
    return {
      name: t.name,
      pages: this.pages,
      pageWidth: this.pageW,
      pageHeight: this.pageH,
      table: { columns: pick([...groupHeaders, ...this.columns.map((c) => c.header)]), rows: this.tableRows.map(pick), context },
      rows,
      warnings: [...this.warnings],
    };
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

function splitFormat(expr: string): [string, string | undefined] {
  // `{[Amount]:c2}` / `{Now():dd MMM yyyy HH:mm}` → expression + format. The expression
  // language has no top-level ':', so split on the first one outside quotes/brackets.
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth--;
    else if (ch === ':' && depth === 0) return [expr.slice(0, i), expr.slice(i + 1).trim()];
  }
  return [expr, undefined];
}

function elementExpressions(el: AnyElement): string[] {
  const out: string[] = [];
  const e = el as TextElement;
  if (e.expression) out.push(e.expression);
  if (e.text && e.text.includes('{')) out.push(e.text);
  return out;
}

function overlapsX(a: AnyElement, b: AnyElement) {
  return a.x < b.x + b.width && b.x < a.x + a.width;
}

function translate(items: RenderedItem[], dx: number, dy: number): RenderedItem[] {
  return items.map((it) => {
    const moved = { ...it, x: it.x + dx, y: it.y + dy };
    if (it.kind === 'line') return { ...moved, x2: it.x2 + dx, y2: it.y2 + dy } as RenderedItem;
    return moved as RenderedItem;
  });
}

function keyValue(v: unknown): unknown {
  return v instanceof Date ? v.getTime() : v;
}

function compareKeys(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return -1;
  if (b === null || b === undefined || b === '') return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function* chunkBy(rows: DataRow[], key: (r: DataRow) => unknown): Generator<{ key: unknown; rows: DataRow[] }> {
  let cur: { key: unknown; rows: DataRow[] } | null = null;
  for (const r of rows) {
    const k = key(r);
    if (!cur || compareKeys(cur.key, k) !== 0) {
      if (cur) yield cur;
      cur = { key: k, rows: [] };
    }
    cur.rows.push(r);
  }
  if (cur) yield cur;
}

/** Lay out a template against data rows, producing positioned pages. */
export function renderReport(template: ReportTemplate, rows: DataRow[], options: RenderOptions = {}): RenderedDocument {
  return new LayoutEngine(template, options).run(rows);
}
