import { LineCapStyle, type PDFPage, type RGB } from '@cantoo/pdf-lib';

export type PdfIconName =
  | 'graduationCap'
  | 'calendar'
  | 'clock'
  | 'building'
  | 'mapPin'
  | 'coins'
  | 'award'
  | 'landmark'
  | 'fileText'
  | 'squareCheck'
  | 'externalLink'
  | 'arrowRight'
  | 'arrowLeft';

interface IconDefinition {
  paths?: string[];
  circles?: Array<{ cx: number; cy: number; r: number }>;
  rects?: Array<{ x: number; y: number; w: number; h: number }>;
}

const LUCIDE_VECTOR_ICONS: Record<PdfIconName, IconDefinition> = {
  graduationCap: {
    paths: [
      'M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z',
      'M22 10v6',
      'M6 12.5V16a6 3 0 0 0 12 0v-3.5',
    ],
  },
  calendar: {
    paths: ['M8 2v3', 'M16 2v3', 'M3 9h18'],
    rects: [{ x: 3, y: 3, w: 18, h: 18 }],
  },
  clock: {
    circles: [{ cx: 12, cy: 12, r: 10 }],
    paths: ['M12 6v6l4 2'],
  },
  building: {
    paths: [
      'M10 12h4',
      'M10 8h4',
      'M14 21v-3a2 2 0 0 0-4 0v3',
      'M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2',
      'M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16',
    ],
  },
  mapPin: {
    paths: [
      'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0',
    ],
    circles: [{ cx: 12, cy: 10, r: 3 }],
  },
  coins: {
    paths: ['M13.744 17.736a6 6 0 1 1-7.48-7.48', 'M15 6h1v4', 'M6.134 14.768l.866-.5 2 3.464'],
    circles: [{ cx: 16, cy: 8, r: 6 }],
  },
  award: {
    paths: [
      'M15.477 12.89l1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526',
    ],
    circles: [{ cx: 12, cy: 8, r: 6 }],
  },
  landmark: {
    paths: [
      'M10 18v-7',
      'M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z',
      'M14 18v-7',
      'M18 18v-7',
      'M3 22h18',
      'M6 18v-7',
    ],
  },
  fileText: {
    paths: [
      'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z',
      'M14 2v5a1 1 0 0 0 1 1h5',
      'M10 9H8',
      'M16 13H8',
      'M16 17H8',
    ],
  },
  squareCheck: {
    rects: [{ x: 3, y: 3, w: 18, h: 18 }],
    paths: ['M16 9l-5.5 5.5L8 12'],
  },
  externalLink: {
    paths: [
      'M15 3h6v6',
      'M10 14L21 3',
      'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
    ],
  },
  arrowRight: {
    paths: ['M5 12h14', 'M12 5l7 7-7 7'],
  },
  arrowLeft: {
    paths: ['M12 19l-7-7 7-7', 'M19 12H5'],
  },
};

/**
 * Draws a crisp Lucide-style outline vector icon inside a [x, topY - size] bounding box.
 */
export function drawPdfIcon(
  page: PDFPage,
  iconName: PdfIconName,
  x: number,
  topY: number,
  size: number,
  color: RGB,
  strokeWidth: number = 1.0,
): void {
  const def = LUCIDE_VECTOR_ICONS[iconName];
  const scale = size / 24;

  if (def.paths) {
    for (const pathData of def.paths) {
      page.drawSvgPath(pathData, {
        x,
        y: topY,
        scale,
        borderColor: color,
        borderWidth: strokeWidth,
        borderLineCap: LineCapStyle.Round,
      });
    }
  }

  if (def.circles) {
    for (const c of def.circles) {
      page.drawCircle({
        x: x + c.cx * scale,
        y: topY - c.cy * scale,
        size: c.r * scale,
        borderColor: color,
        borderWidth: strokeWidth,
      });
    }
  }

  if (def.rects) {
    for (const r of def.rects) {
      page.drawRectangle({
        x: x + r.x * scale,
        y: topY - (r.y + r.h) * scale,
        width: r.w * scale,
        height: r.h * scale,
        borderColor: color,
        borderWidth: strokeWidth,
      });
    }
  }
}

