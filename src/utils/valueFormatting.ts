import { CURRENCY_OPTIONS, type CurrencyCode, type RawCell, type TuitionFeeValue } from '../types/course';

export const NOT_SPECIFIED = 'Not specified';

const CURRENCY_LOOKUP = new Map<CurrencyCode, (typeof CURRENCY_OPTIONS)[number]>(
  CURRENCY_OPTIONS.map((item) => [item.code, item]),
);

/**
 * Normalizes a cell value to plain display text while strictly preserving
 * zero ("0"), mixed text/numeric values ("89 or 4", "B2"), and decimals ("6.5").
 * Blank values, em dashes, standalone en dashes, and N/A become "Not specified".
 */
export function normalizeDisplayValue(raw: RawCell): string {
  if (raw === null || raw === undefined) {
    return NOT_SPECIFIED;
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      return NOT_SPECIFIED;
    }
    return String(raw);
  }
  if (typeof raw === 'boolean') {
    return raw ? 'Yes' : 'No';
  }
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? NOT_SPECIFIED : raw.toISOString().slice(0, 10);
  }

  const trimmed = String(raw).trim();
  if (trimmed.length === 0) {
    return NOT_SPECIFIED;
  }
  if (trimmed === '—' || trimmed === '–') {
    return NOT_SPECIFIED;
  }
  if (/^n\s*\/\s*a$/i.test(trimmed) || /^na$/i.test(trimmed)) {
    return NOT_SPECIFIED;
  }
  return trimmed;
}

/**
 * Normalizes optional values such as Faculty, returning null when absent,
 * em dash, or N/A, while preserving any supplied non-empty value (including "0").
 */
export function normalizeOptionalValue(raw: RawCell): string | null {
  const normalized = normalizeDisplayValue(raw);
  return normalized === NOT_SPECIFIED ? null : normalized;
}

/**
 * Formats semicolon-separated entry requirements into distinct readable lines
 * while preserving every condition verbatim.
 */
export function formatEntryRequirementLines(rawText: string): string[] {
  if (rawText === NOT_SPECIFIED) {
    return [NOT_SPECIFIED];
  }

  const parts = rawText
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return parts.length > 0 ? parts : [rawText];
}

/**
 * Parses a raw Yearly Tuition Fee cell without guessing missing currency
 * or interpreting zero as missing.
 */
export function parseTuitionFee(raw: RawCell): TuitionFeeValue {
  if (raw === null || raw === undefined) {
    return { kind: 'not_specified' };
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      return { kind: 'not_specified' };
    }
    return { kind: 'number', numeric: raw, rawText: String(raw) };
  }

  const normalized = normalizeDisplayValue(raw);
  if (normalized === NOT_SPECIFIED) {
    return { kind: 'not_specified' };
  }

  const cleanedNumeric = normalized.replace(/,/g, '');
  if (/^-?\d+(?:\.\d+)?$/.test(cleanedNumeric)) {
    const num = Number(cleanedNumeric);
    if (Number.isFinite(num)) {
      return { kind: 'number', numeric: num, rawText: normalized };
    }
  }

  return { kind: 'text', rawText: normalized };
}

/**
 * Formats tuition fee with the confirmed currency. Never calculates net tuition
 * or invents numbers.
 */
export function formatTuitionFee(
  fee: TuitionFeeValue,
  currency: CurrencyCode | null,
): string {
  if (fee.kind === 'not_specified') {
    return NOT_SPECIFIED;
  }
  if (!currency) {
    return fee.rawText;
  }

  const def = CURRENCY_LOOKUP.get(currency);
  const symbol = def ? def.symbol : `${currency} `;

  if (fee.kind === 'number') {
    const isWhole = Number.isInteger(fee.numeric);
    const formattedNum = fee.numeric.toLocaleString('en-GB', {
      minimumFractionDigits: isWhole ? 0 : 2,
      maximumFractionDigits: 2,
    });
    return `${symbol}${formattedNum}`;
  }

  // Text value: keep source text intact; append currency code only if not already present.
  const upper = fee.rawText.toUpperCase();
  const hasExplicitCurrency =
    upper.includes(currency) ||
    (currency === 'GBP' && fee.rawText.includes('£')) ||
    (currency === 'EUR' && fee.rawText.includes('€')) ||
    (currency === 'INR' && fee.rawText.includes('₹'));

  return hasExplicitCurrency ? fee.rawText : `${fee.rawText} (${currency})`;
}

/**
 * Validates and normalizes a University Website URL to a safe http/https href.
 * Rejects javascript:, data:, vbscript:, or malformed schemes.
 */
export function normalizeWebsiteUrl(raw: RawCell): {
  display: string;
  href: string | null;
} {
  const display = normalizeDisplayValue(raw);
  if (display === NOT_SPECIFIED) {
    return { display: NOT_SPECIFIED, href: null };
  }

  const candidate = /^https?:\/\//i.test(display)
    ? display
    : /^[a-z][a-z0-9+.-]*:/i.test(display)
      ? display
      : `https://${display}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return { display, href: parsed.toString() };
    }
  } catch {
    return { display, href: null };
  }

  return { display, href: null };
}

/**
 * Sanitizes a student name ONLY for safe cross-platform download filenames,
 * preserving the original student spelling everywhere inside the app and PDF.
 */
export function sanitizeFilenameSegment(rawName: string): string {
  const cleaned = rawName
    .trim()
    .replace(/[/\\:*?"<>|\u0000-\u001F\u007F]+/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'Student';
}

/**
 * Builds the personalized download filename:
 * Eccho_Overseas_[Student_Name]_Course_Shortlist.pdf
 */
export function buildShortlistFilename(studentName: string): string {
  const safeStudent = sanitizeFilenameSegment(studentName);
  return `Eccho_Overseas_${safeStudent}_Course_Shortlist.pdf`;
}

