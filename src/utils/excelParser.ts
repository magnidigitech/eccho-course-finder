import readXlsxFile from 'read-excel-file/browser';
import {
  CURRENCY_OPTIONS,
  type CourseRecord,
  type CurrencyCode,
  type EnglishTestRow,
  type EnglishWaiverRow,
  type RawCell,
  type WorkbookSession,
  type WorkbookSheet,
} from '../types/course';
import {
  NOT_SPECIFIED,
  formatEntryRequirementLines,
  normalizeDisplayValue,
  normalizeOptionalValue,
  normalizeWebsiteUrl,
  parseTuitionFee,
} from './valueFormatting';

export class ExcelValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExcelValidationError';
  }
}

const VALID_CURRENCY_CODES = new Set<CurrencyCode>(
  CURRENCY_OPTIONS.map((item) => item.code),
);

type ColumnKey =
  | 'sourceIndex'
  | 'programName'
  | 'university'
  | 'websiteUrl'
  | 'campus'
  | 'country'
  | 'studyLevel'
  | 'duration'
  | 'openIntake'
  | 'entryRequirement'
  | 'yearlyTuitionFee'
  | 'scholarshipAvailable'
  | 'faculties'
  | 'duolingo'
  | 'waiverCbseIcse'
  | 'waiverUk'
  | 'waiverStateBoard'
  | 'ielts'
  | 'pte'
  | 'toefl';

const HEADER_ALIASES: Record<string, ColumnKey> = {
  '#': 'sourceIndex',
  'program name': 'programName',
  'programme name': 'programName',
  university: 'university',
  'website url': 'websiteUrl',
  website: 'websiteUrl',
  campus: 'campus',
  country: 'country',
  'study level': 'studyLevel',
  duration: 'duration',
  'open intake': 'openIntake',
  'open intakes': 'openIntake',
  'entry requirement': 'entryRequirement',
  'entry requirements': 'entryRequirement',
  'yearly tuition fee': 'yearlyTuitionFee',
  'scholarship available': 'scholarshipAvailable',
  faculties: 'faculties',
  faculty: 'faculties',
  duolingo: 'duolingo',
  'english waiver based on class 12th cbse/icse marks': 'waiverCbseIcse',
  'i want english waiver based on uk qualification': 'waiverUk',
  'i want english waiver based on my class 12th marks (state board)':
    'waiverStateBoard',
  ielts: 'ielts',
  pte: 'pte',
  toefl: 'toefl',
};

const ENGLISH_TEST_FIELDS: Array<{
  key: EnglishTestRow['key'];
  label: string;
}> = [
  { key: 'ielts', label: 'IELTS' },
  { key: 'pte', label: 'PTE' },
  { key: 'toefl', label: 'TOEFL' },
  { key: 'duolingo', label: 'Duolingo' },
];

const ENGLISH_WAIVER_FIELDS: Array<{
  key: EnglishWaiverRow['key'];
  label: string;
}> = [
  {
    key: 'waiverCbseIcse',
    label: 'Class 12 CBSE/ICSE',
  },
  {
    key: 'waiverUk',
    label: 'UK qualification',
  },
  {
    key: 'waiverStateBoard',
    label: 'Class 12 State Board',
  },
];

export function normalizeUniversityKey(universityName: string): string {
  return universityName.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeHeaderName(raw: RawCell): string {
  if (raw === null || raw === undefined) {
    return '';
  }
  return String(raw).trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isCellBlank(cell: RawCell): boolean {
  if (cell === null || cell === undefined) {
    return true;
  }
  if (typeof cell === 'number') {
    return Number.isNaN(cell);
  }
  if (typeof cell === 'boolean') {
    return false;
  }
  if (cell instanceof Date) {
    return Number.isNaN(cell.getTime());
  }
  return String(cell).trim().length === 0;
}

export function isRowEmpty(row: RawCell[] | undefined): boolean {
  if (!row || row.length === 0) {
    return true;
  }
  return row.every((cell) => isCellBlank(cell));
}

function asCurrencyCode(candidate: string): CurrencyCode | null {
  const upper = candidate.trim().toUpperCase() as CurrencyCode;
  return VALID_CURRENCY_CODES.has(upper) ? upper : null;
}

function resolveColumnKey(normalizedHeader: string): {
  key: ColumnKey | null;
  headerCurrency: CurrencyCode | null;
} {
  if (normalizedHeader in HEADER_ALIASES) {
    return { key: HEADER_ALIASES[normalizedHeader], headerCurrency: null };
  }

  const tuitionWithCurrency = normalizedHeader.match(
    /^yearly tuition fee\s*\(\s*([a-z]{3})\s*\)$/i,
  );
  if (tuitionWithCurrency) {
    return {
      key: 'yearlyTuitionFee',
      headerCurrency: asCurrencyCode(tuitionWithCurrency[1]),
    };
  }

  return { key: null, headerCurrency: null };
}

/**
 * Detects explicit currency from the workbook without guessing.
 * Checks the Comparison sheet (e.g. "COST & FUNDING (GBP)"),
 * the Yearly Tuition Fee header, or unanimous unambiguous cell codes/symbols.
 */
export function detectWorkbookCurrency(
  sheets: WorkbookSheet[],
  selectedSheetName: string,
): { currency: CurrencyCode | null; reason: string | null } {
  const comparisonSheet = sheets.find(
    (s) => s.name.trim().toLowerCase() === 'comparison',
  );
  if (comparisonSheet) {
    for (const row of comparisonSheet.rows) {
      for (const cell of row) {
        if (typeof cell !== 'string') continue;
        const match = cell.match(
          /\b(?:cost\s*&\s*funding|tuition(?:\s*fee)?|fees?)\b[^()]*\(\s*([a-z]{3})\s*\)/i,
        );
        if (match) {
          const code = asCurrencyCode(match[1]);
          if (code) {
            return {
              currency: code,
              reason: `Confirmed ${code} from "${comparisonSheet.name}" sheet (${cell.trim()})`,
            };
          }
        }
      }
    }
  }

  const activeSheet = sheets.find((s) => s.name === selectedSheetName);
  if (activeSheet && activeSheet.rows.length > 0) {
    const headerRow = activeSheet.rows[0];
    let tuitionColIndex = -1;

    for (let c = 0; c < headerRow.length; c += 1) {
      const norm = normalizeHeaderName(headerRow[c]);
      const resolved = resolveColumnKey(norm);
      if (resolved.key === 'yearlyTuitionFee') {
        tuitionColIndex = c;
        if (resolved.headerCurrency) {
          return {
            currency: resolved.headerCurrency,
            reason: `Confirmed ${resolved.headerCurrency} from column header`,
          };
        }
      }
    }

    if (tuitionColIndex >= 0) {
      const detectedPerRow = new Set<CurrencyCode>();
      let nonEmptyTuitionCount = 0;

      for (let r = 1; r < activeSheet.rows.length; r += 1) {
        const row = activeSheet.rows[r];
        if (isRowEmpty(row)) continue;
        const val = row[tuitionColIndex];
        const display = normalizeDisplayValue(val);
        if (display === NOT_SPECIFIED) continue;

        nonEmptyTuitionCount += 1;
        const isoMatch = display.match(
          /\b(GBP|USD|EUR|AUD|CAD|NZD|SGD|INR|CHF|AED)\b/i,
        );
        if (isoMatch) {
          const code = asCurrencyCode(isoMatch[1]);
          if (code) detectedPerRow.add(code);
        } else if (display.includes('£')) {
          detectedPerRow.add('GBP');
        } else if (display.includes('€')) {
          detectedPerRow.add('EUR');
        } else if (display.includes('₹')) {
          detectedPerRow.add('INR');
        } else {
          detectedPerRow.clear();
          break;
        }
      }

      if (nonEmptyTuitionCount > 0 && detectedPerRow.size === 1) {
        const [onlyCode] = Array.from(detectedPerRow);
        return {
          currency: onlyCode,
          reason: `Confirmed ${onlyCode} from tuition fee values`,
        };
      }
    }
  }

  return { currency: null, reason: null };
}

/**
 * Builds an in-memory WorkbookSession from raw sheets, automatically selecting
 * "Course Data" when present and ignoring "Comparison" as a course source.
 */
export function buildWorkbookSession(
  fileName: string,
  rawSheets: WorkbookSheet[],
): WorkbookSession {
  if (rawSheets.length === 0) {
    throw new ExcelValidationError(
      'The uploaded workbook does not contain any readable worksheets.',
    );
  }

  const sheetNames = rawSheets.map((s) => s.name);
  const courseDataSheet = rawSheets.find(
    (s) => s.name.trim().toLowerCase() === 'course data',
  );

  const selectedSheet = courseDataSheet
    ? courseDataSheet.name
    : (rawSheets.find((s) => s.name.trim().toLowerCase() !== 'comparison')?.name ??
      rawSheets[0].name);

  const currencyInfo = detectWorkbookCurrency(rawSheets, selectedSheet);

  return {
    fileName,
    sheets: rawSheets,
    sheetNames,
    selectedSheet,
    autoSelectedCourseData: Boolean(courseDataSheet),
    detectedCurrency: currencyInfo.currency,
    currencySource: currencyInfo.reason,
  };
}

/**
 * Parses and validates all course rows from the selected worksheet.
 * Preserves source order, exact text, zero values, mixed strings, and no deduplication.
 * Excludes removed fields (University Ranking, ELLT, ESOL, Kaplan, SELT, Skills For English).
 */
export function parseCoursesFromSheet(
  sheets: WorkbookSheet[],
  sheetName: string,
): CourseRecord[] {
  const sheet = sheets.find((s) => s.name === sheetName);
  if (!sheet) {
    throw new ExcelValidationError(`Worksheet "${sheetName}" was not found.`);
  }

  if (sheet.rows.length === 0 || isRowEmpty(sheet.rows[0])) {
    throw new ExcelValidationError(
      `Worksheet "${sheetName}" has no header row in row 1. Expected at least "Program Name" and "University".`,
    );
  }

  const headerRow = sheet.rows[0];
  const columnMap = new Map<ColumnKey, number>();

  for (let col = 0; col < headerRow.length; col += 1) {
    const normalized = normalizeHeaderName(headerRow[col]);
    if (!normalized) continue;
    const { key } = resolveColumnKey(normalized);
    if (key && !columnMap.has(key)) {
      columnMap.set(key, col);
    }
  }

  const missingRequired: string[] = [];
  if (!columnMap.has('programName')) missingRequired.push('Program Name');
  if (!columnMap.has('university')) missingRequired.push('University');

  if (missingRequired.length > 0) {
    const foundHeaders = headerRow
      .map((cell) =>
        cell === null || cell === undefined ? '' : String(cell).trim(),
      )
      .filter((h) => h.length > 0);
    const previewHeaders =
      foundHeaders.length > 0
        ? ` Found row-1 headers: ${foundHeaders.slice(0, 6).join(', ')}${foundHeaders.length > 6 ? ', ...' : ''}.`
        : '';
    throw new ExcelValidationError(
      `Worksheet "${sheetName}" is missing required column(s): ${missingRequired.join(', ')}.${previewHeaders}`,
    );
  }

  const getCell = (row: RawCell[], key: ColumnKey): RawCell => {
    const idx = columnMap.get(key);
    return idx === undefined ? undefined : row[idx];
  };

  const courses: CourseRecord[] = [];

  for (let rowIndex = 1; rowIndex < sheet.rows.length; rowIndex += 1) {
    const row = sheet.rows[rowIndex];
    if (isRowEmpty(row)) {
      continue;
    }

    const excelRowNumber = rowIndex + 1;
    const rawProgram = getCell(row, 'programName');
    const rawUniversity = getCell(row, 'university');

    const programName = isCellBlank(rawProgram) ? '' : String(rawProgram).trim();
    const university = isCellBlank(rawUniversity)
      ? ''
      : String(rawUniversity).trim();

    if (!programName || !university) {
      const missingFields = [
        !programName ? 'Program Name' : null,
        !university ? 'University' : null,
      ].filter(Boolean);
      throw new ExcelValidationError(
        `Row ${excelRowNumber} in "${sheetName}" is missing required value(s): ${missingFields.join(' and ')}.`,
      );
    }

    const entryRequirementRaw = normalizeDisplayValue(
      getCell(row, 'entryRequirement'),
    );
    const website = normalizeWebsiteUrl(getCell(row, 'websiteUrl'));

    const englishTests: EnglishTestRow[] = ENGLISH_TEST_FIELDS.map((field) => ({
      key: field.key,
      label: field.label,
      value: normalizeDisplayValue(getCell(row, field.key)),
    }));

    const englishWaivers: EnglishWaiverRow[] = ENGLISH_WAIVER_FIELDS.map(
      (field) => ({
        key: field.key,
        label: field.label,
        value: normalizeDisplayValue(getCell(row, field.key)),
      }),
    );

    courses.push({
      rowNumber: excelRowNumber,
      sourceIndex: normalizeOptionalValue(getCell(row, 'sourceIndex')),
      programName,
      university,
      universityKey: normalizeUniversityKey(university),
      websiteUrlDisplay: website.display,
      websiteHref: website.href,
      campus: normalizeDisplayValue(getCell(row, 'campus')),
      country: normalizeDisplayValue(getCell(row, 'country')),
      studyLevel: normalizeDisplayValue(getCell(row, 'studyLevel')),
      duration: normalizeDisplayValue(getCell(row, 'duration')),
      openIntake: normalizeDisplayValue(getCell(row, 'openIntake')),
      entryRequirementRaw,
      entryRequirementLines: formatEntryRequirementLines(entryRequirementRaw),
      yearlyTuitionFee: parseTuitionFee(getCell(row, 'yearlyTuitionFee')),
      scholarshipAvailable: normalizeDisplayValue(
        getCell(row, 'scholarshipAvailable'),
      ),
      faculty: normalizeOptionalValue(getCell(row, 'faculties')),
      englishTests,
      englishWaivers,
    });
  }

  if (courses.length === 0) {
    throw new ExcelValidationError(
      `No course rows were found in worksheet "${sheetName}".`,
    );
  }

  return courses;
}

/**
 * Reads an uploaded Excel file completely in browser memory.
 */
export async function parseExcelFileInBrowser(
  file: File,
): Promise<WorkbookSession> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.xls')) {
    throw new ExcelValidationError(
      'Legacy .xls binary workbooks are not supported in browser-only mode. Please save the file as .xlsx and upload it again.',
    );
  }
  if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xlsm')) {
    throw new ExcelValidationError(
      'Unsupported file format. Please upload an Excel workbook (.xlsx).',
    );
  }
  if (file.size === 0) {
    throw new ExcelValidationError('The uploaded Excel file is empty (0 bytes).');
  }

  let parsedSheets: Array<{ sheet: string; data: RawCell[][] }>;
  try {
    const result = await readXlsxFile(file);
    if (!Array.isArray(result)) {
      throw new ExcelValidationError('Unexpected workbook structure.');
    }
    parsedSheets = result as Array<{ sheet: string; data: RawCell[][] }>;
  } catch (err) {
    if (err instanceof ExcelValidationError) {
      throw err;
    }
    throw new ExcelValidationError(
      'Could not read the Excel workbook. Verify that the .xlsx file is valid and not password-protected.',
    );
  }

  const sheets: WorkbookSheet[] = parsedSheets.map((item) => ({
    name: item.sheet,
    rows: item.data ?? [],
  }));

  return buildWorkbookSession(file.name, sheets);
}
