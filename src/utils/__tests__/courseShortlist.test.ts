import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import readXlsxFile from 'read-excel-file/node';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_READER_INSTRUCTION,
  DOCUMENT_CHECKLIST_GROUPS,
  GUIDANCE_CHECKED_DATE,
  OFFICIAL_GUIDANCE_LINKS,
} from '../../config/ukGuide';
import type { InMemoryLogo, RawCell, WorkbookSheet } from '../../types/course';
import {
  buildWorkbookSession,
  ExcelValidationError,
  parseCoursesFromSheet,
} from '../excelParser';
import {
  A4_HEIGHT_PT,
  A4_WIDTH_PT,
  generateCourseShortlistPdf,
  type FontBytesBundle,
} from '../pdfGenerator';
import {
  buildShortlistFilename,
  formatTuitionFee,
  normalizeDisplayValue,
  normalizeWebsiteUrl,
} from '../valueFormatting';

function loadNodeFontBytes(): FontBytesBundle {
  const base = path.resolve(
    process.cwd(),
    'node_modules/@expo-google-fonts/inter',
  );
  return {
    regular: new Uint8Array(
      fs.readFileSync(path.join(base, '400Regular/Inter_400Regular.ttf')),
    ),
    medium: new Uint8Array(
      fs.readFileSync(path.join(base, '500Medium/Inter_500Medium.ttf')),
    ),
    semiBold: new Uint8Array(
      fs.readFileSync(path.join(base, '600SemiBold/Inter_600SemiBold.ttf')),
    ),
    bold: new Uint8Array(
      fs.readFileSync(path.join(base, '700Bold/Inter_700Bold.ttf')),
    ),
  };
}

function loadNodeDefaultLogo(): InMemoryLogo {
  const logoBytes = new Uint8Array(
    fs.readFileSync(path.resolve(process.cwd(), 'src/assets/eccho-logo.png')),
  );
  return {
    fileName: 'eccho-logo.png',
    mimeType: 'image/png',
    bytes: logoBytes,
    previewUrl: '',
  };
}

const LOCAL_SAMPLE_XLSX = path.resolve(
  process.cwd(),
  'Course_Comparison_2026-11-11 (1).xlsx',
);
const HAS_LOCAL_SAMPLE = fs.existsSync(LOCAL_SAMPLE_XLSX);

async function readLocalWorkbook(): Promise<WorkbookSheet[]> {
  const buffer = fs.readFileSync(LOCAL_SAMPLE_XLSX);
  const parsed = (await readXlsxFile(buffer)) as Array<{
    sheet: string;
    data: RawCell[][];
  }>;
  return parsed.map((s) => ({ name: s.sheet, rows: s.data }));
}

function buildFixtureWorkbook(): WorkbookSheet[] {
  return [
    {
      name: 'Comparison',
      rows: [['COURSE COMPARISON REPORT'], ['COST & FUNDING (GBP)']],
    },
    {
      name: 'Course Data',
      rows: [
        [
          '#',
          'Program Name',
          'University',
          'University Ranking (Key factor)',
          'Website URL',
          'Campus',
          'Country',
          'Study Level',
          'Duration',
          'Open Intake',
          'Entry Requirement',
          'Yearly Tuition Fee',
          'Scholarship Available',
          'Faculties',
          'Duolingo',
          'ELLT',
          'ESOL',
          'English waiver based on class 12th CBSE/ICSE marks',
          'I want English waiver based on UK qualification',
          'I want English waiver based on my class 12th marks (State Board)',
          'IELTS',
          'Kaplan Test of English',
          'Language Certificate Academic SELT',
          'PTE',
          'Skills For English',
          'TOEFL',
        ],
        [
          1,
          'Computing with Digital Media MSc',
          'University of Sussex',
          1,
          'http://www.sussex.ac.uk',
          'Brighton, Falmer',
          'United Kingdom',
          'Postgraduate',
          '1 year full time',
          'January/February 2027, September/October 2027',
          'Applicable to All (Default): India: 68%; Ordinary Degree (3 Yrs): India: 50%',
          28100,
          '3000',
          '—',
          110,
          6,
          'B2',
          70,
          0,
          70,
          6,
          'N/A',
          65,
          59,
          'N/A',
          80,
        ],
        [
          2,
          'Digital Business MSc',
          'Northumbria University Newcastle Campus',
          '—',
          'https://www.northumbria.ac.uk/',
          'Newcastle',
          'United Kingdom',
          'Postgraduate',
          '1 Year',
          'January/February 2027, September/October 2027',
          'Undergraduate (4 Yrs Degree): India: 55%; Honors Degree (3 Yrs): India: 55%',
          21500,
          'Contact for Scholarship',
          '—',
          120,
          'N/A',
          0,
          60,
          'N/A',
          70,
          6.5,
          'N/A',
          0,
          69,
          'N/A',
          '89 or 4',
        ],
      ],
    },
  ];
}

describe('Value formatting & student personalisation rules', () => {
  it('preserves zero, mixed text/numeric, decimals, and normalizes blanks/em-dash/N/A', () => {
    expect(normalizeDisplayValue(0)).toBe('0');
    expect(normalizeDisplayValue('0')).toBe('0');
    expect(normalizeDisplayValue('89 or 4')).toBe('89 or 4');
    expect(normalizeDisplayValue('B2')).toBe('B2');
    expect(normalizeDisplayValue(6.5)).toBe('6.5');
    expect(normalizeDisplayValue(1)).toBe('1');
    expect(normalizeDisplayValue('')).toBe('Not specified');
    expect(normalizeDisplayValue('—')).toBe('Not specified');
    expect(normalizeDisplayValue('N/A')).toBe('Not specified');
  });

  it('validates website URLs safely', () => {
    expect(normalizeWebsiteUrl('http://www.sussex.ac.uk')).toEqual({
      display: 'http://www.sussex.ac.uk',
      href: 'http://www.sussex.ac.uk/',
    });
    expect(normalizeWebsiteUrl('javascript:alert(1)')).toEqual({
      display: 'javascript:alert(1)',
      href: null,
    });
  });

  it('sanitizes only the download filename while preserving expected format', () => {
    expect(buildShortlistFilename('Aarav Sharma')).toBe(
      'Eccho_Overseas_Aarav_Sharma_Course_Shortlist.pdf',
    );
    expect(buildShortlistFilename("  Mary-Jane O'Connor / Test:1 ")).toBe(
      "Eccho_Overseas_Mary-Jane_O'Connor_Test1_Course_Shortlist.pdf",
    );
  });
});

describe('Excel parsing & edge cases', () => {
  it('auto-selects Course Data, ignores Comparison as courses, detects GBP, and preserves values', () => {
    const sheets = buildFixtureWorkbook();
    const session = buildWorkbookSession('fixture.xlsx', sheets);

    expect(session.autoSelectedCourseData).toBe(true);
    expect(session.selectedSheet).toBe('Course Data');
    expect(session.detectedCurrency).toBe('GBP');

    const courses = parseCoursesFromSheet(session.sheets, session.selectedSheet);
    expect(courses).toHaveLength(2);
    expect(courses[0].universityRanking).toBe('1');
    expect(courses[0].faculty).toBeNull();
    expect(formatTuitionFee(courses[0].yearlyTuitionFee, 'GBP')).toBe('£28,100');
    expect(courses[1].englishTests.find((t) => t.label === 'TOEFL')?.value).toBe(
      '89 or 4',
    );
  });

  it.runIf(HAS_LOCAL_SAMPLE)(
    'parses all 6 courses from the local sample workbook in exact order',
    async () => {
      const sheets = await readLocalWorkbook();
      const session = buildWorkbookSession(
        'Course_Comparison_2026-11-11 (1).xlsx',
        sheets,
      );
      const courses = parseCoursesFromSheet(session.sheets, session.selectedSheet);
      expect(courses).toHaveLength(6);
    },
  );

  it('throws clear errors when required headers are missing', () => {
    const sheets: WorkbookSheet[] = [
      {
        name: 'Sheet1',
        rows: [
          ['Course Code', 'Country'],
          ['CS101', 'UK'],
        ],
      },
    ];
    expect(() => parseCoursesFromSheet(sheets, 'Sheet1')).toThrow(
      ExcelValidationError,
    );
  });
});

describe('Personalized PDF generation, clickable navigation & interactive checkboxes', () => {
  it('generates course pages followed by UK Application Process and Required Documents Checklist with internal GoTo links, external official links, and interactive checkboxes', async () => {
    const sheets = HAS_LOCAL_SAMPLE
      ? await readLocalWorkbook()
      : buildFixtureWorkbook();
    const session = buildWorkbookSession('courses.xlsx', sheets);
    const courses = parseCoursesFromSheet(session.sheets, session.selectedSheet);
    const studentName = "Aarav O'Connor";

    const result = await generateCourseShortlistPdf({
      courses,
      currency: session.detectedCurrency,
      studentName,
      checklistSelections: {
        doc_app_passport_copy: true,
        doc_visa_tb_certificate: true,
      },
      logo: loadNodeDefaultLogo(),
      fontBytes: loadNodeFontBytes(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.coursePageCount).toBe(courses.length);
    expect(result.guideStartPage).toBe(courses.length + 1);
    expect(result.checklistStartPage).toBeGreaterThan(result.guideStartPage);
    expect(result.pageCount).toBeGreaterThanOrEqual(result.checklistStartPage);

    const pdf = await pdfjsLib.getDocument({ data: result.pdfBytes.slice() })
      .promise;
    expect(pdf.numPages).toBe(result.pageCount);

    // 1. Verify course pages (Pages 1..N)
    for (let i = 1; i <= result.coursePageCount; i += 1) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      expect(Math.round(viewport.width)).toBe(Math.round(A4_WIDTH_PT));
      expect(Math.round(viewport.height)).toBe(Math.round(A4_HEIGHT_PT));

      const joined = (await page.getTextContent()).items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      expect(joined).toContain(`Prepared for ${studentName}`);
      expect(joined).toContain(`Page ${i} of ${result.pageCount}`);
      expect(joined).toContain('UK Application Process');
      expect(joined).toContain('Required Documents Checklist');
      expect(joined).toContain(courses[i - 1].programName);

      // Verify internal GoTo links resolve to exact Guide and Checklist start pages
      const annots = await page.getAnnotations();
      const destPages: number[] = [];
      for (const a of annots as Array<{ subtype?: string; dest?: unknown[] }>) {
        if (a.subtype === 'Link' && Array.isArray(a.dest) && a.dest[0]) {
          const targetIdx = await pdf.getPageIndex(
            a.dest[0] as Parameters<typeof pdf.getPageIndex>[0],
          );
          destPages.push(targetIdx + 1);
        }
      }
      expect(destPages).toContain(result.guideStartPage);
      expect(destPages).toContain(result.checklistStartPage);
    }

    // 2. Verify UK Application Process pages (Guide)
    let guideTextCombined = '';
    const guideExternalUrls: string[] = [];
    const guideBackTargets: number[] = [];

    for (
      let p = result.guideStartPage;
      p < result.checklistStartPage;
      p += 1
    ) {
      const page = await pdf.getPage(p);
      const text = (await page.getTextContent()).items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      guideTextCombined += ` ${text}`;
      expect(text).toContain(`Prepared for ${studentName}`);
      expect(text).toContain(`Page ${p} of ${result.pageCount}`);

      const annots = await page.getAnnotations();
      for (const a of annots as Array<{
        subtype?: string;
        url?: string;
        dest?: unknown[];
      }>) {
        if (a.subtype === 'Link' && a.url) {
          guideExternalUrls.push(a.url);
        } else if (a.subtype === 'Link' && Array.isArray(a.dest) && a.dest[0]) {
          const targetIdx = await pdf.getPageIndex(
            a.dest[0] as Parameters<typeof pdf.getPageIndex>[0],
          );
          guideBackTargets.push(targetIdx + 1);
        }
      }
    }

    expect(guideTextCombined).toContain(`Guidance checked on ${GUIDANCE_CHECKED_DATE}`);
    expect(guideBackTargets).toContain(1);
    expect(guideBackTargets).toContain(result.checklistStartPage);
    for (const official of OFFICIAL_GUIDANCE_LINKS) {
      expect(guideExternalUrls).toContain(official.url);
    }

    // 3. Verify Required Documents Checklist pages & interactive checkboxes
    let checklistTextCombined = '';
    const checklistBackTargets: number[] = [];
    const widgetFieldNames: string[] = [];
    const widgetAltTexts: string[] = [];

    for (let p = result.checklistStartPage; p <= result.pageCount; p += 1) {
      const page = await pdf.getPage(p);
      const text = (await page.getTextContent()).items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      checklistTextCombined += ` ${text}`;
      expect(text).toContain(`Prepared for ${studentName}`);
      expect(text).toContain(`Page ${p} of ${result.pageCount}`);

      const annots = await page.getAnnotations();
      for (const a of annots as Array<{
        subtype?: string;
        dest?: unknown[];
        checkBox?: boolean;
        fieldName?: string;
        alternativeText?: string;
      }>) {
        if (a.subtype === 'Link' && Array.isArray(a.dest) && a.dest[0]) {
          const targetIdx = await pdf.getPageIndex(
            a.dest[0] as Parameters<typeof pdf.getPageIndex>[0],
          );
          checklistBackTargets.push(targetIdx + 1);
        } else if (a.subtype === 'Widget' && a.checkBox && a.fieldName) {
          widgetFieldNames.push(a.fieldName);
          widgetAltTexts.push(a.alternativeText ?? '');
        }
      }
    }

    expect(checklistTextCombined).toContain(CHECKLIST_READER_INSTRUCTION);
    expect(checklistBackTargets).toContain(1);
    expect(checklistBackTargets).toContain(result.guideStartPage);

    const expectedAllFields = DOCUMENT_CHECKLIST_GROUPS.flatMap((g) =>
      g.items.map((item) => item.fieldName),
    );
    expect(new Set(widgetFieldNames).size).toBe(expectedAllFields.length);
    for (const fieldName of expectedAllFields) {
      expect(widgetFieldNames).toContain(fieldName);
    }
    expect(widgetAltTexts.every((t) => t.length > 10)).toBe(true);

    // 4. Verify interactive checkboxes can be toggled, saved, and reopened cleanly
    const reopenedDoc = await PDFDocument.load(result.pdfBytes.slice());
    const form = reopenedDoc.getForm();
    expect(form.getCheckBox('doc_app_passport_copy').isChecked()).toBe(true);
    expect(form.getCheckBox('doc_visa_tb_certificate').isChecked()).toBe(true);
    expect(form.getCheckBox('doc_cas_deposit_receipt').isChecked()).toBe(false);

    // Verify /TU accessible label exists on AcroForm field
    const passportField = form.getCheckBox('doc_app_passport_copy');
    expect(
      passportField.acroField.dict.get(PDFName.of('TU'))?.toString(),
    ).toContain('Valid passport bio-data page copy');

    // Toggle states, save, and reopen
    form.getCheckBox('doc_app_passport_copy').uncheck();
    form.getCheckBox('doc_cas_deposit_receipt').check();
    const resavedBytes = await reopenedDoc.save();
    const reopenedAgain = await PDFDocument.load(resavedBytes);
    const form2 = reopenedAgain.getForm();
    expect(form2.getCheckBox('doc_app_passport_copy').isChecked()).toBe(false);
    expect(form2.getCheckBox('doc_cas_deposit_receipt').isChecked()).toBe(true);
    expect(form2.getCheckBox('doc_visa_tb_certificate').isChecked()).toBe(true);
  });

  it('blocks export with a clear course error if Student Name is missing or course overflows 9pt single-page limit', async () => {
    const sheets = buildFixtureWorkbook();
    const courses = parseCoursesFromSheet(sheets, 'Course Data');

    const missingStudent = await generateCourseShortlistPdf({
      courses,
      currency: 'GBP',
      studentName: '   ',
      fontBytes: loadNodeFontBytes(),
    });
    expect(missingStudent.ok).toBe(false);

    const oversized = {
      ...courses[0],
      entryRequirementLines: Array.from(
        { length: 45 },
        (_, i) =>
          `Condition ${i + 1}: Applicants must demonstrate comprehensive academic preparation across all modules with minimum 65% average across final four semesters and portfolio interview.`,
      ),
    };

    const result = await generateCourseShortlistPdf({
      courses: [oversized],
      currency: 'GBP',
      studentName: 'Aarav Sharma',
      fontBytes: loadNodeFontBytes(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].programName).toBe(oversized.programName);
  });
});
