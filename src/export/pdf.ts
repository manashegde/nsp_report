import type { jsPDF as JsPDF } from 'jspdf';
import { PT_TO_PX } from '../core/measure';
import { safeUrl } from '../core/html';
import type { BorderStyle, RenderedDocument, RenderedItem, RenderedText } from '../core/types';

export interface PdfFont {
  /** Family name used in templates, e.g. "Roboto". */
  family: string;
  style?: 'normal' | 'bold' | 'italic' | 'bolditalic';
  /** TTF file: base64 string, ArrayBuffer, or URL to fetch. */
  source: string | ArrayBuffer;
}

export interface PdfExportOptions {
  fileName?: string;
  /** Custom TTF fonts (needed for non-Latin scripts). */
  fonts?: PdfFont[];
  /** Image pixel density used when rasterising images (default 2). */
  imageScale?: number;
  title?: string;
  author?: string;
  /** Supply jsPDF yourself instead of the dynamic import. */
  jsPDF?: typeof JsPDF;
}

const PX_TO_PT = 1 / PT_TO_PX; // 0.75

/** Font metrics (ascent/descent in em) so PDF baselines match the browser layout. */
const METRICS: Record<string, { a: number; d: number }> = {
  helvetica: { a: 0.905, d: 0.212 },
  times: { a: 0.891, d: 0.216 },
  courier: { a: 0.833, d: 0.3 },
};

async function loadJsPdf(opts: PdfExportOptions): Promise<typeof JsPDF> {
  if (opts.jsPDF) return opts.jsPDF;
  try {
    const mod = await import('jspdf');
    return (mod.jsPDF ?? (mod as unknown as { default: typeof JsPDF }).default) as typeof JsPDF;
  } catch {
    throw new Error("PDF export requires the 'jspdf' package. Install it with: npm i jspdf");
  }
}

function toBase64(buf: ArrayBuffer): string {
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function fontBase64(src: string | ArrayBuffer): Promise<string> {
  if (typeof src !== 'string') return toBase64(src);
  if (/^(https?:|\/|\.)/.test(src)) return toBase64(await (await fetch(src)).arrayBuffer());
  return src.replace(/^data:[^,]+,/, '');
}

let colorCtx: CanvasRenderingContext2D | null | undefined;
/** Normalise any CSS color to #rrggbb; returns null for transparent / invalid. */
function hex(color: string | undefined): string | null {
  if (!color) return null;
  const c = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  if (/^transparent$/i.test(c)) return null;
  if (colorCtx === undefined) colorCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (!colorCtx) return '#000000';
  colorCtx.fillStyle = '#000000';
  colorCtx.fillStyle = c;
  const v = String(colorCtx.fillStyle);
  if (v.startsWith('#')) return v;
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(v);
  if (!m) return '#000000';
  if (m[4] !== undefined && Number(m[4]) === 0) return null;
  return `#${[m[1], m[2], m[3]].map((x) => Math.round(Number(x)).toString(16).padStart(2, '0')).join('')}`;
}

async function rasterize(src: string, w: number, h: number, fit: string, scale: number): Promise<string | null> {
  const url = safeUrl(src);
  if (!url || typeof document === 'undefined') return null;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Failed to load image ${src.slice(0, 80)}`));
    img.src = url;
  }).catch(() => null);
  if (!img.naturalWidth) return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d')!;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  let dw = canvas.width;
  let dh = canvas.height;
  if (fit !== 'stretch') {
    const r = fit === 'cover' ? Math.max(dw / iw, dh / ih) : Math.min(dw / iw, dh / ih);
    dw = iw * r;
    dh = ih * r;
  }
  ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null; // tainted canvas (CORS)
  }
}

// Characters the standard 14 PDF fonts can draw (WinAnsiEncoding = Latin-1 + CP1252 extras).
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const STANDARD_FONTS = new Set(['helvetica', 'times', 'courier']);

/** Make text drawable with a standard font: compatibility forms (CO₂ → CO2), then '?' for the rest. */
export function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFKC')) {
    const c = ch.charCodeAt(0);
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.includes(ch)) out += ch;
    else if (ch === '−') out += '-';
    else if (ch === ' ' || ch === ' ' || ch === ' ') out += ' ';
    else out += '?';
  }
  return out;
}

class PdfWriter {
  private families = new Map<string, Set<string>>();

  constructor(
    private doc: JsPDF,
    private opts: PdfExportOptions,
  ) {
    for (const f of ['helvetica', 'times', 'courier']) this.families.set(f, new Set(['normal', 'bold', 'italic', 'bolditalic']));
  }

  async registerFonts(fonts: PdfFont[]) {
    for (const f of fonts) {
      const style = f.style ?? 'normal';
      const file = `${f.family}-${style}.ttf`;
      this.doc.addFileToVFS(file, await fontBase64(f.source));
      this.doc.addFont(file, f.family, style);
      const key = f.family.toLowerCase();
      if (!this.families.has(key)) this.families.set(key, new Set());
      this.families.get(key)!.add(style);
    }
  }

  /** Pick the first available family from a CSS font-family list. */
  private font(family: string, bold: boolean, italic: boolean): { name: string; style: string; metrics: { a: number; d: number } } {
    const style = bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal';
    for (const raw of family.split(',')) {
      const f = raw.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
      for (const [name, styles] of this.families) {
        if (name === f) {
          const s = styles.has(style) ? style : 'normal';
          return { name: this.realName(name), style: s, metrics: METRICS[name] ?? METRICS.helvetica };
        }
      }
      if (/times|serif$|georgia|garamond/.test(f) && !/sans/.test(f)) return { name: 'times', style, metrics: METRICS.times };
      if (/courier|mono|consol/.test(f)) return { name: 'courier', style, metrics: METRICS.courier };
      if (/arial|helvetica|sans|verdana|segoe|roboto|inter|tahoma/.test(f)) return { name: 'helvetica', style, metrics: METRICS.helvetica };
    }
    return { name: 'helvetica', style, metrics: METRICS.helvetica };
  }

  private realName(lower: string): string {
    const list = this.doc.getFontList();
    return Object.keys(list).find((k) => k.toLowerCase() === lower) ?? lower;
  }

  private dash(style: string | undefined, width: number) {
    const w = Math.max(width, 0.5);
    if (style === 'dashed') this.doc.setLineDashPattern([w * 3, w * 2], 0);
    else if (style === 'dotted') this.doc.setLineDashPattern([w, w * 1.5], 0);
    else this.doc.setLineDashPattern([], 0);
  }

  private border(x: number, y: number, w: number, h: number, b?: BorderStyle) {
    if (!b || !b.width) return;
    const color = hex(b.color);
    if (!color) return;
    const lw = b.width * PX_TO_PT;
    this.doc.setDrawColor(color);
    this.doc.setLineWidth(lw);
    this.dash(b.style, lw);
    const s = b.sides ?? { top: true, right: true, bottom: true, left: true };
    const [X, Y, W, H] = [x, y, w, h].map((v) => v * PX_TO_PT);
    if (s.top) this.doc.line(X, Y, X + W, Y);
    if (s.right) this.doc.line(X + W, Y, X + W, Y + H);
    if (s.bottom) this.doc.line(X, Y + H, X + W, Y + H);
    if (s.left) this.doc.line(X, Y, X, Y + H);
    this.dash('solid', 0);
  }

  private text(it: RenderedText) {
    const s = it.style;
    const bg = hex(s.backgroundColor);
    if (bg) {
      this.doc.setFillColor(bg);
      this.doc.rect(it.x * PX_TO_PT, it.y * PX_TO_PT, it.width * PX_TO_PT, it.height * PX_TO_PT, 'F');
    }
    this.border(it.x, it.y, it.width, it.height, s.border);
    const lines = it.lines;
    if (!lines.some((l) => l !== '')) return;

    const f = this.font(s.fontFamily, s.bold, s.italic);
    this.doc.setFont(f.name, f.style);
    this.doc.setFontSize(s.fontSize);
    const color = hex(s.color) ?? '#000000';
    this.doc.setTextColor(color);

    const emPx = s.fontSize * PT_TO_PX;
    const lh = emPx * s.lineHeight;
    const blockH = lines.length * lh;
    const pad = s.padding;
    let top = it.y + pad;
    if (s.verticalAlign === 'middle') top = it.y + (it.height - blockH) / 2;
    else if (s.verticalAlign === 'bottom') top = it.y + it.height - pad - blockH;
    const baselineOffset = (lh - (f.metrics.a + f.metrics.d) * emPx) / 2 + f.metrics.a * emPx;

    const left = it.x + pad;
    const right = it.x + it.width - pad;
    const ax = s.textAlign === 'right' ? right : s.textAlign === 'center' ? (left + right) / 2 : left;

    const standard = STANDARD_FONTS.has(f.name.toLowerCase());
    lines.forEach((raw, i) => {
      if (!raw) return;
      const line = standard ? toWinAnsi(raw) : raw;
      const lineTop = top + i * lh;
      // Clip lines that fall outside the box (matches overflow:hidden in HTML).
      if (lineTop + lh > it.y + it.height + 0.5 && i > 0) return;
      const by = lineTop + baselineOffset;
      this.doc.text(line, ax * PX_TO_PT, by * PX_TO_PT, { align: s.textAlign, baseline: 'alphabetic' });
      if (s.underline) {
        const w = this.doc.getTextWidth(line);
        const x0 = s.textAlign === 'right' ? ax * PX_TO_PT - w : s.textAlign === 'center' ? ax * PX_TO_PT - w / 2 : ax * PX_TO_PT;
        const uy = (by + emPx * 0.12) * PX_TO_PT;
        this.doc.setDrawColor(color);
        this.doc.setLineWidth(Math.max(0.5, s.fontSize / 18));
        this.doc.line(x0, uy, x0 + w, uy);
      }
    });
  }

  async item(it: RenderedItem) {
    const d = this.doc;
    const X = it.x * PX_TO_PT;
    const Y = it.y * PX_TO_PT;
    const W = it.width * PX_TO_PT;
    const H = it.height * PX_TO_PT;
    switch (it.kind) {
      case 'text':
        this.text(it);
        break;
      case 'rect': {
        const fill = hex(it.fill);
        const stroke = it.strokeWidth ? hex(it.stroke) : null;
        if (!fill && !stroke) break;
        if (fill) d.setFillColor(fill);
        if (stroke) {
          d.setDrawColor(stroke);
          d.setLineWidth(it.strokeWidth * PX_TO_PT);
          this.dash(it.dash, it.strokeWidth * PX_TO_PT);
        }
        const mode = fill && stroke ? 'FD' : fill ? 'F' : 'S';
        if (it.ellipse) d.ellipse(X + W / 2, Y + H / 2, W / 2, H / 2, mode);
        else if (it.radius) d.roundedRect(X, Y, W, H, it.radius * PX_TO_PT, it.radius * PX_TO_PT, mode);
        else d.rect(X, Y, W, H, mode);
        this.dash('solid', 0);
        break;
      }
      case 'line': {
        const color = hex(it.color);
        if (!color) break;
        d.setDrawColor(color);
        d.setLineWidth(it.thickness * PX_TO_PT);
        this.dash(it.lineStyle, it.thickness * PX_TO_PT);
        d.line(X, Y, it.x2 * PX_TO_PT, it.y2 * PX_TO_PT);
        this.dash('solid', 0);
        break;
      }
      case 'checkbox': {
        const color = hex(it.color) ?? '#000000';
        d.setDrawColor(color);
        d.setLineWidth(0.75);
        d.rect(X, Y, W, H, 'S');
        if (it.checked) {
          d.setLineWidth(1.1);
          d.line(X + W * 0.2, Y + H * 0.52, X + W * 0.4, Y + H * 0.72);
          d.line(X + W * 0.4, Y + H * 0.72, X + W * 0.8, Y + H * 0.3);
        }
        break;
      }
      case 'image': {
        const bg = hex(it.backgroundColor);
        if (bg) {
          d.setFillColor(bg);
          d.rect(X, Y, W, H, 'F');
        }
        const data = await rasterize(it.src, it.width, it.height, it.fit, this.opts.imageScale ?? 2);
        if (data) d.addImage(data, 'PNG', X, Y, W, H, undefined, 'FAST');
        this.border(it.x, it.y, it.width, it.height, it.border);
        break;
      }
    }
  }
}

/** Build a PDF from a rendered document. Returns the jsPDF instance. */
export async function createPdf(doc: RenderedDocument, opts: PdfExportOptions = {}): Promise<JsPDF> {
  const JsPDFCtor = await loadJsPdf(opts);
  const w = doc.pageWidth * PX_TO_PT;
  const h = doc.pageHeight * PX_TO_PT;
  const pdf = new JsPDFCtor({ unit: 'pt', format: [w, h], orientation: w > h ? 'landscape' : 'portrait', compress: true });
  pdf.setProperties({ title: opts.title ?? doc.name, author: opts.author ?? '', creator: 'easy-report' });
  const writer = new PdfWriter(pdf, opts);
  if (opts.fonts?.length) await writer.registerFonts(opts.fonts);
  for (let i = 0; i < doc.pages.length; i++) {
    if (i > 0) pdf.addPage([w, h], w > h ? 'landscape' : 'portrait');
    for (const it of doc.pages[i].items) await writer.item(it);
  }
  return pdf;
}

export async function exportPdfBlob(doc: RenderedDocument, opts: PdfExportOptions = {}): Promise<Blob> {
  return (await createPdf(doc, opts)).output('blob');
}

/** Generate and download a PDF file. */
export async function downloadPdf(doc: RenderedDocument, opts: PdfExportOptions = {}): Promise<void> {
  const blob = await exportPdfBlob(doc, opts);
  downloadBlob(blob, opts.fileName ?? `${sanitizeFileName(doc.name)}.pdf`);
}

export function sanitizeFileName(name: string): string {
  return (name || 'report').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'report';
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
