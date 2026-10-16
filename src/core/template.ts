import type { AnyElement, Band, BandKind, GroupDef, ReportTemplate, TextElement } from './types';

let counter = 0;
export function uid(prefix = 'el'): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createBand(height = 30, extra: Partial<Band> = {}): Band {
  return { id: uid('band'), height, elements: [], ...extra };
}

export function createTemplate(name = 'New Report'): ReportTemplate {
  return {
    version: 1,
    name,
    page: {
      size: 'A4',
      orientation: 'portrait',
      margins: { top: 38, right: 38, bottom: 38, left: 38 },
    },
    parameters: [],
    calculatedFields: [],
    sort: [],
    groups: [],
    bands: {
      reportHeader: createBand(50),
      pageHeader: createBand(30),
      detail: createBand(24),
      reportFooter: createBand(30),
      pageFooter: createBand(28),
    },
    defaultStyle: { fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 10, color: '#000000' },
  };
}

export function createGroup(expression: string, name?: string): GroupDef {
  return {
    id: uid('grp'),
    name,
    expression,
    direction: 'asc',
    header: createBand(26),
    footer: createBand(26),
    keepWithFirstRow: true,
  };
}

export interface BandRef {
  kind: BandKind;
  /** Group id for group header/footer. */
  groupId?: string;
  band: Band;
  label: string;
}

/** All bands in print order (as shown in the designer). */
export function listBands(t: ReportTemplate): BandRef[] {
  const out: BandRef[] = [];
  const b = t.bands;
  if (b.reportHeader) out.push({ kind: 'reportHeader', band: b.reportHeader, label: 'Report Header' });
  if (b.pageHeader) out.push({ kind: 'pageHeader', band: b.pageHeader, label: 'Page Header' });
  t.groups.forEach((g, i) => {
    if (g.header)
      out.push({ kind: 'groupHeader', groupId: g.id, band: g.header, label: `Group Header ${i + 1}: ${g.name || g.expression}` });
  });
  out.push({ kind: 'detail', band: b.detail, label: 'Detail' });
  [...t.groups].reverse().forEach((g) => {
    const i = t.groups.indexOf(g);
    if (g.footer)
      out.push({ kind: 'groupFooter', groupId: g.id, band: g.footer, label: `Group Footer ${i + 1}: ${g.name || g.expression}` });
  });
  if (b.reportFooter) out.push({ kind: 'reportFooter', band: b.reportFooter, label: 'Report Footer' });
  if (b.pageFooter) out.push({ kind: 'pageFooter', band: b.pageFooter, label: 'Page Footer' });
  return out;
}

export function findBand(t: ReportTemplate, bandId: string): Band | undefined {
  return listBands(t).find((r) => r.band.id === bandId)?.band;
}

export function findElement(t: ReportTemplate, elementId: string): { band: Band; element: AnyElement } | undefined {
  for (const { band } of listBands(t)) {
    const element = band.elements.find((e) => e.id === elementId);
    if (element) return { band, element };
  }
  return undefined;
}

/** Fill in missing properties so older/hand-written templates load safely. */
export function normalizeTemplate(input: Partial<ReportTemplate>): ReportTemplate {
  const base = createTemplate(input.name ?? 'Report');
  const t: ReportTemplate = {
    ...base,
    ...input,
    version: 1,
    page: { ...base.page, ...input.page, margins: { ...base.page.margins, ...input.page?.margins } },
    parameters: input.parameters ?? [],
    calculatedFields: input.calculatedFields ?? [],
    sort: input.sort ?? [],
    groups: (input.groups ?? []).map((g) => ({ ...g, id: g.id || uid('grp') })),
    bands: {
      ...(input.bands ?? base.bands),
      detail: input.bands?.detail ?? createBand(24),
    },
  };
  for (const { band } of listBands(t)) {
    band.id ||= uid('band');
    band.elements ||= [];
    for (const el of band.elements) el.id ||= uid();
  }
  return t;
}

/**
 * Build a simple tabular template from a list of fields: column captions in the page
 * header, values in the detail band and optional totals in the report footer.
 */
export function createTabularTemplate(opts: {
  name: string;
  dataSource: string;
  fields: { name: string; label?: string; type?: string }[];
  groupBy?: string[];
  totals?: string[];
  landscape?: boolean;
}): ReportTemplate {
  const t = createTemplate(opts.name);
  t.dataSource = opts.dataSource;
  if (opts.landscape) t.page.orientation = 'landscape';
  const width = (opts.landscape ? 1123 : 794) - t.page.margins.left - t.page.margins.right;
  const cols = opts.fields.filter((f) => !opts.groupBy?.includes(f.name));
  const colW = Math.floor(width / Math.max(1, cols.length));

  t.bands.reportHeader!.elements.push(text({ x: 0, y: 6, width, height: 32, text: opts.name, style: { fontSize: 18, bold: true } }));
  t.bands.pageHeader!.backgroundColor = '#f1f5f9';
  cols.forEach((f, i) => {
    const align = f.type === 'number' ? 'right' : 'left';
    t.bands.pageHeader!.elements.push(
      text({ x: i * colW, y: 4, width: colW, height: 22, text: f.label ?? f.name, style: { bold: true, textAlign: align, padding: 4 } }),
    );
    t.bands.detail.elements.push(
      text({
        x: i * colW,
        y: 0,
        width: colW,
        height: 22,
        expression: `[${f.name}]`,
        format: f.type === 'number' ? 'n2' : f.type === 'date' ? 'd' : undefined,
        style: { textAlign: align, padding: 4 },
      }),
    );
    if (opts.totals?.includes(f.name)) {
      t.bands.reportFooter!.elements.push(
        text({ x: i * colW, y: 4, width: colW, height: 22, expression: `Sum([${f.name}])`, format: 'n2', style: { bold: true, textAlign: 'right', padding: 4 } }),
      );
    }
  });
  t.bands.detail.alternateBackgroundColor = '#f8fafc';

  for (const g of opts.groupBy ?? []) {
    const grp = createGroup(`[${g}]`, g);
    grp.header!.elements.push(
      text({ x: 0, y: 4, width, height: 22, text: `${g}: {[${g}]}`, style: { bold: true, padding: 4, color: '#1e3a8a' } }),
    );
    cols.forEach((f, i) => {
      if (opts.totals?.includes(f.name)) {
        grp.footer!.elements.push(
          text({ x: i * colW, y: 2, width: colW, height: 22, expression: `Sum([${f.name}])`, format: 'n2', style: { bold: true, textAlign: 'right', padding: 4 } }),
        );
      }
    });
    t.groups.push(grp);
  }

  t.bands.pageFooter!.elements.push(
    text({ x: width - 200, y: 4, width: 200, height: 20, text: 'Page {PageNumber} of {TotalPages}', style: { textAlign: 'right', fontSize: 8, color: '#64748b' } }),
    text({ x: 0, y: 4, width: 200, height: 20, text: "{Now():g}", style: { fontSize: 8, color: '#64748b' } }),
  );
  return t;
}

function text(p: Omit<TextElement, 'id' | 'type'>): TextElement {
  return { id: uid(), type: 'text', ...p };
}
