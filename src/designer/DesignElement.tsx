import { memo, type CSSProperties, type ReactNode } from 'react';
import { mergeStyle } from '../core/layout';
import { cssFont } from '../core/measure';
import { safeColor, safeUrl } from '../core/html';
import type {
  AnyElement,
  BorderStyle,
  CheckboxElement,
  ElementStyle,
  ImageElement,
  LineElement,
  ShapeElement,
  TextElement,
} from '../core/types';
import type { ResolvedConfig } from '../ui/config';

const BASE = {
  fontFamily: 'Helvetica, Arial, sans-serif',
  fontSize: 10,
  bold: false,
  italic: false,
  underline: false,
  color: '#000000',
  textAlign: 'left' as const,
  verticalAlign: 'top' as const,
  padding: 2,
  lineHeight: 1.2,
};

function borderCss(b?: BorderStyle): CSSProperties {
  if (!b || !b.width) return {};
  const line = `${b.width}px ${b.style ?? 'solid'} ${safeColor(b.color) ?? '#000'}`;
  if (!b.sides) return { border: line };
  return {
    borderTop: b.sides.top ? line : undefined,
    borderRight: b.sides.right ? line : undefined,
    borderBottom: b.sides.bottom ? line : undefined,
    borderLeft: b.sides.left ? line : undefined,
  };
}

function TextContent({ el, defaults }: { el: TextElement; defaults?: ElementStyle }) {
  const s = mergeStyle(BASE, defaults, el.style);
  const bound = !!el.expression?.trim();
  const content = bound ? el.expression : el.text || '';
  const justify = s.verticalAlign === 'middle' ? 'center' : s.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start';
  const style: CSSProperties = {
    font: cssFont(s),
    lineHeight: s.lineHeight,
    color: safeColor(s.color),
    background: safeColor(s.backgroundColor),
    textAlign: s.textAlign,
    justifyContent: justify,
    padding: s.padding,
    textDecoration: s.underline ? 'underline' : undefined,
    whiteSpace: el.wordWrap === false ? 'pre' : 'pre-wrap',
    ...borderCss(s.border),
  };
  return (
    <div className={`er-de-text ${bound ? 'er-de-text--bound' : ''}`} style={style}>
      <span>{content || (bound ? '(expression)' : '')}</span>
    </div>
  );
}

function ImageContent({ el, cfg }: { el: ImageElement; cfg: ResolvedConfig }) {
  const src = el.src ? safeUrl(el.src) : undefined;
  const s = el.style ?? {};
  if (src) {
    return (
      <img
        alt=""
        src={src}
        draggable={false}
        style={{ width: '100%', height: '100%', objectFit: el.fit === 'stretch' ? 'fill' : (el.fit ?? 'contain'), background: safeColor(s.backgroundColor), ...borderCss(s.border) }}
      />
    );
  }
  return (
    <div className="er-de-placeholder" style={borderCss(s.border)}>
      {cfg.icon('image', 18)}
      {el.expression && <span>{el.expression}</span>}
    </div>
  );
}

function LineContent({ el }: { el: LineElement }) {
  const horizontal = el.direction !== 'vertical';
  const border = `${el.thickness ?? 1}px ${el.lineStyle ?? 'solid'} ${safeColor(el.color) ?? '#000'}`;
  return (
    <div className="er-de-line">
      <div
        style={
          horizontal
            ? { position: 'absolute', left: 0, right: 0, top: '50%', borderTop: border, transform: 'translateY(-50%)' }
            : { position: 'absolute', top: 0, bottom: 0, left: '50%', borderLeft: border, transform: 'translateX(-50%)' }
        }
      />
    </div>
  );
}

function ShapeContent({ el }: { el: ShapeElement }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: safeColor(el.fill),
        border: el.strokeWidth ? `${el.strokeWidth}px solid ${safeColor(el.stroke) ?? '#000'}` : undefined,
        borderRadius: el.shape === 'ellipse' ? '50%' : el.radius,
      }}
    />
  );
}

function CheckboxContent({ el }: { el: CheckboxElement }) {
  const size = Math.min(el.width, el.height, 14);
  return (
    <div className="er-de-center">
      <div style={{ width: size, height: size, border: `1px solid ${safeColor(el.style?.color) ?? '#000'}` }} />
    </div>
  );
}

export const DesignElementContent = memo(function DesignElementContent({
  el,
  cfg,
  defaults,
}: {
  el: AnyElement;
  cfg: ResolvedConfig;
  defaults?: ElementStyle;
}): ReactNode {
  switch (el.type) {
    case 'text':
      return <TextContent el={el as TextElement} defaults={defaults} />;
    case 'image':
      return <ImageContent el={el as ImageElement} cfg={cfg} />;
    case 'line':
      return <LineContent el={el as LineElement} />;
    case 'shape':
      return <ShapeContent el={el as ShapeElement} />;
    case 'checkbox':
      return <CheckboxContent el={el as CheckboxElement} />;
    default: {
      const def = cfg.elementTypes.find((t) => t.type === el.type);
      if (def?.renderDesign) return <>{def.renderDesign(el)}</>;
      return (
        <div className="er-de-placeholder">
          {def?.icon}
          <span>{def?.label ?? el.type}</span>
        </div>
      );
    }
  }
});
