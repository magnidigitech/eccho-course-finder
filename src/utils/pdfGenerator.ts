import fontkit from '@cantoo/fontkit';
import {
  PDFDocument,
  PDFName,
  PDFString,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from '@cantoo/pdf-lib';
import regularFontUrl from '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf?url';
import mediumFontUrl from '@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf?url';
import semiBoldFontUrl from '@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf?url';
import boldFontUrl from '@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf?url';
import { BRAND_CONFIG } from '../config/brand';
import {
  CHECKLIST_READER_INSTRUCTION,
  DOCUMENT_CHECKLIST_GROUPS,
  GUIDANCE_CHECKED_DATE,
  OFFICIAL_GUIDANCE_LINKS,
  UK_APPLICATION_STEPS,
  type ChecklistGroup,
  type GuideStep,
} from '../config/ukGuide';
import type {
  ChecklistSelections,
  CourseRecord,
  CurrencyCode,
  InMemoryLogo,
  PageFitFailure,
  PdfGenerationResult,
  UniversityLogoEntry,
  UniversityLogoMap,
} from '../types/course';
import { drawPdfIcon, type PdfIconName } from './pdfIcons';
import { getUniversityInitials } from './universityLogos';
import { NOT_SPECIFIED, formatTuitionFee } from './valueFormatting';

// A4 portrait dimensions in PDF points (210mm x 297mm)
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;

const FOOTER_BOTTOM_PAD = 18;
const FOOTER_RULE_Y = 56;
const CONTENT_FOOTER_GAP = 10;
const MIN_CONTENT_BOTTOM_Y = FOOTER_RULE_Y + CONTENT_FOOTER_GAP; // 66 pt from bottom

export interface FontBytesBundle {
  regular: Uint8Array;
  medium: Uint8Array;
  semiBold: Uint8Array;
  bold: Uint8Array;
}

interface EmbeddedFonts {
  regular: PDFFont;
  medium: PDFFont;
  semiBold: PDFFont;
  bold: PDFFont;
}

interface LayoutTier {
  name: string;
  topMargin: number;
  sideMargin: number;
  minContentY: number;
  headerHeight: number;
  backStripHeight: number;
  logoBoxSize: number;
  universitySize: number;
  locationSize: number;
  programTitleSize: number;
  sectionHeadingSize: number;
  labelSize: number;
  bodySize: number; // Strictly >= 9.0 pt
  tableTextSize: number; // Strictly >= 9.0 pt
  tuitionValueSize: number;
  sectionGap: number;
  lineGap: number;
  rowPadY: number;
}

const LAYOUT_TIERS: LayoutTier[] = [
  {
    name: 'comfortable',
    topMargin: 22,
    sideMargin: 36,
    minContentY: MIN_CONTENT_BOTTOM_Y,
    headerHeight: 28,
    backStripHeight: 22,
    logoBoxSize: 44,
    universitySize: 11.5,
    locationSize: 9.25,
    programTitleSize: 17.5,
    sectionHeadingSize: 10.5,
    labelSize: 8.5,
    bodySize: 9.5,
    tableTextSize: 9.25,
    tuitionValueSize: 14.5,
    sectionGap: 11,
    lineGap: 2.2,
    rowPadY: 5.5,
  },
  {
    name: 'balanced',
    topMargin: 20,
    sideMargin: 34,
    minContentY: MIN_CONTENT_BOTTOM_Y,
    headerHeight: 26,
    backStripHeight: 20,
    logoBoxSize: 42,
    universitySize: 11,
    locationSize: 9.0,
    programTitleSize: 16,
    sectionHeadingSize: 10.0,
    labelSize: 8.25,
    bodySize: 9.25,
    tableTextSize: 9.0,
    tuitionValueSize: 13.5,
    sectionGap: 9,
    lineGap: 2.0,
    rowPadY: 4.5,
  },
  {
    name: 'compact',
    topMargin: 18,
    sideMargin: 32,
    minContentY: MIN_CONTENT_BOTTOM_Y,
    headerHeight: 24,
    backStripHeight: 19,
    logoBoxSize: 38,
    universitySize: 10.5,
    locationSize: 9.0,
    programTitleSize: 14.5,
    sectionHeadingSize: 9.75,
    labelSize: 8.25,
    bodySize: 9.0,
    tableTextSize: 9.0,
    tuitionValueSize: 12.5,
    sectionGap: 7.5,
    lineGap: 1.8,
    rowPadY: 3.8,
  },
  {
    name: 'dense',
    topMargin: 16,
    sideMargin: 30,
    minContentY: MIN_CONTENT_BOTTOM_Y,
    headerHeight: 22,
    backStripHeight: 18,
    logoBoxSize: 36,
    universitySize: 10.25,
    locationSize: 9.0,
    programTitleSize: 13.5,
    sectionHeadingSize: 9.5,
    labelSize: 8.0,
    bodySize: 9.0,
    tableTextSize: 9.0,
    tuitionValueSize: 12.0,
    sectionGap: 6.0,
    lineGap: 1.5,
    rowPadY: 3.2,
  },
];

let cachedBrowserFontBytes: Promise<FontBytesBundle> | null = null;
let cachedDefaultLogoBytes: Promise<{
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg';
} | null> | null = null;

async function fetchBinaryAsset(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load static asset (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function loadBrowserFontBytes(): Promise<FontBytesBundle> {
  if (!cachedBrowserFontBytes) {
    cachedBrowserFontBytes = Promise.all([
      fetchBinaryAsset(regularFontUrl),
      fetchBinaryAsset(mediumFontUrl),
      fetchBinaryAsset(semiBoldFontUrl),
      fetchBinaryAsset(boldFontUrl),
    ]).then(([regular, medium, semiBold, bold]) => ({
      regular,
      medium,
      semiBold,
      bold,
    }));
  }
  return cachedBrowserFontBytes;
}

async function loadDefaultBrandLogo(): Promise<{
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg';
} | null> {
  if (!BRAND_CONFIG.logoAssetPath) {
    return null;
  }
  if (!cachedDefaultLogoBytes) {
    cachedDefaultLogoBytes = fetch(BRAND_CONFIG.logoAssetPath)
      .then(async (resp) => {
        if (!resp.ok) return null;
        const bytes = new Uint8Array(await resp.arrayBuffer());
        const contentType = (resp.headers.get('content-type') ?? '').toLowerCase();
        const isJpg =
          contentType.includes('jpeg') ||
          contentType.includes('jpg') ||
          BRAND_CONFIG.logoAssetPath!.toLowerCase().endsWith('.jpg') ||
          BRAND_CONFIG.logoAssetPath!.toLowerCase().endsWith('.jpeg');
        return {
          bytes,
          mimeType: (isJpg ? 'image/jpeg' : 'image/png') as 'image/png' | 'image/jpeg',
        };
      })
      .catch(() => null);
  }
  return cachedDefaultLogoBytes;
}

function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

const COLORS = {
  brandPrimary: hexToRgb(BRAND_CONFIG.colors.brandPrimary),
  brandDark: hexToRgb(BRAND_CONFIG.colors.brandDark),
  brandSoft: hexToRgb(BRAND_CONFIG.colors.brandSoft),
  brandBorder: hexToRgb(BRAND_CONFIG.colors.brandBorder),
  surfaceTint: hexToRgb(BRAND_CONFIG.colors.surfaceTint),
  surfaceAlt: hexToRgb(BRAND_CONFIG.colors.surfaceAlt),
  border: hexToRgb(BRAND_CONFIG.colors.border),
  borderStrong: hexToRgb(BRAND_CONFIG.colors.borderStrong),
  textPrimary: hexToRgb(BRAND_CONFIG.colors.textPrimary),
  textSecondary: hexToRgb(BRAND_CONFIG.colors.textSecondary),
  textMuted: hexToRgb(BRAND_CONFIG.colors.textMuted),
  white: hexToRgb(BRAND_CONFIG.colors.white),
};

// ============================================================================
// Text Measurement & Wrapping
// ============================================================================

function cleanControlChars(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\t/g, '  ');
}

function measureWidth(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    const safe = text.replace(/[^\x20-\x7E]/g, ' ');
    return font.widthOfTextAtSize(safe, size);
  }
}

function sanitizeLineForFont(font: PDFFont, text: string, size: number): string {
  try {
    font.widthOfTextAtSize(text, size);
    return text;
  } catch {
    let out = '';
    for (const ch of text) {
      try {
        font.widthOfTextAtSize(ch, size);
        out += ch;
      } catch {
        out += '?';
      }
    }
    return out;
  }
}

function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  const cleaned = cleanControlChars(text).trim();
  if (!cleaned) return [];

  const result: string[] = [];
  const paragraphs = cleaned.split('\n');

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      if (result.length > 0 && result[result.length - 1] !== '') {
        result.push('');
      }
      continue;
    }

    const words = trimmed.split(/\s+/);
    let currentLine = '';

    for (const rawWord of words) {
      const word = sanitizeLineForFont(font, rawWord, fontSize);
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (measureWidth(font, candidate, fontSize) <= maxWidth) {
        currentLine = candidate;
        continue;
      }

      if (currentLine) {
        result.push(currentLine);
        currentLine = '';
      }

      if (measureWidth(font, word, fontSize) <= maxWidth) {
        currentLine = word;
      } else {
        let segment = '';
        for (const ch of word) {
          const next = segment + ch;
          if (measureWidth(font, next, fontSize) <= maxWidth) {
            segment = next;
          } else {
            if (segment) result.push(segment);
            segment = ch;
          }
        }
        currentLine = segment;
      }
    }

    if (currentLine) {
      result.push(currentLine);
    }
  }

  return result;
}

function blockHeight(lines: string[], fontSize: number, lineGap: number): number {
  if (lines.length === 0) return 0;
  return lines.length * fontSize + (lines.length - 1) * lineGap;
}

function drawLines(
  page: PDFPage,
  lines: string[],
  x: number,
  topY: number,
  font: PDFFont,
  fontSize: number,
  lineGap: number,
  color: RGB,
  alignRightEndX?: number,
): void {
  const step = fontSize + lineGap;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const baselineY = topY - fontSize * 0.82 - i * step;
    const drawX =
      alignRightEndX !== undefined
        ? alignRightEndX - measureWidth(font, line, fontSize)
        : x;
    page.drawText(line, {
      x: drawX,
      y: baselineY,
      size: fontSize,
      font,
      color,
    });
  }
}

// ============================================================================
// PDF Annotations & Common Drawing Primitives
// ============================================================================

function addUriLinkAnnotation(
  pdfDoc: PDFDocument,
  page: PDFPage,
  rect: [number, number, number, number],
  url: string,
): void {
  const annot = pdfDoc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: rect,
    Border: [0, 0, 0],
    A: {
      Type: 'Action',
      S: 'URI',
      URI: PDFString.of(url),
    },
  });
  page.node.addAnnot(pdfDoc.context.register(annot));
}

function addGoToLinkAnnotation(
  pdfDoc: PDFDocument,
  page: PDFPage,
  rect: [number, number, number, number],
  targetPage: PDFPage,
): void {
  const dest = pdfDoc.context.obj([targetPage.ref, PDFName.of('Fit')]);
  const annot = pdfDoc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: rect,
    Border: [0, 0, 0],
    A: {
      Type: 'Action',
      S: 'GoTo',
      D: dest,
    },
  });
  page.node.addAnnot(pdfDoc.context.register(annot));
}

function drawUniversityLogoFrame(options: {
  page: PDFPage;
  x: number;
  topY: number;
  size: number;
  pad: number;
  embeddedImage: PDFImage | null;
  initials: string;
  fonts: EmbeddedFonts;
}): void {
  const { page, x, topY, size, pad, embeddedImage, initials, fonts } = options;
  const bottomY = topY - size;

  page.drawRectangle({
    x,
    y: bottomY,
    width: size,
    height: size,
    color: embeddedImage ? COLORS.white : COLORS.surfaceTint,
    borderColor: COLORS.brandBorder,
    borderWidth: 0.9,
  });

  if (embeddedImage) {
    const inner = size - pad * 2;
    const scale = Math.min(inner / embeddedImage.width, inner / embeddedImage.height);
    const drawW = embeddedImage.width * scale;
    const drawH = embeddedImage.height * scale;
    page.drawImage(embeddedImage, {
      x: x + (size - drawW) / 2,
      y: bottomY + (size - drawH) / 2,
      width: drawW,
      height: drawH,
    });
    return;
  }

  const label = sanitizeLineForFont(fonts.bold, initials || 'UN', size * 0.36);
  const textSize = label.length >= 3 ? size * 0.31 : size * 0.36;
  const textW = measureWidth(fonts.bold, label, textSize);
  page.drawText(label, {
    x: x + (size - textW) / 2,
    y: bottomY + (size - textSize * 0.72) / 2,
    size: textSize,
    font: fonts.bold,
    color: COLORS.brandDark,
  });
}

function drawMinimalPageHeader(options: {
  page: PDFPage;
  sideMargin: number;
  topMargin: number;
  headerHeight: number;
  fonts: EmbeddedFonts;
  embeddedBrandLogo: PDFImage | null;
  rightLabel: string;
  studentName: string;
  showPreparedBesideLogo?: boolean;
}): number {
  const {
    page,
    sideMargin,
    topMargin,
    headerHeight,
    fonts,
    embeddedBrandLogo,
    rightLabel,
    studentName,
    showPreparedBesideLogo = true,
  } = options;

  const contentWidth = A4_WIDTH_PT - sideMargin * 2;
  const topY = A4_HEIGHT_PT - topMargin;
  const midY = topY - headerHeight * 0.5;
  let nextX = sideMargin;

  if (embeddedBrandLogo) {
    const maxLogoH = Math.min(18, headerHeight - 6);
    const maxLogoW = 104;
    const scale = Math.min(
      maxLogoW / embeddedBrandLogo.width,
      maxLogoH / embeddedBrandLogo.height,
    );
    const drawW = embeddedBrandLogo.width * scale;
    const drawH = embeddedBrandLogo.height * scale;
    page.drawImage(embeddedBrandLogo, {
      x: nextX,
      y: midY - drawH / 2 + 1,
      width: drawW,
      height: drawH,
    });
    nextX += drawW + 10;
  } else {
    const fallbackBrand = BRAND_CONFIG.brandName.toUpperCase();
    page.drawText(fallbackBrand, {
      x: nextX,
      y: midY - 3.5,
      size: 11,
      font: fonts.bold,
      color: COLORS.brandDark,
    });
    nextX += measureWidth(fonts.bold, fallbackBrand, 11) + 10;
  }

  if (showPreparedBesideLogo) {
    page.drawLine({
      start: { x: nextX, y: midY - 5 },
      end: { x: nextX, y: midY + 6 },
      thickness: 0.7,
      color: COLORS.borderStrong,
    });
    const maxPrepW = contentWidth - (nextX - sideMargin) - 140;
    const preparedText = sanitizeLineForFont(
      fonts.medium,
      `Prepared for ${studentName}`,
      8.5,
    );
    const clippedPrep =
      measureWidth(fonts.medium, preparedText, 8.5) <= maxPrepW
        ? preparedText
        : (wrapText(preparedText, fonts.medium, 8.5, maxPrepW)[0] ?? preparedText);
    page.drawText(clippedPrep, {
      x: nextX + 9,
      y: midY - 2.75,
      size: 8.5,
      font: fonts.medium,
      color: COLORS.textSecondary,
    });
  }

  const rightText = sanitizeLineForFont(fonts.semiBold, rightLabel, 8.25);
  const rightW = measureWidth(fonts.semiBold, rightText, 8.25);
  page.drawText(rightText, {
    x: sideMargin + contentWidth - rightW,
    y: midY - 2.75,
    size: 8.25,
    font: fonts.semiBold,
    color: COLORS.textMuted,
  });

  const dividerY = topY - headerHeight;
  page.drawLine({
    start: { x: sideMargin, y: dividerY },
    end: { x: sideMargin + contentWidth, y: dividerY },
    thickness: 0.75,
    color: COLORS.border,
  });

  return dividerY;
}

interface NavPillSpec {
  icon: PdfIconName;
  label: string;
  targetPage: PDFPage;
  emphasis?: 'back' | 'action';
}

function drawNavigationStrip(options: {
  pdfDoc: PDFDocument;
  page: PDFPage;
  sideMargin: number;
  topY: number;
  stripHeight: number;
  fonts: EmbeddedFonts;
  links: NavPillSpec[];
}): number {
  const { pdfDoc, page, sideMargin, topY, stripHeight, fonts, links } = options;
  let cursorX = sideMargin;

  for (const item of links) {
    const textSize = 8.25;
    const iconSize = 9.5;
    const isAction = item.emphasis === 'action';
    const padX = isAction ? 8 : 2;
    const textW = measureWidth(fonts.semiBold, item.label, textSize);
    const pillW = padX * 2 + iconSize + 5 + textW;
    const pillH = Math.min(18, stripHeight - 2);
    const pillY = topY - (stripHeight + pillH) / 2;

    if (isAction) {
      page.drawRectangle({
        x: cursorX,
        y: pillY,
        width: pillW,
        height: pillH,
        color: COLORS.brandSoft,
        borderColor: COLORS.brandBorder,
        borderWidth: 0.65,
      });
    }

    const iconColor = COLORS.brandDark;
    drawPdfIcon(
      page,
      item.icon,
      cursorX + padX,
      pillY + (pillH + iconSize) / 2,
      iconSize,
      iconColor,
      1.6,
    );

    page.drawText(item.label, {
      x: cursorX + padX + iconSize + 5,
      y: pillY + (pillH - textSize * 0.72) / 2,
      size: textSize,
      font: fonts.semiBold,
      color: COLORS.brandDark,
    });

    addGoToLinkAnnotation(
      pdfDoc,
      page,
      [cursorX, pillY, cursorX + pillW, pillY + pillH],
      item.targetPage,
    );

    cursorX += pillW + 14;
  }

  return topY - stripHeight;
}

function drawStandardFooter(options: {
  pdfDoc: PDFDocument;
  page: PDFPage;
  fonts: EmbeddedFonts;
  sideMargin: number;
  pageNumber: number;
  totalPages: number;
  studentName?: string;
  websiteDisplay?: string;
  websiteHref?: string | null;
}): void {
  const {
    pdfDoc,
    page,
    fonts,
    sideMargin,
    pageNumber,
    totalPages,
    studentName,
    websiteDisplay,
    websiteHref,
  } = options;

  const contentWidth = A4_WIDTH_PT - sideMargin * 2;
  const pageText = `Page ${pageNumber} of ${totalPages}`;
  const pageTextW = measureWidth(fonts.medium, pageText, 8.25);

  page.drawLine({
    start: { x: sideMargin, y: FOOTER_RULE_Y },
    end: { x: sideMargin + contentWidth, y: FOOTER_RULE_Y },
    thickness: 0.7,
    color: COLORS.border,
  });

  page.drawText(pageText, {
    x: sideMargin + contentWidth - pageTextW,
    y: FOOTER_BOTTOM_PAD + 9,
    size: 8.25,
    font: fonts.medium,
    color: COLORS.textSecondary,
  });

  if (websiteHref !== undefined) {
    // Course page footer: Left clickable URL + brief confirmation note in center
    const leftMaxW = 155;
    if (websiteHref) {
      const displayLabel =
        cleanWebsiteLabel(websiteDisplay || websiteHref) || websiteHref;
      const wrappedUrl = wrapText(displayLabel, fonts.semiBold, 8.0, leftMaxW - 14);
      const urlText = wrappedUrl[0] ?? displayLabel;
      const urlTextW = measureWidth(fonts.semiBold, urlText, 8.0);
      const baselineY = FOOTER_BOTTOM_PAD + 9.5;
      page.drawText(urlText, {
        x: sideMargin,
        y: baselineY,
        size: 8.0,
        font: fonts.semiBold,
        color: COLORS.brandDark,
      });
      page.drawLine({
        start: { x: sideMargin, y: baselineY - 1.5 },
        end: { x: sideMargin + urlTextW, y: baselineY - 1.5 },
        thickness: 0.65,
        color: COLORS.brandPrimary,
      });
      drawPdfIcon(
        page,
        'externalLink',
        sideMargin + urlTextW + 4,
        baselineY + 8,
        8.5,
        COLORS.brandDark,
        1.6,
      );
      addUriLinkAnnotation(
        pdfDoc,
        page,
        [
          sideMargin,
          FOOTER_BOTTOM_PAD + 3,
          sideMargin + urlTextW + 15,
          FOOTER_BOTTOM_PAD + 21,
        ],
        websiteHref,
      );
    } else {
      page.drawText('Website not specified', {
        x: sideMargin,
        y: FOOTER_BOTTOM_PAD + 9.5,
        size: 8.0,
        font: fonts.regular,
        color: COLORS.textMuted,
      });
    }

    const disclaimerX = sideMargin + 162;
    const disclaimerW = contentWidth - 162 - pageTextW - 14;
    const disclaimerLines = wrapText(
      'Fees, scholarships and entry requirements are subject to change. Confirm with the university.',
      fonts.regular,
      7.4,
      disclaimerW,
    );
    drawLines(
      page,
      disclaimerLines.slice(0, 2),
      disclaimerX,
      FOOTER_RULE_Y - 10,
      fonts.regular,
      7.4,
      1.6,
      COLORS.textMuted,
    );
  } else {
    const leftLabel = sanitizeLineForFont(
      fonts.medium,
      studentName
        ? `${BRAND_CONFIG.brandName}  |  Prepared for ${studentName}`
        : BRAND_CONFIG.brandName,
      8.0,
    );
    page.drawText(leftLabel, {
      x: sideMargin,
      y: FOOTER_BOTTOM_PAD + 9,
      size: 8.0,
      font: fonts.medium,
      color: COLORS.textSecondary,
    });
  }
}

function cleanWebsiteLabel(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

// ============================================================================
// Page 1 (or 1..S): Personalised Summary Pages
// ============================================================================

interface MeasuredSummaryRow {
  courseIndex: number;
  course: CourseRecord;
  univLines: string[];
  courseLines: string[];
  locationLines: string[];
  rowHeight: number;
}

function buildSummaryLayout(
  courses: CourseRecord[],
  studentName: string,
  fonts: EmbeddedFonts,
): {
  summaryTitleLines: string[];
  heroBlockHeight: number;
  toolkitHeight: number;
  pages: MeasuredSummaryRow[][];
} {
  const sideMargin = 36;
  const contentWidth = A4_WIDTH_PT - sideMargin * 2;
  const headerBottomY = A4_HEIGHT_PT - 22 - 28; // ~791.89

  const summaryTitleLines = wrapText(
    'Your Personalised Course Shortlist',
    fonts.bold,
    21,
    contentWidth,
  );
  const heroTitleH = blockHeight(summaryTitleLines, 21, 3);
  // Title + "Prepared for ..." + stats bar + top/bottom spacing
  const heroBlockHeight = 14 + heroTitleH + 6 + 14 + 14 + 22 + 10;

  // Application toolkit block at bottom of last summary page:
  // Heading (16) + 2 rows (32 each) + gaps (16)
  const toolkitHeight = 18 + 32 + 8 + 32 + 12;

  // Measure each course row
  // Columns: [36pt logo] + gap(12) + [titleCol ~212pt] + gap(12) + [locationCol ~145pt] + gap(12) + [View course btn 92pt] = 521pt <= 523.28pt
  const titleColW = 208;
  const locationColW = 146;
  const measuredRows: MeasuredSummaryRow[] = courses.map((course, idx) => {
    const univLines = wrapText(course.university, fonts.bold, 10.25, titleColW);
    const courseLines = wrapText(
      course.programName,
      fonts.regular,
      9.25,
      titleColW,
    );
    const campusOrCountry =
      course.campus !== NOT_SPECIFIED
        ? course.campus
        : course.country !== NOT_SPECIFIED
          ? course.country
          : 'Campus not specified';
    const locationLines = wrapText(
      campusOrCountry,
      fonts.regular,
      8.75,
      locationColW - 14,
    );

    const middleH =
      blockHeight(univLines, 10.25, 1.8) +
      3 +
      blockHeight(courseLines, 9.25, 1.6);
    const locH = blockHeight(locationLines, 8.75, 1.6);
    const innerH = Math.max(36, middleH, locH);
    return {
      courseIndex: idx,
      course,
      univLines,
      courseLines,
      locationLines,
      rowHeight: innerH + 16,
    };
  });

  // Pack rows into summary pages cleanly
  const firstPageAvail = headerBottomY - heroBlockHeight - MIN_CONTENT_BOTTOM_Y;
  const nextPageAvail = headerBottomY - 28 - MIN_CONTENT_BOTTOM_Y;
  const pages: MeasuredSummaryRow[][] = [];
  let current: MeasuredSummaryRow[] = [];
  let used = 0;

  for (const row of measuredRows) {
    const avail = pages.length === 0 ? firstPageAvail : nextPageAvail;
    if (current.length > 0 && used + row.rowHeight > avail) {
      pages.push(current);
      current = [row];
      used = row.rowHeight;
    } else {
      current.push(row);
      used += row.rowHeight;
    }
  }
  if (current.length > 0 || pages.length === 0) {
    pages.push(current);
  }

  // Ensure the last summary page also fits the toolkit block cleanly above footer
  const lastIdx = pages.length - 1;
  const lastAvail = lastIdx === 0 ? firstPageAvail : nextPageAvail;
  const lastUsed = pages[lastIdx].reduce((sum, r) => sum + r.rowHeight, 0);
  if (lastUsed + toolkitHeight > lastAvail && pages[lastIdx].length > 1) {
    const moved = pages[lastIdx].pop()!;
    pages.push([moved]);
  }

  void studentName;
  return {
    summaryTitleLines,
    heroBlockHeight,
    toolkitHeight,
    pages,
  };
}

function formatDestinationSummary(courses: CourseRecord[]): string {
  const uniqueCountries: string[] = [];
  const seen = new Set<string>();
  for (const course of courses) {
    if (course.country === NOT_SPECIFIED) continue;
    const key = course.country.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueCountries.push(course.country.trim());
    }
  }
  if (uniqueCountries.length === 0) return 'Destination not specified';
  if (uniqueCountries.length <= 2) return uniqueCountries.join(', ');
  return `${uniqueCountries[0]} + ${uniqueCountries.length - 1} more`;
}

function renderSummaryPages(options: {
  pdfDoc: PDFDocument;
  summaryPages: PDFPage[];
  layout: ReturnType<typeof buildSummaryLayout>;
  courses: CourseRecord[];
  coursePages: PDFPage[];
  guideStartPage: PDFPage;
  checklistStartPage: PDFPage;
  studentName: string;
  fonts: EmbeddedFonts;
  embeddedBrandLogo: PDFImage | null;
  universityLogos: UniversityLogoMap;
  embeddedUniversityLogos: Map<string, PDFImage>;
  totalPages: number;
}): { courseSummaryPageMap: Map<number, PDFPage> } {
  const {
    pdfDoc,
    summaryPages,
    layout,
    courses,
    coursePages,
    guideStartPage,
    checklistStartPage,
    studentName,
    fonts,
    embeddedBrandLogo,
    universityLogos,
    embeddedUniversityLogos,
    totalPages,
  } = options;

  const sideMargin = 36;
  const contentWidth = A4_WIDTH_PT - sideMargin * 2;
  const uniqueUnivCount = new Set(courses.map((c) => c.universityKey)).size;
  const destinationLabel = formatDestinationSummary(courses);
  const courseSummaryPageMap = new Map<number, PDFPage>();

  summaryPages.forEach((page, pageIdx) => {
    const headerBottomY = drawMinimalPageHeader({
      page,
      sideMargin,
      topMargin: 22,
      headerHeight: 28,
      fonts,
      embeddedBrandLogo,
      rightLabel:
        summaryPages.length === 1
          ? 'PERSONALISED COURSE SHORTLIST'
          : `COURSE SHORTLIST (${pageIdx + 1}/${summaryPages.length})`,
      studentName,
      showPreparedBesideLogo: false,
    });

    let y = headerBottomY;

    if (pageIdx === 0) {
      y -= 14;
      drawLines(
        page,
        layout.summaryTitleLines,
        sideMargin,
        y,
        fonts.bold,
        21,
        3,
        COLORS.textPrimary,
      );
      y -= blockHeight(layout.summaryTitleLines, 21, 3) + 6;

      page.drawText(`Prepared for ${studentName}`, {
        x: sideMargin,
        y: y - 9.5,
        size: 11,
        font: fonts.regular,
        color: COLORS.textSecondary,
      });
      y -= 20;

      // Stats strip with Lucide vector icons
      const statsItems: { icon: PdfIconName; text: string }[] = [
        {
          icon: 'graduationCap',
          text: `${courses.length} ${courses.length === 1 ? 'course' : 'courses'}`,
        },
        {
          icon: 'landmark',
          text: `${uniqueUnivCount} ${uniqueUnivCount === 1 ? 'university' : 'universities'}`,
        },
        {
          icon: 'mapPin',
          text: destinationLabel,
        },
      ];

      let sx = sideMargin;
      const statTopY = y;
      statsItems.forEach((stat, idx) => {
        if (idx > 0) {
          page.drawLine({
            start: { x: sx, y: statTopY - 12 },
            end: { x: sx, y: statTopY - 1 },
            thickness: 0.7,
            color: COLORS.borderStrong,
          });
          sx += 12;
        }
        drawPdfIcon(page, stat.icon, sx, statTopY - 1, 11.5, COLORS.brandDark, 1.6);
        const txt = sanitizeLineForFont(fonts.medium, stat.text, 9.5);
        page.drawText(txt, {
          x: sx + 16,
          y: statTopY - 10,
          size: 9.5,
          font: fonts.medium,
          color: COLORS.textPrimary,
        });
        sx += 16 + measureWidth(fonts.medium, txt, 9.5) + 12;
      });
      y -= 24;

      page.drawLine({
        start: { x: sideMargin, y },
        end: { x: sideMargin + contentWidth, y },
        thickness: 0.9,
        color: COLORS.borderStrong,
      });
    } else {
      y -= 10;
      page.drawText('Shortlisted courses (continued)', {
        x: sideMargin,
        y: y - 9,
        size: 10,
        font: fonts.semiBold,
        color: COLORS.textSecondary,
      });
      y -= 18;
      page.drawLine({
        start: { x: sideMargin, y },
        end: { x: sideMargin + contentWidth, y },
        thickness: 0.75,
        color: COLORS.border,
      });
    }

    const rows = layout.pages[pageIdx];
    const titleX = sideMargin + 36 + 12;
    const locX = titleX + 208 + 12;
    const btnW = 92;
    const btnX = sideMargin + contentWidth - btnW;

    for (const row of rows) {
      courseSummaryPageMap.set(row.courseIndex, page);
      const rowTopY = y;
      const rowBottomY = y - row.rowHeight;
      const midY = (rowTopY + rowBottomY) / 2;

      const logoEntry: UniversityLogoEntry | undefined =
        universityLogos[row.course.universityKey];
      const embeddedImg = embeddedUniversityLogos.get(row.course.universityKey) ?? null;

      drawUniversityLogoFrame({
        page,
        x: sideMargin,
        topY: midY + 18,
        size: 36,
        pad: 4,
        embeddedImage: embeddedImg,
        initials:
          logoEntry?.initials ?? getUniversityInitials(row.course.university),
        fonts,
      });

      const titleBlockH =
        blockHeight(row.univLines, 10.25, 1.8) +
        3 +
        blockHeight(row.courseLines, 9.25, 1.6);
      const titleTopY = midY + titleBlockH / 2;
      drawLines(
        page,
        row.univLines,
        titleX,
        titleTopY,
        fonts.bold,
        10.25,
        1.8,
        COLORS.textPrimary,
      );
      drawLines(
        page,
        row.courseLines,
        titleX,
        titleTopY - blockHeight(row.univLines, 10.25, 1.8) - 3,
        fonts.regular,
        9.25,
        1.6,
        COLORS.textSecondary,
      );

      const locBlockH = blockHeight(row.locationLines, 8.75, 1.6);
      const locTopY = midY + locBlockH / 2;
      drawPdfIcon(page, 'mapPin', locX, locTopY - 0.5, 9.5, COLORS.textMuted, 1.6);
      drawLines(
        page,
        row.locationLines,
        locX + 13,
        locTopY,
        fonts.regular,
        8.75,
        1.6,
        COLORS.textSecondary,
      );

      // "View course ->" button with internal /GoTo link annotation
      const btnH = 22;
      const btnY = midY - btnH / 2;
      page.drawRectangle({
        x: btnX,
        y: btnY,
        width: btnW,
        height: btnH,
        color: COLORS.white,
        borderColor: COLORS.brandBorder,
        borderWidth: 0.85,
      });
      const viewLabel = 'View course';
      const labelW = measureWidth(fonts.semiBold, viewLabel, 8.75);
      page.drawText(viewLabel, {
        x: btnX + 11,
        y: btnY + 7.5,
        size: 8.75,
        font: fonts.semiBold,
        color: COLORS.textPrimary,
      });
      drawPdfIcon(
        page,
        'arrowRight',
        btnX + 11 + labelW + 5,
        btnY + 15.5,
        9.5,
        COLORS.brandDark,
        1.7,
      );
      addGoToLinkAnnotation(
        pdfDoc,
        page,
        [btnX, btnY, btnX + btnW, btnY + btnH],
        coursePages[row.courseIndex],
      );

      page.drawLine({
        start: { x: sideMargin, y: rowBottomY },
        end: { x: sideMargin + contentWidth, y: rowBottomY },
        thickness: 0.65,
        color: COLORS.border,
      });

      y = rowBottomY;
    }

    // Draw Application Toolkit on the last summary page
    if (pageIdx === summaryPages.length - 1) {
      y -= 16;
      page.drawText('Your Application Toolkit', {
        x: sideMargin,
        y: y - 10,
        size: 11.5,
        font: fonts.bold,
        color: COLORS.textPrimary,
      });
      y -= 20;

      const toolkitRows: {
        icon: PdfIconName;
        title: string;
        subtitle: string;
        targetPage: PDFPage;
      }[] = [
        {
          icon: 'fileText',
          title: 'UK Application Process',
          subtitle: '6-step admissions & Student visa guide',
          targetPage: guideStartPage,
        },
        {
          icon: 'squareCheck',
          title: 'Required Documents Checklist',
          subtitle: 'Interactive checklist to tick and save',
          targetPage: checklistStartPage,
        },
      ];

      for (const tool of toolkitRows) {
        const boxH = 30;
        const boxY = y - boxH;
        page.drawRectangle({
          x: sideMargin,
          y: boxY,
          width: contentWidth,
          height: boxH,
          color: COLORS.surfaceTint,
          borderColor: COLORS.borderStrong,
          borderWidth: 0.75,
        });

        drawPdfIcon(
          page,
          tool.icon,
          sideMargin + 12,
          boxY + 21,
          12,
          COLORS.brandDark,
          1.6,
        );
        page.drawText(tool.title, {
          x: sideMargin + 31,
          y: boxY + 11.5,
          size: 9.75,
          font: fonts.semiBold,
          color: COLORS.textPrimary,
        });
        const titleW = measureWidth(fonts.semiBold, tool.title, 9.75);
        page.drawText(`—  ${tool.subtitle}`, {
          x: sideMargin + 38 + titleW,
          y: boxY + 11.5,
          size: 8.75,
          font: fonts.regular,
          color: COLORS.textMuted,
        });
        drawPdfIcon(
          page,
          'arrowRight',
          sideMargin + contentWidth - 22,
          boxY + 20.5,
          11,
          COLORS.brandDark,
          1.7,
        );
        addGoToLinkAnnotation(
          pdfDoc,
          page,
          [sideMargin, boxY, sideMargin + contentWidth, boxY + boxH],
          tool.targetPage,
        );
        y = boxY - 7;
      }
    }

    drawStandardFooter({
      pdfDoc,
      page,
      fonts,
      sideMargin,
      pageNumber: pageIdx + 1,
      totalPages,
      studentName,
    });
  });

  return { courseSummaryPageMap };
}

// ============================================================================
// Course Pages (Strictly 1 Course per A4 Page, >= 9pt body text)
// ============================================================================

interface OverviewCell {
  icon: PdfIconName;
  label: string;
  lines: string[];
  height: number;
}

interface AcademicRowLayout {
  leftLines: string[];
  rightLines: string[] | null;
  rightAlign: boolean;
  rowHeight: number;
}

interface MeasuredCourseLayout {
  tier: LayoutTier;
  course: CourseRecord;
  contentWidth: number;
  univLines: string[];
  locationLines: string[];
  headerIdentHeight: number;
  programTitleLines: string[];
  programTitleHeight: number;
  overviewCells: OverviewCell[];
  overviewRowHeights: number[];
  tuitionDisplay: string;
  tuitionLines: string[];
  scholarshipLines: string[];
  feePanelHeight: number;
  academicRows: AcademicRowLayout[];
  academicTotalHeight: number;
  englishCols: { label: string; lines: string[]; isMissing: boolean }[];
  englishStripHeight: number;
  waiverCols: { label: string; lines: string[]; isMissing: boolean }[];
  waiverStripHeight: number;
  toolkitStripHeight: number;
  totalContentHeight: number;
  availableContentHeight: number;
  fitsOnSinglePage: boolean;
}

function splitEntryRequirementLine(line: string): {
  label: string;
  value: string;
} | null {
  const match = line.match(/^([^:\n]{2,56}):\s+(.+)$/);
  if (!match) return null;
  const left = match[1].trim();
  const right = match[2].trim();
  if (!left || !right || /^https?$/i.test(left)) return null;
  return { label: left, value: right };
}

function computeCourseLayoutForTier(
  course: CourseRecord,
  currency: CurrencyCode | null,
  fonts: EmbeddedFonts,
  tier: LayoutTier,
): MeasuredCourseLayout {
  const contentWidth = A4_WIDTH_PT - tier.sideMargin * 2;
  const topUsed =
    tier.topMargin + tier.headerHeight + tier.backStripHeight + 8;
  const availableContentHeight = A4_HEIGHT_PT - topUsed - tier.minContentY;

  // 1. University identity beside square logo frame
  const identTextW = contentWidth - tier.logoBoxSize - 14;
  const univLines = wrapText(
    course.university,
    fonts.bold,
    tier.universitySize,
    identTextW,
  );
  const locationText =
    course.campus !== NOT_SPECIFIED && course.country !== NOT_SPECIFIED
      ? `${course.campus}  /  ${course.country}`
      : course.campus !== NOT_SPECIFIED
        ? course.campus
        : course.country;
  const locationLines = wrapText(
    locationText,
    fonts.regular,
    tier.locationSize,
    identTextW - 14,
  );
  const identTextH =
    blockHeight(univLines, tier.universitySize, 1.8) +
    4 +
    blockHeight(locationLines, tier.locationSize, 1.6);
  const headerIdentHeight = Math.max(tier.logoBoxSize, identTextH);

  // 2. Program title
  const programTitleLines = wrapText(
    course.programName,
    fonts.bold,
    tier.programTitleSize,
    contentWidth,
  );
  const programTitleHeight = blockHeight(
    programTitleLines,
    tier.programTitleSize,
    2.4,
  );

  // 3. Overview 2-column grid (Study level, Duration, Open intake, optional Faculty)
  const overviewColGap = 16;
  const overviewColW = (contentWidth - overviewColGap) / 2;
  const overviewValueW = overviewColW - 22;

  const rawOverview: { icon: PdfIconName; label: string; value: string }[] = [
    { icon: 'graduationCap', label: 'Study level', value: course.studyLevel },
    { icon: 'clock', label: 'Duration', value: course.duration },
    { icon: 'calendar', label: 'Open intake', value: course.openIntake },
  ];
  if (course.faculty !== null) {
    rawOverview.push({
      icon: 'building',
      label: 'Faculty',
      value: course.faculty,
    });
  }

  const overviewCells: OverviewCell[] = rawOverview.map((item) => {
    const lines = wrapText(
      item.value,
      fonts.semiBold,
      tier.bodySize,
      overviewValueW,
    );
    const height =
      tier.labelSize + 3 + blockHeight(lines, tier.bodySize, tier.lineGap);
    return {
      icon: item.icon,
      label: item.label,
      lines,
      height,
    };
  });

  const overviewRowHeights: number[] = [];
  for (let i = 0; i < overviewCells.length; i += 2) {
    const left = overviewCells[i];
    const right = overviewCells[i + 1];
    overviewRowHeights.push(
      Math.max(left.height, right ? right.height : 0) + 6,
    );
  }
  const overviewSectionH =
    tier.sectionHeadingSize +
    7 +
    overviewRowHeights.reduce((sum, h) => sum + h, 0) +
    6;

  // 4. Fees section (two side-by-side subtle sage panels)
  const feeGap = 10;
  const tuitionBoxW = Math.round(contentWidth * 0.41);
  const scholarBoxW = contentWidth - tuitionBoxW - feeGap;
  const panelPadX = 10;
  const panelPadY = 8;

  const tuitionDisplay = formatTuitionFee(course.yearlyTuitionFee, currency);
  const tuitionIsText =
    course.yearlyTuitionFee.kind === 'text' && tuitionDisplay.length > 18;
  const tuitionSize = tuitionIsText ? tier.bodySize : tier.tuitionValueSize;
  const tuitionLines = wrapText(
    tuitionDisplay,
    fonts.bold,
    tuitionSize,
    tuitionBoxW - panelPadX * 2 - 26,
  );
  const scholarshipLines = wrapText(
    course.scholarshipAvailable,
    fonts.semiBold,
    tier.bodySize,
    scholarBoxW - panelPadX * 2 - 26,
  );

  const leftPanelInnerH =
    tier.labelSize +
    4 +
    blockHeight(tuitionLines, tuitionSize, tier.lineGap);
  const rightPanelInnerH =
    tier.labelSize +
    4 +
    blockHeight(scholarshipLines, tier.bodySize, tier.lineGap);
  const feePanelHeight =
    Math.max(leftPanelInnerH, rightPanelInnerH, 28) + panelPadY * 2;
  const feesSectionH = tier.sectionHeadingSize + 7 + feePanelHeight;

  // 5. Academic entry requirements
  const academicLinesSource =
    course.entryRequirementLines.length > 0
      ? course.entryRequirementLines
      : [NOT_SPECIFIED];

  const academicRows: AcademicRowLayout[] = academicLinesSource.map((line) => {
    const split = splitEntryRequirementLine(line);
    if (!split) {
      const wrapped = wrapText(
        line,
        fonts.regular,
        tier.tableTextSize,
        contentWidth - 8,
      );
      return {
        leftLines: wrapped,
        rightLines: null,
        rightAlign: false,
        rowHeight:
          blockHeight(wrapped, tier.tableTextSize, tier.lineGap) +
          tier.rowPadY * 2,
      };
    }

    const leftMaxW = contentWidth * 0.56;
    const rightMaxW = contentWidth * 0.4;
    const leftWrapped = wrapText(
      split.label,
      fonts.medium,
      tier.tableTextSize,
      leftMaxW,
    );
    const rightWrapped = wrapText(
      split.value,
      fonts.semiBold,
      tier.tableTextSize,
      rightMaxW,
    );
    const bodyH = Math.max(
      blockHeight(leftWrapped, tier.tableTextSize, tier.lineGap),
      blockHeight(rightWrapped, tier.tableTextSize, tier.lineGap),
    );
    return {
      leftLines: leftWrapped,
      rightLines: rightWrapped,
      rightAlign: rightWrapped.length === 1,
      rowHeight: bodyH + tier.rowPadY * 2,
    };
  });

  const academicTotalHeight =
    tier.sectionHeadingSize +
    7 +
    academicRows.reduce((sum, r) => sum + r.rowHeight, 0);

  // 6. English language requirements (Strictly IELTS, PTE, TOEFL, Duolingo)
  const englishColW = contentWidth / 4;
  const englishCols = course.englishTests.map((test) => {
    const isMissing = test.value === NOT_SPECIFIED;
    const valSize = isMissing || test.value.length > 10 ? 9.0 : 11.0;
    const lines = wrapText(
      test.value,
      isMissing ? fonts.regular : fonts.bold,
      valSize,
      englishColW - 14,
    );
    return {
      label: test.label,
      lines,
      isMissing,
    };
  });

  const englishMaxLinesH = Math.max(
    ...englishCols.map((col) =>
      blockHeight(col.lines, col.isMissing || col.lines.length > 1 ? 9.0 : 11.0, 1.5),
    ),
    11,
  );
  const englishStripHeight = 8 + 4 + englishMaxLinesH + 8;
  const englishSectionH = tier.sectionHeadingSize + 7 + englishStripHeight;

  // 7. Waiver criteria (CBSE / ICSE, UK qualification, State Board)
  const waiverColW = contentWidth / 3;
  const waiverCols = course.englishWaivers.map((waiver) => {
    const isMissing = waiver.value === NOT_SPECIFIED;
    const valSize = isMissing || waiver.value.length > 14 ? 9.0 : 10.5;
    const lines = wrapText(
      waiver.value,
      isMissing ? fonts.regular : fonts.bold,
      valSize,
      waiverColW - 14,
    );
    return {
      label: waiver.label,
      lines,
      isMissing,
    };
  });

  const waiverMaxLinesH = Math.max(
    ...waiverCols.map((col) =>
      blockHeight(col.lines, col.isMissing || col.lines.length > 1 ? 9.0 : 10.5, 1.5),
    ),
    10.5,
  );
  const waiverStripHeight = 8 + 4 + waiverMaxLinesH + 6;
  const waiverSectionH = tier.sectionHeadingSize + 6 + waiverStripHeight;

  const toolkitStripHeight = 23;

  const totalContentHeight =
    headerIdentHeight +
    8 +
    programTitleHeight +
    tier.sectionGap +
    overviewSectionH +
    tier.sectionGap +
    feesSectionH +
    tier.sectionGap +
    academicTotalHeight +
    tier.sectionGap +
    englishSectionH +
    tier.sectionGap +
    waiverSectionH +
    tier.sectionGap +
    toolkitStripHeight;

  return {
    tier,
    course,
    contentWidth,
    univLines,
    locationLines,
    headerIdentHeight,
    programTitleLines,
    programTitleHeight,
    overviewCells,
    overviewRowHeights,
    tuitionDisplay,
    tuitionLines,
    scholarshipLines,
    feePanelHeight,
    academicRows,
    academicTotalHeight,
    englishCols,
    englishStripHeight,
    waiverCols,
    waiverStripHeight,
    toolkitStripHeight,
    totalContentHeight,
    availableContentHeight,
    fitsOnSinglePage: totalContentHeight <= availableContentHeight,
  };
}

function selectBestLayoutForCourse(
  course: CourseRecord,
  currency: CurrencyCode | null,
  fonts: EmbeddedFonts,
):
  | { ok: true; layout: MeasuredCourseLayout }
  | { ok: false; tightest: MeasuredCourseLayout } {
  let tightest: MeasuredCourseLayout | null = null;
  for (const tier of LAYOUT_TIERS) {
    const measured = computeCourseLayoutForTier(course, currency, fonts, tier);
    tightest = measured;
    if (measured.fitsOnSinglePage) {
      return { ok: true, layout: measured };
    }
  }
  return { ok: false, tightest: tightest! };
}

function renderCoursePage(options: {
  pdfDoc: PDFDocument;
  page: PDFPage;
  layout: MeasuredCourseLayout;
  fonts: EmbeddedFonts;
  embeddedBrandLogo: PDFImage | null;
  universityLogos: UniversityLogoMap;
  embeddedUniversityLogos: Map<string, PDFImage>;
  studentName: string;
  courseIndex: number;
  totalCourses: number;
  pageNumber: number;
  totalPages: number;
  summaryPage: PDFPage;
  guideStartPage: PDFPage;
  checklistStartPage: PDFPage;
}): void {
  const {
    pdfDoc,
    page,
    layout,
    fonts,
    embeddedBrandLogo,
    universityLogos,
    embeddedUniversityLogos,
    studentName,
    courseIndex,
    totalCourses,
    pageNumber,
    totalPages,
    summaryPage,
    guideStartPage,
    checklistStartPage,
  } = options;

  const { tier, course, contentWidth } = layout;
  const sx = tier.sideMargin;
  const padNum = (n: number) =>
    totalCourses < 100 ? String(n).padStart(2, '0') : String(n);

  const headerBottomY = drawMinimalPageHeader({
    page,
    sideMargin: sx,
    topMargin: tier.topMargin,
    headerHeight: tier.headerHeight,
    fonts,
    embeddedBrandLogo,
    rightLabel: `COURSE ${padNum(courseIndex + 1)} / ${padNum(totalCourses)}`,
    studentName,
  });

  const stripBottomY = drawNavigationStrip({
    pdfDoc,
    page,
    sideMargin: sx,
    topY: headerBottomY,
    stripHeight: tier.backStripHeight,
    fonts,
    links: [
      {
        icon: 'arrowLeft',
        label: 'Back to shortlist',
        targetPage: summaryPage,
        emphasis: 'back',
      },
    ],
  });

  let y = stripBottomY - 8;

  // 1. Fixed square university logo frame + University & Location
  const logoEntry = universityLogos[course.universityKey];
  const embeddedUnivImg =
    embeddedUniversityLogos.get(course.universityKey) ?? null;

  drawUniversityLogoFrame({
    page,
    x: sx,
    topY: y,
    size: tier.logoBoxSize,
    pad: 5,
    embeddedImage: embeddedUnivImg,
    initials: logoEntry?.initials ?? getUniversityInitials(course.university),
    fonts,
  });

  const identTextX = sx + tier.logoBoxSize + 14;
  drawLines(
    page,
    layout.univLines,
    identTextX,
    y - 2,
    fonts.bold,
    tier.universitySize,
    1.8,
    COLORS.textPrimary,
  );
  const locTopY = y - 2 - blockHeight(layout.univLines, tier.universitySize, 1.8) - 4;
  drawPdfIcon(page, 'mapPin', identTextX, locTopY - 0.5, 10, COLORS.textMuted, 1.6);
  drawLines(
    page,
    layout.locationLines,
    identTextX + 14,
    locTopY,
    fonts.regular,
    tier.locationSize,
    1.6,
    COLORS.textSecondary,
  );

  y -= layout.headerIdentHeight + 8;

  // 2. Dominant Course Title
  drawLines(
    page,
    layout.programTitleLines,
    sx,
    y,
    fonts.bold,
    tier.programTitleSize,
    2.4,
    COLORS.textPrimary,
  );
  y -= layout.programTitleHeight + tier.sectionGap;

  // 3. Overview Section (Study level, Duration, Open intake, optional Faculty)
  page.drawText('Overview', {
    x: sx,
    y: y - tier.sectionHeadingSize * 0.85,
    size: tier.sectionHeadingSize,
    font: fonts.bold,
    color: COLORS.textPrimary,
  });
  y -= tier.sectionHeadingSize + 7;

  const overviewColGap = 16;
  const overviewColW = (contentWidth - overviewColGap) / 2;
  let rowIdx = 0;

  for (let i = 0; i < layout.overviewCells.length; i += 2) {
    const left = layout.overviewCells[i];
    const right = layout.overviewCells[i + 1];
    const rowH = layout.overviewRowHeights[rowIdx];

    const drawCell = (cell: OverviewCell, cx: number) => {
      drawPdfIcon(page, cell.icon, cx, y - 1, 13, COLORS.textSecondary, 1.5);
      page.drawText(cell.label, {
        x: cx + 20,
        y: y - tier.labelSize * 0.85,
        size: tier.labelSize,
        font: fonts.regular,
        color: COLORS.textMuted,
      });
      drawLines(
        page,
        cell.lines,
        cx + 20,
        y - tier.labelSize - 3,
        fonts.semiBold,
        tier.bodySize,
        tier.lineGap,
        COLORS.textPrimary,
      );
    };

    drawCell(left, sx);
    if (right) {
      const dividerX = sx + overviewColW + overviewColGap / 2;
      page.drawLine({
        start: { x: dividerX, y: y - 2 },
        end: { x: dividerX, y: y - rowH + 6 },
        thickness: 0.65,
        color: COLORS.border,
      });
      drawCell(right, sx + overviewColW + overviewColGap);
    }

    y -= rowH;
    rowIdx += 1;
  }

  y -= 2;
  page.drawLine({
    start: { x: sx, y },
    end: { x: sx + contentWidth, y },
    thickness: 0.65,
    color: COLORS.border,
  });
  y -= tier.sectionGap + 2;

  // 4. Fees Section (Two adjacent subtle sage panels)
  page.drawText('Fees', {
    x: sx,
    y: y - tier.sectionHeadingSize * 0.85,
    size: tier.sectionHeadingSize,
    font: fonts.bold,
    color: COLORS.textPrimary,
  });
  y -= tier.sectionHeadingSize + 7;

  const feeGap = 10;
  const tuitionBoxW = Math.round(contentWidth * 0.41);
  const scholarBoxW = contentWidth - tuitionBoxW - feeGap;
  const feeBoxBottomY = y - layout.feePanelHeight;

  // Left panel: Yearly tuition fee
  page.drawRectangle({
    x: sx,
    y: feeBoxBottomY,
    width: tuitionBoxW,
    height: layout.feePanelHeight,
    color: COLORS.brandSoft,
    borderColor: COLORS.border,
    borderWidth: 0.65,
  });
  drawPdfIcon(page, 'coins', sx + 10, y - 9, 14, COLORS.brandDark, 1.6);
  page.drawText('Yearly tuition fee', {
    x: sx + 32,
    y: y - 8 - tier.labelSize * 0.85,
    size: tier.labelSize,
    font: fonts.regular,
    color: COLORS.textSecondary,
  });
  const tuitionIsText =
    course.yearlyTuitionFee.kind === 'text' && layout.tuitionDisplay.length > 18;
  drawLines(
    page,
    layout.tuitionLines,
    sx + 32,
    y - 8 - tier.labelSize - 4,
    fonts.bold,
    tuitionIsText ? tier.bodySize : tier.tuitionValueSize,
    tier.lineGap,
    COLORS.textPrimary,
  );

  // Right panel: Scholarship available
  const schX = sx + tuitionBoxW + feeGap;
  page.drawRectangle({
    x: schX,
    y: feeBoxBottomY,
    width: scholarBoxW,
    height: layout.feePanelHeight,
    color: COLORS.brandSoft,
    borderColor: COLORS.border,
    borderWidth: 0.65,
  });
  drawPdfIcon(page, 'award', schX + 10, y - 9, 14, COLORS.brandDark, 1.6);
  page.drawText('Scholarship available', {
    x: schX + 32,
    y: y - 8 - tier.labelSize * 0.85,
    size: tier.labelSize,
    font: fonts.regular,
    color: COLORS.textSecondary,
  });
  drawLines(
    page,
    layout.scholarshipLines,
    schX + 32,
    y - 8 - tier.labelSize - 4,
    fonts.semiBold,
    tier.bodySize,
    tier.lineGap,
    course.scholarshipAvailable === NOT_SPECIFIED
      ? COLORS.textMuted
      : COLORS.textPrimary,
  );

  y = feeBoxBottomY - tier.sectionGap;

  // 5. Academic entry requirements (aligned hairline table rows)
  page.drawText('Academic entry requirements', {
    x: sx,
    y: y - tier.sectionHeadingSize * 0.85,
    size: tier.sectionHeadingSize,
    font: fonts.bold,
    color: COLORS.textPrimary,
  });
  y -= tier.sectionHeadingSize + 7;

  page.drawLine({
    start: { x: sx, y },
    end: { x: sx + contentWidth, y },
    thickness: 0.65,
    color: COLORS.border,
  });

  for (const row of layout.academicRows) {
    const rowTopY = y;
    const rowBottomY = y - row.rowHeight;
    drawLines(
      page,
      row.leftLines,
      sx + 4,
      rowTopY - tier.rowPadY,
      row.rightLines ? fonts.medium : fonts.regular,
      tier.tableTextSize,
      tier.lineGap,
      COLORS.textPrimary,
    );
    if (row.rightLines) {
      drawLines(
        page,
        row.rightLines,
        sx + contentWidth * 0.59,
        rowTopY - tier.rowPadY,
        fonts.semiBold,
        tier.tableTextSize,
        tier.lineGap,
        COLORS.textPrimary,
        row.rightAlign ? sx + contentWidth - 4 : undefined,
      );
    }
    page.drawLine({
      start: { x: sx, y: rowBottomY },
      end: { x: sx + contentWidth, y: rowBottomY },
      thickness: 0.55,
      color: COLORS.border,
    });
    y = rowBottomY;
  }

  y -= tier.sectionGap;

  // 6. English language requirements (Strictly IELTS, PTE, TOEFL, Duolingo)
  page.drawText('English language requirements', {
    x: sx,
    y: y - tier.sectionHeadingSize * 0.85,
    size: tier.sectionHeadingSize,
    font: fonts.bold,
    color: COLORS.textPrimary,
  });
  y -= tier.sectionHeadingSize + 7;

  const englishColW = contentWidth / 4;
  const engBottomY = y - layout.englishStripHeight;

  layout.englishCols.forEach((col, idx) => {
    const cx = sx + idx * englishColW;
    if (idx > 0) {
      page.drawLine({
        start: { x: cx, y: y - 2 },
        end: { x: cx, y: engBottomY + 4 },
        thickness: 0.65,
        color: COLORS.border,
      });
    }
    const labelW = measureWidth(fonts.semiBold, col.label, 8.0);
    page.drawText(col.label, {
      x: cx + (englishColW - labelW) / 2,
      y: y - 9,
      size: 8.0,
      font: fonts.semiBold,
      color: COLORS.textMuted,
    });

    const valSize = col.isMissing || col.lines.length > 1 ? 9.0 : 11.0;
    const valFont = col.isMissing ? fonts.regular : fonts.bold;
    col.lines.forEach((line, lIdx) => {
      const lw = measureWidth(valFont, line, valSize);
      page.drawText(line, {
        x: cx + (englishColW - lw) / 2,
        y: y - 23 - lIdx * (valSize + 1.5),
        size: valSize,
        font: valFont,
        color: col.isMissing ? COLORS.textMuted : COLORS.textPrimary,
      });
    });
  });

  y = engBottomY - tier.sectionGap;

  // 7. Waiver criteria (CBSE / ICSE, UK qualification, State Board)
  page.drawText('Waiver criteria', {
    x: sx,
    y: y - tier.sectionHeadingSize * 0.85,
    size: tier.sectionHeadingSize,
    font: fonts.bold,
    color: COLORS.textPrimary,
  });
  y -= tier.sectionHeadingSize + 6;

  const waiverColW = contentWidth / 3;
  const waiverBottomY = y - layout.waiverStripHeight;

  layout.waiverCols.forEach((col, idx) => {
    const cx = sx + idx * waiverColW;
    if (idx > 0) {
      page.drawLine({
        start: { x: cx, y: y - 2 },
        end: { x: cx, y: waiverBottomY + 4 },
        thickness: 0.65,
        color: COLORS.border,
      });
    }
    const labelW = measureWidth(fonts.medium, col.label, 8.25);
    page.drawText(col.label, {
      x: cx + (waiverColW - labelW) / 2,
      y: y - 9,
      size: 8.25,
      font: fonts.medium,
      color: COLORS.textMuted,
    });

    const valSize = col.isMissing || col.lines.length > 1 ? 9.0 : 10.5;
    const valFont = col.isMissing ? fonts.regular : fonts.bold;
    col.lines.forEach((line, lIdx) => {
      const lw = measureWidth(valFont, line, valSize);
      page.drawText(line, {
        x: cx + (waiverColW - lw) / 2,
        y: y - 22 - lIdx * (valSize + 1.5),
        size: valSize,
        font: valFont,
        color: col.isMissing ? COLORS.textMuted : COLORS.textPrimary,
      });
    });
  });

  y = waiverBottomY - tier.sectionGap;

  // 8. Quick Toolkit Internal Navigation Buttons
  const toolGap = 10;
  const toolW = (contentWidth - toolGap) / 2;
  const toolH = layout.toolkitStripHeight;
  const toolBottomY = y - toolH;

  const quickButtons: {
    x: number;
    icon: PdfIconName;
    label: string;
    targetPage: PDFPage;
  }[] = [
    {
      x: sx,
      icon: 'fileText',
      label: 'UK Application Process',
      targetPage: guideStartPage,
    },
    {
      x: sx + toolW + toolGap,
      icon: 'squareCheck',
      label: 'Documents Checklist',
      targetPage: checklistStartPage,
    },
  ];

  for (const btn of quickButtons) {
    page.drawRectangle({
      x: btn.x,
      y: toolBottomY,
      width: toolW,
      height: toolH,
      color: COLORS.white,
      borderColor: COLORS.brandBorder,
      borderWidth: 0.75,
    });
    drawPdfIcon(
      page,
      btn.icon,
      btn.x + 12,
      toolBottomY + 16.5,
      10.5,
      COLORS.brandDark,
      1.6,
    );
    page.drawText(btn.label, {
      x: btn.x + 28,
      y: toolBottomY + 8,
      size: 9.0,
      font: fonts.semiBold,
      color: COLORS.textPrimary,
    });
    drawPdfIcon(
      page,
      'arrowRight',
      btn.x + toolW - 22,
      toolBottomY + 16,
      10,
      COLORS.brandDark,
      1.7,
    );
    addGoToLinkAnnotation(
      pdfDoc,
      page,
      [btn.x, toolBottomY, btn.x + toolW, toolBottomY + toolH],
      btn.targetPage,
    );
  }

  drawStandardFooter({
    pdfDoc,
    page,
    fonts,
    sideMargin: sx,
    pageNumber,
    totalPages,
    websiteDisplay: course.websiteUrlDisplay,
    websiteHref: course.websiteHref,
  });
}

// ============================================================================
// UK Application Process Pages (Bundled Offline Guide)
// ============================================================================

interface MeasuredGuideStep {
  step: GuideStep;
  summaryLines: string[];
  bulletLines: string[][];
  cardHeight: number;
}

function measureGuideSteps(fonts: EmbeddedFonts): MeasuredGuideStep[] {
  const cardWidth = A4_WIDTH_PT - 36 * 2;
  const innerWidth = cardWidth - 52;

  return UK_APPLICATION_STEPS.map((step) => {
    const summaryLines = wrapText(step.summary, fonts.regular, 9.25, innerWidth);
    const bulletLines = step.details.map((b) =>
      wrapText(b, fonts.regular, 9.0, innerWidth - 12),
    );
    const bulletsH = bulletLines.reduce(
      (sum, lines) => sum + blockHeight(lines, 9.0, 1.8) + 3.5,
      0,
    );
    const cardHeight =
      10 +
      16 +
      blockHeight(summaryLines, 9.25, 2.0) +
      6 +
      bulletsH +
      8;
    return { step, summaryLines, bulletLines, cardHeight };
  });
}

function paginateGuideContent(fonts: EmbeddedFonts): {
  stepPages: MeasuredGuideStep[][];
  linksHeight: number;
} {
  const measuredSteps = measureGuideSteps(fonts);
  const sideMargin = 36;
  const contentWidth = A4_WIDTH_PT - sideMargin * 2;

  const introLines = wrapText(
    'This roadmap separates university admissions stages from UKVI Student visa requirements so you prepare the right evidence at each milestone.',
    fonts.regular,
    9.25,
    contentWidth,
  );
  const firstPageOverhead = 54 + 26 + blockHeight(introLines, 9.25, 2.0) + 14;
  const nextPageOverhead = 54 + 26 + 22;

  const stepPages: MeasuredGuideStep[][] = [];
  let current: MeasuredGuideStep[] = [];
  let used = 0;

  for (const ms of measuredSteps) {
    const avail =
      A4_HEIGHT_PT -
      (stepPages.length === 0 ? firstPageOverhead : nextPageOverhead) -
      MIN_CONTENT_BOTTOM_Y;
    if (current.length > 0 && used + ms.cardHeight + 9 > avail) {
      stepPages.push(current);
      current = [ms];
      used = ms.cardHeight;
    } else {
      current.push(ms);
      used += ms.cardHeight + (current.length > 1 ? 9 : 0);
    }
  }
  if (current.length > 0) stepPages.push(current);

  const linksHeight = 32 + OFFICIAL_GUIDANCE_LINKS.length * 29 + 14;
  const lastIdx = stepPages.length - 1;
  const lastAvail =
    A4_HEIGHT_PT -
    (lastIdx === 0 ? firstPageOverhead : nextPageOverhead) -
    MIN_CONTENT_BOTTOM_Y;
  const lastUsed = stepPages[lastIdx].reduce(
    (s, ms, idx) => s + ms.cardHeight + (idx > 0 ? 9 : 0),
    0,
  );

  if (lastUsed + 12 + linksHeight > lastAvail) {
    stepPages.push([]);
  }

  return { stepPages, linksHeight };
}

function renderGuidePages(options: {
  pdfDoc: PDFDocument;
  guidePages: PDFPage[];
  stepPages: MeasuredGuideStep[][];
  fonts: EmbeddedFonts;
  embeddedBrandLogo: PDFImage | null;
  studentName: string;
  startPageNumber: number;
  totalPages: number;
  shortlistPage: PDFPage;
  checklistStartPage: PDFPage;
}): void {
  const {
    pdfDoc,
    guidePages,
    stepPages,
    fonts,
    embeddedBrandLogo,
    studentName,
    startPageNumber,
    totalPages,
    shortlistPage,
    checklistStartPage,
  } = options;

  const sideMargin = 36;
  const contentWidth = A4_WIDTH_PT - sideMargin * 2;

  const introLines = wrapText(
    'This roadmap separates university admissions stages from UKVI Student visa requirements so you prepare the right evidence at each milestone.',
    fonts.regular,
    9.25,
    contentWidth,
  );

  guidePages.forEach((page, pIdx) => {
    const headerBottomY = drawMinimalPageHeader({
      page,
      sideMargin,
      topMargin: 22,
      headerHeight: 28,
      fonts,
      embeddedBrandLogo,
      rightLabel:
        guidePages.length === 1
          ? 'UK APPLICATION PROCESS'
          : `UK APPLICATION PROCESS (${pIdx + 1}/${guidePages.length})`,
      studentName,
    });

    let y = drawNavigationStrip({
      pdfDoc,
      page,
      sideMargin,
      topY: headerBottomY,
      stripHeight: 24,
      fonts,
      links: [
        {
          icon: 'arrowLeft',
          label: 'Back to shortlist',
          targetPage: shortlistPage,
          emphasis: 'back',
        },
        {
          icon: 'squareCheck',
          label: 'Required Documents Checklist',
          targetPage: checklistStartPage,
          emphasis: 'action',
        },
      ],
    });

    y -= 10;

    if (pIdx === 0) {
      page.drawText('UK Application Process', {
        x: sideMargin,
        y: y - 14,
        size: 16.5,
        font: fonts.bold,
        color: COLORS.textPrimary,
      });
      y -= 24;
      drawLines(
        page,
        introLines,
        sideMargin,
        y,
        fonts.regular,
        9.25,
        2.0,
        COLORS.textSecondary,
      );
      y -= blockHeight(introLines, 9.25, 2.0) + 12;
    } else {
      page.drawText('UK Application Process (continued)', {
        x: sideMargin,
        y: y - 11,
        size: 12.5,
        font: fonts.bold,
        color: COLORS.textPrimary,
      });
      y -= 22;
    }

    const steps = stepPages[pIdx] ?? [];
    for (const ms of steps) {
      const cardBottomY = y - ms.cardHeight;

      page.drawRectangle({
        x: sideMargin,
        y: cardBottomY,
        width: contentWidth,
        height: ms.cardHeight,
        color: COLORS.white,
        borderColor: COLORS.border,
        borderWidth: 0.75,
      });

      // Step number badge
      const badgeSize = 22;
      const badgeX = sideMargin + 12;
      const badgeY = y - 10 - badgeSize;
      page.drawRectangle({
        x: badgeX,
        y: badgeY,
        width: badgeSize,
        height: badgeSize,
        color: COLORS.brandSoft,
        borderColor: COLORS.brandBorder,
        borderWidth: 0.75,
      });
      const numLabel = String(ms.step.number).padStart(2, '0');
      const numW = measureWidth(fonts.bold, numLabel, 9.5);
      page.drawText(numLabel, {
        x: badgeX + (badgeSize - numW) / 2,
        y: badgeY + 7.5,
        size: 9.5,
        font: fonts.bold,
        color: COLORS.brandDark,
      });

      const innerX = sideMargin + 44;
      page.drawText(ms.step.title, {
        x: innerX,
        y: y - 19,
        size: 11,
        font: fonts.bold,
        color: COLORS.textPrimary,
      });

      const isVisa = ms.step.scope === 'UK Student Visa (UKVI)';
      const catLabel = ms.step.scope;
      const catW = measureWidth(fonts.semiBold, catLabel, 7.75) + 14;
      const catX = sideMargin + contentWidth - catW - 12;
      const catY = y - 22;
      page.drawRectangle({
        x: catX,
        y: catY,
        width: catW,
        height: 14,
        color: isVisa ? COLORS.surfaceAlt : COLORS.brandSoft,
        borderColor: isVisa ? COLORS.borderStrong : COLORS.brandBorder,
        borderWidth: 0.6,
      });
      page.drawText(catLabel, {
        x: catX + 7,
        y: catY + 4,
        size: 7.75,
        font: fonts.semiBold,
        color: isVisa ? COLORS.textSecondary : COLORS.brandDark,
      });

      let ty = y - 29;
      drawLines(
        page,
        ms.summaryLines,
        innerX,
        ty,
        fonts.regular,
        9.25,
        2.0,
        COLORS.textSecondary,
      );
      ty -= blockHeight(ms.summaryLines, 9.25, 2.0) + 6;

      for (const bLines of ms.bulletLines) {
        page.drawRectangle({
          x: innerX + 2,
          y: ty - 5.5,
          width: 3,
          height: 3,
          color: COLORS.brandPrimary,
        });
        drawLines(
          page,
          bLines,
          innerX + 10,
          ty,
          fonts.regular,
          9.0,
          1.8,
          COLORS.textPrimary,
        );
        ty -= blockHeight(bLines, 9.0, 1.8) + 3.5;
      }

      y = cardBottomY - 9;
    }

    // Official Sources block on final Guide page
    if (pIdx === guidePages.length - 1) {
      y -= 4;
      const boxH = 32 + OFFICIAL_GUIDANCE_LINKS.length * 29 + 12;
      const boxBottomY = y - boxH;
      page.drawRectangle({
        x: sideMargin,
        y: boxBottomY,
        width: contentWidth,
        height: boxH,
        color: COLORS.surfaceTint,
        borderColor: COLORS.brandBorder,
        borderWidth: 0.75,
      });

      page.drawText('Official UK Guidance Sources', {
        x: sideMargin + 12,
        y: y - 16,
        size: 10.5,
        font: fonts.bold,
        color: COLORS.textPrimary,
      });
      const checkedNote = `Guidance checked on ${GUIDANCE_CHECKED_DATE}`;
      const checkedW = measureWidth(fonts.medium, checkedNote, 8.0);
      page.drawText(checkedNote, {
        x: sideMargin + contentWidth - checkedW - 12,
        y: y - 16,
        size: 8.0,
        font: fonts.medium,
        color: COLORS.textMuted,
      });

      let ly = y - 34;
      for (const link of OFFICIAL_GUIDANCE_LINKS) {
        page.drawText(link.label, {
          x: sideMargin + 12,
          y: ly - 2,
          size: 8.75,
          font: fonts.semiBold,
          color: COLORS.textPrimary,
        });
        const urlX = sideMargin + 12;
        const urlY = ly - 14;
        const urlShown =
          measureWidth(fonts.regular, link.url, 8.0) <= contentWidth - 40
            ? link.url
            : (wrapText(link.url, fonts.regular, 8.0, contentWidth - 40)[0] ??
              link.url);
        page.drawText(urlShown, {
          x: urlX,
          y: urlY,
          size: 8.0,
          font: fonts.regular,
          color: COLORS.brandDark,
        });
        const urlW = measureWidth(fonts.regular, urlShown, 8.0);
        page.drawLine({
          start: { x: urlX, y: urlY - 1.5 },
          end: { x: urlX + urlW, y: urlY - 1.5 },
          thickness: 0.6,
          color: COLORS.brandPrimary,
        });
        drawPdfIcon(
          page,
          'externalLink',
          urlX + urlW + 4,
          urlY + 7.5,
          8.25,
          COLORS.brandDark,
          1.6,
        );
        addUriLinkAnnotation(
          pdfDoc,
          page,
          [urlX, urlY - 3, urlX + urlW + 15, urlY + 10],
          link.url,
        );
        ly -= 29;
      }
    }

    drawStandardFooter({
      pdfDoc,
      page,
      fonts,
      sideMargin,
      pageNumber: startPageNumber + pIdx,
      totalPages,
      studentName,
    });
  });
}

// ============================================================================
// Required Documents Checklist Pages (Interactive AcroForm Checkboxes)
// ============================================================================

interface MeasuredChecklistGroup {
  group: ChecklistGroup;
  noteLines: string[];
  items: {
    item: ChecklistGroup['items'][number];
    labelLines: string[];
    conditionLines: string[];
    rowHeight: number;
  }[];
  totalHeight: number;
}

function measureChecklistGroups(
  fonts: EmbeddedFonts,
): MeasuredChecklistGroup[] {
  const sideMargin = 36;
  const contentWidth = A4_WIDTH_PT - sideMargin * 2;
  const itemTextW = contentWidth - 150;

  return DOCUMENT_CHECKLIST_GROUPS.map((group) => {
    const noteLines = wrapText(
      group.circumstanceNote,
      fonts.regular,
      8.75,
      contentWidth - 20,
    );
    const headerH = 22 + blockHeight(noteLines, 8.75, 1.8) + 8;

    const items = group.items.map((item) => {
      const labelLines = wrapText(item.label, fonts.semiBold, 9.25, itemTextW);
      const conditionLines = wrapText(
        item.note,
        fonts.regular,
        8.25,
        itemTextW,
      );
      const rowHeight =
        6 +
        blockHeight(labelLines, 9.25, 1.8) +
        3 +
        blockHeight(conditionLines, 8.25, 1.6) +
        7;
      return { item, labelLines, conditionLines, rowHeight };
    });

    const totalHeight =
      headerH + items.reduce((sum, it) => sum + it.rowHeight, 0);
    return { group, noteLines, items, totalHeight };
  });
}

function paginateChecklistContent(fonts: EmbeddedFonts): {
  pages: MeasuredChecklistGroup[][];
} {
  const groups = measureChecklistGroups(fonts);
  const firstPageAvail = A4_HEIGHT_PT - 148 - MIN_CONTENT_BOTTOM_Y;
  const nextPageAvail = A4_HEIGHT_PT - 104 - MIN_CONTENT_BOTTOM_Y;

  const pages: MeasuredChecklistGroup[][] = [];
  let current: MeasuredChecklistGroup[] = [];
  let used = 0;

  for (const grp of groups) {
    const avail = pages.length === 0 ? firstPageAvail : nextPageAvail;
    if (current.length > 0 && used + grp.totalHeight + 12 > avail) {
      pages.push(current);
      current = [grp];
      used = grp.totalHeight;
    } else {
      current.push(grp);
      used += grp.totalHeight + (current.length > 1 ? 12 : 0);
    }
  }
  if (current.length > 0) pages.push(current);

  return { pages };
}

function renderChecklistPages(options: {
  pdfDoc: PDFDocument;
  checklistPages: PDFPage[];
  groupPages: MeasuredChecklistGroup[][];
  checklistSelections: ChecklistSelections;
  fonts: EmbeddedFonts;
  embeddedBrandLogo: PDFImage | null;
  studentName: string;
  startPageNumber: number;
  totalPages: number;
  shortlistPage: PDFPage;
  guideStartPage: PDFPage;
}): void {
  const {
    pdfDoc,
    checklistPages,
    groupPages,
    checklistSelections,
    fonts,
    embeddedBrandLogo,
    studentName,
    startPageNumber,
    totalPages,
    shortlistPage,
    guideStartPage,
  } = options;

  const sideMargin = 36;
  const contentWidth = A4_WIDTH_PT - sideMargin * 2;
  const form = pdfDoc.getForm();
  const instructionLines = wrapText(
    CHECKLIST_READER_INSTRUCTION,
    fonts.regular,
    8.75,
    contentWidth - 24,
  );

  checklistPages.forEach((page, pIdx) => {
    const headerBottomY = drawMinimalPageHeader({
      page,
      sideMargin,
      topMargin: 22,
      headerHeight: 28,
      fonts,
      embeddedBrandLogo,
      rightLabel:
        checklistPages.length === 1
          ? 'REQUIRED DOCUMENTS CHECKLIST'
          : `DOCUMENTS CHECKLIST (${pIdx + 1}/${checklistPages.length})`,
      studentName,
    });

    let y = drawNavigationStrip({
      pdfDoc,
      page,
      sideMargin,
      topY: headerBottomY,
      stripHeight: 24,
      fonts,
      links: [
        {
          icon: 'arrowLeft',
          label: 'Back to shortlist',
          targetPage: shortlistPage,
          emphasis: 'back',
        },
        {
          icon: 'fileText',
          label: 'UK Application Process',
          targetPage: guideStartPage,
          emphasis: 'action',
        },
      ],
    });

    y -= 10;

    if (pIdx === 0) {
      page.drawText('Required Documents Checklist', {
        x: sideMargin,
        y: y - 14,
        size: 16.5,
        font: fonts.bold,
        color: COLORS.textPrimary,
      });
      y -= 24;

      const boxH = blockHeight(instructionLines, 8.75, 1.8) + 14;
      const boxBottomY = y - boxH;
      page.drawRectangle({
        x: sideMargin,
        y: boxBottomY,
        width: contentWidth,
        height: boxH,
        color: COLORS.brandSoft,
        borderColor: COLORS.brandBorder,
        borderWidth: 0.75,
      });
      drawLines(
        page,
        instructionLines,
        sideMargin + 12,
        y - 7,
        fonts.regular,
        8.75,
        1.8,
        COLORS.brandDark,
      );
      y = boxBottomY - 12;
    } else {
      page.drawText('Required Documents Checklist (continued)', {
        x: sideMargin,
        y: y - 11,
        size: 12.5,
        font: fonts.bold,
        color: COLORS.textPrimary,
      });
      y -= 22;
    }

    const groups = groupPages[pIdx] ?? [];
    for (const grp of groups) {
      const boxBottomY = y - grp.totalHeight;

      page.drawRectangle({
        x: sideMargin,
        y: boxBottomY,
        width: contentWidth,
        height: grp.totalHeight,
        color: COLORS.white,
        borderColor: COLORS.borderStrong,
        borderWidth: 0.75,
      });

      const headerH = 22 + blockHeight(grp.noteLines, 8.75, 1.8) + 8;
      page.drawRectangle({
        x: sideMargin + 0.5,
        y: y - headerH,
        width: contentWidth - 1,
        height: headerH - 0.5,
        color: COLORS.surfaceTint,
      });
      page.drawText(grp.group.title, {
        x: sideMargin + 12,
        y: y - 15,
        size: 10.5,
        font: fonts.bold,
        color: COLORS.textPrimary,
      });
      drawLines(
        page,
        grp.noteLines,
        sideMargin + 12,
        y - 22,
        fonts.regular,
        8.75,
        1.8,
        COLORS.textSecondary,
      );

      let rowTopY = y - headerH;
      for (const entry of grp.items) {
        page.drawLine({
          start: { x: sideMargin, y: rowTopY },
          end: { x: sideMargin + contentWidth, y: rowTopY },
          thickness: 0.55,
          color: COLORS.border,
        });

        const boxSize = 13;
        const boxX = sideMargin + 12;
        const boxY = rowTopY - 6 - boxSize + 1;
        const accessibleLabel = `${grp.group.title}: ${entry.item.label} (${entry.item.status})`;

        const checkBox = form.createCheckBox(entry.item.fieldName);
        checkBox.addToPage(page, {
          x: boxX,
          y: boxY,
          width: boxSize,
          height: boxSize,
          borderWidth: 1.1,
          borderColor: COLORS.brandPrimary,
          backgroundColor: COLORS.white,
          textColor: COLORS.brandDark,
        });

        checkBox.acroField.dict.set(
          PDFName.of('TU'),
          PDFString.of(accessibleLabel),
        );
        for (const widget of checkBox.acroField.getWidgets()) {
          widget.dict.set(PDFName.of('TU'), PDFString.of(accessibleLabel));
        }

        if (checklistSelections[entry.item.fieldName]) {
          checkBox.check();
        } else {
          checkBox.uncheck();
        }

        const textX = sideMargin + 34;
        drawLines(
          page,
          entry.labelLines,
          textX,
          rowTopY - 6,
          fonts.semiBold,
          9.25,
          1.8,
          COLORS.textPrimary,
        );
        drawLines(
          page,
          entry.conditionLines,
          textX,
          rowTopY - 6 - blockHeight(entry.labelLines, 9.25, 1.8) - 3,
          fonts.regular,
          8.25,
          1.6,
          COLORS.textMuted,
        );

        const isGeneral = entry.item.status === 'Generally required';
        const pillW = 86;
        const pillH = 14.5;
        const pillX = sideMargin + contentWidth - pillW - 10;
        const pillY = rowTopY - 19;

        page.drawRectangle({
          x: pillX,
          y: pillY,
          width: pillW,
          height: pillH,
          color: isGeneral ? COLORS.brandSoft : COLORS.surfaceAlt,
          borderColor: isGeneral ? COLORS.brandBorder : COLORS.borderStrong,
          borderWidth: 0.6,
        });
        const stW = measureWidth(fonts.semiBold, entry.item.status, 7.6);
        page.drawText(entry.item.status, {
          x: pillX + (pillW - stW) / 2,
          y: pillY + 4.3,
          size: 7.6,
          font: fonts.semiBold,
          color: isGeneral ? COLORS.brandDark : COLORS.textSecondary,
        });

        rowTopY -= entry.rowHeight;
      }

      y = boxBottomY - 12;
    }

    drawStandardFooter({
      pdfDoc,
      page,
      fonts,
      sideMargin,
      pageNumber: startPageNumber + pIdx,
      totalPages,
      studentName,
    });
  });

  form.updateFieldAppearances(fonts.regular);
}

// ============================================================================
// Public PDF Generator Entry Point
// ============================================================================

export interface GeneratePdfOptions {
  courses: CourseRecord[];
  currency: CurrencyCode | null;
  studentName: string;
  checklistSelections?: ChecklistSelections;
  universityLogos?: UniversityLogoMap;
  logo?: InMemoryLogo | null;
  fontBytes?: FontBytesBundle;
}

async function embedImageSafely(
  pdfDoc: PDFDocument,
  image: { bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' },
): Promise<PDFImage | null> {
  try {
    return image.mimeType === 'image/png'
      ? await pdfDoc.embedPng(image.bytes)
      : await pdfDoc.embedJpg(image.bytes);
  } catch {
    return null;
  }
}

/**
 * Generates the branded Eccho Overseas PDF in strict order:
 * 1. Personalised summary (Page 1, or 1..S for large imports)
 * 2. Individual course pages (exactly one course per A4 page)
 * 3. UK Application Process (bundled 6-step guide)
 * 4. Required Documents Checklist (interactive AcroForm checkboxes)
 */
export async function generateCourseShortlistPdf(
  options: GeneratePdfOptions,
): Promise<PdfGenerationResult> {
  const {
    courses,
    currency,
    studentName,
    checklistSelections = {},
    universityLogos = {},
    logo = null,
    fontBytes,
  } = options;

  const trimmedStudentName = studentName.trim();
  if (!trimmedStudentName) {
    return {
      ok: false,
      failures: [],
      message: 'Student Name is required before generating the personalised PDF.',
    };
  }

  if (courses.length === 0) {
    return {
      ok: false,
      failures: [],
      message: 'No valid courses are available to generate a PDF.',
    };
  }

  const resolvedFontBytes = fontBytes ?? (await loadBrowserFontBytes());

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  pdfDoc.setTitle(
    `${BRAND_CONFIG.brandName} — ${BRAND_CONFIG.documentTitle} (${trimmedStudentName})`,
  );
  pdfDoc.setCreator(BRAND_CONFIG.brandName);
  pdfDoc.setProducer(BRAND_CONFIG.brandName);

  const [regular, medium, semiBold, bold] = await Promise.all([
    pdfDoc.embedFont(resolvedFontBytes.regular, { subset: true }),
    pdfDoc.embedFont(resolvedFontBytes.medium, { subset: true }),
    pdfDoc.embedFont(resolvedFontBytes.semiBold, { subset: true }),
    pdfDoc.embedFont(resolvedFontBytes.bold, { subset: true }),
  ]);
  const fonts: EmbeddedFonts = { regular, medium, semiBold, bold };

  // Validate single-page A4 fit for every course before drawing
  const courseLayouts: MeasuredCourseLayout[] = [];
  const failures: PageFitFailure[] = [];

  courses.forEach((course, idx) => {
    const decision = selectBestLayoutForCourse(course, currency, fonts);
    if (decision.ok) {
      courseLayouts.push(decision.layout);
    } else {
      failures.push({
        courseNumber: idx + 1,
        rowNumber: course.rowNumber,
        programName: course.programName,
        university: course.university,
        requiredHeightPt: Math.ceil(decision.tightest.totalContentHeight),
        availableHeightPt: Math.floor(decision.tightest.availableContentHeight),
      });
    }
  });

  if (failures.length > 0) {
    const summary = failures
      .map(
        (f) =>
          `Course #${f.courseNumber} (Excel row ${f.rowNumber}: "${f.programName}" at ${f.university}) requires ~${f.requiredHeightPt} pt but only ${f.availableHeightPt} pt is available above the footer at the minimum 9 pt body text size`,
      )
      .join('; ');
    return {
      ok: false,
      failures,
      message: `Single-page A4 fit failed and export is blocked: ${summary}. Shorten the oversized source field(s) and re-upload.`,
    };
  }

  // Embed Eccho Overseas logo
  let embeddedBrandLogo: PDFImage | null = null;
  const brandLogoSource = logo ?? (await loadDefaultBrandLogo());
  if (brandLogoSource) {
    embeddedBrandLogo = await embedImageSafely(pdfDoc, brandLogoSource);
  }

  // Embed each unique university logo once
  const embeddedUniversityLogos = new Map<string, PDFImage>();
  for (const [key, entry] of Object.entries(universityLogos)) {
    if (!entry.logo) continue;
    const embedded = await embedImageSafely(pdfDoc, entry.logo);
    if (embedded) {
      embeddedUniversityLogos.set(key, embedded);
    }
  }

  const summaryLayout = buildSummaryLayout(courses, trimmedStudentName, fonts);
  const guidePlan = paginateGuideContent(fonts);
  const checklistPlan = paginateChecklistContent(fonts);

  const summaryPageCount = summaryLayout.pages.length;
  const coursePageCount = courses.length;
  const guidePageCount = guidePlan.stepPages.length;
  const checklistPageCount = checklistPlan.pages.length;

  const courseStartPageNum = summaryPageCount + 1;
  const guideStartPageNum = courseStartPageNum + coursePageCount;
  const checklistStartPageNum = guideStartPageNum + guidePageCount;
  const totalPages = checklistStartPageNum + checklistPageCount - 1;

  // Allocate all pages upfront so /GoTo annotations can reference exact targets
  const summaryPages = Array.from({ length: summaryPageCount }, () =>
    pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]),
  );
  const coursePages = Array.from({ length: coursePageCount }, () =>
    pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]),
  );
  const guidePages = Array.from({ length: guidePageCount }, () =>
    pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]),
  );
  const checklistPages = Array.from({ length: checklistPageCount }, () =>
    pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]),
  );

  const guideStartPage = guidePages[0];
  const checklistStartPage = checklistPages[0];

  const { courseSummaryPageMap } = renderSummaryPages({
    pdfDoc,
    summaryPages,
    layout: summaryLayout,
    courses,
    coursePages,
    guideStartPage,
    checklistStartPage,
    studentName: trimmedStudentName,
    fonts,
    embeddedBrandLogo,
    universityLogos,
    embeddedUniversityLogos,
    totalPages,
  });

  courseLayouts.forEach((layout, idx) => {
    renderCoursePage({
      pdfDoc,
      page: coursePages[idx],
      layout,
      fonts,
      embeddedBrandLogo,
      universityLogos,
      embeddedUniversityLogos,
      studentName: trimmedStudentName,
      courseIndex: idx,
      totalCourses: coursePageCount,
      pageNumber: courseStartPageNum + idx,
      totalPages,
      summaryPage: courseSummaryPageMap.get(idx) ?? summaryPages[0],
      guideStartPage,
      checklistStartPage,
    });
  });

  renderGuidePages({
    pdfDoc,
    guidePages,
    stepPages: guidePlan.stepPages,
    fonts,
    embeddedBrandLogo,
    studentName: trimmedStudentName,
    startPageNumber: guideStartPageNum,
    totalPages,
    shortlistPage: summaryPages[0],
    checklistStartPage,
  });

  renderChecklistPages({
    pdfDoc,
    checklistPages,
    groupPages: checklistPlan.pages,
    checklistSelections,
    fonts,
    embeddedBrandLogo,
    studentName: trimmedStudentName,
    startPageNumber: checklistStartPageNum,
    totalPages,
    shortlistPage: summaryPages[0],
    guideStartPage,
  });

  const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
  return {
    ok: true,
    pdfBytes,
    pageCount: totalPages,
    summaryPageCount,
    courseStartPage: courseStartPageNum,
    coursePageCount,
    guideStartPage: guideStartPageNum,
    checklistStartPage: checklistStartPageNum,
    tiersUsed: courseLayouts.map((l) => l.tier.name),
  };
}
