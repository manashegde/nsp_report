import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { getFields, prepareRows, renderReport, createPdf } from '../src/core';
import { salesReport } from '../playground/templates';
import { dataSources, generateOrders } from '../playground/data';

it.skipIf(!process.env.ER_PDF_OUT)('writes sample PDF', async () => {
  const rows = prepareRows(generateOrders(), getFields(dataSources[0]));
  const doc = renderReport(salesReport(), rows, { locale: 'en-US' });
  const pdf = await createPdf(doc);
  writeFileSync(process.env.ER_PDF_OUT!, Buffer.from(pdf.output('arraybuffer')));
});
