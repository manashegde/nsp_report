import { cssFont, lineHeightPx } from './measure';
import type { BorderStyle, RenderedItem, RenderedPage } from './types';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

/** Allow only plain color tokens (hex, rgb/hsl functions, named colors). */
export function safeColor(c: string | undefined): string | undefined {
  if (!c) return undefined;
  const v = c.trim();
  return /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([\d\s.,%/]+\)|[a-z]+)$/i.test(v) ? v : undefined;
}

/** Allow http(s), data:image, blob: and relative URLs. */
export function safeUrl(u: string): string | undefined {
  const v = u.trim();
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml|bmp);/i.test(v)) return v;
  if (/^(https?:|blob:)/i.test(v)) return v;
  if (/^[\w./-]/.test(v) && !/^[a-z][\w+.-]*:/i.test(v)) return v;
  return undefined;
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

function borderCss(b?: BorderStyle): string {
  if (!b || !b.width) return '';
  const color = safeColor(b.color) ?? '#000';
  const line = `${px(b.width)} ${b.style ?? 'solid'} ${color}`;
  const s = b.sides;
  if (!s) return `border:${line};`;
  return (['top', 'right', 'bottom', 'left'] as const)
    .filter((side) => s[side])
    .map((side) => `border-${side}:${line};`)
    .join('');
}

function itemHtml(it: RenderedItem): string {
  const box = `left:${px(it.x)};top:${px(it.y)};width:${px(it.width)};height:${px(it.height)};`;
  const id = it.elementId ? ` data-er-el="${escapeHtml(it.elementId)}"` : '';
  switch (it.kind) {
    case 'text': {
      const s = it.style;
      const lh = lineHeightPx(s);
      const justify = s.verticalAlign === 'middle' ? 'center' : s.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start';
      const style =
        box +
        `font:${escapeHtml(cssFont(s))};color:${safeColor(s.color) ?? '#000'};` +
        (s.backgroundColor && safeColor(s.backgroundColor) ? `background:${safeColor(s.backgroundColor)};` : '') +
        `padding:${px(s.padding)};text-align:${s.textAlign};justify-content:${justify};` +
        (s.underline ? 'text-decoration:underline;' : '') +
        borderCss(s.border);
      const lines = it.lines.map((l) => `<div style="height:${px(lh)};line-height:${px(lh)}">${escapeHtml(l) || '&#8203;'}</div>`).join('');
      return `<div class="er-i er-t"${id} style="${style}">${lines}</div>`;
    }
    case 'image': {
      const src = safeUrl(it.src);
      if (!src) return '';
      const fit = it.fit === 'stretch' ? 'fill' : it.fit;
      const bg = it.backgroundColor && safeColor(it.backgroundColor) ? `background:${safeColor(it.backgroundColor)};` : '';
      return `<img class="er-i"${id} alt="" src="${escapeHtml(src)}" style="${box}object-fit:${fit};${bg}${borderCss(it.border)}"/>`;
    }
    case 'line': {
      const horizontal = it.y === it.y2;
      const color = safeColor(it.color) ?? '#000';
      const style = horizontal
        ? `left:${px(it.x)};top:${px(it.y - it.thickness / 2)};width:${px(it.x2 - it.x)};height:0;border-top:${px(it.thickness)} ${it.lineStyle} ${color};`
        : `left:${px(it.x - it.thickness / 2)};top:${px(it.y)};height:${px(it.y2 - it.y)};width:0;border-left:${px(it.thickness)} ${it.lineStyle} ${color};`;
      return `<div class="er-i"${id} style="${style}"></div>`;
    }
    case 'rect': {
      const fill = safeColor(it.fill);
      const stroke = safeColor(it.stroke);
      const style =
        box +
        (fill ? `background:${fill};` : '') +
        (stroke && it.strokeWidth ? `border:${px(it.strokeWidth)} ${it.dash ?? 'solid'} ${stroke};` : '') +
        (it.ellipse ? 'border-radius:50%;' : it.radius ? `border-radius:${px(it.radius)};` : '');
      return `<div class="er-i"${id} style="${style}"></div>`;
    }
    case 'checkbox': {
      const color = safeColor(it.color) ?? '#000';
      const mark = it.checked
        ? `<svg viewBox="0 0 10 10" width="100%" height="100%"><path d="M2 5.2l2 2L8 3" fill="none" stroke="${color}" stroke-width="1.4"/></svg>`
        : '';
      return `<div class="er-i"${id} style="${box}border:1px solid ${color};box-sizing:border-box">${mark}</div>`;
    }
  }
}

/** Inner HTML for one page (absolute positioned items). */
export function renderPageHtml(page: RenderedPage): string {
  return page.items.map(itemHtml).join('');
}

/** Base CSS that the page markup relies on. */
export const PAGE_CSS = `
.er-page{position:relative;overflow:hidden;background:#fff;color:#000;box-sizing:border-box}
.er-page .er-i{position:absolute;box-sizing:border-box;margin:0}
.er-page .er-t{display:flex;flex-direction:column;overflow:hidden;white-space:pre}
`;

/** Complete standalone HTML document (used for printing). */
export function renderDocumentHtml(pages: RenderedPage[], title = 'Report'): string {
  const w = pages[0]?.width ?? 794;
  const h = pages[0]?.height ?? 1123;
  const body = pages
    .map((p) => `<div class="er-page" style="width:${w}px;height:${h}px">${renderPageHtml(p)}</div>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
${PAGE_CSS}
@page{size:${w}px ${h}px;margin:0}
html,body{margin:0;padding:0;background:#fff}
.er-page{page-break-after:always;break-after:page}
.er-page:last-child{page-break-after:auto;break-after:auto}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
</style></head><body>${body}</body></html>`;
}
