import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { pageDimensions } from '../core/measure';
import { findElement, listBands, uid, type BandRef } from '../core/template';
import type { AnyElement, BandKind, ReportTemplate, TextElement } from '../core/types';
import { useER } from '../ui/config';
import { cx } from '../ui/primitives';
import { useDesigner } from './context';
import { DesignElementContent } from './DesignElement';
import { DRAG_MIME, getDragPayload, type DragPayload } from './registry';

type Rect = { x: number; y: number; width: number; height: number };

type DragState =
  | { mode: 'move'; ids: string[]; dx: number; dy: number; targetBandId: string | null }
  | { mode: 'resize'; id: string; rect: Rect }
  | { mode: 'marquee'; bandId: string; x0: number; y0: number; x1: number; y1: number }
  | { mode: 'band'; bandId: string; height: number };

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof HANDLES)[number];

/** Attach window pointer listeners for the duration of a drag. */
function trackPointer(
  e: RPointerEvent,
  onMove: (dx: number, dy: number, ev: PointerEvent) => void,
  onUp: (dx: number, dy: number, ev: PointerEvent, moved: boolean) => void,
) {
  const sx = e.clientX;
  const sy = e.clientY;
  let moved = false;
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - sx;
    const dy = ev.clientY - sy;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    moved = true;
    onMove(dx, dy, ev);
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    onUp(ev.clientX - sx, ev.clientY - sy, ev, moved);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function bandHeightFor(band: { height: number; elements: AnyElement[] }) {
  return band.elements.reduce((m, e) => Math.max(m, e.y + e.height), 0);
}

export function DesignSurface() {
  const { store, zoom, grid, toolbox, readOnly, openExpression, fields } = useDesigner();
  const cfg = useER();
  const { labels } = cfg;
  const t = store.template;
  const { selection, bandId: selectedBandId } = store.state;
  const dims = pageDimensions(t.page);
  const contentW = dims.width - t.page.margins.left - t.page.margins.right;
  const bands = listBands(t);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dropBand, setDropBand] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const setDragState = (d: DragState | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const snap = useCallback(
    (v: number, ev?: { altKey: boolean }) => (grid.snap && !ev?.altKey ? Math.round(v / grid.size) * grid.size : Math.round(v)),
    [grid.snap, grid.size],
  );

  const bandBodies = () =>
    Array.from(surfaceRef.current?.querySelectorAll<HTMLElement>('[data-band-body]') ?? []).map((el) => ({
      id: el.dataset.bandBody!,
      rect: el.getBoundingClientRect(),
    }));

  const bandAt = (clientY: number) => {
    const bodies = bandBodies();
    return (
      bodies.find((b) => clientY >= b.rect.top && clientY < b.rect.bottom) ??
      (clientY < (bodies[0]?.rect.top ?? 0) ? bodies[0] : bodies[bodies.length - 1])
    );
  };

  /* ---------------- element move ---------------- */
  const onElementPointerDown = (e: RPointerEvent, el: AnyElement, ref: BandRef) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    surfaceRef.current?.focus({ preventScroll: true });
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      store.select(selection.includes(el.id) ? selection.filter((i) => i !== el.id) : [...selection, el.id]);
      return;
    }
    const ids = selection.includes(el.id) ? selection : [el.id];
    if (!selection.includes(el.id)) store.select(ids);
    if (readOnly || editing) return;

    trackPointer(
      e,
      (dx, dy, ev) => {
        const rawX = el.x + dx / zoom;
        const rawY = el.y + dy / zoom;
        const target = bandAt(ev.clientY);
        setDragState({ mode: 'move', ids, dx: snap(rawX, ev) - el.x, dy: snap(rawY, ev) - el.y, targetBandId: target?.id ?? ref.band.id });
      },
      (_dx, _dy, _ev, moved) => {
        const d = dragRef.current;
        setDragState(null);
        if (!moved || !d || d.mode !== 'move') return;
        const bodies = bandBodies();
        const rectOf = (id: string) => bodies.find((b) => b.id === id)?.rect;
        store.update((draft) => {
          const targetRef = listBands(draft).find((b) => b.band.id === d.targetBandId);
          for (const id of d.ids) {
            const hit = findElement(draft, id);
            if (!hit) continue;
            const { band, element } = hit;
            let nx = Math.max(0, element.x + d.dx);
            let ny = element.y + d.dy;
            if (targetRef && targetRef.band.id !== band.id) {
              const from = rectOf(band.id);
              const to = rectOf(targetRef.band.id);
              if (from && to) ny = (from.top + ny * zoom - to.top) / zoom;
              band.elements = band.elements.filter((x) => x.id !== id);
              targetRef.band.elements.push(element);
            }
            nx = Math.min(nx, Math.max(0, contentW - element.width));
            element.x = Math.round(nx);
            element.y = Math.max(0, Math.round(ny));
            const owner = targetRef && targetRef.band.elements.includes(element) ? targetRef.band : band;
            owner.height = Math.max(owner.height, element.y + element.height);
          }
        });
      },
    );
  };

  /* ---------------- resize ---------------- */
  const onHandlePointerDown = (e: RPointerEvent, el: AnyElement, h: Handle) => {
    e.stopPropagation();
    if (e.button !== 0 || readOnly) return;
    const o: Rect = { x: el.x, y: el.y, width: el.width, height: el.height };
    trackPointer(
      e,
      (dx, dy, ev) => {
        const r = { ...o };
        const ddx = dx / zoom;
        const ddy = dy / zoom;
        if (h.includes('e')) r.width = Math.max(4, snap(o.x + o.width + ddx, ev) - o.x);
        if (h.includes('s')) r.height = Math.max(4, snap(o.y + o.height + ddy, ev) - o.y);
        if (h.includes('w')) {
          const nx = Math.min(snap(o.x + ddx, ev), o.x + o.width - 4);
          r.width = o.x + o.width - Math.max(0, nx);
          r.x = Math.max(0, nx);
        }
        if (h.includes('n')) {
          const ny = Math.min(snap(o.y + ddy, ev), o.y + o.height - 4);
          r.height = o.y + o.height - Math.max(0, ny);
          r.y = Math.max(0, ny);
        }
        setDragState({ mode: 'resize', id: el.id, rect: r });
      },
      (_dx, _dy, _ev, moved) => {
        const d = dragRef.current;
        setDragState(null);
        if (!moved || !d || d.mode !== 'resize') return;
        store.update((draft) => {
          const hit = findElement(draft, d.id);
          if (!hit) return;
          Object.assign(hit.element, {
            x: Math.round(d.rect.x),
            y: Math.round(d.rect.y),
            width: Math.round(d.rect.width),
            height: Math.round(d.rect.height),
          });
          hit.band.height = Math.max(hit.band.height, hit.element.y + hit.element.height);
        });
      },
    );
  };

  /* ---------------- marquee / band select ---------------- */
  const onBandPointerDown = (e: RPointerEvent, ref: BandRef) => {
    if (e.button !== 0) return;
    surfaceRef.current?.focus({ preventScroll: true });
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x0 = (e.clientX - rect.left) / zoom;
    const y0 = (e.clientY - rect.top) / zoom;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    trackPointer(
      e,
      (dx, dy) => setDragState({ mode: 'marquee', bandId: ref.band.id, x0, y0, x1: x0 + dx / zoom, y1: y0 + dy / zoom }),
      (_dx, _dy, _ev, moved) => {
        const d = dragRef.current;
        setDragState(null);
        if (!moved || !d || d.mode !== 'marquee') {
          store.select([], ref.band.id);
          return;
        }
        const m: Rect = { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), width: Math.abs(d.x1 - d.x0), height: Math.abs(d.y1 - d.y0) };
        const hits = ref.band.elements.filter((el) => intersects(m, el)).map((el) => el.id);
        store.select(additive ? [...new Set([...selection, ...hits])] : hits);
      },
    );
  };

  /* ---------------- band height ---------------- */
  const onBandResizeDown = (e: RPointerEvent, ref: BandRef) => {
    e.stopPropagation();
    if (e.button !== 0 || readOnly) return;
    const orig = ref.band.height;
    const min = Math.max(0, bandHeightFor(ref.band));
    trackPointer(
      e,
      (_dx, dy, ev) => setDragState({ mode: 'band', bandId: ref.band.id, height: Math.max(min, snap(orig + dy / zoom, ev)) }),
      (_dx, _dy, _ev, moved) => {
        const d = dragRef.current;
        setDragState(null);
        if (!moved || !d || d.mode !== 'band') return;
        store.update((draft) => {
          const b = listBands(draft).find((x) => x.band.id === d.bandId);
          if (b) b.band.height = Math.round(d.height);
        });
      },
    );
  };

  /* ---------------- drop from toolbox / field list ---------------- */
  const createFromPayload = (p: DragPayload, ref: BandRef, x: number, y: number, draft: ReportTemplate): AnyElement[] => {
    const band = listBands(draft).find((b) => b.band.id === ref.band.id)!;
    if (p.kind === 'toolbox') {
      const item = toolbox.find((i) => i.id === p.id);
      if (!item) return [];
      return [{ ...item.create(), id: uid(), x, y } as AnyElement];
    }
    const isNumber = p.fieldType === 'number';
    const footer: BandKind[] = ['groupFooter', 'reportFooter', 'pageFooter', 'groupHeader'];
    if (p.kind === 'parameter') {
      return [{ id: uid(), type: 'text', x, y, width: 120, height: 22, expression: `?${p.name}`, format: p.fieldType === 'date' ? 'd' : undefined } as TextElement];
    }
    const summarise = isNumber && footer.includes(band.kind) && band.kind !== 'groupHeader';
    const el: TextElement = {
      id: uid(),
      type: 'text',
      x,
      y,
      width: 120,
      height: 22,
      expression: summarise ? `Sum([${p.path}])` : `[${p.path}]`,
      format: isNumber ? 'n2' : p.fieldType === 'date' ? 'd' : undefined,
      style: isNumber ? { textAlign: 'right', ...(summarise ? { bold: true } : {}) } : undefined,
    };
    const out: AnyElement[] = [el];
    // Dropping into Detail also creates a caption in the page header.
    if (band.kind === 'detail' && draft.bands.pageHeader) {
      const ph = draft.bands.pageHeader;
      const occupied = ph.elements.some((e) => e.x < x + el.width && x < e.x + e.width);
      if (!occupied) {
        ph.elements.push({
          id: uid(),
          type: 'text',
          x,
          y: Math.max(0, ph.height - 24),
          width: el.width,
          height: 22,
          text: p.label,
          style: { bold: true, ...(isNumber ? { textAlign: 'right' } : {}) },
        } as TextElement);
      }
    }
    return out;
  };

  const onDrop = (e: React.DragEvent, ref: BandRef) => {
    setDropBand(null);
    const p = getDragPayload(e);
    if (!p || readOnly) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.max(0, snap((e.clientX - rect.left) / zoom));
    const y = Math.max(0, snap((e.clientY - rect.top) / zoom));
    let ids: string[] = [];
    store.update((draft) => {
      const band = listBands(draft).find((b) => b.band.id === ref.band.id)!.band;
      const els = createFromPayload(p, ref, x, y, draft);
      for (const el of els) {
        el.x = Math.min(el.x, Math.max(0, contentW - el.width));
        band.elements.push(el);
        band.height = Math.max(band.height, el.y + el.height);
      }
      ids = els.map((el) => el.id);
    });
    store.select(ids);
  };

  /* ---------------- keyboard ---------------- */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (mod && k === 'y') return void (e.preventDefault(), store.redo());
    if (mod && k === 'c') return void (e.preventDefault(), store.copy());
    if (readOnly) return;
    if (mod && k === 'x') return void (e.preventDefault(), store.copy(), store.deleteSelected());
    if (mod && k === 'v') return void (e.preventDefault(), store.paste());
    if (mod && k === 'd') return void (e.preventDefault(), store.duplicate());
    if (mod && k === 'a') {
      e.preventDefault();
      const bandRef =
        bands.find((b) => b.band.id === selectedBandId) ?? bands.find((b) => b.band.elements.some((el) => selection.includes(el.id)));
      store.select((bandRef ? [bandRef] : bands).flatMap((b) => b.band.elements.map((el) => el.id)));
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selection.length) {
        e.preventDefault();
        store.deleteSelected();
      }
      return;
    }
    if (e.key === 'Escape') return store.select([]);
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const dir = arrows[e.key];
    if (dir && selection.length) {
      e.preventDefault();
      const step = e.shiftKey ? grid.size : 1;
      store.updateSelected((el, band) => {
        if (e.altKey) {
          el.width = Math.max(4, el.width + dir[0] * step);
          el.height = Math.max(4, el.height + dir[1] * step);
        } else {
          el.x = Math.max(0, el.x + dir[0] * step);
          el.y = Math.max(0, el.y + dir[1] * step);
        }
        band.height = Math.max(band.height, el.y + el.height);
      }, `nudge:${selection.join(',')}`);
    }
  };

  /* ---------------- inline text editing ---------------- */
  const onDoubleClick = (el: AnyElement) => {
    if (readOnly) return;
    if (el.type !== 'text' && el.type !== 'image' && el.type !== 'checkbox') return;
    const te = el as TextElement;
    if (el.type === 'text' && te.expression === undefined) {
      setEditing(el.id);
      return;
    }
    openExpression({
      value: te.expression ?? '',
      onApply: (v) =>
        store.update((d) => {
          const hit = findElement(d, el.id);
          if (hit) (hit.element as TextElement).expression = v;
        }),
    });
  };

  const commitEdit = (id: string, text: string) => {
    setEditing(null);
    store.update((d) => {
      const hit = findElement(d, id);
      if (hit) (hit.element as TextElement).text = text;
    });
  };

  /* ---------------- render ---------------- */
  const singleSelected = selection.length === 1 ? selection[0] : null;
  const gridStyle: CSSProperties = grid.show
    ? {
        backgroundImage: `linear-gradient(to right, var(--er-grid) 1px, transparent 1px), linear-gradient(to bottom, var(--er-grid) 1px, transparent 1px)`,
        backgroundSize: `${grid.size * zoom}px ${grid.size * zoom}px`,
      }
    : {};

  return (
    <div
      className="er-surface"
      ref={surfaceRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) store.select([]);
      }}
      aria-label="Report design surface"
    >
      <div className="er-surface__page" style={{ width: contentW * zoom }}>
        {bands.map((ref) => {
          const isDragBand = drag?.mode === 'band' && drag.bandId === ref.band.id;
          const height = isDragBand ? drag.height : ref.band.height;
          const bandSelected = selectedBandId === ref.band.id;
          return (
            <section key={ref.band.id} className={cx('er-band', bandSelected && 'er-band--selected')}>
              <div className="er-band__header" onPointerDown={() => store.select([], ref.band.id)} title={ref.label}>
                <span className="er-band__label">{bandLabel(ref, labels, t)}</span>
                {ref.band.visible && <span className="er-band__badge">{cfg.icon('eye', 12)}</span>}
                {ref.band.pageBreakBefore && <span className="er-band__badge">⤒</span>}
                {ref.band.pageBreakAfter && <span className="er-band__badge">⤓</span>}
              </div>
              <div
                className={cx('er-band__body', dropBand === ref.band.id && 'er-band__body--drop', drag?.mode === 'move' && drag.targetBandId === ref.band.id && 'er-band__body--target')}
                data-band-body={ref.band.id}
                style={{ height: height * zoom, ...gridStyle }}
                onPointerDown={(e) => onBandPointerDown(e, ref)}
                onDragOver={(e) => {
                  if (!readOnly && e.dataTransfer.types.includes(DRAG_MIME)) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    if (dropBand !== ref.band.id) setDropBand(ref.band.id);
                  }
                }}
                onDragLeave={() => setDropBand((b) => (b === ref.band.id ? null : b))}
                onDrop={(e) => onDrop(e, ref)}
              >
                <div className="er-band__inner" style={{ width: contentW, height, transform: `scale(${zoom})`, background: ref.band.backgroundColor }}>
                  {ref.band.elements.length === 0 && ref.kind === 'detail' && fields.length > 0 && (
                    <div className="er-band__hint">{labels.dropHere}</div>
                  )}
                  {ref.band.elements.map((el) => {
                    const selected = selection.includes(el.id);
                    let style: CSSProperties = { left: el.x, top: el.y, width: el.width, height: el.height };
                    if (drag?.mode === 'move' && selected) style = { ...style, transform: `translate(${drag.dx}px, ${drag.dy}px)`, zIndex: 10, opacity: 0.85 };
                    if (drag?.mode === 'resize' && drag.id === el.id) style = { ...style, left: drag.rect.x, top: drag.rect.y, width: drag.rect.width, height: drag.rect.height };
                    return (
                      <div
                        key={el.id}
                        className={cx('er-el', selected && 'er-el--selected', el.visible && 'er-el--conditional')}
                        style={style}
                        data-el={el.id}
                        onPointerDown={(e) => onElementPointerDown(e, el, ref)}
                        onDoubleClick={() => onDoubleClick(el)}
                        title={el.name}
                      >
                        <DesignElementContent el={el} cfg={cfg} defaults={t.defaultStyle} />
                        {editing === el.id && (
                          <InlineEditor initial={(el as TextElement).text ?? ''} onCommit={(v) => commitEdit(el.id, v)} onCancel={() => setEditing(null)} />
                        )}
                        {singleSelected === el.id && !readOnly && !editing &&
                          HANDLES.map((h) => (
                            <div
                              key={h}
                              className={`er-handle er-handle--${h}`}
                              style={{ transform: `scale(${1 / zoom})` }}
                              onPointerDown={(e) => onHandlePointerDown(e, el, h)}
                            />
                          ))}
                      </div>
                    );
                  })}
                  {drag?.mode === 'marquee' && drag.bandId === ref.band.id && (
                    <div
                      className="er-marquee"
                      style={{
                        left: Math.min(drag.x0, drag.x1),
                        top: Math.min(drag.y0, drag.y1),
                        width: Math.abs(drag.x1 - drag.x0),
                        height: Math.abs(drag.y1 - drag.y0),
                      }}
                    />
                  )}
                </div>
                {!readOnly && <div className="er-band__resize" onPointerDown={(e) => onBandResizeDown(e, ref)} />}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function bandLabel(ref: BandRef, labels: ReturnType<typeof useER>['labels'], t: ReportTemplate): string {
  switch (ref.kind) {
    case 'reportHeader':
      return labels.reportHeader;
    case 'pageHeader':
      return labels.pageHeader;
    case 'detail':
      return labels.detail;
    case 'reportFooter':
      return labels.reportFooter;
    case 'pageFooter':
      return labels.pageFooter;
    default: {
      const g = t.groups.find((x) => x.id === ref.groupId);
      const name = g?.name || g?.expression || '';
      return `${ref.kind === 'groupHeader' ? labels.groupHeader : labels.groupFooter}: ${name}`;
    }
  }
}

function InlineEditor({ initial, onCommit, onCancel }: { initial: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  return (
    <textarea
      className="er-inline-edit"
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => onCommit(v)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onCommit(v);
        }
      }}
    />
  );
}
