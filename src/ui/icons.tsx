import type { ReactNode, SVGProps } from 'react';

/** Minimal stroke icon set (24x24, currentColor). Hosts can replace any icon via config.icons. */
const PATHS = {
  first: 'M18 18l-6-6 6-6M7 6v12',
  prev: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  last: 'M6 18l6-6-6-6M17 6v12',
  zoomIn: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4M11 8v6M8 11h6',
  zoomOut: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4M8 11h6',
  pdf: 'M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8zM14 3v5h5M9 13h1.5a1.5 1.5 0 010 3H9v-3zm0 3v2M14 13v5M14 13h2M14 15.5h1.5',
  csv: 'M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8zM14 3v5h5M8 12h8M8 15h8M8 18h8M11 12v6',
  print: 'M6 9V3h12v6M6 18H4a1 1 0 01-1-1v-6a2 2 0 012-2h14a2 2 0 012 2v6a1 1 0 01-1 1h-2M7 14h10v7H7z',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  params: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  close: 'M6 6l12 12M18 6L6 18',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  paste: 'M9 4h6v3H9zM8 5H5v16h14V5h-3',
  save: 'M5 3h11l4 4v13a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1zM8 3v5h7V3M7 13h10v8H7z',
  open: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  file: 'M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8zM14 3v5h5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  design: 'M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  field: 'M4 7h3M4 12h3M4 17h3M10 5l2 14M14 5l-2 14M9 9h8M8 15h8',
  sigma: 'M18 5H6l6 7-6 7h12',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  lineH: 'M3 12h18',
  lineV: 'M12 3v18',
  rect: 'M4 6h16v12H4z',
  ellipse: 'M12 5c5 0 9 3.1 9 7s-4 7-9 7-9-3.1-9-7 4-7 9-7z',
  checkbox: 'M4 4h16v16H4zM8 12l3 3 5-6',
  page: 'M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8zM14 3v5h5M9 14h6M9 17h4',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  alignLeft: 'M4 3v18M8 7h10v4H8zM8 14h6v4H8z',
  alignCenter: 'M12 3v18M6 7h12v4H6zM8 14h8v4H8z',
  alignRight: 'M20 3v18M6 7h10v4H6zM10 14h6v4h-6z',
  alignTop: 'M3 4h18M7 8h4v10H7zM14 8h4v6h-4z',
  alignMiddle: 'M3 12h18M7 6h4v12H7zM14 8h4v8h-4z',
  alignBottom: 'M3 20h18M7 6h4v10H7zM14 10h4v6h-4z',
  sameWidth: 'M4 8h16M4 16h16M4 5v6M20 5v6M4 13v6M20 13v6',
  sameHeight: 'M8 4v16M16 4v16M5 4h6M5 20h6M13 4h6M13 20h6',
  front: 'M8 8h12v12H8zM4 4h12v4M4 4v12h4',
  back: 'M4 4h12v12H4zM20 8v12H8',
  grid: 'M4 4h16v16H4zM4 10h16M4 15h16M10 4v16M15 4v16',
  magnet: 'M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4zM6 8h4M14 8h4',
  bold: 'M7 5h6a3.5 3.5 0 010 7H7zM7 12h7a3.5 3.5 0 010 7H7z',
  italic: 'M14 5h-4M14 19h-4M14 5l-4 14',
  underline: 'M7 4v7a5 5 0 0010 0V4M5 20h14',
  expression: 'M7 4c-2 0-2 2-2 4s-1 4-2 4c1 0 2 2 2 4s0 4 2 4M17 4c2 0 2 2 2 4s1 4 2 4c-1 0-2 2-2 4s0 4-2 4M10 9l4 6M14 9l-4 6',
  group: 'M4 5h16M4 5v4M8 9h12M8 9v4M12 13h8M4 17h16',
  sort: 'M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3',
  drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  fitWidth: 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4',
  db: 'M12 4c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  calc: 'M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01',
  hash: 'M5 9h14M5 15h14M10 4L8 20M16 4l-2 16',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  toggle: 'M8 7h8a5 5 0 010 10H8A5 5 0 018 7zM8 10a2 2 0 100 4 2 2 0 000-4z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  warning: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 000 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
} as const;

export type IconName = keyof typeof PATHS;
export type IconOverrides = Partial<Record<IconName, ReactNode>>;

export function SvgIcon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
