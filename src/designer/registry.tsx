import type { ReactNode } from 'react';
import type { ResolvedConfig, ToolboxItem } from '../ui/config';

/** Built-in toolbox entries. Hosts can filter/extend these via the `toolbox` prop. */
export function builtinToolbox(cfg: ResolvedConfig): ToolboxItem[] {
  const { icon } = cfg;
  return [
    { id: 'label', label: 'Label', icon: icon('text'), create: () => ({ type: 'text', width: 120, height: 22, text: 'Label' }) },
    { id: 'field', label: 'Field', icon: icon('field'), create: () => ({ type: 'text', width: 120, height: 22, expression: '' }) },
    {
      id: 'summary',
      label: 'Summary',
      icon: icon('sigma'),
      create: () => ({ type: 'text', width: 120, height: 22, expression: 'Count()', style: { bold: true, textAlign: 'right' } }),
    },
    {
      id: 'pageNumber',
      label: 'Page number',
      icon: icon('page'),
      create: () => ({ type: 'text', width: 140, height: 20, text: 'Page {PageNumber} of {TotalPages}', style: { fontSize: 8 } }),
    },
    {
      id: 'dateTime',
      label: 'Date / time',
      icon: icon('clock'),
      create: () => ({ type: 'text', width: 140, height: 20, text: '{Now():g}', style: { fontSize: 8 } }),
    },
    { id: 'image', label: 'Image', icon: icon('image'), create: () => ({ type: 'image', width: 100, height: 60, fit: 'contain' }) },
    {
      id: 'lineH',
      label: 'Horizontal line',
      icon: icon('lineH'),
      create: () => ({ type: 'line', width: 200, height: 6, direction: 'horizontal', thickness: 1, color: '#000000' }),
    },
    {
      id: 'lineV',
      label: 'Vertical line',
      icon: icon('lineV'),
      create: () => ({ type: 'line', width: 6, height: 40, direction: 'vertical', thickness: 1, color: '#000000' }),
    },
    {
      id: 'rect',
      label: 'Rectangle',
      icon: icon('rect'),
      create: () => ({ type: 'shape', shape: 'rectangle', width: 120, height: 40, stroke: '#000000', strokeWidth: 1 }),
    },
    {
      id: 'ellipse',
      label: 'Ellipse',
      icon: icon('ellipse'),
      create: () => ({ type: 'shape', shape: 'ellipse', width: 60, height: 40, stroke: '#000000', strokeWidth: 1 }),
    },
    { id: 'checkbox', label: 'Check box', icon: icon('checkbox'), create: () => ({ type: 'checkbox', width: 20, height: 20, expression: '' }) },
  ];
}

export function toolboxFromElementTypes(cfg: ResolvedConfig): ToolboxItem[] {
  return cfg.elementTypes
    .filter((t) => t.toolbox !== false)
    .map((t) => ({
      id: `custom:${t.type}`,
      label: t.label,
      icon: t.icon ?? cfg.icon('rect'),
      create: () => ({ ...t.defaults, type: t.type }),
    }));
}

export type ToolboxConfig = ToolboxItem[] | ((defaults: ToolboxItem[]) => ToolboxItem[]);

export function resolveToolbox(cfg: ResolvedConfig, config?: ToolboxConfig): ToolboxItem[] {
  const defaults = [...builtinToolbox(cfg), ...toolboxFromElementTypes(cfg)];
  if (!config) return defaults;
  return typeof config === 'function' ? config(defaults) : config;
}

export const DRAG_MIME = 'application/x-easy-report';

export type DragPayload =
  | { kind: 'toolbox'; id: string }
  | { kind: 'field'; path: string; label: string; fieldType: string }
  | { kind: 'parameter'; name: string; label: string; fieldType: string };

export function setDragPayload(e: React.DragEvent, p: DragPayload) {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(p));
  e.dataTransfer.setData('text/plain', p.kind === 'field' ? `[${p.path}]` : p.kind === 'parameter' ? `?${p.name}` : p.id);
  e.dataTransfer.effectAllowed = 'copy';
}

export function getDragPayload(e: React.DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    return raw ? (JSON.parse(raw) as DragPayload) : null;
  } catch {
    return null;
  }
}

export function TypeIcon({ type, cfg }: { type: string; cfg: ResolvedConfig }): ReactNode {
  const name = type === 'number' ? 'hash' : type === 'date' ? 'calendar' : type === 'boolean' ? 'toggle' : 'text';
  return cfg.icon(name, 14);
}
