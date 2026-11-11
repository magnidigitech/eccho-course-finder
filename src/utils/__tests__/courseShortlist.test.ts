import fs from 'node:fs';
import path from 'node:path';
import readXlsxFile from 'read-excel-file/node';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import type { RawCell, WorkbookSheet } from '../../types/course';
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
      rows: [
        ['COURSE COMPARISON REPORT'],
        ['COST & FUNDING (GBP)'],
      ],
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

describe('Value formatting & data integrity rules', () => {
  it('preserves zero, mixed text/numeric, decimals, and normalizes blanks/em-dash/N/A', () => {
    expect(normalizeDisplayValue(0)).toBe('0');
    expect(normalizeDisplayValue('0')).toBe('0');
    expect(normalizeDisplayValue('89 or 4')).toBe('89 or 4');
    expect(normalizeDisplayValue('B2')).toBe('B2');
    expect(normalizeDisplayValue(6.5)).toBe('6.5');
    expect(normalizeDisplayValue(1)).toBe('1');
    expect(normalizeDisplayValue('')).toBe('Not specified');
    expect(normalizeDisplayValue('   ')).toBe('Not specified');
    expect(normalizeDisplayValue(null)).toBe('Not specified');
    expect(normalizeDisplayValue(undefined)).toBe('Not specified');
    expect(normalizeDisplayValue('—')).toBe('Not specified');
    expect(normalizeDisplayValue('N/A')).toBe('Not specified');
    expect(normalizeDisplayValue(' n/a ')).toBe('Not specified');
  });

  it('validates website URLs safely', () => {
    expect(normalizeWebsiteUrl('http://www.sussex.ac.uk')).toEqual({
      display: 'http://www.sussex.ac.uk',
      href: 'http://www.sussex.ac.uk/',
    });
    expect(normalizeWebsiteUrl('www.sussex.ac.uk')).toEqual({
      display: 'www.sussex.ac.uk',
      href: 'https://www.sussex.ac.uk/',
    });
    expect(normalizeWebsiteUrl('javascript:alert(1)')).toEqual({
      display: 'javascript:alert(1)',
      href: null,
    });
  });

  it('builds local-date filename cleanly', () => {
    const dt = new Date(2026, 10, 11);
    expect(buildShortlistFilename(dt)).toBe(
      'Eccho_Overseas_Course_Shortlist_2026-11-11.pdf',
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
    expect(
      courses[0].englishTests.find((t) => t.label === 'ESOL')?.value,
    ).toBe('B2');
    expect(
      courses[0].englishWaivers.find((w) => w.label === 'UK Qualification')?.value,
    ).toBe('0');
    expect(formatTuitionFee(courses[0].yearlyTuitionFee, 'GBP')).toBe('£28,100');

    expect(courses[1].universityRanking).toBe('Not specified');
    expect(
      courses[1].englishTests.find((t) => t.label === 'TOEFL')?.value,
    ).toBe('89 or 4');
    expect(
      courses[1].englishTests.find((t) => t.label === 'ESOL')?.value,
    ).toBe('0');
  });

  it.runIf(HAS_LOCAL_SAMPLE)(
    'parses all 6 courses from the local sample workbook in exact order',
    async () => {
      const sheets = await readLocalWorkbook();
      const session = buildWorkbookSession(
        'Course_Comparison_2026-11-11 (1).xlsx',
        sheets,
      );

      expect(session.autoSelectedCourseData).toBe(true);
      expect(session.selectedSheet).toBe('Course Data');
      expect(session.detectedCurrency).toBe('GBP');

      const courses = parseCoursesFromSheet(session.sheets, session.selectedSheet);
      expect(courses).toHaveLength(6);
      expect(courses.map((c) => c.programName)).toEqual([
        'Computing with Digital Media MSc',
        'MBA (Digital Marketing)',
        'Digital Media Production - MSc',
        'Digital Media and Society MA',
        'Digital Marketing Management MSc',
        'Digital Business MSc',
      ]);

      const c5 = courses[4];
      expect(c5.scholarshipAvailable).toContain('£2,000 off the tuition fee');
      expect(c5.scholarshipAvailable).toContain(
        'Coventry University Online courses are excluded',
      );
      expect(
        c5.englishTests.find((t) => t.label === 'Skills For English')?.value,
      ).toBe('0');
    },
  );

  it('requires currency selection when workbook has no explicit currency, normalizes headers, skips empty rows, and keeps duplicates', () => {
    const sheets: WorkbookSheet[] = [
      {
        name: 'Shortlist',
        rows: [
          ['  program name  ', ' UNIVERSITY ', 'Yearly Tuition Fee', 'Faculties'],
          [null, null, null, null],
          ['MSc Data Science', 'University A', 18000, 'Computing'],
          ['   ', '   ', null, null],
          ['MSc Data Science', 'University A', 18000, 'Computing'],
        ],
      },
    ];

    const session = buildWorkbookSession('custom.xlsx', sheets);
    expect(session.autoSelectedCourseData).toBe(false);
    expect(session.selectedSheet).toBe('Shortlist');
    expect(session.detectedCurrency).toBeNull();

    const courses = parseCoursesFromSheet(session.sheets, session.selectedSheet);
    expect(courses).toHaveLength(2);
    expect(courses[0].faculty).toBe('Computing');
  });

  it('throws clear errors when required headers are missing', () => {
    const sheets: WorkbookSheet[] = [
      {
        name: 'Sheet1',
        rows: [['Course Code', 'Country'], ['CS101', 'UK']],
      },
    ];
    expect(() => parseCoursesFromSheet(sheets, 'Sheet1')).toThrow(
      ExcelValidationError,
    );
    expect(() => parseCoursesFromSheet(sheets, 'Sheet1')).toThrow(
      /Program Name, University/,
    );
  });
});

describe('PDF generation & strict single-page A4 fitting', () => {
  it('generates exactly one A4 portrait page per course with £, links, and Eccho Overseas branding', async () => {
    const sheets = HAS_LOCAL_SAMPLE
      ? await readLocalWorkbook()
      : buildFixtureWorkbook();
    const session = buildWorkbookSession('courses.xlsx', sheets);
    const courses = parseCoursesFromSheet(session.sheets, session.selectedSheet);

    const result = await generateCourseShortlistPdf({
      courses,
      currency: session.detectedCurrency,
      fontBytes: loadNodeFontBytes(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const expectedCount = courses.length;
    expect(result.pageCount).toBe(expectedCount);

    const pdf = await pdfjsLib.getDocument({ data: result.pdfBytes.slice() })
      .promise;
    expect(pdf.numPages).toBe(expectedCount);

    for (let i = 1; i <= expectedCount; i += 1) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      expect(Math.round(viewport.width)).toBe(Math.round(A4_WIDTH_PT));
      expect(Math.round(viewport.height)).toBe(Math.round(A4_HEIGHT_PT));

      const textContent = await page.getTextContent();
      const joined = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');

      expect(joined).toContain('Eccho Overseas');
      expect(joined).toContain(`Page ${i} of ${expectedCount}`);
      expect(joined).toContain('As provided');
      expect(joined).not.toMatch(/edwest/i);
      expect(joined).not.toContain('View Program Details');
      expect(joined).toContain(courses[i - 1].programName);

      const annots = await page.getAnnotations();
      const linkAnnots = annots.filter(
        (a: { subtype?: string }) => a.subtype === 'Link',
      );
      expect(linkAnnots.length).toBe(1);
    }

    const p1Text = (await (await pdf.getPage(1)).getTextContent()).items
      .map((i) => ('str' in i ? i.str : ''))
      .join(' ');
    expect(p1Text).toContain('£28,100');
    expect(p1Text).toContain('B2');

    const lastText = (
      await (await pdf.getPage(expectedCount)).getTextContent()
    ).items
      .map((i) => ('str' in i ? i.str : ''))
      .join(' ');
    expect(lastText).toContain('89 or 4');
    expect(lastText).toContain('£21,500');
  });

  it('blocks export with a clear course error if a course overflows a single A4 page at 9pt minimum', async () => {
    const sheets = buildFixtureWorkbook();
    const courses = parseCoursesFromSheet(sheets, 'Course Data');
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
      fontBytes: loadNodeFontBytes(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].programName).toBe(oversized.programName);
    expect(result.message).toContain(oversized.programName);
  });
});
