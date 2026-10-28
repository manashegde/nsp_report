# @nsplus/easy-report

A lightweight banded **report designer**, **report viewer** and **PDF / CSV exporter** for React — the essentials of DevExpress Reporting at a fraction of the size (~33 kB gzip for everything, plus `jspdf` loaded on demand for PDF).

- **Banded layout**: report header/footer, page header/footer, nested group headers/footers, detail
- **Drag & drop designer**: toolbox, field list, move/resize/marquee/multi-select, cross-band moves, snap-to-grid, align tools, undo/redo, copy/paste, inline text editing, live preview
- **Data binding & parameters**: host-provided data sources (static rows or async fetchers that receive parameter values), parameter panel with lookups, filter/sort expressions, calculated fields
- **Summaries**: `Sum`, `Avg`, `Count`, `CountDistinct`, `Min`, `Max`, `Median`, `StdDev`, `PercentOfTotal`, `RunningSum/Count/Avg`, `SumIf/CountIf/AvgIf` — scoped to group, page, report or a named group
- **Formatting**: `n2`, `c2`, `p1`, `d`, `yyyy-MM-dd`, `#,##0.00`, conditional styles, can-grow text
- **Output**: paginated HTML viewer (search, zoom, lazy pages), vector PDF, CSV (report or raw data), print
- **Host-configurable UI**: theme tokens, i18n labels, swap UI primitives with your design system, configurable toolbars and toolbox, custom element types

## Install

```bash
npm i @nsplus/easy-report jspdf
```

`react`/`react-dom` ≥ 18 are peer dependencies. `jspdf` is optional — only needed for PDF export.

```tsx
import '@nsplus/easy-report/styles.css';
```

## Quick start

```tsx
import { ReportDesigner, ReportViewer, EasyReportProvider, type ReportDataSource } from '@nsplus/easy-report';
import '@nsplus/easy-report/styles.css';

const dataSources: ReportDataSource[] = [
  {
    name: 'orders',
    label: 'Sales orders',
    fields: [
      { name: 'OrderDate', type: 'date' },
      { name: 'Region', type: 'string' },
      { name: 'Amount', type: 'number' },
      { name: 'Customer', type: 'string', fields: [{ name: 'Name', type: 'string' }] },
    ],
    // Called with the report's parameter values — call your API here.
    data: async ({ parameters, signal }) =>
      (await fetch(`/api/orders?region=${parameters.Region ?? ''}`, { signal })).json(),
    // Used by the designer preview so it works without a backend.
    sampleData: [{ OrderDate: '2024-01-05', Region: 'East', Amount: 120, Customer: { Name: 'Acme' } }],
  },
];

export function App() {
  const [template, setTemplate] = useState<ReportTemplate>();
  return (
    <EasyReportProvider config={{ dataSources, locale: 'en-US' }}>
      <div style={{ height: 700 }}>
        <ReportDesigner template={template} onSave={(t) => api.saveTemplate(t)} />
      </div>
      <div style={{ height: 700 }}>
        {template && <ReportViewer template={template} />}
      </div>
    </EasyReportProvider>
  );
}
```

Both components fill their parent (`height: 100%`), so give the container a height.

## Templates

A template is plain JSON (`ReportTemplate`) — store it in your DB, version it, ship it between designer and viewer. Coordinates are CSS px at 96 DPI; font sizes are points.

```ts
import { createTemplate, createTabularTemplate, normalizeTemplate } from '@nsplus/easy-report';

const t = createTabularTemplate({
  name: 'Orders', dataSource: 'orders',
  fields: [{ name: 'Region' }, { name: 'Amount', type: 'number' }],
  groupBy: ['Region'], totals: ['Amount'],
});
```

`normalizeTemplate(json)` fills defaults when loading older or hand-written templates.

## Expressions

| Syntax | Meaning |
| --- | --- |
| `[Amount]`, `[Customer.Name]` | Field of the current row (dotted paths for nested objects) |
| `?StartDate` | Report parameter |
| `PageNumber`, `TotalPages`, `RowNumber`, `GroupNumber`, `ReportName` | Built-in variables |
| `+ - * / %`, `= != < <= > >=`, `and or not` | Operators (`+` concatenates strings) |
| `Iif(c, a, b)`, `IsNull(x, 0)`, `In(x, 'a', 'b')` | Logic |
| `Format(x, 'c2')`, `Upper`, `Substring`, `Concat`, … | Text |
| `Round(x, 2)`, `Abs`, `Percent(a, b)`, … | Math |
| `Today()`, `Year(d)`, `AddDays(d, 7)`, `DateDiffDay(a, b)` … | Dates |

Static text can embed expressions with an optional format: `Page {PageNumber} of {TotalPages}`, `Total: {Sum([Amount]):c2}`.

### Aggregates and scope

```text
Sum([Amount])                 -- default scope: group in group bands, report in report bands, page in page bands
Sum([Amount], 'report')       -- explicit scope: 'group' | 'report' | 'page' | '<group name>'
PercentOfTotal([Amount])      -- detail row (or current group) share of the report total
PercentOfTotal([Amount], 'group')
RunningSum([Amount])          -- cumulative within the group
CountIf([Paid] = false)       -- conditional aggregates
```

In the designer, the **Summary** section of a field's properties builds these for you (function, field and scope). Dropping a numeric field into a footer band creates a `Sum()` automatically.

### Formats

`n0` `n2` (grouped) · `f2` (fixed) · `c2` (currency — `template.currency`) · `p1` (percent) · `d5` (zero padded) · `#,##0.00` · `0.0%` · dates: `d` `D` `t` `g` `M` `Y` or custom `dd/MM/yyyy HH:mm` · booleans: `Yes|No`.

## Host configuration

Pass `config` to a component or once via `<EasyReportProvider config={…}>` (nested providers merge).

```tsx
const config: EasyReportConfig = {
  theme: { base: 'dark', primary: '#7c3aed', radius: '2px', fontFamily: 'Inter, sans-serif' }, // or 'light' | 'dark'
  labels: { exportPdf: 'PDF herunterladen', parameters: 'Parameter' },  // i18n — see DEFAULT_LABELS
  components: { Button: MyButton, Input: MyInput, Select: MySelect },    // use your design system
  icons: { pdf: <MyPdfIcon /> },
  dataSources,
  parameterLookups: { regions: async () => (await api.regions()).map((r) => ({ value: r.id, label: r.name })) },
  // Messages per parameter: shown under the fields, Submit blocked, report not run.
  validateParameters: (v) => (v.From > v.To ? { From: "'From' must be on or before 'To'." } : null),
  functions: { FiscalYear: ([d]) => /* … */ 2025 },                    // extra expression functions
  elementTypes: [barcodeElement],                                         // custom elements
  pdf: { fonts: [{ family: 'Noto Sans', source: '/fonts/NotoSans-Regular.ttf' }] },
  csv: { delimiter: ';' },
  locale: 'de-DE',
  currency: 'EUR',
};
```

- **Theme** — every color/size is a CSS variable (`--er-primary`, `--er-surface`, `--er-border`, `--er-radius`, …) on `.er-root`. Override via `theme` or plain CSS. Class names are single-class (`.er-btn`, `.er-toolbar`…) so they are easy to restyle.
- **Toolbars** — `toolbar={false}`, `toolbar={['prev', 'next', 'exportPdf']}` or `toolbar={(defaults) => [...defaults, { id: 'email', label: 'Email', onClick }]}` on both viewer and designer.
- **Toolbox** — `<ReportDesigner toolbox={(items) => items.filter((i) => i.id !== 'ellipse')} />`.
- **Panels** — `panels={{ toolbox: false }}`, `readOnly`, `initialMode="preview"`.

### Custom element types

A custom element turns into standard render items (text / rect / line / image), so it works in viewer, print and PDF automatically.

```tsx
const progress: ElementTypeDef = {
  type: 'progress',
  label: 'Progress bar',
  defaults: { width: 120, height: 12, props: { value: '0.5' } },
  properties: [{ key: 'props.value', label: 'Value (0–1)', type: 'expression' }],
  layout: (el, api) => {
    const v = Number(api.evaluate(el.props.value)) || 0;
    return {
      height: el.height,
      items: [
        { kind: 'rect', x: el.x, y: el.y, width: el.width, height: el.height, fill: '#e2e8f0', strokeWidth: 0, radius: 6 },
        { kind: 'rect', x: el.x, y: el.y, width: el.width * v, height: el.height, fill: '#2563eb', strokeWidth: 0, radius: 6 },
      ],
    };
  },
  renderDesign: () => <div className="my-progress-placeholder" />,
};
```

## Report library: build once, view many times (`ReportStudio`)

Typical setup: an admin builds a set of reports for an application once; everyone else opens them from a list.

```tsx
import { ReportStudio, createRestTemplateStore } from '@nsplus/easy-report';

const store = createRestTemplateStore({
  baseUrl: '/api/v1/Reports/templates',
  headers: () => ({ Authorization: `Bearer ${token}` }),
});

<ReportStudio
  store={store}
  role={canBuild ? 'admin' : 'viewer'}   // viewers only see published reports
  dataSources={dataSources}
  starters={[{ id: 'energy', label: 'Site energy mix', create: siteEnergyTemplate }]}
  categories={['Energy', 'BESS', 'Grid']}
/>
```

- **Viewer**: searchable list of published reports grouped by category → opens in the viewer (parameters, export, print).
- **Admin**: same list plus *New report* (blank or a host-provided starter), *Edit* (designer), *Duplicate*, *Publish / Unpublish*, *Delete*, with name, category, description and an unsaved-changes guard.

### Template stores

A store is four async methods (`list`, `get`, `save`, `remove`); saves carry a `version` and stores throw `TemplateConflictError` when someone saved in between. For viewers, `ReportStudio` calls `list({ status: 'published' })`.

| Store | Use |
| --- | --- |
| `createRestTemplateStore({ baseUrl, headers, fromServer?, toServer? })` | Your backend (`GET/POST base`, `GET/PUT/DELETE base/{id}`, 409 = conflict, `GET base?status=published` for viewers). Map other shapes with `fromServer` / `toServer`. |
| `createLocalStorageTemplateStore(key)` | Demos / POCs (per browser). |
| `createMemoryTemplateStore(initial)` | Tests, or a host that persists elsewhere. |
| custom | Implement `ReportTemplateStore`. |

## Application-specific tags: data selection & metric columns

Telemetry usually arrives "long" — one row per tag per period. Describe that on the data source and the designer does the rest:

```ts
const tagReadings: ReportDataSource = {
  name: 'tagReadings',
  fields: [/* timestamp, site, tagId, tagName, energyKwh, avg, max … */],
  data: ({ parameters, filters }) => api.rows({ ...parameters, tagIds: filters?.tagIds }),
  // Chosen once by the report author, stored in template.dataFilters, not editable by viewers.
  filters: [{ name: 'tagIds', label: 'Tags in this report', type: 'multi', lookup: 'tags', field: 'tagId' }],
  // Enables "Add metric column".
  metrics: {
    keyField: 'tagId', labelField: 'tagName', filter: 'tagIds',
    valueFields: [{ name: 'energyKwh', label: 'Energy (kWh)', format: 'n0' }, { name: 'max', label: 'Peak (kW)' }],
  },
};
```

- **Data selection** (report properties): the author ticks this application's tags (options come from the `tags` lookup). Data functions receive them as `filters`; static/sample data is filtered on `field`.
- **Add metric column** (field list): pick a tag, a value and an aggregate (sum / average / max / min / count) and a caption; the designer adds a header caption and a cell such as `SumIf([energyKwh], [tagId] = 'grid_import')` to the chosen group/report band. Typical layout: group by site and by month (*Group by period* presets) with one metric column per tag.
- Expressions gained `MinIf` / `MaxIf`; `metricExpression(...)` builds the same expressions in code for starter templates.

## Production data: aggregate on the server

The report engine runs in the browser and aggregates whatever rows it receives. That's fine for a few thousand rows, but telemetry adds up fast. A year of daily readings for 50 sites × 100 tags is about 1.8 M rows (~250 MB of JSON); at 15-minute resolution it's impossible. A monthly report needs only a few hundred numbers per site, so **the backend should aggregate and the report should only lay out the result**.

```
 Telemetry DB ─► rollup tables (hourly / daily) ─► report API ─► easy-report
 (raw readings)  filled at ingestion or by a job   GROUP BY      lays out a small,
                                                   site, period,  already-aggregated
                                                   tag            result
```

### The standard tag-summary contract

Every host that returns this shape can run the same report templates, whatever its database looks like. Typically each host writes one SQL view over its own tables.

| Field | Type | Meaning |
| --- | --- | --- |
| `siteId`, `siteName` | string | Site |
| `period` | date | Start of the period (hour / day / month / year) |
| `tagId`, `tagName`, `unit` | string | Measured item |
| `sum`, `count`, `min`, `max` | number | Aggregates of the readings in that period |

```ts
import { createTagSummarySource, createRestDataSource } from '@nsplus/easy-report';

// Contract fields, tag/site/granularity pickers and metric columns, data from your API:
const tagSummary = createTagSummarySource({
  valueLabel: 'Energy (kWh)', format: 'n0',
  data: (ctx) => api.tagSummary(ctx),   // or createRestDataSource({...}).data
});
```

- The author picks **tags, sites and granularity** (`hour` / `day` / `month` / `year`) once per report (`template.dataFilters`). The data function receives them as `filters`, so the backend can return exactly one row per site × period × tag.
- **Metric columns re-aggregate correctly.** A value field with `parts` (`{ sum, count, min, max }`) produces sums of sums, min of mins, max of maxes, and **averages as total sum ÷ total count, never an average of averages.** The designer only offers the aggregates the parts support.

```ts
metrics: {
  keyField: 'tagId',
  valueFields: [{ name: 'energy', label: 'Energy', parts: { sum: 'energy_sum', count: 'energy_count', max: 'energy_max' } }],
}
// avg → SumIf([energy_sum], [tagId] = 'pv') / SumIf([energy_count], [tagId] = 'pv')
```

### Wide (pivoted) rows

If the backend pivots to one row per site × period with one column per tag (`{ site, period, grid_import_kwh, solar_kwh, … }`), templates bind straight to `[grid_import_kwh]`. The columns depend on the author's selection, so `fields` can be a function of the design-time filters:

```ts
fields: ({ filters }) => [
  { name: 'site', type: 'string' }, { name: 'period', type: 'date' },
  ...(filters?.tagIds as string[] ?? []).map((t) => ({ name: t, label: tagLabel(t), type: 'number' })),
],
```

### `createRestDataSource`: named queries, never SQL from the browser

```ts
const energy = createRestDataSource({
  name: 'energy', label: 'Energy summary', fields: TAG_SUMMARY_FIELDS,
  url: '/api/v1/Reports/datasets/energy/rows',
  headers: () => ({ Authorization: `Bearer ${token}` }),
});
```

- Sends `POST url` with `{ parameters, filters }`. Dates are sent as local ISO (`2026-07-01T00:00:00+05:30`) so a picked day doesn't shift through UTC. Override with `toServer`.
- Accepts `rows[]` or `{ rows, truncated, rowLimit }` (override with `fromServer`). **Truncated results are refused** with `DataLimitError`, because totals over a partial result would be silently wrong. Pass `onTruncated` to accept them anyway.
- Error bodies `{ error }`, `{ message }` and ASP.NET ProblemDetails (`title` / `detail`) become the error message shown in the viewer.

### Row limit

Every data source refuses results above `maxRows` (default `DEFAULT_MAX_ROWS` = 100 000) with a `DataLimitError` that tells the viewer to narrow the range or aggregate. Set `maxRows: Infinity` to disable it.

### Security: what the backend must enforce

Everything the browser sends can be edited by the user, so these checks belong on the server:

- **Data scoping.** `filters` (tags, sites) and `parameters` come from the client. The rows endpoint must check that the requested sites and tags belong to the signed-in customer, and treat an empty selection as "everything *this user* may see".
- **Drafts.** The templates endpoint must return only published templates to viewers (`?status=published` is a hint, not a guarantee) and allow saving and deleting only to authors.
- **Queries.** Datasets are named queries or views owned by the backend. Never accept SQL or expressions from the browser to run against the database.

## Viewer API

```tsx
const ref = useRef<ReportViewerHandle>(null);
<ReportViewer
  ref={ref}
  template={template}
  data={rows}                       // optional: bypass data sources
  parameters={{ Region: 'East' }}   // initial values
  parametersPanel="auto"            // 'open' | 'collapsed' | 'hidden'
  zoom="fit-width"
  onDocumentReady={(doc) => …}
/>;

ref.current.exportPdf();             // download PDF
ref.current.exportCsv({ mode: 'data' });
ref.current.print();
ref.current.setParameters({ Region: 'West' });
```

## Headless / server-side

`@nsplus/easy-report/core` has no React dependency — render and export anywhere (Node, workers):

```ts
import { renderReport, createPdf, documentToCsv, prepareRows } from '@nsplus/easy-report/core';

const doc = renderReport(template, prepareRows(rows, fields), { parameters: { Region: 'East' }, locale: 'en-US' });
const pdf = await createPdf(doc);           // jsPDF instance → pdf.output('arraybuffer')
const csv = documentToCsv(doc);             // report columns; { mode: 'data' } for raw rows
```

Report-mode CSV has one row per detail row; when the detail band shows no values (a summary report), it has one row per innermost group footer (or header) that does. Numbers are written plain (`1234.5`, no grouping or currency symbol). Pass `{ context: true }` (or `config.csv.context`) to write the report header — name, scope, KPIs — above the table.

Layout uses built-in Helvetica/Arial metrics, so pagination is identical in the browser, on the server and in the PDF.

## PDF notes

- Text, lines, shapes and borders are vector; images are rasterised (remote images need CORS).
- The 14 standard PDF fonts cover Latin-1. For other scripts (Arabic, CJK, Devanagari, …) register a TTF via `config.pdf.fonts` and use that family in the template.

## Development

```bash
npm run dev        # playground at http://localhost:5180
npm test           # vitest
npm run build      # dist/ (ESM + CJS + .d.ts + styles.css)
```

## Roadmap ideas

Sub-reports, charts and barcodes as built-in elements, cross-tab/pivot element, band splitting across pages for very tall bands, Excel (XLSX) export, rulers and snap-lines in the designer.
