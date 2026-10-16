import { renderDocumentHtml } from '../core/html';
import type { RenderedDocument } from '../core/types';

/** Print the document through a hidden iframe (browser print dialog → printer or "Save as PDF"). */
export function printDocument(doc: RenderedDocument): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(iframe);
    const win = iframe.contentWindow!;
    win.document.open();
    win.document.write(renderDocumentHtml(doc.pages, doc.name));
    win.document.close();
    const done = () => {
      setTimeout(() => iframe.remove(), 1000);
      resolve();
    };
    const go = () => {
      win.focus();
      win.addEventListener('afterprint', done, { once: true });
      win.print();
      // Some browsers never fire afterprint for iframes.
      setTimeout(done, 60000);
    };
    const imgs = Array.from(win.document.images);
    Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => ((i.onload = r), (i.onerror = r)))))).then(() =>
      setTimeout(go, 50),
    );
  });
}
