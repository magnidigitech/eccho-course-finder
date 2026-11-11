export type CurrencyCode =
  | 'GBP'
  | 'USD'
  | 'EUR'
  | 'AUD'
  | 'CAD'
  | 'NZD'
  | 'SGD'
  | 'INR'
  | 'CHF'
  | 'AED';

export interface CurrencyDefinition {
  code: CurrencyCode;
  label: string;
  symbol: string;
}

export const CURRENCY_OPTIONS: CurrencyDefinition[] = [
  { code: 'GBP', label: 'GBP (£) — British Pound', symbol: '£' },
  { code: 'USD', label: 'USD ($) — US Dollar', symbol: 'US$' },
  { code: 'EUR', label: 'EUR (€) — Euro', symbol: '€' },
  { code: 'AUD', label: 'AUD (A$) — Australian Dollar', symbol: 'A$' },
  { code: 'CAD', label: 'CAD (CA$) — Canadian Dollar', symbol: 'CA$' },
  { code: 'NZD', label: 'NZD (NZ$) — New Zealand Dollar', symbol: 'NZ$' },
  { code: 'SGD', label: 'SGD (S$) — Singapore Dollar', symbol: 'S$' },
  { code: 'INR', label: 'INR (₹) — Indian Rupee', symbol: '₹' },
  { code: 'CHF', label: 'CHF — Swiss Franc', symbol: 'CHF ' },
  { code: 'AED', label: 'AED — UAE Dirham', symbol: 'AED ' },
];

export type RawCell = string | number | boolean | Date | null | undefined;

export interface WorkbookSheet {
  name: string;
  rows: RawCell[][];
}

export interface WorkbookSession {
  fileName: string;
  sheets: WorkbookSheet[];
  sheetNames: string[];
  selectedSheet: string;
  autoSelectedCourseData: boolean;
  detectedCurrency: CurrencyCode | null;
  currencySource: string | null;
}

export interface EnglishTestRow {
  key: string;
  label: string;
  value: string;
}

export interface EnglishWaiverRow {
  key: string;
  label: string;
  value: string;
}

export type TuitionFeeValue =
  | { kind: 'number'; numeric: number; rawText: string }
  | { kind: 'text'; rawText: string }
  | { kind: 'not_specified' };

export interface CourseRecord {
  rowNumber: number;
  sourceIndex: string | null;
  programName: string;
  university: string;
  universityRanking: string;
  websiteUrlDisplay: string;
  websiteHref: string | null;
  campus: string;
  country: string;
  studyLevel: string;
  duration: string;
  openIntake: string;
  entryRequirementRaw: string;
  entryRequirementLines: string[];
  yearlyTuitionFee: TuitionFeeValue;
  scholarshipAvailable: string;
  faculty: string | null;
  englishTests: EnglishTestRow[];
  englishWaivers: EnglishWaiverRow[];
}

export interface InMemoryLogo {
  fileName: string;
  mimeType: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
  previewUrl: string;
}

export interface PageFitFailure {
  courseNumber: number;
  rowNumber: number;
  programName: string;
  university: string;
  requiredHeightPt: number;
  availableHeightPt: number;
}

export type ChecklistSelections = Record<string, boolean>;

export type PdfGenerationResult =
  | {
      ok: true;
      pdfBytes: Uint8Array;
      pageCount: number;
      coursePageCount: number;
      guideStartPage: number;
      checklistStartPage: number;
      tiersUsed: string[];
    }
  | {
      ok: false;
      failures: PageFitFailure[];
      message: string;
    };

