import brookesLogoUrl from '../assets/universities/brookes.png?url';
import coventryLogoUrl from '../assets/universities/coventry.png?url';
import leicesterLogoUrl from '../assets/universities/leicester.png?url';
import northumbriaLogoUrl from '../assets/universities/northumbria.png?url';
import sussexLogoUrl from '../assets/universities/sussex.png?url';
import uelLogoUrl from '../assets/universities/uel.png?url';
import type {
  CourseRecord,
  InMemoryLogo,
  UniversityLogoEntry,
  UniversityLogoMap,
} from '../types/course';
import { rasterizeImageBlobToPngBytes, sanitizeSvgMarkup } from './logoLoader';

interface PackagedUniversitySpec {
  domains: string[];
  nameMatches: string[];
  assetUrl: string;
  fileName: string;
  initials: string;
}

const PACKAGED_UNIVERSITIES: PackagedUniversitySpec[] = [
  {
    domains: ['sussex.ac.uk'],
    nameMatches: ['university of sussex'],
    assetUrl: sussexLogoUrl,
    fileName: 'sussex.png',
    initials: 'US',
  },
  {
    domains: ['uel.ac.uk'],
    nameMatches: ['university of east london'],
    assetUrl: uelLogoUrl,
    fileName: 'uel.png',
    initials: 'UEL',
  },
  {
    domains: ['brookes.ac.uk'],
    nameMatches: ['oxford brookes university'],
    assetUrl: brookesLogoUrl,
    fileName: 'brookes.png',
    initials: 'OB',
  },
  {
    domains: ['le.ac.uk'],
    nameMatches: ['university of leicester'],
    assetUrl: leicesterLogoUrl,
    fileName: 'leicester.png',
    initials: 'UL',
  },
  {
    domains: ['coventry.ac.uk'],
    nameMatches: ['coventry university'],
    assetUrl: coventryLogoUrl,
    fileName: 'coventry.png',
    initials: 'CU',
  },
  {
    domains: ['northumbria.ac.uk'],
    nameMatches: ['northumbria university'],
    assetUrl: northumbriaLogoUrl,
    fileName: 'northumbria.png',
    initials: 'NU',
  },
];

const packagedBytesCache = new Map<string, Promise<Uint8Array | null>>();

export function extractDomainFromUrl(href: string | null): string | null {
  if (!href) return null;
  try {
    const parsed = new URL(href);
    return parsed.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

export function getUniversityInitials(universityName: string): string {
  const lower = universityName.toLowerCase();
  for (const spec of PACKAGED_UNIVERSITIES) {
    if (spec.nameMatches.some((n) => lower.includes(n))) {
      return spec.initials;
    }
  }

  const stopWords = new Set(['of', 'the', 'and', 'at', 'in', 'for', 'on', 'campus']);
  const tokens = universityName
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);

  const significant = tokens.filter((w) => !stopWords.has(w.toLowerCase()));
  if (significant.length >= 2) {
    const first = significant[0][0].toUpperCase();
    const second = significant[1][0].toUpperCase();
    return `${first}${second}`;
  }
  if (tokens.length >= 2) {
    return `${tokens[0][0]}${tokens[1][0]}`.toUpperCase();
  }
  return universityName.trim().slice(0, 2).toUpperCase() || 'UN';
}

function findPackagedUniversitySpec(
  universityName: string,
  domain: string | null,
): PackagedUniversitySpec | null {
  if (domain) {
    const byDomain = PACKAGED_UNIVERSITIES.find((spec) =>
      spec.domains.some(
        (d) => domain === d || domain.endsWith(`.${d}`),
      ),
    );
    if (byDomain) return byDomain;
  }

  const lower = universityName.trim().toLowerCase();
  return (
    PACKAGED_UNIVERSITIES.find((spec) =>
      spec.nameMatches.some((match) => lower.includes(match)),
    ) ?? null
  );
}

function loadPackagedLogoBytes(assetUrl: string): Promise<Uint8Array | null> {
  let cached = packagedBytesCache.get(assetUrl);
  if (!cached) {
    cached = fetch(assetUrl)
      .then(async (resp) => {
        if (!resp.ok) return null;
        return new Uint8Array(await resp.arrayBuffer());
      })
      .catch(() => null);
    packagedBytesCache.set(assetUrl, cached);
  }
  return cached;
}

/**
 * Resolves packaged official university logos once per unique university in source order.
 * Unmatched universities gracefully receive an initials placeholder without blocking PDF generation.
 */
export async function resolveUniversityLogosForCourses(
  courses: CourseRecord[],
  existingMap: UniversityLogoMap = {},
): Promise<UniversityLogoMap> {
  const nextMap: UniversityLogoMap = {};
  const seenKeys = new Set<string>();

  for (const course of courses) {
    const key = course.universityKey;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const existing = existingMap[key];
    // Preserve manually uploaded or fetched session logos across re-renders
    if (
      existing &&
      (existing.source === 'uploaded' || existing.source === 'fetched') &&
      existing.logo
    ) {
      nextMap[key] = existing;
      continue;
    }

    const domain = extractDomainFromUrl(course.websiteHref);
    const packaged = findPackagedUniversitySpec(course.university, domain);
    const initials = getUniversityInitials(course.university);

    if (packaged) {
      const bytes = await loadPackagedLogoBytes(packaged.assetUrl);
      if (bytes && bytes.length > 0) {
        const previewBlob = new Blob([new Uint8Array(bytes)], {
          type: 'image/png',
        });
        nextMap[key] = {
          universityKey: key,
          universityName: course.university,
          websiteHref: course.websiteHref,
          domain,
          initials,
          source: 'packaged',
          logo: {
            fileName: packaged.fileName,
            mimeType: 'image/png',
            bytes,
            previewUrl: URL.createObjectURL(previewBlob),
          },
          lookupNote: 'Verified packaged logo',
        };
        continue;
      }
    }

    nextMap[key] = {
      universityKey: key,
      universityName: course.university,
      websiteHref: course.websiteHref,
      domain,
      initials,
      source: 'initials',
      logo: null,
      lookupNote: domain
        ? 'No packaged logo — using initials placeholder (upload or fetch optionally)'
        : 'No website URL — using initials placeholder',
    };
  }

  return nextMap;
}

export function revokeUniversityLogoUrls(logoMap: UniversityLogoMap): void {
  for (const entry of Object.values(logoMap)) {
    if (entry.logo?.previewUrl) {
      URL.revokeObjectURL(entry.logo.previewUrl);
    }
  }
}

function isLikelyFaviconUrl(urlStr: string): boolean {
  const lower = urlStr.toLowerCase();
  return (
    lower.includes('favicon') ||
    lower.includes('apple-touch-icon') ||
    lower.endsWith('.ico')
  );
}

interface ChromePermissionsApi {
  permissions?: {
    request: (perms: { origins: string[] }) => Promise<boolean>;
  };
}

/**
 * Optional live logo lookup triggered explicitly by the user for an unmatched university.
 * Sends zero student data or spreadsheet contents—only requests the public university homepage.
 * Uses narrowly scoped optional host permission inside Chrome Extension builds.
 */
export async function attemptWebsiteLogoLookup(
  entry: UniversityLogoEntry,
): Promise<{ logo: InMemoryLogo | null; note: string }> {
  if (!entry.websiteHref) {
    return { logo: null, note: 'No valid university Website URL to check.' };
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(entry.websiteHref);
    if (parsedOrigin.protocol !== 'https:' && parsedOrigin.protocol !== 'http:') {
      return { logo: null, note: 'Only HTTP/HTTPS university URLs are supported.' };
    }
  } catch {
    return { logo: null, note: 'Invalid university website URL.' };
  }

  // Request narrowly scoped optional host permission if running inside MV3 extension
  const globalChrome = (globalThis as { chrome?: ChromePermissionsApi }).chrome;
  if (globalChrome?.permissions?.request) {
    try {
      const granted = await globalChrome.permissions.request({
        origins: [`${parsedOrigin.protocol}//${parsedOrigin.hostname}/*`],
      });
      if (!granted) {
        return {
          logo: null,
          note: 'Host permission declined — keeping initials placeholder (manual upload available).',
        };
      }
    } catch {
      return {
        logo: null,
        note: 'Domain not permitted for live lookup — please upload logo manually.',
      };
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);

  try {
    const pageResp = await fetch(parsedOrigin.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      mode: 'cors',
    });
    if (!pageResp.ok) {
      return {
        logo: null,
        note: `University site returned HTTP ${pageResp.status} — manual upload available.`,
      };
    }

    const html = await pageResp.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const baseHref = pageResp.url || parsedOrigin.toString();

    const candidates: string[] = [];

    const ogLogo = doc
      .querySelector('meta[property="og:logo"], meta[name="og:logo"]')
      ?.getAttribute('content');
    if (ogLogo) candidates.push(ogLogo);

    const imgs = Array.from(doc.querySelectorAll('header img, nav img, a[class*="logo" i] img, img[class*="logo" i], img[alt*="logo" i]'));
    for (const img of imgs) {
      const src = img.getAttribute('src');
      if (src) candidates.push(src);
    }

    for (const rawCandidate of candidates) {
      let resolvedUrl: URL;
      try {
        resolvedUrl = new URL(rawCandidate, baseHref);
      } catch {
        continue;
      }
      if (resolvedUrl.protocol !== 'https:' && resolvedUrl.protocol !== 'http:') {
        continue;
      }
      if (isLikelyFaviconUrl(resolvedUrl.toString())) {
        continue;
      }

      const imgResp = await fetch(resolvedUrl.toString(), {
        signal: controller.signal,
        redirect: 'follow',
        mode: 'cors',
      });
      if (!imgResp.ok) continue;

      const contentType = (imgResp.headers.get('content-type') ?? '').toLowerCase();
      const lowerUrl = resolvedUrl.pathname.toLowerCase();

      let bytes: Uint8Array;
      let mimeType: 'image/png' | 'image/jpeg' = 'image/png';

      if (contentType.includes('svg') || lowerUrl.endsWith('.svg')) {
        const svgText = await imgResp.text();
        const safeSvg = sanitizeSvgMarkup(svgText);
        bytes = await rasterizeImageBlobToPngBytes(
          new Blob([safeSvg], { type: 'image/svg+xml' }),
        );
      } else if (contentType.includes('jpeg') || contentType.includes('jpg') || lowerUrl.endsWith('.jpg') || lowerUrl.endsWith('.jpeg')) {
        bytes = new Uint8Array(await imgResp.arrayBuffer());
        mimeType = 'image/jpeg';
      } else if (contentType.includes('png') || lowerUrl.endsWith('.png')) {
        bytes = new Uint8Array(await imgResp.arrayBuffer());
        mimeType = 'image/png';
      } else if (contentType.includes('webp') || lowerUrl.endsWith('.webp')) {
        const blob = await imgResp.blob();
        bytes = await rasterizeImageBlobToPngBytes(blob);
      } else {
        continue;
      }

      if (bytes.length < 100) continue;

      const previewUrl = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: mimeType }),
      );
      return {
        logo: {
          fileName: `${entry.initials.toLowerCase()}-official.${mimeType === 'image/jpeg' ? 'jpg' : 'png'}`,
          mimeType,
          bytes,
          previewUrl,
        },
        note: `Fetched from ${resolvedUrl.hostname}`,
      };
    }

    return {
      logo: null,
      note: 'No explicit official logo found (favicons skipped) — please upload manually.',
    };
  } catch {
    return {
      logo: null,
      note: 'Website blocked CORS or timed out — keeping initials placeholder (manual upload available).',
    };
  } finally {
    clearTimeout(timer);
  }
}

