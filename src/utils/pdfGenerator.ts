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
import { BRAND_CONFIG, getNonEmptyContactEntries } from '../config/brand';
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
} from '../types/course';
import { NOT_SPECIFIED, formatTuitionFee } from './valueFormatting';

// A4 portrait dimensions in PDF points (210mm x 297mm)
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;

// Fixed footer band strictly outside content area
const FOOTER_BOTTOM_PAD = 18;
const FOOTER_RULE_Y = 58;
const CONTENT_FOOTER_GAP = 10;
const MIN_CONTENT_BOTTOM_Y = FOOTER_RULE_Y + CONTENT_FOOTER_GAP; // 68 pt from bottom

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
  navStripHeight: number;
  programTitleSize: number;
  universitySize: number;
  locationSize: number;
  sectionHeaderSize: number;
  labelSize: number;
  bodySize: number; // Strictly >= 9.0 pt
  tableTextSize: number; // Strictly >= 9.0 pt
  tuitionValueSize: number;
  sectionGap: number;
  cardPadX: number;
  cardPadY: number;
  lineGap: number;
  tableRowHeight: number;
  twoColumnAcademic: boolean;
}

const LAYOUT_TIERS: LayoutTier[] = [
  {
    name: 'comfortable',
    topMargin: 20,
    sideMargin: 34,
    minContentY: MIN_CONTENT_BOTTOM_Y,
    headerHeight: 46,
    navStripHeight: 20,
    programTitleSize: 15.5,
    universitySize: 10.75,
    locationSize: 9.25,
    sectionHeaderSize: 9.25,
    labelSize: 8.5,
    bodySize: 9.25,
    tableTextSize: 9.0,
    tuitionValueSize: 13.5,
    sectionGap: 8.5,
    cardPadX: 10,
    cardPadY: 6.5,
    lineGap: 2.8,
    tableRowHeight: 17,
    twoColumnAcademic: false,
  },
  {
    name: 'compact-spacing',
    topMargin: 18,
    sideMargin: 30,
    minContentY: MIN_CONTENT_BOTTOM_Y,
    headerHeight: 44,
    navStripHeight: 19,
    programTitleSize: 14.5,
    universitySize: 10.25,
    locationSize: 9.0,
    sectionHeaderSize: 9.0,
    labelSize: 8.25,
    bodySize: 9.0,
    tableTextSize: 9.0,
    tuitionValueSize: 13,
    sectionGap: 6.5,
    cardPadX: 8.5,
    cardPadY: 5.5,
    lineGap: 2.3,
    tableRowHeight: 16,
    twoColumnAcademic: false,
  },
  {
    name: 'compact-two-column',
    topMargin: 16,
    sideMargin: 28,
    minContentY: MIN_CONTENT_BOTTOM_Y,
    headerHeight: 42,
    navStripHeight: 18,
    programTitleSize: 14,
    universitySize: 10.0,
    locationSize: 9.0,
    sectionHeaderSize: 9.0,
    labelSize: 8.0,
    bodySize: 9.0,
    tableTextSize: 9.0,
    tuitionValueSize: 12.5,
    sectionGap: 5.5,
    cardPadX: 7.5,
    cardPadY: 4.5,
    lineGap: 2.0,
    tableRowHeight: 15,
    twoColumnAcademic: true,
  },
  {
    name: 'tight-minimum-9pt',
    topMargin: 15,
    sideMargin: 24,
    minContentY: MIN_CONTENT_BOTTOM_Y,
    headerHeight: 40,
    navStripHeight: 18,
    programTitleSize: 13.25,
    universitySize: 9.75,
    locationSize: 9.0,
    sectionHeaderSize: 9.0,
    labelSize: 8.0,
    bodySize: 9.0,
    tableTextSize: 9.0,
    tuitionValueSize: 12.0,
    sectionGap: 4.5,
    cardPadX: 6.5,
    cardPadY: 4,
    lineGap: 1.7,
    tableRowHeight: 14.5,
    twoColumnAcademic: true,
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
  slateBadgeBg: rgb(0.937, 0.953, 0.941),
};

function cleanControlChars(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\uFEFF]/g, '');
}

function measureWidth(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    let safe = '';
    for (const ch of text) {
      try {
        font.widthOfTextAtSize(ch, size);
        safe += ch;
      } catch {
        safe += '?';
      }
    }
    return font.widthOfTextAtSize(safe, size);
  }
}

function makeEncodable(font: PDFFont, text: string, size: number): string {
  const cleaned = cleanControlChars(text);
  try {
    font.widthOfTextAtSize(cleaned, size);
    return cleaned;
  } catch {
    let safe = '';
    for (const ch of cleaned) {
      try {
        font.widthOfTextAtSize(ch, size);
        safe += ch;
      } catch {
        safe += '?';
      }
    }
    return safe;
  }
}

function wrapText(
  rawText: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  const safeText = makeEncodable(font, rawText, fontSize);
  const paragraphs = safeText.split(/\r?\n/);
  const lines: string[] = [];

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (trimmedPara.length === 0) {
      lines.push('');
      continue;
    }

    const words = trimmedPara.split(/\s+/);
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measureWidth(font, candidate, fontSize) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
        current = '';
      }

      if (measureWidth(font, word, fontSize) <= maxWidth) {
        current = word;
      } else {
        let chunk = '';
        for (const ch of word) {
          const nextChunk = chunk + ch;
          if (measureWidth(font, nextChunk, fontSize) <= maxWidth) {
            chunk = nextChunk;
          } else {
            if (chunk) lines.push(chunk);
            chunk = ch;
          }
        }
        current = chunk;
      }
    }

    if (current) {
      lines.push(current);
    }
  }

  return lines.length > 0 ? lines : [''];
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
): void {
  const step = fontSize + lineGap;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length === 0) continue;
    const baselineY = topY - fontSize * 0.82 - i * step;
    page.drawText(line, {
      x,
      y: baselineY,
      size: fontSize,
      font,
      color,
    });
  }
}

function drawSectionHeading(
  page: PDFPage,
  title: string,
  x: number,
  topY: number,
  width: number,
  font: PDFFont,
  fontSize: number,
): number {
  const barH = fontSize + 1;
  page.drawRectangle({
    x,
    y: topY - barH,
    width: 3,
    height: barH,
    color: COLORS.brandPrimary,
  });

  page.drawText(title, {
    x: x + 8,
    y: topY - fontSize * 0.84,
    size: fontSize,
    font,
    color: COLORS.brandDark,
  });

  const ruleY = topY - fontSize - 3.5;
  page.drawLine({
    start: { x, y: ruleY },
    end: { x: x + width, y: ruleY },
    thickness: 0.6,
    color: COLORS.border,
  });

  return topY - (fontSize + 5);
}

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

interface NavPillSpec {
  label: string;
  targetPage: PDFPage;
}

/**
 * Draws a shared branded top bar, logo/wordmark, section title,
 * "Prepared for [Student Name]", and an internal PDF navigation strip.
 */
function drawPageHeaderAndNav(options: {
  pdfDoc: PDFDocument;
  page: PDFPage;
  topMargin: number;
  sideMargin: number;
  headerHeight: number;
  navStripHeight: number;
  sectionLabel: string;
  subLabel: string;
  studentName: string;
  fonts: EmbeddedFonts;
  embeddedLogo: PDFImage | null;
  navLinks: NavPillSpec[];
}): number {
  const {
    pdfDoc,
    page,
    topMargin,
    sideMargin,
    headerHeight,
    navStripHeight,
    sectionLabel,
    subLabel,
    studentName,
    fonts,
    embeddedLogo,
    navLinks,
  } = options;

  const startX = sideMargin;
  const contentWidth = A4_WIDTH_PT - sideMargin * 2;

  // White page background
  page.drawRectangle({
    x: 0,
    y: 0,
    width: A4_WIDTH_PT,
    height: A4_HEIGHT_PT,
    color: COLORS.white,
  });

  // Eccho green top bar
  page.drawRectangle({
    x: 0,
    y: A4_HEIGHT_PT - 4,
    width: A4_WIDTH_PT,
    height: 4,
    color: COLORS.brandPrimary,
  });
  page.drawRectangle({
    x: 0,
    y: A4_HEIGHT_PT - 4,
    width: 130,
    height: 4,
    color: COLORS.brandDark,
  });

  const headerTopY = A4_HEIGHT_PT - topMargin;
  const headerBottomY = headerTopY - headerHeight;

  if (embeddedLogo) {
    const maxLogoW = 140;
    const maxLogoH = headerHeight - 10;
    const scale = Math.min(
      maxLogoW / embeddedLogo.width,
      maxLogoH / embeddedLogo.height,
    );
    const drawW = embeddedLogo.width * scale;
    const drawH = embeddedLogo.height * scale;
    page.drawImage(embeddedLogo, {
      x: startX,
      y: headerTopY - drawH - 2,
      width: drawW,
      height: drawH,
    });
  } else {
    const ecchoText = 'ECCHO';
    const overseasText = 'OVERSEAS';
    const wordSize = 14;
    const ecchoW = measureWidth(fonts.bold, ecchoText, wordSize);

    page.drawText(ecchoText, {
      x: startX,
      y: headerTopY - 15,
      size: wordSize,
      font: fonts.bold,
      color: COLORS.brandDark,
    });
    page.drawText(overseasText, {
      x: startX + ecchoW + 5,
      y: headerTopY - 15,
      size: wordSize,
      font: fonts.semiBold,
      color: COLORS.brandPrimary,
    });
    page.drawRectangle({
      x: startX,
      y: headerTopY - 20,
      width: 34,
      height: 1.75,
      color: COLORS.brandPrimary,
    });
  }

  // Optional non-empty contact info from brand config (omitted when empty)
  const contacts = getNonEmptyContactEntries();
  if (contacts.length > 0) {
    const contactStr = makeEncodable(
      fonts.regular,
      contacts.map((c) => c.value).join('  •  '),
      8,
    );
    page.drawText(contactStr, {
      x: startX,
      y: headerBottomY + 4,
      size: 8,
      font: fonts.regular,
      color: COLORS.textMuted,
    });
  }

  // Right header: Document Section + Prepared for [Student Name] + Subtitle
  const titleText = makeEncodable(fonts.bold, sectionLabel, 10.5);
  const titleW = measureWidth(fonts.bold, titleText, 10.5);
  page.drawText(titleText, {
    x: startX + contentWidth - titleW,
    y: headerTopY - 11,
    size: 10.5,
    font: fonts.bold,
    color: COLORS.brandDark,
  });

  const preparedText = makeEncodable(
    fonts.semiBold,
    `Prepared for ${studentName}`,
    9.0,
  );
  const maxRightTextW = contentWidth - 155;
  let preparedSize = 9.0;
  while (
    preparedSize > 7.25 &&
    measureWidth(fonts.semiBold, preparedText, preparedSize) > maxRightTextW
  ) {
    preparedSize -= 0.25;
  }
  const preparedW = measureWidth(fonts.semiBold, preparedText, preparedSize);
  page.drawText(preparedText, {
    x: startX + contentWidth - preparedW,
    y: headerTopY - 23,
    size: preparedSize,
    font: fonts.semiBold,
    color: COLORS.brandPrimary,
  });

  const subText = makeEncodable(fonts.medium, subLabel, 8.25);
  const subW = measureWidth(fonts.medium, subText, 8.25);
  page.drawText(subText, {
    x: startX + contentWidth - subW,
    y: headerTopY - 34.5,
    size: 8.25,
    font: fonts.medium,
    color: COLORS.textMuted,
  });

  page.drawLine({
    start: { x: startX, y: headerBottomY },
    end: { x: startX + contentWidth, y: headerBottomY },
    thickness: 0.9,
    color: COLORS.borderStrong,
  });

  // Compact Internal PDF Navigation Strip
  const navBottomY = headerBottomY - navStripHeight;
  page.drawRectangle({
    x: startX,
    y: navBottomY,
    width: contentWidth,
    height: navStripHeight,
    color: COLORS.surfaceTint,
    borderColor: COLORS.border,
    borderWidth: 0.5,
  });

  const navLabel = 'Navigate PDF:';
  const navFontSize = 8.0;
  const navTextBaselineY = navBottomY + (navStripHeight - navFontSize) / 2 + 1.4;
  page.drawText(navLabel, {
    x: startX + 8,
    y: navTextBaselineY,
    size: navFontSize,
    font: fonts.semiBold,
    color: COLORS.textMuted,
  });

  let pillX = startX + 8 + measureWidth(fonts.semiBold, navLabel, navFontSize) + 10;
  for (const link of navLinks) {
    const linkText = makeEncodable(fonts.semiBold, link.label, navFontSize);
    const textW = measureWidth(fonts.semiBold, linkText, navFontSize);
    const pillPadX = 7;
    const pillW = textW + pillPadX * 2;
    const pillH = navStripHeight - 5;
    const pillBottomY = navBottomY + 2.5;

    page.drawRectangle({
      x: pillX,
      y: pillBottomY,
      width: pillW,
      height: pillH,
      color: COLORS.white,
      borderColor: COLORS.brandBorder,
      borderWidth: 0.6,
    });

    page.drawText(linkText, {
      x: pillX + pillPadX,
      y: navTextBaselineY,
      size: navFontSize,
      font: fonts.semiBold,
      color: COLORS.brandDark,
    });

    addGoToLinkAnnotation(
      pdfDoc,
      page,
      [pillX, pillBottomY, pillX + pillW, pillBottomY + pillH],
      link.targetPage,
    );

    pillX += pillW + 8;
  }

  return navBottomY;
}

function drawStandardFooter(options: {
  pdfDoc: PDFDocument;
  page: PDFPage;
  sideMargin: number;
  fonts: EmbeddedFonts;
  pageNumber: number;
  totalPages: number;
  leftText: string;
  leftHref?: string | null;
  leftLabelPrefix?: string;
  disclaimerNote: string;
}): void {
  const {
    pdfDoc,
    page,
    sideMargin,
    fonts,
    pageNumber,
    totalPages,
    leftText,
    leftHref = null,
    leftLabelPrefix = '',
    disclaimerNote,
  } = options;

  const startX = sideMargin;
  const contentWidth = A4_WIDTH_PT - sideMargin * 2;

  page.drawLine({
    start: { x: startX, y: FOOTER_RULE_Y },
    end: { x: startX + contentWidth, y: FOOTER_RULE_Y },
    thickness: 0.75,
    color: COLORS.borderStrong,
  });

  const footerTopLineY = 44;
  const textSize = 8.5;

  const rightFooterText = `${BRAND_CONFIG.brandName}   •   Page ${pageNumber} of ${totalPages}`;
  const rightFooterW = measureWidth(fonts.semiBold, rightFooterText, textSize);
  const rightFooterX = startX + contentWidth - rightFooterW;

  let leftX = startX;
  if (leftLabelPrefix) {
    const prefixW = measureWidth(fonts.medium, leftLabelPrefix, textSize);
    page.drawText(leftLabelPrefix, {
      x: leftX,
      y: footerTopLineY,
      size: textSize,
      font: fonts.medium,
      color: COLORS.textSecondary,
    });
    leftX += prefixW;
  }

  const maxLeftW = Math.max(80, rightFooterX - leftX - 14);
  const safeLeftText = makeEncodable(fonts.medium, leftText, textSize);
  let leftSize = textSize;
  while (
    leftSize > 6.5 &&
    measureWidth(fonts.medium, safeLeftText, leftSize) > maxLeftW
  ) {
    leftSize -= 0.5;
  }
  const leftW = measureWidth(fonts.medium, safeLeftText, leftSize);

  page.drawText(safeLeftText, {
    x: leftX,
    y: footerTopLineY,
    size: leftSize,
    font: fonts.medium,
    color: leftHref ? COLORS.brandDark : COLORS.textMuted,
  });

  if (leftHref) {
    page.drawLine({
      start: { x: leftX, y: footerTopLineY - 1.5 },
      end: { x: leftX + Math.min(leftW, maxLeftW), y: footerTopLineY - 1.5 },
      thickness: 0.5,
      color: COLORS.brandPrimary,
    });
    addUriLinkAnnotation(
      pdfDoc,
      page,
      [
        leftX - 1,
        footerTopLineY - 3,
        leftX + Math.min(leftW, maxLeftW) + 1,
        footerTopLineY + 10,
      ],
      leftHref,
    );
  }

  page.drawText(rightFooterText, {
    x: rightFooterX,
    y: footerTopLineY,
    size: textSize,
    font: fonts.semiBold,
    color: COLORS.brandDark,
  });

  page.drawText(makeEncodable(fonts.regular, disclaimerNote, 7.5), {
    x: startX,
    y: FOOTER_BOTTOM_PAD + 10,
    size: 7.5,
    font: fonts.regular,
    color: COLORS.textMuted,
  });
}

// ============================================================================
// COURSE SHORTLIST PAGE MEASUREMENT & RENDERING
// ============================================================================

interface MeasuredCourseLayout {
  tier: LayoutTier;
  contentWidth: number;
  startX: number;
  requiredBottomY: number;
  totalContentHeight: number;
  availableContentHeight: number;
  programLines: string[];
  universityLines: string[];
  locationLines: string[];
  headingHeight: number;
  overviewGridItems: Array<{ label: string; lines: string[]; height: number }>;
  overviewRow1Height: number;
  intakeLines: string[];
  facultyLines: string[] | null;
  overviewBoxHeight: number;
  tuitionDisplay: string;
  tuitionLines: string[];
  scholarshipLines: string[];
  feesBoxHeight: number;
  academicItems: string[][];
  academicTwoColumn: boolean;
  academicBoxHeight: number;
  englishTestRows: Array<{
    leftLabelLines: string[];
    leftValueLines: string[];
    leftValueRaw: string;
    rightLabelLines: string[] | null;
    rightValueLines: string[] | null;
    rightValueRaw: string | null;
    rowHeight: number;
  }>;
  englishTableHeight: number;
  waiverStacked: boolean;
  waiverItems: Array<{ label: string; lines: string[]; height: number }>;
  waiverBoxHeight: number;
}

function computeCourseLayoutForTier(
  course: CourseRecord,
  currency: CurrencyCode | null,
  fonts: EmbeddedFonts,
  tier: LayoutTier,
): MeasuredCourseLayout {
  const startX = tier.sideMargin;
  const contentWidth = A4_WIDTH_PT - tier.sideMargin * 2;
  const topStartY = A4_HEIGHT_PT - tier.topMargin;
  let y =
    topStartY -
    tier.headerHeight -
    tier.navStripHeight -
    tier.sectionGap;

  // 1. Course Heading
  const programLines = wrapText(
    course.programName,
    fonts.bold,
    tier.programTitleSize,
    contentWidth,
  );
  const universityLines = wrapText(
    course.university,
    fonts.semiBold,
    tier.universitySize,
    contentWidth,
  );
  const locationText = `Country: ${course.country}   |   Campus: ${course.campus}`;
  const locationLines = wrapText(
    locationText,
    fonts.regular,
    tier.locationSize,
    contentWidth,
  );

  const headingHeight =
    blockHeight(programLines, tier.programTitleSize, 2.5) +
    3.5 +
    blockHeight(universityLines, tier.universitySize, 2.2) +
    2.5 +
    blockHeight(locationLines, tier.locationSize, 2.0);

  y -= headingHeight + tier.sectionGap;

  // 2. Program Overview
  const sectionTitleH = tier.sectionHeaderSize + 5;
  y -= sectionTitleH;

  const overviewColGap = 12;
  const innerOverviewW = contentWidth - tier.cardPadX * 2;
  const colW3 = (innerOverviewW - overviewColGap * 2) / 3;

  const row1Specs = [
    { label: 'Study Level', value: course.studyLevel },
    { label: 'Duration', value: course.duration },
    {
      label: 'University Ranking (As provided)',
      value: course.universityRanking,
    },
  ];

  const overviewGridItems = row1Specs.map((spec) => {
    const lines = wrapText(spec.value, fonts.semiBold, tier.bodySize, colW3);
    const height =
      tier.labelSize + 3 + blockHeight(lines, tier.bodySize, tier.lineGap);
    return { label: spec.label, lines, height };
  });
  const overviewRow1Height = Math.max(...overviewGridItems.map((i) => i.height));

  const intakeLines = wrapText(
    course.openIntake,
    fonts.medium,
    tier.bodySize,
    innerOverviewW,
  );
  const intakeBlockH =
    tier.labelSize + 3 + blockHeight(intakeLines, tier.bodySize, tier.lineGap);

  const facultyLines = course.faculty
    ? wrapText(course.faculty, fonts.medium, tier.bodySize, innerOverviewW)
    : null;
  const facultyBlockH = facultyLines
    ? tier.labelSize +
      3 +
      blockHeight(facultyLines, tier.bodySize, tier.lineGap) +
      6
    : 0;

  const overviewBoxHeight =
    tier.cardPadY * 2 +
    overviewRow1Height +
    6 +
    intakeBlockH +
    facultyBlockH;

  y -= overviewBoxHeight + tier.sectionGap;

  // 3. Fees & Scholarships
  y -= sectionTitleH;
  const tuitionColWidth = 146;
  const feeDividerGap = 20;
  const scholarshipColWidth =
    contentWidth - tier.cardPadX * 2 - tuitionColWidth - feeDividerGap;

  const tuitionDisplay = formatTuitionFee(course.yearlyTuitionFee, currency);
  const tuitionLines = wrapText(
    tuitionDisplay,
    fonts.bold,
    tier.tuitionValueSize,
    tuitionColWidth,
  );
  const tuitionInnerH =
    tier.labelSize +
    4 +
    blockHeight(tuitionLines, tier.tuitionValueSize, 2.5);

  const scholarshipLines = wrapText(
    course.scholarshipAvailable,
    fonts.regular,
    tier.bodySize,
    scholarshipColWidth,
  );
  const scholarshipInnerH =
    tier.labelSize +
    4 +
    blockHeight(scholarshipLines, tier.bodySize, tier.lineGap);

  const feesBoxHeight =
    tier.cardPadY * 2 + Math.max(tuitionInnerH, scholarshipInnerH);
  y -= feesBoxHeight + tier.sectionGap;

  // 4. Academic Entry Requirements
  y -= sectionTitleH;
  const academicBulletIndent = 10;
  const academicInnerW = contentWidth - tier.cardPadX * 2;
  const useTwoColAcademic =
    tier.twoColumnAcademic && course.entryRequirementLines.length >= 2;
  const academicColGap = 14;
  const academicColW = useTwoColAcademic
    ? (academicInnerW - academicColGap) / 2 - academicBulletIndent
    : academicInnerW - academicBulletIndent;

  const academicItems = course.entryRequirementLines.map((item) =>
    wrapText(item, fonts.regular, tier.bodySize, academicColW),
  );

  let academicContentH = 0;
  if (useTwoColAcademic) {
    for (let i = 0; i < academicItems.length; i += 2) {
      const leftH = blockHeight(academicItems[i], tier.bodySize, tier.lineGap);
      const rightH =
        i + 1 < academicItems.length
          ? blockHeight(academicItems[i + 1], tier.bodySize, tier.lineGap)
          : 0;
      academicContentH += Math.max(leftH, rightH);
      if (i + 2 < academicItems.length) {
        academicContentH += tier.lineGap + 2;
      }
    }
  } else {
    academicItems.forEach((lines, idx) => {
      academicContentH += blockHeight(lines, tier.bodySize, tier.lineGap);
      if (idx < academicItems.length - 1) {
        academicContentH += tier.lineGap + 2;
      }
    });
  }

  const academicBoxHeight = tier.cardPadY * 2 + academicContentH;
  y -= academicBoxHeight + tier.sectionGap;

  // 5. English Language Requirements
  y -= sectionTitleH;

  const halfW = contentWidth / 2;
  const labelColW = halfW * 0.695;
  const scoreColW = halfW - labelColW;
  const labelTextMaxW = labelColW - 14;
  const scoreTextMaxW = scoreColW - 12;

  const englishTestRows: MeasuredCourseLayout['englishTestRows'] = [];
  for (let i = 0; i < course.englishTests.length; i += 2) {
    const left = course.englishTests[i];
    const right = course.englishTests[i + 1] ?? null;

    const leftLabelLines = wrapText(
      left.label,
      fonts.medium,
      tier.tableTextSize,
      labelTextMaxW,
    );
    const leftValueLines = wrapText(
      left.value,
      left.value === NOT_SPECIFIED ? fonts.regular : fonts.semiBold,
      tier.tableTextSize,
      scoreTextMaxW,
    );

    const rightLabelLines = right
      ? wrapText(right.label, fonts.medium, tier.tableTextSize, labelTextMaxW)
      : null;
    const rightValueLines = right
      ? wrapText(
          right.value,
          right.value === NOT_SPECIFIED ? fonts.regular : fonts.semiBold,
          tier.tableTextSize,
          scoreTextMaxW,
        )
      : null;

    const maxLines = Math.max(
      leftLabelLines.length,
      leftValueLines.length,
      rightLabelLines?.length ?? 1,
      rightValueLines?.length ?? 1,
    );
    const contentH = blockHeight(
      Array.from({ length: maxLines }, () => 'x'),
      tier.tableTextSize,
      2,
    );
    const rowHeight = Math.max(tier.tableRowHeight, contentH + 6);

    englishTestRows.push({
      leftLabelLines,
      leftValueLines,
      leftValueRaw: left.value,
      rightLabelLines,
      rightValueLines,
      rightValueRaw: right ? right.value : null,
      rowHeight,
    });
  }

  const tableHeaderH = tier.tableRowHeight;
  const englishTableHeight =
    tableHeaderH +
    englishTestRows.reduce((sum, row) => sum + row.rowHeight, 0);

  y -= englishTableHeight + 5;

  // English Waiver Subsection
  const waiverSubheadingH = tier.labelSize + 4;
  y -= waiverSubheadingH;

  const waiverInnerW = contentWidth - tier.cardPadX * 2;
  const waiverColGap = 10;
  const waiverColW3 = (waiverInnerW - waiverColGap * 2) / 3;

  const threeColWaivers = course.englishWaivers.map((w) => {
    const labelLines = wrapText(
      w.label,
      fonts.semiBold,
      tier.labelSize,
      waiverColW3,
    );
    const valLines = wrapText(
      w.value,
      fonts.semiBold,
      tier.bodySize,
      waiverColW3,
    );
    const height =
      blockHeight(labelLines, tier.labelSize, 1.5) +
      3 +
      blockHeight(valLines, tier.bodySize, tier.lineGap);
    return { label: w.label, lines: valLines, height, labelLines };
  });

  const maxWaiverLines = Math.max(...threeColWaivers.map((w) => w.lines.length));
  const waiverStacked = maxWaiverLines > 3;

  let waiverItems: Array<{ label: string; lines: string[]; height: number }>;
  let waiverContentH: number;

  if (!waiverStacked) {
    waiverItems = threeColWaivers.map((w) => ({
      label: w.label,
      lines: w.lines,
      height: w.height,
    }));
    waiverContentH = Math.max(...threeColWaivers.map((w) => w.height));
  } else {
    waiverItems = course.englishWaivers.map((w) => {
      const lines = wrapText(
        `${w.label}: ${w.value}`,
        fonts.medium,
        tier.bodySize,
        waiverInnerW,
      );
      const height = blockHeight(lines, tier.bodySize, tier.lineGap);
      return { label: w.label, lines, height };
    });
    waiverContentH =
      waiverItems.reduce((sum, item) => sum + item.height, 0) +
      (waiverItems.length - 1) * 3;
  }

  const waiverBoxHeight = tier.cardPadY * 2 + waiverContentH;
  y -= waiverBoxHeight;

  const availableContentHeight = topStartY - tier.minContentY;
  const totalContentHeight = topStartY - y;

  return {
    tier,
    contentWidth,
    startX,
    requiredBottomY: y,
    totalContentHeight,
    availableContentHeight,
    programLines,
    universityLines,
    locationLines,
    headingHeight,
    overviewGridItems,
    overviewRow1Height,
    intakeLines,
    facultyLines,
    overviewBoxHeight,
    tuitionDisplay,
    tuitionLines,
    scholarshipLines,
    feesBoxHeight,
    academicItems,
    academicTwoColumn: useTwoColAcademic,
    academicBoxHeight,
    englishTestRows,
    englishTableHeight,
    waiverStacked,
    waiverItems,
    waiverBoxHeight,
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
    if (measured.requiredBottomY >= tier.minContentY) {
      return { ok: true, layout: measured };
    }
  }
  return { ok: false, tightest: tightest! };
}

function renderCoursePage(options: {
  pdfDoc: PDFDocument;
  page: PDFPage;
  course: CourseRecord;
  layout: MeasuredCourseLayout;
  fonts: EmbeddedFonts;
  embeddedLogo: PDFImage | null;
  studentName: string;
  courseIndex: number;
  courseCount: number;
  pageNumber: number;
  totalPages: number;
  guideStartPage: PDFPage;
  checklistStartPage: PDFPage;
}): void {
  const {
    pdfDoc,
    page,
    course,
    layout,
    fonts,
    embeddedLogo,
    studentName,
    courseIndex,
    courseCount,
    pageNumber,
    totalPages,
    guideStartPage,
    checklistStartPage,
  } = options;
  const { tier, startX, contentWidth } = layout;

  const navBottomY = drawPageHeaderAndNav({
    pdfDoc,
    page,
    topMargin: tier.topMargin,
    sideMargin: tier.sideMargin,
    headerHeight: tier.headerHeight,
    navStripHeight: tier.navStripHeight,
    sectionLabel: BRAND_CONFIG.documentTitle,
    subLabel: `Course ${courseIndex + 1} of ${courseCount}`,
    studentName,
    fonts,
    embeddedLogo,
    navLinks: [
      { label: 'UK Application Process', targetPage: guideStartPage },
      { label: 'Required Documents Checklist', targetPage: checklistStartPage },
    ],
  });

  let y = navBottomY - tier.sectionGap;

  // Course Heading
  drawLines(
    page,
    layout.programLines,
    startX,
    y,
    fonts.bold,
    tier.programTitleSize,
    2.5,
    COLORS.brandDark,
  );
  y -= blockHeight(layout.programLines, tier.programTitleSize, 2.5) + 3.5;

  drawLines(
    page,
    layout.universityLines,
    startX,
    y,
    fonts.semiBold,
    tier.universitySize,
    2.2,
    COLORS.brandPrimary,
  );
  y -= blockHeight(layout.universityLines, tier.universitySize, 2.2) + 2.5;

  drawLines(
    page,
    layout.locationLines,
    startX,
    y,
    fonts.regular,
    tier.locationSize,
    2.0,
    COLORS.textSecondary,
  );
  y -=
    blockHeight(layout.locationLines, tier.locationSize, 2.0) + tier.sectionGap;

  // Program Overview
  y = drawSectionHeading(
    page,
    'PROGRAM OVERVIEW',
    startX,
    y,
    contentWidth,
    fonts.bold,
    tier.sectionHeaderSize,
  );

  page.drawRectangle({
    x: startX,
    y: y - layout.overviewBoxHeight,
    width: contentWidth,
    height: layout.overviewBoxHeight,
    color: COLORS.surfaceTint,
    borderColor: COLORS.border,
    borderWidth: 0.75,
  });

  const overviewColGap = 12;
  const innerOverviewW = contentWidth - tier.cardPadX * 2;
  const colW3 = (innerOverviewW - overviewColGap * 2) / 3;
  let innerY = y - tier.cardPadY;

  layout.overviewGridItems.forEach((item, idx) => {
    const colX = startX + tier.cardPadX + idx * (colW3 + overviewColGap);
    page.drawText(item.label, {
      x: colX,
      y: innerY - tier.labelSize * 0.82,
      size: tier.labelSize,
      font: fonts.semiBold,
      color: COLORS.textMuted,
    });
    drawLines(
      page,
      item.lines,
      colX,
      innerY - tier.labelSize - 3,
      fonts.semiBold,
      tier.bodySize,
      tier.lineGap,
      COLORS.textPrimary,
    );
  });

  innerY -= layout.overviewRow1Height + 6;

  page.drawText('Open Intake', {
    x: startX + tier.cardPadX,
    y: innerY - tier.labelSize * 0.82,
    size: tier.labelSize,
    font: fonts.semiBold,
    color: COLORS.textMuted,
  });
  drawLines(
    page,
    layout.intakeLines,
    startX + tier.cardPadX,
    innerY - tier.labelSize - 3,
    fonts.medium,
    tier.bodySize,
    tier.lineGap,
    COLORS.textPrimary,
  );

  if (layout.facultyLines) {
    const intakeH =
      tier.labelSize +
      3 +
      blockHeight(layout.intakeLines, tier.bodySize, tier.lineGap);
    const facultyY = innerY - intakeH - 6;
    page.drawText('Faculty', {
      x: startX + tier.cardPadX,
      y: facultyY - tier.labelSize * 0.82,
      size: tier.labelSize,
      font: fonts.semiBold,
      color: COLORS.textMuted,
    });
    drawLines(
      page,
      layout.facultyLines,
      startX + tier.cardPadX,
      facultyY - tier.labelSize - 3,
      fonts.medium,
      tier.bodySize,
      tier.lineGap,
      COLORS.textPrimary,
    );
  }

  y -= layout.overviewBoxHeight + tier.sectionGap;

  // Fees & Scholarships
  y = drawSectionHeading(
    page,
    'FEES & SCHOLARSHIPS',
    startX,
    y,
    contentWidth,
    fonts.bold,
    tier.sectionHeaderSize,
  );

  const tuitionColWidth = 146;
  const feeDividerGap = 20;
  const leftPaneW = tier.cardPadX + tuitionColWidth + feeDividerGap / 2;

  page.drawRectangle({
    x: startX,
    y: y - layout.feesBoxHeight,
    width: contentWidth,
    height: layout.feesBoxHeight,
    color: COLORS.white,
    borderColor: COLORS.border,
    borderWidth: 0.75,
  });

  page.drawRectangle({
    x: startX + 0.75,
    y: y - layout.feesBoxHeight + 0.75,
    width: leftPaneW - 0.75,
    height: layout.feesBoxHeight - 1.5,
    color: COLORS.brandSoft,
  });

  page.drawLine({
    start: { x: startX + leftPaneW, y },
    end: { x: startX + leftPaneW, y: y - layout.feesBoxHeight },
    thickness: 0.75,
    color: COLORS.brandBorder,
  });

  const feeInnerY = y - tier.cardPadY;
  page.drawText('Yearly Tuition Fee', {
    x: startX + tier.cardPadX,
    y: feeInnerY - tier.labelSize * 0.82,
    size: tier.labelSize,
    font: fonts.semiBold,
    color: COLORS.brandPrimary,
  });
  drawLines(
    page,
    layout.tuitionLines,
    startX + tier.cardPadX,
    feeInnerY - tier.labelSize - 4,
    fonts.bold,
    tier.tuitionValueSize,
    2.5,
    COLORS.brandDark,
  );

  const scholarshipX = startX + leftPaneW + feeDividerGap / 2;
  page.drawText('Scholarship Available', {
    x: scholarshipX,
    y: feeInnerY - tier.labelSize * 0.82,
    size: tier.labelSize,
    font: fonts.semiBold,
    color: COLORS.textMuted,
  });
  drawLines(
    page,
    layout.scholarshipLines,
    scholarshipX,
    feeInnerY - tier.labelSize - 4,
    fonts.regular,
    tier.bodySize,
    tier.lineGap,
    COLORS.textPrimary,
  );

  y -= layout.feesBoxHeight + tier.sectionGap;

  // Academic Entry Requirements
  y = drawSectionHeading(
    page,
    'ACADEMIC ENTRY REQUIREMENTS',
    startX,
    y,
    contentWidth,
    fonts.bold,
    tier.sectionHeaderSize,
  );

  page.drawRectangle({
    x: startX,
    y: y - layout.academicBoxHeight,
    width: contentWidth,
    height: layout.academicBoxHeight,
    color: COLORS.white,
    borderColor: COLORS.border,
    borderWidth: 0.75,
  });

  let acadY = y - tier.cardPadY;
  const acadInnerW = contentWidth - tier.cardPadX * 2;
  const acadColGap = 14;
  const acadColSpan = (acadInnerW - acadColGap) / 2;

  if (layout.academicTwoColumn) {
    for (let i = 0; i < layout.academicItems.length; i += 2) {
      const leftLines = layout.academicItems[i];
      const leftX = startX + tier.cardPadX;
      page.drawCircle({
        x: leftX + 2.5,
        y: acadY - tier.bodySize * 0.45,
        size: 1.8,
        color: COLORS.brandPrimary,
      });
      drawLines(
        page,
        leftLines,
        leftX + 10,
        acadY,
        fonts.regular,
        tier.bodySize,
        tier.lineGap,
        COLORS.textPrimary,
      );

      let rightH = 0;
      if (i + 1 < layout.academicItems.length) {
        const rightLines = layout.academicItems[i + 1];
        const rightX = startX + tier.cardPadX + acadColSpan + acadColGap;
        page.drawCircle({
          x: rightX + 2.5,
          y: acadY - tier.bodySize * 0.45,
          size: 1.8,
          color: COLORS.brandPrimary,
        });
        drawLines(
          page,
          rightLines,
          rightX + 10,
          acadY,
          fonts.regular,
          tier.bodySize,
          tier.lineGap,
          COLORS.textPrimary,
        );
        rightH = blockHeight(rightLines, tier.bodySize, tier.lineGap);
      }

      const leftH = blockHeight(leftLines, tier.bodySize, tier.lineGap);
      acadY -= Math.max(leftH, rightH) + tier.lineGap + 2;
    }
  } else {
    layout.academicItems.forEach((lines) => {
      const itemX = startX + tier.cardPadX;
      page.drawCircle({
        x: itemX + 2.5,
        y: acadY - tier.bodySize * 0.45,
        size: 1.8,
        color: COLORS.brandPrimary,
      });
      drawLines(
        page,
        lines,
        itemX + 10,
        acadY,
        fonts.regular,
        tier.bodySize,
        tier.lineGap,
        COLORS.textPrimary,
      );
      acadY -= blockHeight(lines, tier.bodySize, tier.lineGap) + tier.lineGap + 2;
    });
  }

  y -= layout.academicBoxHeight + tier.sectionGap;

  // English Language Requirements
  y = drawSectionHeading(
    page,
    'ENGLISH LANGUAGE REQUIREMENTS',
    startX,
    y,
    contentWidth,
    fonts.bold,
    tier.sectionHeaderSize,
  );

  const halfW = contentWidth / 2;
  const labelColW = halfW * 0.695;
  const rowH = tier.tableRowHeight;
  const tableTopY = y;

  page.drawRectangle({
    x: startX,
    y: tableTopY - layout.englishTableHeight,
    width: contentWidth,
    height: layout.englishTableHeight,
    color: COLORS.white,
    borderColor: COLORS.borderStrong,
    borderWidth: 0.75,
  });

  page.drawRectangle({
    x: startX + 0.5,
    y: tableTopY - rowH,
    width: contentWidth - 1,
    height: rowH - 0.5,
    color: COLORS.brandDark,
  });

  const headerBaselineOffset = (rowH - tier.labelSize) / 2 + 1.5;
  page.drawText('English Test', {
    x: startX + 8,
    y: tableTopY - rowH + headerBaselineOffset,
    size: tier.labelSize,
    font: fonts.semiBold,
    color: COLORS.white,
  });
  page.drawText('Supplied Score', {
    x: startX + labelColW + 6,
    y: tableTopY - rowH + headerBaselineOffset,
    size: tier.labelSize,
    font: fonts.semiBold,
    color: COLORS.white,
  });
  page.drawText('English Test', {
    x: startX + halfW + 8,
    y: tableTopY - rowH + headerBaselineOffset,
    size: tier.labelSize,
    font: fonts.semiBold,
    color: COLORS.white,
  });
  page.drawText('Supplied Score', {
    x: startX + halfW + labelColW + 6,
    y: tableTopY - rowH + headerBaselineOffset,
    size: tier.labelSize,
    font: fonts.semiBold,
    color: COLORS.white,
  });

  let currentRowTopY = tableTopY - rowH;
  layout.englishTestRows.forEach((row, idx) => {
    const curRowH = row.rowHeight;
    const rowBottomY = currentRowTopY - curRowH;
    if (idx % 2 === 1) {
      page.drawRectangle({
        x: startX + 0.5,
        y: rowBottomY,
        width: contentWidth - 1,
        height: curRowH,
        color: COLORS.surfaceTint,
      });
    }

    page.drawLine({
      start: { x: startX, y: currentRowTopY },
      end: { x: startX + contentWidth, y: currentRowTopY },
      thickness: 0.5,
      color: COLORS.border,
    });

    const leftValColor =
      row.leftValueRaw === NOT_SPECIFIED ? COLORS.textMuted : COLORS.brandDark;
    const leftLabelH = blockHeight(row.leftLabelLines, tier.tableTextSize, 2);
    const leftLabelTopY =
      rowBottomY + curRowH - Math.max(3, (curRowH - leftLabelH) / 2);
    drawLines(
      page,
      row.leftLabelLines,
      startX + 8,
      leftLabelTopY,
      fonts.medium,
      tier.tableTextSize,
      2,
      COLORS.textPrimary,
    );

    const leftValH = blockHeight(row.leftValueLines, tier.tableTextSize, 2);
    const leftValTopY =
      rowBottomY + curRowH - Math.max(3, (curRowH - leftValH) / 2);
    drawLines(
      page,
      row.leftValueLines,
      startX + labelColW + 6,
      leftValTopY,
      row.leftValueRaw === NOT_SPECIFIED ? fonts.regular : fonts.semiBold,
      tier.tableTextSize,
      2,
      leftValColor,
    );

    if (
      row.rightLabelLines &&
      row.rightValueLines &&
      row.rightValueRaw !== null
    ) {
      const rightValColor =
        row.rightValueRaw === NOT_SPECIFIED
          ? COLORS.textMuted
          : COLORS.brandDark;
      const rightLabelH = blockHeight(
        row.rightLabelLines,
        tier.tableTextSize,
        2,
      );
      const rightLabelTopY =
        rowBottomY + curRowH - Math.max(3, (curRowH - rightLabelH) / 2);
      drawLines(
        page,
        row.rightLabelLines,
        startX + halfW + 8,
        rightLabelTopY,
        fonts.medium,
        tier.tableTextSize,
        2,
        COLORS.textPrimary,
      );

      const rightValH = blockHeight(row.rightValueLines, tier.tableTextSize, 2);
      const rightValTopY =
        rowBottomY + curRowH - Math.max(3, (curRowH - rightValH) / 2);
      drawLines(
        page,
        row.rightValueLines,
        startX + halfW + labelColW + 6,
        rightValTopY,
        row.rightValueRaw === NOT_SPECIFIED ? fonts.regular : fonts.semiBold,
        tier.tableTextSize,
        2,
        rightValColor,
      );
    }

    currentRowTopY = rowBottomY;
  });

  page.drawLine({
    start: { x: startX + halfW, y: tableTopY },
    end: { x: startX + halfW, y: tableTopY - layout.englishTableHeight },
    thickness: 0.75,
    color: COLORS.borderStrong,
  });
  page.drawLine({
    start: { x: startX + labelColW, y: tableTopY - rowH },
    end: { x: startX + labelColW, y: tableTopY - layout.englishTableHeight },
    thickness: 0.5,
    color: COLORS.border,
  });
  page.drawLine({
    start: { x: startX + halfW + labelColW, y: tableTopY - rowH },
    end: {
      x: startX + halfW + labelColW,
      y: tableTopY - layout.englishTableHeight,
    },
    thickness: 0.5,
    color: COLORS.border,
  });

  y -= layout.englishTableHeight + 5;

  page.drawText('English Waiver Criteria', {
    x: startX,
    y: y - tier.labelSize * 0.85,
    size: tier.labelSize + 0.5,
    font: fonts.bold,
    color: COLORS.brandDark,
  });
  y -= tier.labelSize + 4;

  page.drawRectangle({
    x: startX,
    y: y - layout.waiverBoxHeight,
    width: contentWidth,
    height: layout.waiverBoxHeight,
    color: COLORS.surfaceTint,
    borderColor: COLORS.border,
    borderWidth: 0.75,
  });

  const waiverInnerY = y - tier.cardPadY;
  const waiverInnerW = contentWidth - tier.cardPadX * 2;

  if (!layout.waiverStacked) {
    const waiverColGap = 10;
    const waiverColW = (waiverInnerW - waiverColGap * 2) / 3;
    layout.waiverItems.forEach((item, idx) => {
      const colX = startX + tier.cardPadX + idx * (waiverColW + waiverColGap);
      const labelLines = wrapText(
        item.label,
        fonts.semiBold,
        tier.labelSize,
        waiverColW,
      );
      drawLines(
        page,
        labelLines,
        colX,
        waiverInnerY,
        fonts.semiBold,
        tier.labelSize,
        1.5,
        COLORS.textMuted,
      );
      const labelH = blockHeight(labelLines, tier.labelSize, 1.5);
      const valIsNotSpec = item.lines.join(' ') === NOT_SPECIFIED;
      drawLines(
        page,
        item.lines,
        colX,
        waiverInnerY - labelH - 3,
        valIsNotSpec ? fonts.regular : fonts.semiBold,
        tier.bodySize,
        tier.lineGap,
        valIsNotSpec ? COLORS.textMuted : COLORS.brandDark,
      );
    });
  } else {
    let wy = waiverInnerY;
    layout.waiverItems.forEach((item) => {
      drawLines(
        page,
        item.lines,
        startX + tier.cardPadX,
        wy,
        fonts.medium,
        tier.bodySize,
        tier.lineGap,
        COLORS.textPrimary,
      );
      wy -= item.height + 3;
    });
  }

  drawStandardFooter({
    pdfDoc,
    page,
    sideMargin: tier.sideMargin,
    fonts,
    pageNumber,
    totalPages,
    leftLabelPrefix: 'University Website: ',
    leftText: course.websiteUrlDisplay,
    leftHref: course.websiteHref,
    disclaimerNote: BRAND_CONFIG.footerNote,
  });
}

// ============================================================================
// UK APPLICATION PROCESS GUIDE PAGES
// ============================================================================

const GUIDE_SIDE_MARGIN = 34;
const GUIDE_TOP_MARGIN = 22;
const GUIDE_HEADER_H = 46;
const GUIDE_NAV_H = 20;

interface MeasuredGuideStep {
  step: GuideStep;
  titleLines: string[];
  summaryLines: string[];
  bulletLines: string[][];
  cardHeight: number;
}

function measureGuideSteps(fonts: EmbeddedFonts): MeasuredGuideStep[] {
  const contentWidth = A4_WIDTH_PT - GUIDE_SIDE_MARGIN * 2;
  const textW = contentWidth - 48;

  return UK_APPLICATION_STEPS.map((step) => {
    const titleLines = wrapText(
      `${step.number}. ${step.title}`,
      fonts.bold,
      10.5,
      textW - 115,
    );
    const summaryLines = wrapText(step.summary, fonts.semiBold, 9.25, textW);
    const bulletLines = step.details.map((d) =>
      wrapText(d, fonts.regular, 9.0, textW - 12),
    );

    const titleH = blockHeight(titleLines, 10.5, 2.2);
    const summaryH = blockHeight(summaryLines, 9.25, 2.4);
    const bulletsH = bulletLines.reduce(
      (sum, lines, i) =>
        sum +
        blockHeight(lines, 9.0, 2.2) +
        (i < bulletLines.length - 1 ? 3 : 0),
      0,
    );

    const cardHeight = 8 + titleH + 4 + summaryH + 4 + bulletsH + 8;
    return { step, titleLines, summaryLines, bulletLines, cardHeight };
  });
}

function paginateGuideContent(fonts: EmbeddedFonts): {
  stepPages: MeasuredGuideStep[][];
  linksFitOnLastStepPage: boolean;
  linksCardHeight: number;
  calloutHeight: number;
  calloutLines: string[];
} {
  const contentWidth = A4_WIDTH_PT - GUIDE_SIDE_MARGIN * 2;
  const topY =
    A4_HEIGHT_PT - GUIDE_TOP_MARGIN - GUIDE_HEADER_H - GUIDE_NAV_H - 12;

  const calloutText =
    'University admission rules (academic grades, English waivers, deposits, and pre-CAS interviews set by each institution) are separate from UK Student visa rules (CAS, financial evidence, ATAS, TB screening, Immigration Health Surcharge, and digital eVisa status set by UKVI). Do not assume automatic fee thresholds, processing times, or guaranteed visa outcomes—always verify current figures on the official GOV.UK links below.';
  const calloutLines = wrapText(
    calloutText,
    fonts.regular,
    9.0,
    contentWidth - 20,
  );
  const calloutHeight = 8 + 13 + 3 + blockHeight(calloutLines, 9.0, 2.4) + 8;

  const measuredSteps = measureGuideSteps(fonts);
  const stepPages: MeasuredGuideStep[][] = [[]];
  let curY = topY - calloutHeight - 10;

  for (const item of measuredSteps) {
    if (curY - item.cardHeight < MIN_CONTENT_BOTTOM_Y && stepPages[stepPages.length - 1].length > 0) {
      stepPages.push([]);
      curY = topY;
    }
    stepPages[stepPages.length - 1].push(item);
    curY -= item.cardHeight + 8;
  }

  // Official Guidance Links card height (2-column link rows)
  const linkColW = (contentWidth - 28) / 2;
  const linkRowHeights: number[] = [];
  for (let i = 0; i < OFFICIAL_GUIDANCE_LINKS.length; i += 2) {
    const leftLines = wrapText(
      OFFICIAL_GUIDANCE_LINKS[i].label,
      fonts.semiBold,
      9.0,
      linkColW,
    );
    const rightLines =
      i + 1 < OFFICIAL_GUIDANCE_LINKS.length
        ? wrapText(
            OFFICIAL_GUIDANCE_LINKS[i + 1].label,
            fonts.semiBold,
            9.0,
            linkColW,
          )
        : [];
    const lh = blockHeight(leftLines, 9.0, 1.8) + 11; // label + small URL line
    const rh =
      rightLines.length > 0 ? blockHeight(rightLines, 9.0, 1.8) + 11 : 0;
    linkRowHeights.push(Math.max(lh, rh));
  }

  const linksCardHeight =
    26 +
    linkRowHeights.reduce((s, h) => s + h, 0) +
    Math.max(0, linkRowHeights.length - 1) * 7 +
    12;

  const linksFitOnLastStepPage =
    curY - (linksCardHeight + 24) >= MIN_CONTENT_BOTTOM_Y;

  return {
    stepPages,
    linksFitOnLastStepPage,
    linksCardHeight,
    calloutHeight,
    calloutLines,
  };
}

function renderGuidePages(options: {
  pdfDoc: PDFDocument;
  guidePages: PDFPage[];
  plan: ReturnType<typeof paginateGuideContent>;
  fonts: EmbeddedFonts;
  embeddedLogo: PDFImage | null;
  studentName: string;
  startPageNumber: number;
  totalPages: number;
  shortlistStartPage: PDFPage;
  checklistStartPage: PDFPage;
}): void {
  const {
    pdfDoc,
    guidePages,
    plan,
    fonts,
    embeddedLogo,
    studentName,
    startPageNumber,
    totalPages,
    shortlistStartPage,
    checklistStartPage,
  } = options;

  const startX = GUIDE_SIDE_MARGIN;
  const contentWidth = A4_WIDTH_PT - GUIDE_SIDE_MARGIN * 2;

  const drawLinksCard = (page: PDFPage, topY: number) => {
    let y = drawSectionHeading(
      page,
      'OFFICIAL UKVI & UNIVERSITY GUIDANCE LINKS',
      startX,
      topY,
      contentWidth,
      fonts.bold,
      9.5,
    );

    page.drawRectangle({
      x: startX,
      y: y - plan.linksCardHeight,
      width: contentWidth,
      height: plan.linksCardHeight,
      color: COLORS.surfaceTint,
      borderColor: COLORS.border,
      borderWidth: 0.75,
    });

    const headerNote = `Official sources verified for ${studentName} — Guidance checked on ${GUIDANCE_CHECKED_DATE}`;
    page.drawText(makeEncodable(fonts.semiBold, headerNote, 9.0), {
      x: startX + 10,
      y: y - 16,
      size: 9.0,
      font: fonts.semiBold,
      color: COLORS.brandDark,
    });

    const linkColW = (contentWidth - 28) / 2;
    let ly = y - 28;

    for (let i = 0; i < OFFICIAL_GUIDANCE_LINKS.length; i += 2) {
      const pair = [
        OFFICIAL_GUIDANCE_LINKS[i],
        OFFICIAL_GUIDANCE_LINKS[i + 1] ?? null,
      ];
      let maxPairH = 0;

      pair.forEach((item, colIdx) => {
        if (!item) return;
        const colX = startX + 10 + colIdx * (linkColW + 10);
        const labelLines = wrapText(item.label, fonts.semiBold, 9.0, linkColW);
        drawLines(
          page,
          labelLines,
          colX,
          ly,
          fonts.semiBold,
          9.0,
          1.8,
          COLORS.brandDark,
        );
        const labelH = blockHeight(labelLines, 9.0, 1.8);
        const urlTopY = ly - labelH - 1.5;

        let urlDisplay = makeEncodable(fonts.regular, item.url, 7.75);
        let urlSize = 7.75;
        while (
          urlSize > 6.5 &&
          measureWidth(fonts.regular, urlDisplay, urlSize) > linkColW
        ) {
          urlSize -= 0.25;
        }
        const urlW = measureWidth(fonts.regular, urlDisplay, urlSize);
        page.drawText(urlDisplay, {
          x: colX,
          y: urlTopY - urlSize * 0.85,
          size: urlSize,
          font: fonts.regular,
          color: COLORS.brandPrimary,
        });
        page.drawLine({
          start: { x: colX, y: urlTopY - urlSize * 0.85 - 1.2 },
          end: {
            x: colX + Math.min(urlW, linkColW),
            y: urlTopY - urlSize * 0.85 - 1.2,
          },
          thickness: 0.45,
          color: COLORS.brandPrimary,
        });

        addUriLinkAnnotation(
          pdfDoc,
          page,
          [
            colX,
            urlTopY - urlSize - 2,
            colX + Math.max(measureWidth(fonts.semiBold, labelLines[0] ?? '', 9.0), Math.min(urlW, linkColW)),
            ly + 1,
          ],
          item.url,
        );

        maxPairH = Math.max(maxPairH, labelH + 11);
      });

      ly -= maxPairH + 7;
    }
  };

  guidePages.forEach((page, pageIdx) => {
    const navBottomY = drawPageHeaderAndNav({
      pdfDoc,
      page,
      topMargin: GUIDE_TOP_MARGIN,
      sideMargin: GUIDE_SIDE_MARGIN,
      headerHeight: GUIDE_HEADER_H,
      navStripHeight: GUIDE_NAV_H,
      sectionLabel: 'UK Application Process',
      subLabel:
        guidePages.length > 1
          ? `Guide Part ${pageIdx + 1} of ${guidePages.length}`
          : 'Step-by-Step Guide',
      studentName,
      fonts,
      embeddedLogo,
      navLinks: [
        { label: 'Back to Course Shortlist', targetPage: shortlistStartPage },
        { label: 'Required Documents Checklist', targetPage: checklistStartPage },
      ],
    });

    let y = navBottomY - 12;

    if (pageIdx === 0) {
      // Distinction callout + Guidance checked date
      page.drawRectangle({
        x: startX,
        y: y - plan.calloutHeight,
        width: contentWidth,
        height: plan.calloutHeight,
        color: COLORS.brandSoft,
        borderColor: COLORS.brandBorder,
        borderWidth: 0.75,
      });
      page.drawRectangle({
        x: startX,
        y: y - plan.calloutHeight,
        width: 3.5,
        height: plan.calloutHeight,
        color: COLORS.brandPrimary,
      });

      page.drawText('Important Distinction: University Admissions vs UK Student Visa', {
        x: startX + 10,
        y: y - 15,
        size: 9.5,
        font: fonts.bold,
        color: COLORS.brandDark,
      });

      const checkedTag = `Guidance checked on ${GUIDANCE_CHECKED_DATE}`;
      const checkedW = measureWidth(fonts.semiBold, checkedTag, 8.25);
      page.drawText(checkedTag, {
        x: startX + contentWidth - checkedW - 10,
        y: y - 15,
        size: 8.25,
        font: fonts.semiBold,
        color: COLORS.brandPrimary,
      });

      drawLines(
        page,
        plan.calloutLines,
        startX + 10,
        y - 23,
        fonts.regular,
        9.0,
        2.4,
        COLORS.textPrimary,
      );

      y -= plan.calloutHeight + 10;
    }

    const stepsForPage = plan.stepPages[pageIdx] ?? [];
    for (const item of stepsForPage) {
      page.drawRectangle({
        x: startX,
        y: y - item.cardHeight,
        width: contentWidth,
        height: item.cardHeight,
        color: COLORS.white,
        borderColor: COLORS.border,
        borderWidth: 0.75,
      });

      // Numbered badge
      const badgeCenterX = startX + 19;
      const badgeCenterY = y - 15;
      page.drawCircle({
        x: badgeCenterX,
        y: badgeCenterY,
        size: 9.5,
        color: COLORS.brandPrimary,
      });
      const numStr = String(item.step.number);
      const numW = measureWidth(fonts.bold, numStr, 9.5);
      page.drawText(numStr, {
        x: badgeCenterX - numW / 2,
        y: badgeCenterY - 3.3,
        size: 9.5,
        font: fonts.bold,
        color: COLORS.white,
      });

      // Scope pill on top right of card
      const scopeW = measureWidth(fonts.semiBold, item.step.scope, 7.75) + 12;
      const scopeX = startX + contentWidth - scopeW - 10;
      page.drawRectangle({
        x: scopeX,
        y: y - 20,
        width: scopeW,
        height: 14,
        color: COLORS.surfaceTint,
        borderColor: COLORS.brandBorder,
        borderWidth: 0.5,
      });
      page.drawText(item.step.scope, {
        x: scopeX + 6,
        y: y - 15.5,
        size: 7.75,
        font: fonts.semiBold,
        color: COLORS.brandDark,
      });

      let cy = y - 8;
      drawLines(
        page,
        item.titleLines,
        startX + 36,
        cy,
        fonts.bold,
        10.5,
        2.2,
        COLORS.brandDark,
      );
      cy -= blockHeight(item.titleLines, 10.5, 2.2) + 4;

      drawLines(
        page,
        item.summaryLines,
        startX + 36,
        cy,
        fonts.semiBold,
        9.25,
        2.4,
        COLORS.textPrimary,
      );
      cy -= blockHeight(item.summaryLines, 9.25, 2.4) + 4;

      item.bulletLines.forEach((bLines) => {
        page.drawCircle({
          x: startX + 39,
          y: cy - 4,
          size: 1.7,
          color: COLORS.brandPrimary,
        });
        drawLines(
          page,
          bLines,
          startX + 47,
          cy,
          fonts.regular,
          9.0,
          2.2,
          COLORS.textSecondary,
        );
        cy -= blockHeight(bLines, 9.0, 2.2) + 3;
      });

      y -= item.cardHeight + 8;
    }

    const isLastGuidePage = pageIdx === guidePages.length - 1;
    if (isLastGuidePage) {
      drawLinksCard(page, y - 2);
    }

    drawStandardFooter({
      pdfDoc,
      page,
      sideMargin: GUIDE_SIDE_MARGIN,
      fonts,
      pageNumber: startPageNumber + pageIdx,
      totalPages,
      leftText: `Guidance checked on ${GUIDANCE_CHECKED_DATE} — Official GOV.UK & UKCISA sources`,
      disclaimerNote:
        'Check official GOV.UK pages and your university offer letter for live fees, maintenance thresholds, and policy updates.',
    });
  });
}

// ============================================================================
// REQUIRED DOCUMENTS CHECKLIST PAGES (WITH INTERACTIVE ACROFORM CHECKBOXES)
// ============================================================================

interface MeasuredChecklistGroup {
  group: ChecklistGroup;
  noteLines: string[];
  items: Array<{
    item: ChecklistGroup['items'][number];
    labelLines: string[];
    noteLines: string[];
    rowHeight: number;
  }>;
  cardHeight: number;
}

function measureChecklistGroups(fonts: EmbeddedFonts): MeasuredChecklistGroup[] {
  const contentWidth = A4_WIDTH_PT - GUIDE_SIDE_MARGIN * 2;
  const itemTextW = contentWidth - 46 - 102; // checkbox col + status badge col

  return DOCUMENT_CHECKLIST_GROUPS.map((group) => {
    const noteLines = wrapText(
      group.circumstanceNote,
      fonts.regular,
      9.0,
      contentWidth - 20,
    );
    const headerH = 22 + blockHeight(noteLines, 9.0, 2.0) + 6;

    const measuredItems = group.items.map((item) => {
      const labelLines = wrapText(item.label, fonts.semiBold, 9.5, itemTextW);
      const itemNoteLines = wrapText(
        item.note,
        fonts.regular,
        9.0,
        itemTextW,
      );
      const rowHeight =
        6 +
        blockHeight(labelLines, 9.5, 2.0) +
        2.5 +
        blockHeight(itemNoteLines, 9.0, 2.0) +
        6;
      return { item, labelLines, noteLines: itemNoteLines, rowHeight };
    });

    const cardHeight =
      headerH + measuredItems.reduce((sum, r) => sum + r.rowHeight, 0);
    return { group, noteLines, items: measuredItems, cardHeight };
  });
}

function paginateChecklistContent(fonts: EmbeddedFonts): {
  groupPages: MeasuredChecklistGroup[][];
  bannerLines: string[];
  bannerHeight: number;
} {
  const contentWidth = A4_WIDTH_PT - GUIDE_SIDE_MARGIN * 2;
  const topY =
    A4_HEIGHT_PT - GUIDE_TOP_MARGIN - GUIDE_HEADER_H - GUIDE_NAV_H - 12;

  const bannerLines = wrapText(
    `${CHECKLIST_READER_INSTRUCTION} Status badges distinguish items that are Generally required from those that are If applicable depending on the university, course subject, or personal circumstances.`,
    fonts.medium,
    9.0,
    contentWidth - 20,
  );
  const bannerHeight = 8 + 13 + 3 + blockHeight(bannerLines, 9.0, 2.2) + 8;

  const groups = measureChecklistGroups(fonts);
  const groupPages: MeasuredChecklistGroup[][] = [[]];
  let curY = topY - bannerHeight - 10;

  for (const grp of groups) {
    if (
      curY - grp.cardHeight < MIN_CONTENT_BOTTOM_Y &&
      groupPages[groupPages.length - 1].length > 0
    ) {
      groupPages.push([]);
      curY = topY;
    }
    groupPages[groupPages.length - 1].push(grp);
    curY -= grp.cardHeight + 10;
  }

  return { groupPages, bannerLines, bannerHeight };
}

function renderChecklistPages(options: {
  pdfDoc: PDFDocument;
  checklistPages: PDFPage[];
  plan: ReturnType<typeof paginateChecklistContent>;
  checklistSelections: ChecklistSelections;
  fonts: EmbeddedFonts;
  embeddedLogo: PDFImage | null;
  studentName: string;
  startPageNumber: number;
  totalPages: number;
  shortlistStartPage: PDFPage;
  guideStartPage: PDFPage;
}): void {
  const {
    pdfDoc,
    checklistPages,
    plan,
    checklistSelections,
    fonts,
    embeddedLogo,
    studentName,
    startPageNumber,
    totalPages,
    shortlistStartPage,
    guideStartPage,
  } = options;

  const startX = GUIDE_SIDE_MARGIN;
  const contentWidth = A4_WIDTH_PT - GUIDE_SIDE_MARGIN * 2;
  const form = pdfDoc.getForm();

  checklistPages.forEach((page, pageIdx) => {
    const navBottomY = drawPageHeaderAndNav({
      pdfDoc,
      page,
      topMargin: GUIDE_TOP_MARGIN,
      sideMargin: GUIDE_SIDE_MARGIN,
      headerHeight: GUIDE_HEADER_H,
      navStripHeight: GUIDE_NAV_H,
      sectionLabel: 'Required Documents Checklist',
      subLabel:
        checklistPages.length > 1
          ? `Checklist Part ${pageIdx + 1} of ${checklistPages.length}`
          : 'Interactive Checklist',
      studentName,
      fonts,
      embeddedLogo,
      navLinks: [
        { label: 'Back to Course Shortlist', targetPage: shortlistStartPage },
        { label: 'UK Application Process', targetPage: guideStartPage },
      ],
    });

    let y = navBottomY - 12;

    if (pageIdx === 0) {
      page.drawRectangle({
        x: startX,
        y: y - plan.bannerHeight,
        width: contentWidth,
        height: plan.bannerHeight,
        color: COLORS.brandSoft,
        borderColor: COLORS.brandBorder,
        borderWidth: 0.75,
      });
      page.drawRectangle({
        x: startX,
        y: y - plan.bannerHeight,
        width: 3.5,
        height: plan.bannerHeight,
        color: COLORS.brandPrimary,
      });

      page.drawText(
        makeEncodable(
          fonts.bold,
          `Interactive Checklist for ${studentName}`,
          9.5,
        ),
        {
          x: startX + 10,
          y: y - 15,
          size: 9.5,
          font: fonts.bold,
          color: COLORS.brandDark,
        },
      );

      drawLines(
        page,
        plan.bannerLines,
        startX + 10,
        y - 23,
        fonts.medium,
        9.0,
        2.2,
        COLORS.textPrimary,
      );

      y -= plan.bannerHeight + 10;
    }

    const groupsOnPage = plan.groupPages[pageIdx] ?? [];
    for (const grp of groupsOnPage) {
      const headerBandH =
        22 + blockHeight(grp.noteLines, 9.0, 2.0) + 6;

      page.drawRectangle({
        x: startX,
        y: y - grp.cardHeight,
        width: contentWidth,
        height: grp.cardHeight,
        color: COLORS.white,
        borderColor: COLORS.borderStrong,
        borderWidth: 0.75,
      });

      page.drawRectangle({
        x: startX + 0.5,
        y: y - headerBandH,
        width: contentWidth - 1,
        height: headerBandH - 0.5,
        color: COLORS.surfaceTint,
      });

      page.drawText(grp.group.title.toUpperCase(), {
        x: startX + 10,
        y: y - 15,
        size: 9.5,
        font: fonts.bold,
        color: COLORS.brandDark,
      });

      drawLines(
        page,
        grp.noteLines,
        startX + 10,
        y - 23,
        fonts.regular,
        9.0,
        2.0,
        COLORS.textSecondary,
      );

      let rowTopY = y - headerBandH;

      grp.items.forEach((entry, idx) => {
        page.drawLine({
          start: { x: startX, y: rowTopY },
          end: { x: startX + contentWidth, y: rowTopY },
          thickness: 0.5,
          color: COLORS.border,
        });

        if (idx % 2 === 1) {
          page.drawRectangle({
            x: startX + 0.5,
            y: rowTopY - entry.rowHeight,
            width: contentWidth - 1,
            height: entry.rowHeight,
            color: COLORS.surfaceTint,
          });
        }

        // Genuine interactive AcroForm CheckBox with unique field name & accessible label (/TU)
        const boxSize = 13;
        const boxX = startX + 12;
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

        // Label
        const textX = startX + 34;
        drawLines(
          page,
          entry.labelLines,
          textX,
          rowTopY - 6,
          fonts.semiBold,
          9.5,
          2.0,
          COLORS.textPrimary,
        );

        // Status pill ("Generally required" | "If applicable")
        const isGeneral = entry.item.status === 'Generally required';
        const pillW = 86;
        const pillH = 14.5;
        const pillX = startX + contentWidth - pillW - 10;
        const pillY = rowTopY - 19;

        page.drawRectangle({
          x: pillX,
          y: pillY,
          width: pillW,
          height: pillH,
          color: isGeneral ? COLORS.brandSoft : COLORS.slateBadgeBg,
          borderColor: isGeneral ? COLORS.brandBorder : COLORS.borderStrong,
          borderWidth: 0.6,
        });

        const statusW = measureWidth(fonts.semiBold, entry.item.status, 7.75);
        page.drawText(entry.item.status, {
          x: pillX + (pillW - statusW) / 2,
          y: pillY + 4.3,
          size: 7.75,
          font: fonts.semiBold,
          color: isGeneral ? COLORS.brandDark : COLORS.textSecondary,
        });

        // Circumstance note
        const labelH = blockHeight(entry.labelLines, 9.5, 2.0);
        drawLines(
          page,
          entry.noteLines,
          textX,
          rowTopY - 6 - labelH - 2.5,
          fonts.regular,
          9.0,
          2.0,
          COLORS.textSecondary,
        );

        rowTopY -= entry.rowHeight;
      });

      y -= grp.cardHeight + 10;
    }

    drawStandardFooter({
      pdfDoc,
      page,
      sideMargin: GUIDE_SIDE_MARGIN,
      fonts,
      pageNumber: startPageNumber + pageIdx,
      totalPages,
      leftText: `Prepared for ${studentName} — Guidance checked on ${GUIDANCE_CHECKED_DATE}`,
      disclaimerNote: CHECKLIST_READER_INSTRUCTION,
    });
  });
}

// ============================================================================
// MAIN DOCUMENT BUILDER
// ============================================================================

export interface GeneratePdfOptions {
  courses: CourseRecord[];
  currency: CurrencyCode | null;
  studentName: string;
  checklistSelections?: ChecklistSelections;
  logo?: InMemoryLogo | null;
  fontBytes?: FontBytesBundle;
}

/**
 * Generates one combined A4 portrait PDF:
 * 1. Course shortlist (exactly one course per page)
 * 2. UK Application Process guide
 * 3. Interactive Required Documents Checklist
 * Blocks export with a clear course error if any course overflows one A4 page at 9pt minimum.
 */
export async function generateCourseShortlistPdf(
  options: GeneratePdfOptions,
): Promise<PdfGenerationResult> {
  const {
    courses,
    currency,
    studentName,
    checklistSelections = {},
    logo = null,
    fontBytes,
  } = options;

  const trimmedStudentName = studentName.trim();
  if (!trimmedStudentName) {
    return {
      ok: false,
      failures: [],
      message: 'Student Name is required before generating the personalized PDF.',
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

  // Measure every course strictly BEFORE drawing
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

  // Embed logo (custom uploaded override or bundled Eccho Overseas default logo)
  let embeddedLogo: PDFImage | null = null;
  if (logo) {
    embeddedLogo =
      logo.mimeType === 'image/png'
        ? await pdfDoc.embedPng(logo.bytes)
        : await pdfDoc.embedJpg(logo.bytes);
  } else {
    const defaultLogo = await loadDefaultBrandLogo();
    if (defaultLogo) {
      embeddedLogo =
        defaultLogo.mimeType === 'image/png'
          ? await pdfDoc.embedPng(defaultLogo.bytes)
          : await pdfDoc.embedJpg(defaultLogo.bytes);
    }
  }

  // Paginate Guide & Checklist sections
  const guidePlan = paginateGuideContent(fonts);
  const guidePageCount =
    guidePlan.stepPages.length + (guidePlan.linksFitOnLastStepPage ? 0 : 1);

  const checklistPlan = paginateChecklistContent(fonts);
  const checklistPageCount = checklistPlan.groupPages.length;

  // Create all PDF pages upfront so internal /GoTo links can resolve forward/backward refs
  const coursePages = courses.map(() =>
    pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]),
  );
  const guidePages = Array.from({ length: guidePageCount }, () =>
    pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]),
  );
  const checklistPages = Array.from({ length: checklistPageCount }, () =>
    pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]),
  );

  const totalPages = pdfDoc.getPageCount();
  const guideStartPageNum = coursePages.length + 1;
  const checklistStartPageNum = coursePages.length + guidePages.length + 1;

  // 1. Render Course Shortlist Pages (1 course per page)
  for (let i = 0; i < courses.length; i += 1) {
    renderCoursePage({
      pdfDoc,
      page: coursePages[i],
      course: courses[i],
      layout: courseLayouts[i],
      fonts,
      embeddedLogo,
      studentName: trimmedStudentName,
      courseIndex: i,
      courseCount: courses.length,
      pageNumber: i + 1,
      totalPages,
      guideStartPage: guidePages[0],
      checklistStartPage: checklistPages[0],
    });
  }

  // 2. Render UK Application Process Guide Pages
  renderGuidePages({
    pdfDoc,
    guidePages,
    plan: guidePlan,
    fonts,
    embeddedLogo,
    studentName: trimmedStudentName,
    startPageNumber: guideStartPageNum,
    totalPages,
    shortlistStartPage: coursePages[0],
    checklistStartPage: checklistPages[0],
  });

  // 3. Render Required Documents Checklist Pages (with interactive checkboxes)
  renderChecklistPages({
    pdfDoc,
    checklistPages,
    plan: checklistPlan,
    checklistSelections,
    fonts,
    embeddedLogo,
    studentName: trimmedStudentName,
    startPageNumber: checklistStartPageNum,
    totalPages,
    shortlistStartPage: coursePages[0],
    guideStartPage: guidePages[0],
  });

  const pdfBytes = await pdfDoc.save();
  return {
    ok: true,
    pdfBytes,
    pageCount: totalPages,
    coursePageCount: coursePages.length,
    guideStartPage: guideStartPageNum,
    checklistStartPage: checklistStartPageNum,
    tiersUsed: courseLayouts.map((l) => l.tier.name),
  };
}
