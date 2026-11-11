import type {
  CandidateSourceKind,
  DiscoveredLogoCandidate,
  InMemoryLogo,
} from '../types/course';
import { base64ToUint8Bytes } from './base64';
import {
  rasterizeImageBlobToPngBytes,
  sanitizeSvgMarkup,
} from './logoLoader';

export type SniffedImageFormat = 'png' | 'jpeg' | 'webp' | 'svg';

export interface RawFetchedCandidatePayload {
  id: string;
  sourceUrl: string;
  sourceKind: CandidateSourceKind;
  sourceLabel: string;
  score: number;
  rawSvg?: string;
  base64Bytes?: string;
  bytes?: Uint8Array;
  contentType?: string;
  likelyWhiteVariant?: boolean;
}

export interface PixelAnalysisResult {
  width: number;
  height: number;
  hasVisiblePixels: boolean;
  needsDarkBackdrop: boolean;
}

/**
 * Verifies the actual image format via magic bytes / XML signature rather than relying on URL extensions.
 * Explicitly rejects HTML error responses, GIF spacers, and ICO icons.
 */
export function sniffImageBytesFormat(
  bytes: Uint8Array,
  contentTypeHint?: string,
): SniffedImageFormat | null {
  if (bytes.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }

  // Explicitly reject GIF ("GIF8") and ICO (00 00 01 00)
  if (
    (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) ||
    (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00)
  ) {
    return null;
  }

  // SVG check via UTF-8 text header (must contain <svg and not <html)
  const headText = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, Math.min(1024, bytes.length)))
    .trimStart();
  if (/^<!doctype\s+html|^<html\b/i.test(headText)) {
    return null;
  }
  if (
    /<svg[\s>]/i.test(headText) ||
    (contentTypeHint?.toLowerCase().includes('svg') && /<svg[\s>]/i.test(headText))
  ) {
    return 'svg';
  }

  return null;
}

/**
 * Analyses decoded image dimensions and detects white-on-transparent logos cleanly.
 */
export function inspectProcessedLogoPixels(
  bytes: Uint8Array,
  mimeType: 'image/png' | 'image/jpeg',
): Promise<PixelAnalysisResult> {
  return new Promise((resolve, reject) => {
    const blobUrl = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: mimeType }),
    );
    const img = new Image();

    img.onload = () => {
      try {
        const naturalW = img.naturalWidth || 0;
        const naturalH = img.naturalHeight || 0;
        const sampleSize = 96;
        const canvas = document.createElement('canvas');
        canvas.width = sampleSize;
        canvas.height = sampleSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({
            width: naturalW,
            height: naturalH,
            hasVisiblePixels: naturalW >= 24 && naturalH >= 16,
            needsDarkBackdrop: false,
          });
          return;
        }

        const scale = Math.min(
          sampleSize / Math.max(1, naturalW),
          sampleSize / Math.max(1, naturalH),
        );
        const drawW = Math.max(1, Math.round(naturalW * scale));
        const drawH = Math.max(1, Math.round(naturalH * scale));
        canvas.width = drawW;
        canvas.height = drawH;
        ctx.clearRect(0, 0, drawW, drawH);
        ctx.drawImage(img, 0, 0, drawW, drawH);

        const data = ctx.getImageData(0, 0, drawW, drawH).data;
        let opaqueCount = 0;
        let transparentCount = 0;
        let brightOpaqueCount = 0;
        let darkOpaqueCount = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 25) {
            transparentCount += 1;
            continue;
          }
          opaqueCount += 1;
          const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          if (lum >= 0.84) {
            brightOpaqueCount += 1;
          } else if (lum < 0.7) {
            darkOpaqueCount += 1;
          }
        }

        const totalPixels = opaqueCount + transparentCount;
        const hasTransparentBg = totalPixels > 0 && transparentCount / totalPixels >= 0.08;
        const brightFraction = opaqueCount > 0 ? brightOpaqueCount / opaqueCount : 0;
        const darkFraction = opaqueCount > 0 ? darkOpaqueCount / opaqueCount : 0;

        resolve({
          width: naturalW,
          height: naturalH,
          hasVisiblePixels: opaqueCount >= 12,
          needsDarkBackdrop: hasTransparentBg && brightFraction >= 0.86 && darkFraction < 0.08,
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Pixel inspection failed'));
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error('Image decoding failed during validation.'));
    };

    img.src = blobUrl;
  });
}

function buildFileNameFromSourceUrl(
  sourceUrl: string,
  mimeType: 'image/png' | 'image/jpeg',
): string {
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  try {
    const parsed = new URL(sourceUrl);
    const tail = parsed.pathname.split('/').filter(Boolean).pop() ?? 'university-logo';
    const clean = tail.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 48);
    return clean.endsWith(`.${ext}`) ? clean : `${clean}.${ext}`;
  } catch {
    return `university-logo.${ext}`;
  }
}

export async function processDiscoveredCandidate(
  payload: RawFetchedCandidatePayload,
): Promise<DiscoveredLogoCandidate | null> {
  try {
    let finalMime: 'image/png' | 'image/jpeg';
    let finalBytes: Uint8Array;

    if (payload.rawSvg) {
      const cleanSvg = sanitizeSvgMarkup(payload.rawSvg);
      const svgBlob = new Blob([cleanSvg], { type: 'image/svg+xml' });
      finalBytes = await rasterizeImageBlobToPngBytes(svgBlob);
      finalMime = 'image/png';
    } else {
      const rawBytes =
        payload.bytes ??
        (payload.base64Bytes ? base64ToUint8Bytes(payload.base64Bytes) : null);
      if (!rawBytes || rawBytes.length === 0) return null;

      const format = sniffImageBytesFormat(rawBytes, payload.contentType);
      if (!format) return null;

      if (format === 'svg') {
        const rawText = new TextDecoder('utf-8', { fatal: false }).decode(rawBytes);
        const cleanSvg = sanitizeSvgMarkup(rawText);
        const svgBlob = new Blob([cleanSvg], { type: 'image/svg+xml' });
        finalBytes = await rasterizeImageBlobToPngBytes(svgBlob);
        finalMime = 'image/png';
      } else if (format === 'webp') {
        const webpBlob = new Blob([new Uint8Array(rawBytes)], {
          type: 'image/webp',
        });
        finalBytes = await rasterizeImageBlobToPngBytes(webpBlob);
        finalMime = 'image/png';
      } else {
        finalMime = format === 'png' ? 'image/png' : 'image/jpeg';
        finalBytes = rawBytes;
      }
    }

    const metrics = await inspectProcessedLogoPixels(finalBytes, finalMime);
    if (!metrics.hasVisiblePixels) return null;
    if (metrics.width < 24 || metrics.height < 16) return null;
    const ratio = metrics.width / Math.max(1, metrics.height);
    if (ratio > 10 || ratio < 0.1) return null;

    let adjustedScore = payload.score;
    const needsDark =
      metrics.needsDarkBackdrop || Boolean(payload.likelyWhiteVariant);

    if (metrics.width >= 160 || payload.rawSvg) {
      adjustedScore += 10;
    } else if (metrics.width < 56) {
      adjustedScore -= 14;
    }

    if (needsDark) {
      adjustedScore -= 18;
    } else {
      adjustedScore += 12;
    }

    const previewBlob = new Blob([new Uint8Array(finalBytes)], { type: finalMime });
    const logo: InMemoryLogo = {
      fileName: buildFileNameFromSourceUrl(payload.sourceUrl, finalMime),
      mimeType: finalMime,
      bytes: finalBytes,
      previewUrl: URL.createObjectURL(previewBlob),
      needsDarkBackdrop: needsDark,
      pixelWidth: metrics.width,
      pixelHeight: metrics.height,
    };

    return {
      id: payload.id,
      sourceUrl: payload.sourceUrl,
      sourceKind: payload.sourceKind,
      sourceLabel: payload.sourceLabel,
      score: adjustedScore,
      logo,
    };
  } catch {
    return null;
  }
}

export function resolveCandidateOutcome(
  validCandidates: DiscoveredLogoCandidate[],
): {
  status: 'found' | 'needs_selection' | 'unavailable';
  selected: DiscoveredLogoCandidate | null;
  candidates: DiscoveredLogoCandidate[];
} {
  if (validCandidates.length === 0) {
    return { status: 'unavailable', selected: null, candidates: [] };
  }

  const sorted = [...validCandidates].sort((a, b) => b.score - a.score);
  if (sorted.length === 1) {
    return { status: 'found', selected: sorted[0], candidates: sorted };
  }

  const top = sorted[0];
  const second = sorted[1];

  // If two genuinely different candidates score closely (within 10 pts),
  // prompt quick confirmation via candidate picker while keeping valid previews ready.
  const closeContention = top.score - second.score <= 10;
  if (closeContention) {
    return { status: 'needs_selection', selected: null, candidates: sorted };
  }

  return { status: 'found', selected: top, candidates: sorted };
}
