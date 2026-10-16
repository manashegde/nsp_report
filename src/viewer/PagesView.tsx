import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { renderPageHtml } from '../core/html';
import type { RenderedDocument, RenderedPage, RenderedText } from '../core/types';

export const PAGE_GAP = 16;

export interface SearchMatch {
  page: number;
  item: RenderedText;
}

export function findMatches(doc: RenderedDocument | null, query: string): SearchMatch[] {
  const q = query.trim().toLowerCase();
  if (!doc || !q) return [];
  const out: SearchMatch[] = [];
  doc.pages.forEach((p, i) => {
    for (const it of p.items) {
      if (it.kind === 'text' && it.lines.join(' ').toLowerCase().includes(q)) out.push({ page: i, item: it });
    }
  });
  return out;
}

const PageContent = memo(function PageContent({ page }: { page: RenderedPage }) {
  const html = useMemo(() => renderPageHtml(page), [page]);
  return <div className="er-page__content" dangerouslySetInnerHTML={{ __html: html }} />;
});

function LazyPage({
  page,
  zoom,
  root,
  matches,
  current,
  onClick,
}: {
  page: RenderedPage;
  zoom: number;
  root: RefObject<HTMLDivElement | null>;
  matches: SearchMatch[];
  current: SearchMatch | null;
  onClick?: (elementId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(page.index < 3);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), {
      root: root.current,
      rootMargin: '1200px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  return (
    <div
      ref={ref}
      className="er-page-frame"
      style={{ width: page.width * zoom, height: page.height * zoom }}
      data-page={page.index + 1}
      onClick={
        onClick
          ? (e) => {
              const el = (e.target as HTMLElement).closest('[data-er-el]');
              if (el) onClick(el.getAttribute('data-er-el')!);
            }
          : undefined
      }
    >
      <div className="er-page" style={{ width: page.width, height: page.height, transform: `scale(${zoom})` }}>
        {visible && <PageContent page={page} />}
        {visible &&
          matches.map((m, i) => (
            <div
              key={i}
              className={`er-hit ${m === current ? 'er-hit--current' : ''}`}
              style={{ left: m.item.x, top: m.item.y, width: m.item.width, height: m.item.height }}
            />
          ))}
      </div>
    </div>
  );
}

export interface PagesViewProps {
  doc: RenderedDocument;
  zoom: number;
  matches: SearchMatch[];
  currentMatch: SearchMatch | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  onPageChange: (page: number) => void;
  onElementClick?: (elementId: string) => void;
}

export function PagesView({ doc, zoom, matches, currentMatch, scrollRef, onPageChange, onElementClick }: PagesViewProps) {
  const byPage = useMemo(() => {
    const m = new Map<number, SearchMatch[]>();
    for (const x of matches) m.set(x.page, [...(m.get(x.page) ?? []), x]);
    return m;
  }, [matches]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const stride = doc.pageHeight * zoom + PAGE_GAP;
      const mid = el.scrollTop + el.clientHeight / 3;
      onPageChange(Math.min(doc.pages.length, Math.max(1, Math.floor(mid / stride) + 1)));
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [doc, zoom, scrollRef, onPageChange]);

  return (
    <div className="er-pages" style={{ gap: PAGE_GAP }}>
      {doc.pages.map((p) => (
        <LazyPage
          key={p.index}
          page={p}
          zoom={zoom}
          root={scrollRef}
          matches={byPage.get(p.index) ?? []}
          current={currentMatch}
          onClick={onElementClick}
        />
      ))}
    </div>
  );
}
