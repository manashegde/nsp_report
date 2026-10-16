import { useCallback, useMemo, useRef, useState } from 'react';
import { findElement, listBands, uid } from '../core/template';
import type { AnyElement, Band, ReportTemplate } from '../core/types';

export interface DesignerState {
  template: ReportTemplate;
  /** Selected element ids. */
  selection: string[];
  /** Selected band (when no elements are selected). */
  bandId: string | null;
  past: ReportTemplate[];
  future: ReportTemplate[];
  /** Coalesces rapid edits (typing) into a single undo step. */
  mergeKey: string | null;
}

type Action =
  | { type: 'update'; fn: (draft: ReportTemplate) => void; mergeKey?: string }
  | { type: 'replace'; template: ReportTemplate; resetHistory?: boolean }
  | { type: 'select'; ids: string[]; bandId?: string | null }
  | { type: 'undo' }
  | { type: 'redo' };

const HISTORY = 100;

function clone<T>(v: T): T {
  return structuredClone(v);
}

function prune(state: DesignerState, template: ReportTemplate): Pick<DesignerState, 'selection' | 'bandId'> {
  const ids = new Set(listBands(template).flatMap((b) => b.band.elements.map((e) => e.id)));
  const bands = new Set(listBands(template).map((b) => b.band.id));
  return {
    selection: state.selection.filter((id) => ids.has(id)),
    bandId: state.bandId && bands.has(state.bandId) ? state.bandId : null,
  };
}

function reducer(state: DesignerState, action: Action): DesignerState {
  switch (action.type) {
    case 'update': {
      const draft = clone(state.template);
      action.fn(draft);
      const merge = action.mergeKey && action.mergeKey === state.mergeKey;
      return {
        ...state,
        template: draft,
        past: merge ? state.past : [...state.past.slice(-HISTORY + 1), state.template],
        future: [],
        mergeKey: action.mergeKey ?? null,
        ...prune(state, draft),
      };
    }
    case 'replace':
      return {
        ...state,
        template: action.template,
        past: action.resetHistory ? [] : [...state.past.slice(-HISTORY + 1), state.template],
        future: action.resetHistory ? [] : state.future,
        mergeKey: null,
        ...(action.resetHistory ? { selection: [], bandId: null } : prune(state, action.template)),
      };
    case 'select':
      return { ...state, selection: action.ids, bandId: action.bandId ?? null, mergeKey: null };
    case 'undo': {
      if (!state.past.length) return state;
      const prev = state.past[state.past.length - 1];
      return { ...state, template: prev, past: state.past.slice(0, -1), future: [state.template, ...state.future], mergeKey: null, ...prune(state, prev) };
    }
    case 'redo': {
      if (!state.future.length) return state;
      const next = state.future[0];
      return { ...state, template: next, past: [...state.past, state.template], future: state.future.slice(1), mergeKey: null, ...prune(state, next) };
    }
  }
}

export interface DesignerStore {
  state: DesignerState;
  template: ReportTemplate;
  update: (fn: (draft: ReportTemplate) => void, mergeKey?: string) => void;
  replace: (t: ReportTemplate, resetHistory?: boolean) => void;
  select: (ids: string[], bandId?: string | null) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Mutate all selected elements in one undo step. */
  updateSelected: (fn: (el: AnyElement, band: Band) => void, mergeKey?: string) => void;
  deleteSelected: () => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
}

export function useDesignerStore(initial: ReportTemplate): DesignerStore {
  const [state, setState] = useState<DesignerState>(() => ({
    template: initial,
    selection: [],
    bandId: null,
    past: [],
    future: [],
    mergeKey: null,
  }));
  const clipboard = useRef<{ elements: AnyElement[]; bandId: string } | null>(null);
  const stateRef = useRef(state);
  // Actions apply synchronously (unlike useReducer, which defers the reducer to render), so a
  // caller can read ids created inside update() and act on them right away, e.g. select them.
  const dispatch = useCallback((action: Action) => {
    const next = reducer(stateRef.current, action);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
  }, []);

  const update = useCallback((fn: (d: ReportTemplate) => void, mergeKey?: string) => dispatch({ type: 'update', fn, mergeKey }), []);
  const select = useCallback((ids: string[], bandId?: string | null) => dispatch({ type: 'select', ids, bandId }), []);

  const updateSelected = useCallback(
    (fn: (el: AnyElement, band: Band) => void, mergeKey?: string) => {
      const ids = stateRef.current.selection;
      if (!ids.length) return;
      update((d) => {
        for (const id of ids) {
          const hit = findElement(d, id);
          if (hit) fn(hit.element, hit.band);
        }
      }, mergeKey);
    },
    [update],
  );

  const deleteSelected = useCallback(() => {
    const ids = new Set(stateRef.current.selection);
    if (!ids.size) return;
    update((d) => {
      for (const { band } of listBands(d)) band.elements = band.elements.filter((e) => !ids.has(e.id));
    });
  }, [update]);

  const copy = useCallback(() => {
    const s = stateRef.current;
    const els = s.selection.map((id) => findElement(s.template, id)).filter(Boolean) as { band: Band; element: AnyElement }[];
    if (els.length) clipboard.current = { elements: els.map((e) => clone(e.element)), bandId: els[0].band.id };
  }, []);

  const pasteInto = useCallback(
    (elements: AnyElement[], bandId: string, offset: number) => {
      const newIds: string[] = [];
      update((d) => {
        const band = listBands(d).find((b) => b.band.id === bandId)?.band ?? d.bands.detail;
        for (const el of elements) {
          const copyEl = { ...clone(el), id: uid(), x: el.x + offset, y: el.y + offset };
          band.elements.push(copyEl);
          newIds.push(copyEl.id);
          band.height = Math.max(band.height, copyEl.y + copyEl.height);
        }
      });
      dispatch({ type: 'select', ids: newIds });
    },
    [update],
  );

  const paste = useCallback(() => {
    const c = clipboard.current;
    if (!c) return;
    const s = stateRef.current;
    const target = s.bandId ?? (s.selection[0] ? findElement(s.template, s.selection[0])?.band.id : undefined) ?? c.bandId;
    pasteInto(c.elements, target, 8);
    // Next paste lands a little further away.
    clipboard.current = { ...c, elements: c.elements.map((e) => ({ ...e, x: e.x + 8, y: e.y + 8 })) };
  }, [pasteInto]);

  const duplicate = useCallback(() => {
    const s = stateRef.current;
    const els = s.selection.map((id) => findElement(s.template, id)).filter(Boolean) as { band: Band; element: AnyElement }[];
    if (els.length) pasteInto(els.map((e) => e.element), els[0].band.id, 8);
  }, [pasteInto]);

  return useMemo(
    () => ({
      state,
      template: state.template,
      update,
      replace: (t, resetHistory) => dispatch({ type: 'replace', template: t, resetHistory }),
      select,
      undo: () => dispatch({ type: 'undo' }),
      redo: () => dispatch({ type: 'redo' }),
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      updateSelected,
      deleteSelected,
      copy,
      paste,
      duplicate,
    }),
    [state, update, select, updateSelected, deleteSelected, copy, paste, duplicate],
  );
}
