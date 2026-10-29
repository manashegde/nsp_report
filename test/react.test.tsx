// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ReportDesigner, ReportStudio, ReportViewer, createMemoryTemplateStore, createTabularTemplate, type ReportDataSource } from '../src';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ds: ReportDataSource[] = [
  {
    name: 'people',
    fields: [
      { name: 'Name', type: 'string' },
      { name: 'Age', type: 'number' },
    ],
    data: [
      { Name: 'Ann', Age: 31 },
      { Name: 'Bob', Age: 45 },
    ],
  },
];
const template = createTabularTemplate({
  name: 'People',
  dataSource: 'people',
  fields: [{ name: 'Name' }, { name: 'Age', type: 'number' }],
  totals: ['Age'],
});

let container: HTMLDivElement;
afterEach(() => container?.remove());

async function mount(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  // let async data loading + layout settle
  await act(async () => new Promise((r) => setTimeout(r, 30)));
  return root;
}

describe('React components', () => {
  it('ReportViewer renders pages with data', async () => {
    const root = await mount(<ReportViewer template={template} dataSources={ds} />);
    expect(container.querySelector('.er-page-frame')).toBeTruthy();
    expect(container.textContent).toContain('Ann');
    expect(container.textContent).toContain('76.00'); // Sum(Age)
    root.unmount();
  });

  it('ReportViewer does not run with parameters the host rejects', async () => {
    let fetches = 0;
    const counted: ReportDataSource[] = [{ ...ds[0], data: async () => (fetches++, ds[0].data as never) }];
    const t = { ...template, parameters: [{ name: 'From', type: 'date' as const, defaultValue: '2026-10-07' }, { name: 'To', type: 'date' as const, defaultValue: '2026-10-01' }] };
    const validateParameters = (v: Record<string, unknown>) =>
      (v.From as Date) > (v.To as Date) ? { From: "'From' must be on or before 'To'." } : null;
    const root = await mount(<ReportViewer template={t} dataSources={counted} config={{ validateParameters }} />);
    expect(fetches).toBe(0);
    expect(container.querySelector('.er-page-frame')).toBeNull();
    expect(container.querySelector('.er-field__error')?.textContent).toBe("'From' must be on or before 'To'.");
    expect(container.querySelector<HTMLButtonElement>('.er-params button[type="submit"]')?.disabled).toBe(true);
    root.unmount();
  });

  it('ReportViewer Reset restores the opening values and re-runs; optional dropdowns offer "All"', async () => {
    const seen: unknown[] = [];
    const tracked: ReportDataSource[] = [{ ...ds[0], data: async ({ parameters }) => (seen.push(parameters.Site), ds[0].data as never) }];
    const t = { ...template, parameters: [{ name: 'Site', type: 'number' as const, options: [{ value: 1, label: 'Plant A' }, { value: 2, label: 'Plant B' }] }] };
    const root = await mount(<ReportViewer template={t} dataSources={tracked} />);
    const select = container.querySelector<HTMLSelectElement>('#er-param-Site')!;
    expect(select.options[0].textContent).toBe('All');

    // Pick a site and submit, then Reset.
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      set.call(select, '2');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('.er-params button[type="submit"]')!.click());
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(seen.at(-1)).toBe(2);

    const reset = [...container.querySelectorAll<HTMLButtonElement>('.er-params button')].find((b) => b.textContent === 'Reset')!;
    await act(async () => reset.click());
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(container.querySelector<HTMLSelectElement>('#er-param-Site')!.value).toBe('');
    expect(seen.at(-1) ?? null).toBeNull();
    root.unmount();
  });

  it('ReportViewer names the chosen option with ParamLabel even when no rows come back, and says there is no data', async () => {
    const lookupCalls: unknown[] = [];
    const empty: ReportDataSource[] = [{ ...ds[0], data: async () => [] }];
    const t = {
      ...template,
      dataFilters: { tagIds: ['a'] },
      parameters: [{ name: 'Site', type: 'number' as const, lookup: 'sites', defaultValue: 7 }],
      bands: {
        ...template.bands,
        reportHeader: {
          id: 'rh',
          height: 30,
          elements: [{ id: 'h', type: 'text' as const, x: 0, y: 0, width: 300, height: 20, text: "{Iif(IsNull(?Site, 0) = 0, 'All sites', ParamLabel('Site'))} · Oct" }],
        },
      },
    };
    const sites = async (ctx: { filters?: Record<string, unknown> }) => (lookupCalls.push(ctx.filters), [{ value: 7, label: 'Plant A' }]);
    const root = await mount(<ReportViewer template={t} dataSources={empty} config={{ parameterLookups: { sites }, labels: { noData: 'No data for the selected range' } }} />);
    expect(container.querySelector('.er-page-frame')?.textContent).toContain('Plant A · Oct');
    expect(container.querySelector('.er-message--empty')?.textContent).toBe('No data for the selected range');
    expect(lookupCalls).toContainEqual({ tagIds: ['a'] });
    root.unmount();
  });

  it('ReportViewer date inputs carry required and the configured min / max', async () => {
    const t = { ...template, parameters: [{ name: 'From', type: 'date' as const, required: true, defaultValue: '2026-10-01' }] };
    const root = await mount(<ReportViewer template={t} dataSources={ds} config={{ dateLimits: { min: '2000-01-01', max: '2026-10-28' } }} />);
    const input = container.querySelector<HTMLInputElement>('#er-param-From')!;
    expect([input.required, input.min, input.max]).toEqual([true, '2000-01-01', '2026-10-28']);
    root.unmount();
  });

  it('ReportViewer hides a failed run\'s message once a parameter is edited', async () => {
    const failing: ReportDataSource[] = [{ ...ds[0], data: () => Promise.reject(new Error('Bad range')) }];
    const t = { ...template, parameters: [{ name: 'Note', type: 'string' as const, defaultValue: 'x' }] };
    const root = await mount(<ReportViewer template={t} dataSources={failing} />);
    expect(container.querySelector('.er-message--error')?.textContent).toBe('Bad range');
    const input = container.querySelector<HTMLInputElement>('#er-param-Note')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'y');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('.er-message--error')).toBeNull();
    root.unmount();
  });

  it('ReportViewer shows the message of a plain-object data error', async () => {
    const failing: ReportDataSource[] = [{ ...ds[0], data: () => Promise.reject({ errorCode: '400', errorMessage: "'from' must be before 'to'." }) }];
    const root = await mount(<ReportViewer template={template} dataSources={failing} />);
    expect(container.querySelector('.er-message--error')?.textContent).toBe("'from' must be before 'to'.");
    root.unmount();
  });

  it('ReportViewer honours toolbar config and labels', async () => {
    const root = await mount(
      <ReportViewer template={template} dataSources={ds} toolbar={['exportPdf']} config={{ labels: { exportPdf: 'PDF herunterladen' } }} />,
    );
    const buttons = container.querySelectorAll('.er-toolbar button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute('title')).toBe('PDF herunterladen');
    root.unmount();
  });

  it('ReportDesigner does not report host-loaded templates as edits', async () => {
    const changes: unknown[] = [];
    const root = await mount(<ReportDesigner template={template} dataSources={ds} onChange={(t) => changes.push(t)} />);
    const other = createTabularTemplate({ name: 'Other', dataSource: 'people', fields: [{ name: 'Name' }] });
    await act(async () => root.render(<ReportDesigner template={other} dataSources={ds} onChange={(t) => changes.push(t)} />));
    expect(container.textContent).toContain('Other');
    expect(changes).toHaveLength(0);
    root.unmount();
  });

  it('ReportDesigner renders bands, toolbox and field list', async () => {
    const root = await mount(<ReportDesigner template={template} dataSources={ds} />);
    expect(container.querySelectorAll('[data-band-body]').length).toBe(5);
    expect(container.textContent).toContain('Toolbox');
    expect(container.querySelector('.er-tree')?.textContent).toContain('Age');
    // select an element → properties panel shows it
    const el = container.querySelector('[data-el]') as HTMLElement;
    await act(async () => {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    });
    expect(container.querySelector('.er-props__title')?.textContent).toMatch(/Report Header/);
    root.unmount();
  });

  it('ReportStudio shows viewers only published reports and opens them', async () => {
    const store = createMemoryTemplateStore();
    await store.save({ name: 'People list', status: 'published', category: 'HR', template });
    await store.save({ name: 'Secret draft', status: 'draft', template });
    const root = await mount(<ReportStudio store={store} role="viewer" dataSources={ds} />);
    await act(async () => new Promise((r) => setTimeout(r, 30)));

    const items = [...container.querySelectorAll('.er-studio__item')].map((b) => b.textContent);
    expect(items).toEqual(['People list']);
    expect(container.textContent).not.toContain('New report');

    await act(async () => (container.querySelector('.er-studio__item') as HTMLButtonElement).click());
    await act(async () => new Promise((r) => setTimeout(r, 60)));
    expect(container.querySelector('.er-page-frame')).toBeTruthy();
    expect(container.textContent).not.toContain('Edit');
    root.unmount();
  });

  it('ReportStudio lets admins create, save and publish a report', async () => {
    const store = createMemoryTemplateStore();
    const root = await mount(
      <ReportStudio store={store} role="admin" dataSources={ds} starters={[{ id: 'people', label: 'People table', create: () => template }]} />,
    );
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    const click = async (el: Element | null | undefined) => {
      await act(async () => (el as HTMLElement).click());
      await act(async () => new Promise((r) => setTimeout(r, 30)));
    };
    const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

    await click(button('New report'));
    await click([...container.querySelectorAll('.er-studio__starter')].find((b) => b.textContent?.includes('People table')));
    expect(container.querySelectorAll('[data-band-body]').length).toBeGreaterThan(0);

    await click(button('Save draft'));
    let saved = await store.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'People', status: 'draft' });
    expect(container.querySelector('.er-studio__item .er-badge')?.textContent).toBe('Draft');

    await click(button('Save & publish'));
    saved = await store.list();
    expect(saved[0].status).toBe('published');
    root.unmount();
  });
});
