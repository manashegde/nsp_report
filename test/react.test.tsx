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
