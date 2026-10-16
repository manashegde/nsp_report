/**
 * Report template model. A template is plain JSON so it can be stored in a
 * database, versioned, and sent between designer and viewer.
 *
 * All coordinates and sizes are in CSS pixels at 96 DPI.
 */

export type FieldType = 'string' | 'number' | 'date' | 'boolean';

export type PageSizeName = 'A3' | 'A4' | 'A5' | 'Letter' | 'Legal' | 'Tabloid';

export interface PageSettings {
  size: PageSizeName | { width: number; height: number };
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number };
}

export interface BorderStyle {
  width: number;
  color: string;
  style?: 'solid' | 'dashed' | 'dotted';
  /** Which sides to draw. Defaults to all four. */
  sides?: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean };
}

export interface ElementStyle {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  backgroundColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  padding?: number;
  border?: BorderStyle;
  lineHeight?: number;
}

export interface ConditionalStyle {
  /** Boolean expression, e.g. `[Amount] < 0` */
  condition: string;
  style: ElementStyle;
}

export interface BaseElement {
  id: string;
  type: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style?: ElementStyle;
  /** Boolean expression; element is hidden when it evaluates falsy. */
  visible?: string;
  conditionalStyles?: ConditionalStyle[];
}

export interface TextElement extends BaseElement {
  type: 'text';
  /** Static text, used when `expression` is empty. */
  text?: string;
  /** Expression whose result is displayed, e.g. `[Price] * [Qty]`. */
  expression?: string;
  /** Display format: n2, c2, p1, d, D, t, yyyy-MM-dd, #,##0.00 ... */
  format?: string;
  /** Grow vertically to fit content. */
  canGrow?: boolean;
  /** Wrap long text onto multiple lines (default true). */
  wordWrap?: boolean;
  /** CSV export column header override for this element. */
  exportName?: string;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  /** Static URL / data URI. */
  src?: string;
  /** Expression producing a URL / data URI. */
  expression?: string;
  fit?: 'contain' | 'cover' | 'stretch';
}

export interface LineElement extends BaseElement {
  type: 'line';
  direction: 'horizontal' | 'vertical';
  color?: string;
  thickness?: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
}

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shape: 'rectangle' | 'ellipse';
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
}

export interface CheckboxElement extends BaseElement {
  type: 'checkbox';
  expression?: string;
}

/** Custom element registered by the host. */
export interface CustomElement extends BaseElement {
  props?: Record<string, unknown>;
}

export type ReportElement =
  | TextElement
  | ImageElement
  | LineElement
  | ShapeElement
  | CheckboxElement;

export type AnyElement = ReportElement | CustomElement;

export type BandKind =
  | 'reportHeader'
  | 'pageHeader'
  | 'groupHeader'
  | 'detail'
  | 'groupFooter'
  | 'reportFooter'
  | 'pageFooter';

export interface Band {
  id: string;
  height: number;
  elements: AnyElement[];
  visible?: string;
  backgroundColor?: string;
  /** Start a new page before printing this band. */
  pageBreakBefore?: boolean;
  /** Start a new page after printing this band. */
  pageBreakAfter?: boolean;
  /** Group header only: reprint on every page while the group continues. */
  repeatOnEveryPage?: boolean;
  /** Detail only: alternating row background. */
  alternateBackgroundColor?: string;
}

export interface SortSpec {
  expression: string;
  direction: 'asc' | 'desc';
}

export interface GroupDef {
  id: string;
  name?: string;
  /** Group key expression, usually a field: `[Category]` */
  expression: string;
  direction: 'asc' | 'desc';
  header?: Band;
  footer?: Band;
  /** Move the group header to the next page if it would be orphaned. */
  keepWithFirstRow?: boolean;
}

export interface ParameterOption {
  value: unknown;
  label: string;
}

export interface ParameterDef {
  name: string;
  label?: string;
  type: FieldType;
  defaultValue?: unknown;
  required?: boolean;
  multiValue?: boolean;
  /** Static choices. Host can also provide `lookup` via data source config. */
  options?: ParameterOption[];
  /** Name of a host-provided lookup (see ReportDataSource.lookups / HostConfig.parameterLookups). */
  lookup?: string;
  /** Show the parameter in the viewer's parameter panel (default true). */
  visible?: boolean;
  description?: string;
}

export interface CalculatedField {
  name: string;
  expression: string;
  type?: FieldType;
}

export interface ReportTemplate {
  version: 1;
  name: string;
  description?: string;
  page: PageSettings;
  /** Name of the host data source used for detail rows. */
  dataSource?: string;
  parameters: ParameterDef[];
  calculatedFields: CalculatedField[];
  /** Row filter expression, e.g. `[OrderDate] >= ?StartDate` */
  filter?: string;
  /**
   * Design-time selections for the data source's `filters` (e.g. which tags or sites this report
   * covers). Chosen by the report author, sent with every data fetch, not editable by viewers.
   */
  dataFilters?: Record<string, unknown>;
  sort: SortSpec[];
  groups: GroupDef[];
  bands: {
    reportHeader?: Band;
    pageHeader?: Band;
    detail: Band;
    reportFooter?: Band;
    pageFooter?: Band;
  };
  /** Default font for all text. */
  defaultStyle?: ElementStyle;
  /** Locale used for number/date formatting (default: host locale). */
  locale?: string;
  /** ISO currency code used by `c` formats (default USD). */
  currency?: string;
}

/* ------------------------------------------------------------------ */
/* Data sources (provided by the host application)                     */
/* ------------------------------------------------------------------ */

export interface FieldDef {
  name: string;
  label?: string;
  type: FieldType;
  /** Nested object fields, e.g. Customer.Name */
  fields?: FieldDef[];
}

export type DataRow = Record<string, unknown>;

export interface DataFetchContext {
  parameters: Record<string, unknown>;
  /** The template's design-time `dataFilters`. */
  filters?: Record<string, unknown>;
  signal?: AbortSignal;
}

/** A design-time filter the report author sets once per report (e.g. tags, sites). */
export interface DataSourceFilterDef {
  /** Key in `template.dataFilters` and `DataFetchContext.filters`, e.g. `tagIds`. */
  name: string;
  label: string;
  /** `multi` = pick several options, `single` = one option, `text` = free text. */
  type: 'multi' | 'single' | 'text';
  /** Named lookup (HostConfig.parameterLookups) providing the options. */
  lookup?: string;
  /** Fixed options, used when there is no `lookup` (e.g. a period granularity: day / month). */
  options?: ParameterOption[];
  /**
   * Row field the selection matches (e.g. `tagId`). When set, rows are also filtered on the client,
   * so static/sample data honours the selection; remote sources should filter server-side too.
   */
  field?: string;
  description?: string;
}

/**
 * A numeric field metric columns can aggregate. For rows the backend has already aggregated
 * (e.g. one row per site × day × tag from a rollup table), `parts` names the fields holding each
 * partial result so re-aggregation stays correct: sums of sums, min of mins, max of maxes, counts
 * as sums of counts, and averages as total sum ÷ total count — never an average of averages.
 */
export interface MetricValueField {
  name: string;
  label: string;
  format?: string;
  parts?: { sum?: string; count?: string; min?: string; max?: string };
}

/**
 * Describes "long" data (one row per measured item, e.g. per tag) so the designer can offer
 * metric columns: the author picks an item + value + aggregate and gets a labelled column.
 */
export interface DataSourceMetrics {
  /** Field identifying the item, e.g. `tagId`. */
  keyField: string;
  /** Field with a readable item name, e.g. `tagName`. */
  labelField?: string;
  /** Lookup listing the items; defaults to the values selected in the matching filter. */
  lookup?: string;
  /** Filter (in `filters`) whose selection limits the offered items, e.g. `tagIds`. */
  filter?: string;
  /** Numeric fields that can be aggregated, e.g. energy, average, maximum. */
  valueFields: MetricValueField[];
}

export interface ReportDataSource {
  name: string;
  label?: string;
  /**
   * Schema used by the designer field list. Inferred from rows if omitted. A function receives the
   * template's design-time `filters`, for "wide" data whose columns depend on the selection
   * (e.g. one column per selected tag).
   */
  fields?: FieldDef[] | ((ctx: { filters?: Record<string, unknown> }) => FieldDef[]);
  /** Static rows, or a function returning rows for the given parameter values. */
  data?: DataRow[] | ((ctx: DataFetchContext) => DataRow[] | Promise<DataRow[]>);
  /** Sample rows shown in designer preview when `data` needs a backend. */
  sampleData?: DataRow[];
  /** Design-time filters the report author configures (stored in `template.dataFilters`). */
  filters?: DataSourceFilterDef[];
  /** Enables "Add metric column" for long-format data. */
  metrics?: DataSourceMetrics;
  /**
   * Refuse results larger than this (default `DEFAULT_MAX_ROWS`, 100 000). Reports aggregate in the
   * browser, so very large results mean the backend should aggregate first. `Infinity` disables.
   */
  maxRows?: number;
}

export type ParameterLookup = (
  ctx: DataFetchContext,
) => ParameterOption[] | Promise<ParameterOption[]>;

/* ------------------------------------------------------------------ */
/* Rendered document (output of layout engine)                         */
/* ------------------------------------------------------------------ */

export interface ResolvedTextStyle {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  backgroundColor?: string;
  textAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  padding: number;
  border?: BorderStyle;
  lineHeight: number;
}

interface RenderedBase {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Source element id (for designer/preview cross-highlighting). */
  elementId?: string;
}

export interface RenderedText extends RenderedBase {
  kind: 'text';
  lines: string[];
  style: ResolvedTextStyle;
}

export interface RenderedImage extends RenderedBase {
  kind: 'image';
  src: string;
  fit: 'contain' | 'cover' | 'stretch';
  border?: BorderStyle;
  backgroundColor?: string;
}

export interface RenderedLine extends RenderedBase {
  kind: 'line';
  x2: number;
  y2: number;
  color: string;
  thickness: number;
  lineStyle: 'solid' | 'dashed' | 'dotted';
}

export interface RenderedRect extends RenderedBase {
  kind: 'rect';
  fill?: string;
  stroke?: string;
  strokeWidth: number;
  radius: number;
  ellipse?: boolean;
  dash?: 'solid' | 'dashed' | 'dotted';
}

export interface RenderedCheckbox extends RenderedBase {
  kind: 'checkbox';
  checked: boolean;
  color: string;
}

export type RenderedItem =
  | RenderedText
  | RenderedImage
  | RenderedLine
  | RenderedRect
  | RenderedCheckbox;

export interface RenderedPage {
  index: number;
  width: number;
  height: number;
  items: RenderedItem[];
}

/** Tabular projection of the detail band, used by CSV export. */
export interface TabularData {
  columns: string[];
  rows: string[][];
}

export interface RenderedDocument {
  name: string;
  pages: RenderedPage[];
  pageWidth: number;
  pageHeight: number;
  table: TabularData;
  /** Rows after filter/sort (useful for raw export). */
  rows: DataRow[];
  warnings: string[];
}
