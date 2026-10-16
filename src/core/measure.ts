import type { PageSettings, ResolvedTextStyle } from './types';

/** px per pt at 96 DPI */
export const PT_TO_PX = 96 / 72;
export const MM_TO_PX = 96 / 25.4;

const PAGE_SIZES_MM: Record<string, [number, number]> = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
  Tabloid: [279.4, 431.8],
};

export const PAGE_SIZE_NAMES = Object.keys(PAGE_SIZES_MM);

export function pageDimensions(page: PageSettings): { width: number; height: number } {
  let w: number;
  let h: number;
  if (typeof page.size === 'string') {
    const mm = PAGE_SIZES_MM[page.size] ?? PAGE_SIZES_MM.A4;
    w = Math.round(mm[0] * MM_TO_PX);
    h = Math.round(mm[1] * MM_TO_PX);
  } else {
    w = page.size.width;
    h = page.size.height;
  }
  if (page.orientation === 'landscape' ? w < h : w > h) [w, h] = [h, w];
  return { width: w, height: h };
}

export interface FontSpec {
  fontFamily: string;
  fontSize: number;
  bold?: boolean;
  italic?: boolean;
}

export interface TextMeasurer {
  /** Width in px of a single line of text. */
  width(text: string, font: FontSpec): number;
}

export function cssFont(f: FontSpec): string {
  return `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${f.fontSize}pt ${quoteFamily(f.fontFamily)}`;
}

function quoteFamily(family: string) {
  return family
    .split(',')
    .map((s) => {
      const t = s.trim();
      return /\s/.test(t) && !/^['"]/.test(t) ? `"${t}"` : t;
    })
    .join(', ');
}

// Helvetica / Helvetica-Bold AFM advance widths (1/1000 em) for ASCII 32..126.
// Arial is metric-compatible, so using these everywhere keeps browser preview,
// server-side layout and the PDF (which uses the standard Helvetica font) identical.
// prettier-ignore
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
// prettier-ignore
const HELV_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

type MetricFamily = 'helvetica' | 'courier' | 'other';

function metricFamily(family: string): MetricFamily {
  const first = family.split(',')[0].trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  if (/^(helvetica|arial|sans-serif|liberation sans|nimbus sans)/.test(first)) return 'helvetica';
  if (/^(courier|monospace)/.test(first)) return 'courier';
  return 'other';
}

function afmWidth(text: string, f: FontSpec): number {
  const px = f.fontSize * PT_TO_PX;
  const table = f.bold ? HELV_BOLD : HELV;
  let units = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    units += c >= 32 && c <= 126 ? table[c - 32] : c === 160 ? 278 : 556;
  }
  return (units / 1000) * px;
}

/** Rough widths for fonts without metrics when no canvas is available (SSR / tests). */
function approxWidth(text: string, f: FontSpec): number {
  return afmWidth(text, f) * 0.93;
}

let canvasCtx: CanvasRenderingContext2D | null | undefined;

export const defaultMeasurer: TextMeasurer = {
  width(text, f) {
    const fam = metricFamily(f.fontFamily);
    if (fam === 'helvetica') return afmWidth(text, f);
    if (fam === 'courier') return [...text].length * 0.6 * f.fontSize * PT_TO_PX;
    if (canvasCtx === undefined) {
      canvasCtx = null;
      try {
        if (typeof document !== 'undefined') canvasCtx = document.createElement('canvas').getContext('2d');
      } catch {
        canvasCtx = null;
      }
    }
    if (!canvasCtx) return approxWidth(text, f);
    canvasCtx.font = cssFont(f);
    return canvasCtx.measureText(text).width;
  },
};

export function lineHeightPx(style: Pick<ResolvedTextStyle, 'fontSize' | 'lineHeight'>): number {
  return style.fontSize * PT_TO_PX * style.lineHeight;
}

/** Break text into lines that fit `maxWidth`. */
export function wrapText(text: string, maxWidth: number, font: FontSpec, m: TextMeasurer, wrap = true): string[] {
  const paragraphs = text.replace(/\r\n?/g, '\n').split('\n');
  if (!wrap || maxWidth <= 0) return paragraphs;
  const out: string[] = [];
  for (const para of paragraphs) {
    if (para === '') {
      out.push('');
      continue;
    }
    if (m.width(para, font) <= maxWidth) {
      out.push(para);
      continue;
    }
    const words = para.split(/(\s+)/);
    let line = '';
    for (const word of words) {
      if (word === '') continue;
      const candidate = line + word;
      if (m.width(candidate, font) <= maxWidth || line === '') {
        if (line === '' && m.width(word, font) > maxWidth && !/^\s+$/.test(word)) {
          // Hard-break a single long word.
          let chunk = '';
          for (const ch of word) {
            if (m.width(chunk + ch, font) > maxWidth && chunk) {
              out.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else {
          line = candidate;
        }
      } else {
        out.push(line.trimEnd());
        line = /^\s+$/.test(word) ? '' : word;
      }
    }
    if (line.trim() !== '' || out.length === 0) out.push(line.trimEnd());
  }
  return out;
}
