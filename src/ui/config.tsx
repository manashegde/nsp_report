import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from 'react';
import type { FunctionDef, HostFunction } from '../core/evaluator';
import type { ElementLayout } from '../core/layout';
import type { TextMeasurer } from '../core/measure';
import type { AnyElement, ParameterLookup, ReportDataSource } from '../core/types';
import type { CsvExportOptions } from '../export/csv';
import type { PdfExportOptions } from '../export/pdf';
import { SvgIcon, type IconName, type IconOverrides } from './icons';
import { DEFAULT_LABELS, type Labels } from './labels';
import { DEFAULT_COMPONENTS, type UIComponents } from './primitives';

/* ------------------------------------------------------------------ */
/* Theme                                                                */
/* ------------------------------------------------------------------ */

export interface ThemeTokens {
  fontFamily: string;
  fontSize: string;
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryText: string;
  primarySoft: string;
  danger: string;
  radius: string;
  canvas: string;
  pageShadow: string;
  selection: string;
  bandHeader: string;
  bandHeaderText: string;
  gridColor: string;
  focusRing: string;
  controlHeight: string;
}

export const LIGHT_THEME: ThemeTokens = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontSize: '13px',
  background: '#ffffff',
  surface: '#ffffff',
  surfaceAlt: '#f4f6f8',
  border: '#d9dee5',
  text: '#1f2933',
  textMuted: '#66717f',
  primary: '#2563eb',
  primaryText: '#ffffff',
  primarySoft: '#e8efff',
  danger: '#d92d20',
  radius: '6px',
  canvas: '#e9ecf0',
  pageShadow: '0 1px 3px rgba(16,24,40,.12), 0 4px 12px rgba(16,24,40,.08)',
  selection: '#2563eb',
  bandHeader: '#eef1f5',
  bandHeaderText: '#4b5563',
  gridColor: 'rgba(100,116,139,.14)',
  focusRing: '0 0 0 2px rgba(37,99,235,.35)',
  controlHeight: '28px',
};

export const DARK_THEME: ThemeTokens = {
  ...LIGHT_THEME,
  background: '#16181d',
  surface: '#1d2026',
  surfaceAlt: '#252932',
  border: '#343a46',
  text: '#e6e8ec',
  textMuted: '#9aa3b2',
  primary: '#4f8cff',
  primaryText: '#ffffff',
  primarySoft: '#22304d',
  danger: '#ff6b5e',
  canvas: '#0f1115',
  pageShadow: '0 1px 3px rgba(0,0,0,.5), 0 6px 16px rgba(0,0,0,.4)',
  selection: '#4f8cff',
  bandHeader: '#262a33',
  bandHeaderText: '#b4bcc8',
  gridColor: 'rgba(148,163,184,.12)',
  focusRing: '0 0 0 2px rgba(79,140,255,.45)',
};

const TOKEN_VARS: Record<keyof ThemeTokens, string> = {
  fontFamily: '--er-font',
  fontSize: '--er-font-size',
  background: '--er-bg',
  surface: '--er-surface',
  surfaceAlt: '--er-surface-alt',
  border: '--er-border',
  text: '--er-text',
  textMuted: '--er-text-muted',
  primary: '--er-primary',
  primaryText: '--er-primary-text',
  primarySoft: '--er-primary-soft',
  danger: '--er-danger',
  radius: '--er-radius',
  canvas: '--er-canvas',
  pageShadow: '--er-page-shadow',
  selection: '--er-selection',
  bandHeader: '--er-band-header',
  bandHeaderText: '--er-band-header-text',
  gridColor: '--er-grid',
  focusRing: '--er-focus',
  controlHeight: '--er-control-h',
};

export function themeToCssVars(theme: EasyReportConfig['theme']): CSSProperties {
  const base = theme === 'dark' ? DARK_THEME : LIGHT_THEME;
  const tokens: ThemeTokens = typeof theme === 'object' ? { ...(theme.base === 'dark' ? DARK_THEME : base), ...theme } : base;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(TOKEN_VARS)) out[v] = tokens[k as keyof ThemeTokens];
  return out as CSSProperties;
}

/* ------------------------------------------------------------------ */
/* Extensibility                                                        */
/* ------------------------------------------------------------------ */

export type PropertyEditorType = 'text' | 'textarea' | 'number' | 'color' | 'boolean' | 'select' | 'expression' | 'format';

export interface PropertyDescriptor {
  /** Dotted path in the element, e.g. `props.value` or `style.color` */
  key: string;
  label: string;
  type: PropertyEditorType;
  section?: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

/** Host-defined element type (e.g. barcode, chart, signature). */
export interface ElementTypeDef<E extends AnyElement = AnyElement> {
  type: string;
  label: string;
  icon?: ReactNode;
  /** Default props for new elements (without id/x/y). */
  defaults: Partial<E> & { width: number; height: number };
  /** Produces render items (text/image/line/rect) for viewer, PDF and print. */
  layout: ElementLayout;
  /** Design-time rendering inside the designer surface. */
  renderDesign?: (el: E) => ReactNode;
  properties?: PropertyDescriptor[];
  /** Set false to hide from the toolbox. */
  toolbox?: boolean;
}

export interface ToolboxItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Props for the new element; must include type, width and height. */
  create: () => Partial<AnyElement> & { type: string; width: number; height: number };
}

export interface ToolbarItem {
  id: string;
  label?: string;
  icon?: ReactNode;
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  /** Fully custom content (rendered as-is). */
  render?: () => ReactNode;
  /** Visual separator before this item. */
  separator?: boolean;
  /** Push this item (and following ones) to the right. */
  spacer?: boolean;
}

export type ToolbarConfig = false | string[] | ((defaults: ToolbarItem[]) => ToolbarItem[]);

export interface EasyReportConfig {
  /** 'light' | 'dark' or individual token overrides (optionally with base: 'dark'). */
  theme?: 'light' | 'dark' | (Partial<ThemeTokens> & { base?: 'light' | 'dark' });
  labels?: Partial<Labels>;
  icons?: IconOverrides;
  /** Replace UI primitives (Button, Input, Select ...) with the host's own components. */
  components?: Partial<UIComponents>;
  dataSources?: ReportDataSource[];
  /** Named lookups for parameter value lists. */
  parameterLookups?: Record<string, ParameterLookup>;
  /** Extra expression functions. */
  functions?: Record<string, HostFunction | FunctionDef>;
  elementTypes?: ElementTypeDef[];
  locale?: string;
  currency?: string;
  pdf?: PdfExportOptions;
  csv?: CsvExportOptions;
  measurer?: TextMeasurer;
  /** Extra class on every root element. */
  className?: string;
}

export interface ResolvedConfig extends Omit<EasyReportConfig, 'labels' | 'components'> {
  labels: Labels;
  components: UIComponents;
  icon: (name: IconName, size?: number) => ReactNode;
  rootStyle: CSSProperties;
  dataSources: ReportDataSource[];
  elementTypes: ElementTypeDef[];
}

const ConfigContext = createContext<EasyReportConfig>({});

/** Optional provider so hosts configure the library once for all viewers/designers. */
export function EasyReportProvider({ config, children }: { config: EasyReportConfig; children: ReactNode }) {
  const parent = useContext(ConfigContext);
  const merged = useMemo(() => mergeConfig(parent, config), [parent, config]);
  return <ConfigContext.Provider value={merged}>{children}</ConfigContext.Provider>;
}

export function mergeConfig(a: EasyReportConfig, b: EasyReportConfig | undefined): EasyReportConfig {
  if (!b) return a;
  return {
    ...a,
    ...b,
    labels: { ...a.labels, ...b.labels },
    icons: { ...a.icons, ...b.icons },
    components: { ...a.components, ...b.components },
    functions: { ...a.functions, ...b.functions },
    parameterLookups: { ...a.parameterLookups, ...b.parameterLookups },
    dataSources: b.dataSources ?? a.dataSources,
    elementTypes: [...(a.elementTypes ?? []), ...(b.elementTypes ?? [])],
    pdf: { ...a.pdf, ...b.pdf },
    csv: { ...a.csv, ...b.csv },
  };
}

const ResolvedContext = createContext<ResolvedConfig | null>(null);

export function useResolvedConfig(local?: EasyReportConfig): ResolvedConfig {
  const ctx = useContext(ConfigContext);
  return useMemo(() => {
    const c = mergeConfig(ctx, local);
    const icons = c.icons ?? {};
    return {
      ...c,
      labels: { ...DEFAULT_LABELS, ...c.labels },
      components: { ...DEFAULT_COMPONENTS, ...c.components },
      icon: (name: IconName, size = 16) => icons[name] ?? <SvgIcon name={name} size={size} />,
      rootStyle: themeToCssVars(c.theme),
      dataSources: c.dataSources ?? [],
      elementTypes: c.elementTypes ?? [],
    };
  }, [ctx, local]);
}

/** Makes the resolved config available to nested library components. */
export function ResolvedConfigProvider({ value, children }: { value: ResolvedConfig; children: ReactNode }) {
  return <ResolvedContext.Provider value={value}>{children}</ResolvedContext.Provider>;
}

export function useER(): ResolvedConfig {
  const v = useContext(ResolvedContext);
  if (!v) throw new Error('easy-report: component used outside ReportViewer/ReportDesigner');
  return v;
}
