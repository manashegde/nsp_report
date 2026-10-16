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

A store is four async methods (`list`, `get`, `save`, `remove`); saves carry a `version` and stores throw `TemplateConflictError` when someone saved in between.

| Store | Use |
| --- | --- |
| `createRestTemplateStore({ baseUrl, headers, fromServer?, toServer? })` | Your backend (`GET/POST base`, `GET/PUT/DELETE base/{id}`, 409 = conflict). Map other shapes with `fromServer` / `toServer`. |
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
