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
import type {
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
const FOOTER_BOTTOM_PAD = 20;
const FOOTER_RULE_Y = 62;
const CONTENT_FOOTER_GAP = 10;
const MIN_CONTENT_BOTTOM_Y = FOOTER_RULE_Y + CONTENT_FOOTER_GAP; // 72 pt from bottom

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
    topMargin: 24,
    sideMargin: 34,
    minContentY: MIN_CONTENT_BOTTOM_Y,
    headerHeight: 46,
    programTitleSize: 16,
    universitySize: 11,
    locationSize: 9.5,
    sectionHeaderSize: 9.5,
    labelSize: 8.5,
    bodySize: 9.5,
    tableTextSize: 9.0,
    tuitionValueSize: 14,
    sectionGap: 10,
    cardPadX: 10,
    cardPadY: 7.5,
    lineGap: 3.2,
    tableRowHeight: 18,
    twoColumnAcademic: false,
  },
  {
    name: 'compact-spacing',
    topMargin: 20,
    sideMargin: 30,
    minContentY: MIN_CONTENT_BOTTOM_Y,
    headerHeight: 42,
    programTitleSize: 15,
    universitySize: 10.5,
    locationSize: 9.25,
    sectionHeaderSize: 9.25,
    labelSize: 8.25,
    bodySize: 9.25,
    tableTextSize: 9.0,
    tuitionValueSize: 13.5,
    sectionGap: 7.5,
    cardPadX: 8.5,
    cardPadY: 6,
    lineGap: 2.5,
    tableRowHeight: 16.5,
    twoColumnAcademic: false,
  },
  {
    name: 'compact-two-column',
    topMargin: 18,
    sideMargin: 28,
    minContentY: MIN_CONTENT_BOTTOM_Y,
    headerHeight: 40,
    programTitleSize: 14.5,
    universitySize: 10.25,
    locationSize: 9.0,
    sectionHeaderSize: 9.0,
    labelSize: 8.0,
    bodySize: 9.0,
    tableTextSize: 9.0,
    tuitionValueSize: 13,
    sectionGap: 6.5,
    cardPadX: 7.5,
    cardPadY: 5,
    lineGap: 2.2,
    tableRowHeight: 15.5,
    twoColumnAcademic: true,
  },
  {
    name: 'tight-minimum-9pt',
    topMargin: 16,
    sideMargin: 24,
    minContentY: MIN_CONTENT_BOTTOM_Y,
    headerHeight: 38,
    programTitleSize: 13.5,
    universitySize: 10.0,
    locationSize: 9.0,
    sectionHeaderSize: 9.0,
    labelSize: 8.0,
    bodySize: 9.0,
    tableTextSize: 9.0,
    tuitionValueSize: 12.5,
    sectionGap: 5,
    cardPadX: 6.5,
    cardPadY: 4.5,
    lineGap: 1.8,
    tableRowHeight: 14.5,
    twoColumnAcademic: true,
  },
];

let cachedBrowserFontBytes: Promise<FontBytesBundle> | null = null;

async function fetchFontBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load embedded font asset (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function loadBrowserFontBytes(): Promise<FontBytesBundle> {
  if (!cachedBrowserFontBytes) {
    cachedBrowserFontBytes = Promise.all([
      fetchFontBytes(regularFontUrl),
      fetchFontBytes(mediumFontUrl),
      fetchFontBytes(semiBoldFontUrl),
      fetchFontBytes(boldFontUrl),
    ]).then(([regular, medium, semiBold, bold]) => ({
      regular,
      medium,
      semiBold,
      bold,
    }));
  }
  return cachedBrowserFontBytes;
}

function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

const COLORS = {
  navyPrimary: hexToRgb(BRAND_CONFIG.colors.navyPrimary),
  navySecondary: hexToRgb(BRAND_CONFIG.colors.navySecondary),
  orangeAccent: hexToRgb(BRAND_CONFIG.colors.orangeAccent),
  orangeSoft: hexToRgb(BRAND_CONFIG.colors.orangeSoft),
  orangeBorder: hexToRgb(BRAND_CONFIG.colors.orangeBorder),
  surfaceTint: hexToRgb(BRAND_CONFIG.colors.surfaceTint),
  surfaceAlt: hexToRgb(BRAND_CONFIG.colors.surfaceAlt),
  border: hexToRgb(BRAND_CONFIG.colors.border),
  borderStrong: hexToRgb(BRAND_CONFIG.colors.borderStrong),
  textPrimary: hexToRgb(BRAND_CONFIG.colors.textPrimary),
  textSecondary: hexToRgb(BRAND_CONFIG.colors.textSecondary),
  textMuted: hexToRgb(BRAND_CONFIG.colors.textMuted),
  white: hexToRgb(BRAND_CONFIG.colors.white),
};

function cleanControlChars(text: string): string {
  // Remove invisible control / zero-width chars that PDF encoders reject
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\uFEFF]/g, '');
}

function measureWidth(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    // Fallback: strip any unsupported glyph code points character by character
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

      // If single token exceeds maxWidth, split cleanly across lines without truncation
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

interface MeasuredCourseLayout {
  tier: LayoutTier;
  contentWidth: number;
  startX: number;
  requiredBottomY: number;
  totalContentHeight: number;
  availableContentHeight: number;
  // Course Heading
  programLines: string[];
  universityLines: string[];
  locationLines: string[];
  headingHeight: number;
  // Program Overview
  overviewGridItems: Array<{ label: string; lines: string[]; height: number }>;
  overviewRow1Height: number;
  intakeLines: string[];
  facultyLines: string[] | null;
  overviewBoxHeight: number;
  // Fees & Scholarships
  tuitionDisplay: string;
  tuitionLines: string[];
  scholarshipLines: string[];
  feesBoxHeight: number;
  // Academic Entry Requirements
  academicItems: string[][]; // Each condition wrapped to lines
  academicTwoColumn: boolean;
  academicBoxHeight: number;
  // English Language Requirements
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
  let y = topStartY - tier.headerHeight - tier.sectionGap;

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
    blockHeight(programLines, tier.programTitleSize, 3) +
    4 +
    blockHeight(universityLines, tier.universitySize, 2.5) +
    3 +
    blockHeight(locationLines, tier.locationSize, 2.2);

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
    7 +
    intakeBlockH +
    facultyBlockH;

  y -= overviewBoxHeight + tier.sectionGap;

  // 3. Fees & Scholarships (2-column card: Tuition on left 146pt, Scholarship on right)
  y -= sectionTitleH;
  const tuitionColWidth = 148;
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

  // 5. English Language Requirements (Compact 2-up Table + 3 Waivers)
  y -= sectionTitleH;

  // Pair all 9 tests into 5 rows (left + right columns) with wrapped cell measurement
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
    const rowHeight = Math.max(tier.tableRowHeight, contentH + 7);

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

  y -= englishTableHeight + 6;

  // English Waiver Subsection (3 fields)
  const waiverSubheadingH = tier.labelSize + 4;
  y -= waiverSubheadingH;

  const waiverInnerW = contentWidth - tier.cardPadX * 2;
  const waiverColGap = 10;
  const waiverColW3 = (waiverInnerW - waiverColGap * 2) / 3;

  // Check if all 3 waiver values fit neatly in 3 columns or need stacked layout
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
): { ok: true; layout: MeasuredCourseLayout } | { ok: false; tightest: MeasuredCourseLayout } {
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
    color: COLORS.orangeAccent,
  });

  page.drawText(title, {
    x: x + 8,
    y: topY - fontSize * 0.84,
    size: fontSize,
    font,
    color: COLORS.navyPrimary,
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
  // Ensure PDF/A-safe PDFName is retained cleanly (already resolved by context.obj)
  void PDFName;
}

function renderCoursePage(
  pdfDoc: PDFDocument,
  page: PDFPage,
  course: CourseRecord,
  layout: MeasuredCourseLayout,
  fonts: EmbeddedFonts,
  embeddedLogo: PDFImage | null,
  pageIndex: number,
  totalPages: number,
): void {
  const { tier, startX, contentWidth } = layout;

  // Pure white A4 page background
  page.drawRectangle({
    x: 0,
    y: 0,
    width: A4_WIDTH_PT,
    height: A4_HEIGHT_PT,
    color: COLORS.white,
  });

  // Top executive accent strip
  page.drawRectangle({
    x: 0,
    y: A4_HEIGHT_PT - 4,
    width: A4_WIDTH_PT,
    height: 4,
    color: COLORS.navyPrimary,
  });
  page.drawRectangle({
    x: 0,
    y: A4_HEIGHT_PT - 4,
    width: 120,
    height: 4,
    color: COLORS.orangeAccent,
  });

  // 1. Branded Header
  const headerTopY = A4_HEIGHT_PT - tier.topMargin;
  const headerBottomY = headerTopY - tier.headerHeight;

  if (embeddedLogo) {
    const maxLogoW = 145;
    const maxLogoH = tier.headerHeight - 14;
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
    // Crisp typographic ECCHO OVERSEAS wordmark
    const ecchoText = 'ECCHO';
    const overseasText = 'OVERSEAS';
    const wordSize = 14;
    const ecchoW = measureWidth(fonts.bold, ecchoText, wordSize);

    page.drawText(ecchoText, {
      x: startX,
      y: headerTopY - 15,
      size: wordSize,
      font: fonts.bold,
      color: COLORS.navyPrimary,
    });
    page.drawText(overseasText, {
      x: startX + ecchoW + 5,
      y: headerTopY - 15,
      size: wordSize,
      font: fonts.semiBold,
      color: COLORS.orangeAccent,
    });
    page.drawRectangle({
      x: startX,
      y: headerTopY - 20,
      width: 34,
      height: 1.75,
      color: COLORS.orangeAccent,
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
      y: headerBottomY + 6,
      size: 8,
      font: fonts.regular,
      color: COLORS.textMuted,
    });
  }

  // Right header: "Course Shortlist" & Programme count
  const docTitleText = BRAND_CONFIG.documentTitle;
  const docTitleW = measureWidth(fonts.bold, docTitleText, 10.5);
  page.drawText(docTitleText, {
    x: startX + contentWidth - docTitleW,
    y: headerTopY - 13,
    size: 10.5,
    font: fonts.bold,
    color: COLORS.navyPrimary,
  });

  const subHeaderText = `Course ${pageIndex + 1} of ${totalPages}`;
  const subHeaderW = measureWidth(fonts.medium, subHeaderText, 8.5);
  page.drawText(subHeaderText, {
    x: startX + contentWidth - subHeaderW,
    y: headerTopY - 25,
    size: 8.5,
    font: fonts.medium,
    color: COLORS.textMuted,
  });

  page.drawLine({
    start: { x: startX, y: headerBottomY },
    end: { x: startX + contentWidth, y: headerBottomY },
    thickness: 0.9,
    color: COLORS.borderStrong,
  });

  let y = headerBottomY - tier.sectionGap;

  // 2. Course Heading
  drawLines(
    page,
    layout.programLines,
    startX,
    y,
    fonts.bold,
    tier.programTitleSize,
    3,
    COLORS.navyPrimary,
  );
  y -= blockHeight(layout.programLines, tier.programTitleSize, 3) + 4;

  drawLines(
    page,
    layout.universityLines,
    startX,
    y,
    fonts.semiBold,
    tier.universitySize,
    2.5,
    COLORS.navySecondary,
  );
  y -= blockHeight(layout.universityLines, tier.universitySize, 2.5) + 3;

  drawLines(
    page,
    layout.locationLines,
    startX,
    y,
    fonts.regular,
    tier.locationSize,
    2.2,
    COLORS.textSecondary,
  );
  y -= blockHeight(layout.locationLines, tier.locationSize, 2.2) + tier.sectionGap;

  // 3. Program Overview
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

  innerY -= layout.overviewRow1Height + 7;

  // Open Intake (full width inside box)
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

  // 4. Fees & Scholarships
  y = drawSectionHeading(
    page,
    'FEES & SCHOLARSHIPS',
    startX,
    y,
    contentWidth,
    fonts.bold,
    tier.sectionHeaderSize,
  );

  const tuitionColWidth = 148;
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

  // Subtle warm accent pane behind Yearly Tuition Fee
  page.drawRectangle({
    x: startX + 0.75,
    y: y - layout.feesBoxHeight + 0.75,
    width: leftPaneW - 0.75,
    height: layout.feesBoxHeight - 1.5,
    color: COLORS.orangeSoft,
  });

  page.drawLine({
    start: { x: startX + leftPaneW, y },
    end: { x: startX + leftPaneW, y: y - layout.feesBoxHeight },
    thickness: 0.75,
    color: COLORS.orangeBorder,
  });

  const feeInnerY = y - tier.cardPadY;
  page.drawText('Yearly Tuition Fee', {
    x: startX + tier.cardPadX,
    y: feeInnerY - tier.labelSize * 0.82,
    size: tier.labelSize,
    font: fonts.semiBold,
    color: COLORS.orangeAccent,
  });
  drawLines(
    page,
    layout.tuitionLines,
    startX + tier.cardPadX,
    feeInnerY - tier.labelSize - 4,
    fonts.bold,
    tier.tuitionValueSize,
    2.5,
    COLORS.navyPrimary,
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

  // 5. Academic Entry Requirements
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
        color: COLORS.orangeAccent,
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
          color: COLORS.orangeAccent,
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
        color: COLORS.orangeAccent,
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

  // 6. English Language Requirements
  y = drawSectionHeading(
    page,
    'ENGLISH LANGUAGE REQUIREMENTS',
    startX,
    y,
    contentWidth,
    fonts.bold,
    tier.sectionHeaderSize,
  );

  // Compact 2-up Table (4 columns: Test | Score | Test | Score)
  const halfW = contentWidth / 2;
  const labelColW = halfW * 0.695;
  const scoreColW = halfW - labelColW;
  const rowH = tier.tableRowHeight;
  const tableTopY = y;

  // Outer table border
  page.drawRectangle({
    x: startX,
    y: tableTopY - layout.englishTableHeight,
    width: contentWidth,
    height: layout.englishTableHeight,
    color: COLORS.white,
    borderColor: COLORS.borderStrong,
    borderWidth: 0.75,
  });

  // Header row background
  page.drawRectangle({
    x: startX + 0.5,
    y: tableTopY - rowH,
    width: contentWidth - 1,
    height: rowH - 0.5,
    color: COLORS.navyPrimary,
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

  // Table body rows with variable height support
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
      row.leftValueRaw === NOT_SPECIFIED ? COLORS.textMuted : COLORS.navyPrimary;
    const leftLabelH = blockHeight(row.leftLabelLines, tier.tableTextSize, 2);
    const leftLabelTopY =
      rowBottomY + curRowH - Math.max(3.5, (curRowH - leftLabelH) / 2);
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
      rowBottomY + curRowH - Math.max(3.5, (curRowH - leftValH) / 2);
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

    if (row.rightLabelLines && row.rightValueLines && row.rightValueRaw !== null) {
      const rightValColor =
        row.rightValueRaw === NOT_SPECIFIED
          ? COLORS.textMuted
          : COLORS.navyPrimary;
      const rightLabelH = blockHeight(row.rightLabelLines, tier.tableTextSize, 2);
      const rightLabelTopY =
        rowBottomY + curRowH - Math.max(3.5, (curRowH - rightLabelH) / 2);
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
        rowBottomY + curRowH - Math.max(3.5, (curRowH - rightValH) / 2);
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

  // Vertical center divider between left pair and right pair
  page.drawLine({
    start: { x: startX + halfW, y: tableTopY },
    end: { x: startX + halfW, y: tableTopY - layout.englishTableHeight },
    thickness: 0.75,
    color: COLORS.borderStrong,
  });
  // Light vertical dividers before score columns
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
  void scoreColW;

  y -= layout.englishTableHeight + 6;

  // Separate clearly labeled English Waiver subsection
  page.drawText('English Waiver Criteria', {
    x: startX,
    y: y - tier.labelSize * 0.85,
    size: tier.labelSize + 0.5,
    font: fonts.bold,
    color: COLORS.navySecondary,
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
        valIsNotSpec ? COLORS.textMuted : COLORS.navyPrimary,
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

  // 7. Footer (strictly outside content area at fixed bottom coordinates)
  page.drawLine({
    start: { x: startX, y: FOOTER_RULE_Y },
    end: { x: startX + contentWidth, y: FOOTER_RULE_Y },
    thickness: 0.75,
    color: COLORS.borderStrong,
  });

  const footerTopLineY = 47;
  const websiteLabel = 'University Website: ';
  const websiteLabelSize = 8.5;
  const labelW = measureWidth(fonts.medium, websiteLabel, websiteLabelSize);
  page.drawText(websiteLabel, {
    x: startX,
    y: footerTopLineY,
    size: websiteLabelSize,
    font: fonts.medium,
    color: COLORS.textSecondary,
  });

  // Right-side brand + pagination coordinates
  const rightFooterText = `${BRAND_CONFIG.brandName}   •   Page ${pageIndex + 1} of ${totalPages}`;
  const rightFooterW = measureWidth(fonts.semiBold, rightFooterText, 8.5);
  const rightFooterX = startX + contentWidth - rightFooterW;

  // Draw clickable university website link BEFORE right-side text for natural reading order
  const maxUrlW = Math.max(80, rightFooterX - (startX + labelW) - 16);
  const rawUrlDisplay = makeEncodable(
    fonts.medium,
    course.websiteUrlDisplay,
    websiteLabelSize,
  );
  let urlSize = websiteLabelSize;
  while (
    urlSize > 6.5 &&
    measureWidth(fonts.medium, rawUrlDisplay, urlSize) > maxUrlW
  ) {
    urlSize -= 0.5;
  }

  const urlColor = course.websiteHref ? COLORS.navySecondary : COLORS.textMuted;
  const urlX = startX + labelW;
  const urlW = measureWidth(fonts.medium, rawUrlDisplay, urlSize);

  page.drawText(rawUrlDisplay, {
    x: urlX,
    y: footerTopLineY,
    size: urlSize,
    font: fonts.medium,
    color: urlColor,
  });

  if (course.websiteHref) {
    page.drawLine({
      start: { x: urlX, y: footerTopLineY - 1.5 },
      end: { x: urlX + Math.min(urlW, maxUrlW), y: footerTopLineY - 1.5 },
      thickness: 0.5,
      color: COLORS.navySecondary,
    });

    addUriLinkAnnotation(
      pdfDoc,
      page,
      [
        urlX - 1,
        footerTopLineY - 3,
        urlX + Math.min(urlW, maxUrlW) + 1,
        footerTopLineY + 10,
      ],
      course.websiteHref,
    );
  }

  page.drawText(rightFooterText, {
    x: rightFooterX,
    y: footerTopLineY,
    size: 8.5,
    font: fonts.semiBold,
    color: COLORS.navyPrimary,
  });

  // Disclaimer note
  page.drawText(BRAND_CONFIG.footerNote, {
    x: startX,
    y: FOOTER_BOTTOM_PAD + 11,
    size: 7.5,
    font: fonts.regular,
    color: COLORS.textMuted,
  });
}

export interface GeneratePdfOptions {
  courses: CourseRecord[];
  currency: CurrencyCode | null;
  logo?: InMemoryLogo | null;
  fontBytes?: FontBytesBundle;
}

/**
 * Generates one combined A4 portrait PDF with exactly one course per page.
 * Validates strict single-page fitting before producing bytes; if any course
 * overflows at minimum readable 9pt text, blocks export and returns detailed errors.
 */
export async function generateCourseShortlistPdf(
  options: GeneratePdfOptions,
): Promise<PdfGenerationResult> {
  const { courses, currency, logo = null, fontBytes } = options;

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
  pdfDoc.setTitle(`${BRAND_CONFIG.brandName} — ${BRAND_CONFIG.documentTitle}`);
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
  const layouts: MeasuredCourseLayout[] = [];
  const failures: PageFitFailure[] = [];

  courses.forEach((course, idx) => {
    const decision = selectBestLayoutForCourse(course, currency, fonts);
    if (decision.ok) {
      layouts.push(decision.layout);
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

  // Embed optional logo (uploaded in memory or configured path)
  let embeddedLogo: PDFImage | null = null;
  if (logo) {
    embeddedLogo =
      logo.mimeType === 'image/png'
        ? await pdfDoc.embedPng(logo.bytes)
        : await pdfDoc.embedJpg(logo.bytes);
  } else if (BRAND_CONFIG.logoAssetPath) {
    const resp = await fetch(BRAND_CONFIG.logoAssetPath);
    if (resp.ok) {
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const contentType = resp.headers.get('content-type') ?? '';
      embeddedLogo = contentType.includes('png')
        ? await pdfDoc.embedPng(bytes)
        : await pdfDoc.embedJpg(bytes);
    }
  }

  const totalPages = courses.length;
  for (let i = 0; i < courses.length; i += 1) {
    const page = pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
    renderCoursePage(
      pdfDoc,
      page,
      courses[i],
      layouts[i],
      fonts,
      embeddedLogo,
      i,
      totalPages,
    );
  }

  const pdfBytes = await pdfDoc.save();
  return {
    ok: true,
    pdfBytes,
    pageCount: totalPages,
    tiersUsed: layouts.map((l) => l.tier.name),
  };
}
