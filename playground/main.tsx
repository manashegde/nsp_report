import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  EasyReportProvider,
  ReportStudio,
  createLocalStorageTemplateStore,
  toNumber,
  type EasyReportConfig,
  type ElementTypeDef,
  type StarterTemplate,
} from '../src';
import { dataSources, parameterLookups, tagSummarySource, telemetryLookups, telemetrySource } from './data';
import { salesReport, siteEnergyMixReport, siteEnergyMixSummaryReport } from './templates';

/** Example of a host-defined element: a progress bar bound to an expression. */
const progressBar: ElementTypeDef = {
  type: 'progress',
  label: 'Progress bar',
  defaults: { width: 120, height: 12, props: { value: '0.5', color: '#2563eb' } },
  properties: [
    { key: 'props.value', label: 'Value (0–1)', type: 'expression' },
    { key: 'props.color', label: 'Color', type: 'color' },
  ],
  layout: (el, api) => {
    const props = (el as { props?: { value?: string; color?: string } }).props ?? {};
    const v = Math.max(0, Math.min(1, toNumber(api.evaluate(props.value ?? '0')) ?? 0));
    return {
      height: el.height,
      value: `${Math.round(v * 100)}%`,
      items: [
        { kind: 'rect', x: el.x, y: el.y, width: el.width, height: el.height, fill: '#e2e8f0', strokeWidth: 0, radius: el.height / 2 },
        { kind: 'rect', x: el.x, y: el.y, width: Math.max(el.height, el.width * v), height: el.height, fill: props.color ?? '#2563eb', strokeWidth: 0, radius: el.height / 2 },
      ],
    };
  },
  renderDesign: (el) => {
    const color = (el as { props?: { color?: string } }).props?.color ?? '#2563eb';
    return (
      <div style={{ width: '100%', height: '100%', background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: '60%', height: '100%', background: color }} />
      </div>
    );
  },
};

const STORE_KEY = 'er-playground.reports';
const store = createLocalStorageTemplateStore(STORE_KEY);

/** First run: seed the library with two published reports (once, even under StrictMode). */
let seeding: Promise<void> | null = null;
function seedStore(): Promise<void> {
  seeding ??= seedIfEmpty().finally(() => (seeding = null));
  return seeding;
}
async function seedIfEmpty() {
  if ((await store.list()).length) return;
  await store.save({ name: 'Sales by Category', category: 'Sales', status: 'published', description: 'Orders by category with totals', template: salesReport() });
  await store.save({ name: 'Site energy mix', category: 'Energy', status: 'published', description: 'Monthly kWh per source and renewable share', template: siteEnergyMixReport() });
  await store.save({ name: 'Site energy mix (pre-aggregated)', category: 'Energy', status: 'published', description: 'Same report on server-aggregated rows (tag-summary contract)', template: siteEnergyMixSummaryReport() });
}

const starters: StarterTemplate[] = [
  { id: 'energy-mix', label: 'Site energy mix', description: 'Sites × months with metric columns per tag', create: siteEnergyMixReport },
  { id: 'energy-mix-summary', label: 'Site energy mix (pre-aggregated)', description: 'Same, on server-aggregated tag-summary rows', create: siteEnergyMixSummaryReport },
  { id: 'sales', label: 'Sales by category', description: 'Grouped orders with summaries', create: salesReport },
];

function App() {
  const [role, setRole] = useState<'admin' | 'viewer'>('admin');
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);
  const [studioKey, setStudioKey] = useState(0);

  useEffect(() => {
    void seedStore().then(() => setReady(true));
  }, []);

  const config = useMemo<EasyReportConfig>(
    () => ({
      theme: dark ? 'dark' : 'light',
      dataSources: [...dataSources, telemetrySource, tagSummarySource],
      parameterLookups: { ...parameterLookups, ...telemetryLookups },
      elementTypes: [progressBar],
      locale: 'en-US',
      // Host-wide rule shown under the fields; the report does not run while it fails.
      validateParameters: (v) =>
        v.From instanceof Date && v.To instanceof Date && v.From > v.To ? { From: "'From' must be on or before 'To'." } : null,
    }),
    [dark],
  );

  document.body.classList.toggle('dark', dark);

  return (
    <EasyReportProvider config={config}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 12, gap: 10, boxSizing: 'border-box' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ marginRight: 12 }}>easy-report</strong>
          <span>Role:</span>
          <button onClick={() => setRole('admin')} disabled={role === 'admin'}>
            Admin (builds reports)
          </button>
          <button onClick={() => setRole('viewer')} disabled={role === 'viewer'}>
            Viewer
          </button>
          <span style={{ flex: 1 }} />
          <label>
            <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> Dark theme
          </label>
          <button
            onClick={async () => {
              localStorage.removeItem(STORE_KEY);
              await seedStore();
              setStudioKey((k) => k + 1);
            }}
          >
            Reset samples
          </button>
        </header>
        <div style={{ flex: 1, minHeight: 0 }}>
          {ready && <ReportStudio key={`${role}-${studioKey}`} store={store} role={role} starters={starters} categories={['Energy', 'BESS', 'Grid', 'Sales']} />}
        </div>
      </div>
    </EasyReportProvider>
  );
}

// Reuse the root across HMR re-executions.
const w = window as unknown as { __erRoot?: ReturnType<typeof createRoot> };
w.__erRoot ??= createRoot(document.getElementById('root')!);
w.__erRoot.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
