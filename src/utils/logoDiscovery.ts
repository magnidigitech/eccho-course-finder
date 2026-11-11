import type { CandidateSourceKind } from '../types/course';

export interface RawLogoCandidate {
  url: string;
  sourceKind: CandidateSourceKind;
  sourceLabel: string;
  score: number;
  rawSvg?: string;
  altText?: string;
  hintWidth?: number;
  hintHeight?: number;
  likelyWhiteVariant?: boolean;
}

export interface HtmlExtractionResult {
  candidates: RawLogoCandidate[];
  stylesheetUrlsToCheck: string[];
}

export interface NormalizedUniversityTarget {
  normalizedUrl: string;
  origin: string;
  originPattern: string;
  requiredOriginPatterns: string[];
  hostname: string;
}

const STOP_WORDS = new Set([
  'the',
  'of',
  'and',
  'for',
  'in',
  'at',
  'on',
  'university',
  'college',
  'institute',
  'campus',
  'school',
  'newcastle',
  'london',
  'uk',
]);

const REJECTED_ASSET_PATTERNS = [
  /favicon/i,
  /apple-touch-icon/i,
  /safari-pinned-tab/i,
  /mstile-/i,
  /blank\.gif(?:$|[?\s])/i,
  /spacer\.gif(?:$|[?\s])/i,
  /1x1\.(?:gif|png)(?:$|[?\s])/i,
  /advancehe/i,
  /athena[-_]?swan/i,
  /race[-_]?equality/i,
  /charter/i,
  /silver[-_]?award/i,
  /gold[-_]?award/i,
  /bronze[-_]?award/i,
  /tef[-_]/i,
  /qaa[-_]/i,
  /research[-_]?plus/i,
  /stonewall/i,
  /disability[-_]?confident/i,
  /cyber[-_]?essentials/i,
  /times[-_]?higher/i,
  /qs[-_]?world/i,
  /accredit/i,
  /hero[-_]?carousel/i,
  /carousel/i,
  /slider/i,
  /banner/i,
  /social[-_]?media/i,
  /og[-_]?image/i,
  /\.ico(?:$|[?\s])/i,
  /\.gif(?:$|[?\s])/i,
];

const WHITE_FILENAME_PATTERN = /(?:^|[-_/])white(?:[-_.]|$)|logo[-_]?inv/i;

/**
 * Normalizes a university website URL to a clean HTTPS homepage target and its narrow origin pattern.
 */
export function normalizeUniversityWebsiteUrl(
  rawHref: string | null | undefined,
): NormalizedUniversityTarget | null {
  if (!rawHref) return null;
  let candidate = rawHref.trim();
  if (!candidate) return null;

  if (/^(?:javascript|data|mailto|tel):/i.test(candidate)) {
    return null;
  }
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate.replace(/^\/+/, '')}`;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    // Upgrade http:// links to https:// so discovery stays encrypted and scoped cleanly
    const hostname = parsed.hostname.toLowerCase();
    // Upgrade public http:// URLs to https://; preserve http:// only for local loopback test endpoints
    if (
      parsed.protocol === 'http:' &&
      hostname !== '127.0.0.1' &&
      hostname !== 'localhost'
    ) {
      parsed.protocol = 'https:';
    }
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    const patterns = new Set<string>([`${parsed.origin}/*`]);
    if (hostname.startsWith('www.')) {
      patterns.add(`${parsed.protocol}//${hostname.slice(4)}/*`);
    } else if (hostname.split('.').length >= 2) {
      patterns.add(`${parsed.protocol}//www.${hostname}/*`);
    }
    return {
      normalizedUrl: parsed.href,
      origin: parsed.origin,
      originPattern: `${parsed.origin}/*`,
      requiredOriginPatterns: Array.from(patterns),
      hostname,
    };
  } catch {
    return null;
  }
}

export function detectBotBlockOrFailure(
  status: number,
  bodySnippet: string,
): string | null {
  if (status === 401 || status === 403 || status === 429) {
    return `Website declined automated logo lookup (HTTP ${status}). Upload a logo manually or keep initials.`;
  }
  if (status >= 500) {
    return `University website returned a temporary server error (HTTP ${status}).`;
  }
  if (status >= 400) {
    return `University homepage unavailable (HTTP ${status}).`;
  }

  const head = bodySnippet.slice(0, 4000);
  if (
    /Just a moment\.\.\.|Attention Required!\s*\|\s*Cloudflare|__cf_chl_opt|cf-browser-verification|_pxCaptcha|challenge-platform/i.test(
      head,
    )
  ) {
    return 'Website is protected by an automated bot challenge. Upload a logo manually or keep initials.';
  }
  return null;
}

function getUniversityKeywords(universityName: string): string[] {
  return universityName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function resolveRelativeUrl(rawUrl: string, baseUrl: string): string | null {
  const cleaned = decodeHtmlEntities(rawUrl).trim();
  if (!cleaned || cleaned.startsWith('#')) return null;
  if (/^(?:javascript|vbscript):/i.test(cleaned)) return null;
  if (/^data:/i.test(cleaned)) return cleaned;
  try {
    const resolved = new URL(cleaned, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return null;
    }
    return resolved.href;
  } catch {
    return null;
  }
}

function isRejectedAsset(url: string, contextText: string): boolean {
  const combined = `${url} ${contextText}`;
  return REJECTED_ASSET_PATTERNS.some((pattern) => pattern.test(combined));
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex =
    /([a-zA-Z0-9:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(tag)) !== null) {
    const key = match[1].toLowerCase();
    const val = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[key] = decodeHtmlEntities(val);
  }
  return attrs;
}

function pickBestSrcFromSrcset(
  srcset: string,
  baseUrl: string,
): string | null {
  const parts = srcset
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  let bestUrl: string | null = null;
  let bestWeight = -1;

  for (const part of parts) {
    const tokens = part.split(/\s+/);
    const rawUrl = tokens[0];
    const descriptor = tokens[1] ?? '';
    const resolved = resolveRelativeUrl(rawUrl, baseUrl);
    if (!resolved) continue;

    let weight = 1;
    const widthMatch = descriptor.match(/^(\d+)w$/i);
    const scaleMatch = descriptor.match(/^(\d+(?:\.\d+)?)x$/i);
    if (widthMatch) weight = Number(widthMatch[1]);
    else if (scaleMatch) weight = Number(scaleMatch[1]) * 100;

    if (weight > bestWeight) {
      bestWeight = weight;
      bestUrl = resolved;
    }
  }
  return bestUrl;
}

function extractBalancedTagBlocks(html: string, tagName: string): string[] {
  const blocks: string[] = [];
  const openRegex = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  const closeTag = `</${tagName}>`;
  const lowerHtml = html.toLowerCase();

  let match: RegExpExecArray | null;
  while ((match = openRegex.exec(html)) !== null) {
    const startIdx = match.index;
    const afterOpenIdx = startIdx + match[0].length;
    let depth = 1;
    let cursor = afterOpenIdx;

    while (depth > 0 && cursor < html.length) {
      const nextOpen = lowerHtml.indexOf(`<${tagName}`, cursor);
      const nextClose = lowerHtml.indexOf(closeTag, cursor);
      if (nextClose === -1) break;

      if (nextOpen !== -1 && nextOpen < nextClose) {
        const nextChar = lowerHtml[nextOpen + tagName.length + 1];
        if (nextChar === ' ' || nextChar === '>' || nextChar === '\n' || nextChar === '\t') {
          depth += 1;
        }
        cursor = nextOpen + tagName.length + 1;
      } else {
        depth -= 1;
        cursor = nextClose + closeTag.length;
      }
    }

    if (depth === 0) {
      blocks.push(html.slice(startIdx, cursor));
      openRegex.lastIndex = cursor;
    }
  }

  return blocks;
}

function stripFooterBlocks(html: string): string {
  const footerBlocks = extractBalancedTagBlocks(html, 'footer');
  let cleaned = html;
  for (const fb of footerBlocks) {
    cleaned = cleaned.replace(fb, ' ');
  }
  return cleaned;
}

function extractJsonLdLogos(
  html: string,
  baseUrl: string,
  universityName: string,
): RawLogoCandidate[] {
  const candidates: RawLogoCandidate[] = [];
  const scriptRegex =
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  const keywords = getUniversityKeywords(universityName);

  const inspectNode = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(inspectNode);
      return;
    }

    const record = node as Record<string, unknown>;
    if (Array.isArray(record['@graph'])) {
      record['@graph'].forEach(inspectNode);
    }

    const rawType = record['@type'];
    const typeStr = Array.isArray(rawType)
      ? rawType.join(' ').toLowerCase()
      : typeof rawType === 'string'
        ? rawType.toLowerCase()
        : '';

    const isOrgNode =
      typeStr.includes('university') ||
      typeStr.includes('organization') ||
      typeStr.includes('school') ||
      typeStr.includes('college');

    if (isOrgNode && record.logo) {
      const logoField = record.logo;
      const logoUrls: string[] = [];

      const pushLogoValue = (val: unknown) => {
        if (typeof val === 'string') {
          logoUrls.push(val);
        } else if (val && typeof val === 'object') {
          const obj = val as Record<string, unknown>;
          if (typeof obj.url === 'string') logoUrls.push(obj.url);
          else if (typeof obj.contentUrl === 'string') logoUrls.push(obj.contentUrl);
        }
      };

      if (Array.isArray(logoField)) {
        logoField.forEach(pushLogoValue);
      } else {
        pushLogoValue(logoField);
      }

      const nodeName = typeof record.name === 'string' ? record.name.toLowerCase() : '';
      const nameOverlap = keywords.some((kw) => nodeName.includes(kw));

      for (const rawLogoUrl of logoUrls) {
        const resolved = resolveRelativeUrl(rawLogoUrl, baseUrl);
        if (!resolved || isRejectedAsset(resolved, nodeName)) continue;

        let score = 88;
        if (typeStr.includes('college') || typeStr.includes('university')) score += 6;
        if (nameOverlap) score += 4;
        if (/\.svg(?:$|\?)/i.test(resolved)) score += 6;
        if (WHITE_FILENAME_PATTERN.test(resolved)) score -= 14;

        candidates.push({
          url: resolved,
          sourceKind: 'jsonld',
          sourceLabel: 'JSON-LD Organization schema',
          score,
          likelyWhiteVariant: WHITE_FILENAME_PATTERN.test(resolved),
        });
      }
    }

    if (record.publisher) inspectNode(record.publisher);
    if (record.mainEntity) inspectNode(record.mainEntity);
  };

  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    const rawJson = match[1].trim();
    if (!rawJson) continue;
    try {
      const parsed: unknown = JSON.parse(rawJson);
      inspectNode(parsed);
    } catch {
      // Ignore malformed JSON-LD script blocks safely
    }
  }

  return candidates;
}

function collectImgsInHtmlSlice(
  slice: string,
  baseUrl: string,
  universityName: string,
  inHeaderRegion: boolean,
): RawLogoCandidate[] {
  const results: RawLogoCandidate[] = [];
  const keywords = getUniversityKeywords(universityName);
  const imgRegex = /<img\b[^>]*>/gi;

  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(slice)) !== null) {
    const tag = match[0];
    const attrs = parseAttributes(tag);

    const srcCandidate =
      (attrs.srcset && pickBestSrcFromSrcset(attrs.srcset, baseUrl)) ||
      attrs['data-src'] ||
      attrs['data-lazy-src'] ||
      attrs.src;

    if (!srcCandidate) continue;
    const resolved = resolveRelativeUrl(srcCandidate, baseUrl);
    if (!resolved) continue;

    // Look at nearby 160 chars before <img> to inspect wrapper link / logo container classes
    const ctxStart = Math.max(0, match.index - 180);
    const parentCtx = slice.slice(ctxStart, match.index);
    const contextText = `${attrs.alt ?? ''} ${attrs.class ?? ''} ${attrs.id ?? ''} ${parentCtx}`;

    if (isRejectedAsset(resolved, contextText)) continue;

    const w = attrs.width ? parseInt(attrs.width, 10) : undefined;
    const h = attrs.height ? parseInt(attrs.height, 10) : undefined;
    if ((w && w < 24) || (h && h < 16)) continue;

    const ownSignals =
      `${resolved} ${attrs.alt ?? ''} ${attrs.class ?? ''} ${attrs.id ?? ''}`.toLowerCase();
    const combinedSignals = `${ownSignals} ${parentCtx}`.toLowerCase();
    const hasLogoToken = /\b(logo|brand|crest|emblem|wordmark|header-screen-logo|header-print-logo)\b/i.test(
      inHeaderRegion ? combinedSignals : ownSignals,
    );
    const matchesUnivToken = keywords.some((kw) =>
      (inHeaderRegion ? combinedSignals : ownSignals).includes(kw),
    );
    const isHomeLink = /href\s*=\s*["']?\/["']?/i.test(parentCtx);

    if (!inHeaderRegion) {
      if (!hasLogoToken || /\.(?:jpe?g)(?:$|\?)/i.test(resolved)) {
        continue;
      }
    }

    let score = inHeaderRegion ? 68 : 48;
    if (hasLogoToken) score += 16;
    if (matchesUnivToken) score += 12;
    if (isHomeLink && inHeaderRegion) score += 6;
    if (/\.svg(?:$|\?)/i.test(resolved)) score += 6;
    if (/print/i.test(attrs.class ?? '')) score -= 3;
    if (WHITE_FILENAME_PATTERN.test(resolved)) score -= 14;

    results.push({
      url: resolved,
      sourceKind: inHeaderRegion ? 'header_img' : 'brand_img',
      sourceLabel: inHeaderRegion ? 'Header image' : 'Page brand image',
      score,
      altText: attrs.alt,
      hintWidth: Number.isFinite(w) ? w : undefined,
      hintHeight: Number.isFinite(h) ? h : undefined,
      likelyWhiteVariant: WHITE_FILENAME_PATTERN.test(resolved),
    });
  }

  return results;
}

function collectInlineHeaderSvgs(
  headerHtml: string,
  baseUrl: string,
  universityName: string,
): RawLogoCandidate[] {
  const candidates: RawLogoCandidate[] = [];
  const keywords = getUniversityKeywords(universityName);
  const svgBlocks = extractBalancedTagBlocks(headerHtml, 'svg');

  svgBlocks.forEach((svgMarkup, idx) => {
    const startIdx = headerHtml.indexOf(svgMarkup);
    const parentCtx = headerHtml.slice(Math.max(0, startIdx - 180), startIdx);
    const openTag = svgMarkup.match(/^<svg\b[^>]*>/i)?.[0] ?? '<svg>';
    const attrs = parseAttributes(openTag);
    const titleMatch = svgMarkup.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const combined =
      `${attrs.class ?? ''} ${attrs.id ?? ''} ${attrs['aria-label'] ?? ''} ${titleMatch?.[1] ?? ''} ${parentCtx}`.toLowerCase();

    const isLogoSvg =
      /\b(logo|brand|crest|emblem|wordmark)\b/i.test(combined) ||
      keywords.some((kw) => combined.includes(kw));
    if (!isLogoSvg) return;

    // Ignore icon sprites (<use href="#icon-..."> without geometry)
    if (/<use\b/i.test(svgMarkup) && !/<(?:path|circle|rect|polygon|g)\b/i.test(svgMarkup)) {
      return;
    }

    const likelyWhite =
      /fill\s*=\s*["']?(?:#fff(?:fff)?|white)["']?/i.test(svgMarkup) &&
      !/fill\s*=\s*["']?#(?!fff)[0-9a-f]{3,6}/i.test(svgMarkup);

    candidates.push({
      url: `${baseUrl}#inline-svg-${idx + 1}`,
      sourceKind: 'header_svg',
      sourceLabel: 'Inline header SVG logo',
      score: likelyWhite ? 74 : 90,
      rawSvg: svgMarkup,
      likelyWhiteVariant: likelyWhite,
    });
  });

  return candidates;
}

function decodeDataUriSvg(dataUri: string): string | null {
  const match = dataUri.match(/^data:image\/svg\+xml(;[^,]*)?,([\s\S]+)$/i);
  if (!match) return null;
  const meta = (match[1] ?? '').toLowerCase();
  const payload = match[2];
  try {
    if (meta.includes('base64')) {
      return typeof atob === 'function' ? atob(payload) : null;
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

export function extractLogoCandidatesFromCss(
  cssText: string,
  cssBaseUrl: string,
): RawLogoCandidate[] {
  const candidates: RawLogoCandidate[] = [];
  const ruleRegex = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = ruleRegex.exec(cssText)) !== null) {
    const selector = match[1].trim();
    const body = match[2];
    if (!/\.(?:logo|brand|site-logo|header-logo)|#logo\b/i.test(selector)) {
      continue;
    }
    if (/background(?:-image)?/i.test(body) === false) continue;

    const urlRegex = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
    let uMatch: RegExpExecArray | null;
    while ((uMatch = urlRegex.exec(body)) !== null) {
      const rawRef = (uMatch[1] ?? uMatch[2] ?? uMatch[3] ?? '').trim();
      if (!rawRef || /^none$/i.test(rawRef)) continue;

      if (/^data:image\/svg\+xml/i.test(rawRef)) {
        const svgText = decodeDataUriSvg(rawRef);
        if (svgText && /<svg\b/i.test(svgText)) {
          const isWhite = /fill\s*=\s*["']?(?:#fff(?:fff)?|white)/i.test(svgText) &&
            !/fill\s*=\s*["']?#(?!fff)[0-9a-f]{3,6}/i.test(svgText);
          candidates.push({
            url: `${cssBaseUrl}#css-svg-${candidates.length + 1}`,
            sourceKind: 'header_css',
            sourceLabel: 'Header CSS SVG logo',
            score: isWhite ? 74 : 92,
            rawSvg: svgText,
            likelyWhiteVariant: isWhite,
          });
        }
        continue;
      }

      const resolved = resolveRelativeUrl(rawRef, cssBaseUrl);
      if (!resolved || isRejectedAsset(resolved, selector)) continue;

      const isWhite = WHITE_FILENAME_PATTERN.test(resolved);
      let score = 84;
      if (/\.svg(?:$|\?)/i.test(resolved)) score += 5;
      if (isWhite) score -= 14;

      candidates.push({
        url: resolved,
        sourceKind: 'header_css',
        sourceLabel: 'Header CSS logo',
        score,
        likelyWhiteVariant: isWhite,
      });
    }
  }

  return candidates;
}

function findPrimaryStylesheetUrls(
  html: string,
  baseUrl: string,
): string[] {
  const urls: string[] = [];
  const baseOrigin = new URL(baseUrl).origin;
  const headHtml = html.match(/<head\b[\s\S]*?<\/head>/i)?.[0] ?? html.slice(0, 15000);
  const linkRegex = /<link\b[^>]*>/gi;

  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(headHtml)) !== null) {
    const attrs = parseAttributes(match[0]);
    const rel = (attrs.rel ?? '').toLowerCase();
    if (!rel.split(/\s+/).includes('stylesheet') || !attrs.href) continue;

    const resolved = resolveRelativeUrl(attrs.href, baseUrl);
    if (!resolved) continue;
    try {
      const parsed = new URL(resolved);
      if (parsed.origin !== baseOrigin) continue;
      if (!urls.includes(resolved)) urls.push(resolved);
      if (urls.length >= 2) break;
    } catch {
      continue;
    }
  }

  return urls;
}

export function extractLogoCandidatesFromHtml(
  html: string,
  finalPageUrl: string,
  universityName: string,
): HtmlExtractionResult {
  const safeHtml = html.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ');
  const jsonLdCandidates = extractJsonLdLogos(safeHtml, finalPageUrl, universityName);

  const headerBlocks = extractBalancedTagBlocks(safeHtml, 'header');
  const navBlocks = extractBalancedTagBlocks(safeHtml, 'nav');
  const headerSlice =
    headerBlocks.length > 0
      ? headerBlocks.join('\n')
      : navBlocks.length > 0
        ? navBlocks.slice(0, 2).join('\n')
        : '';

  const headerImgCandidates = headerSlice
    ? collectImgsInHtmlSlice(headerSlice, finalPageUrl, universityName, true)
    : [];
  const headerSvgCandidates = headerSlice
    ? collectInlineHeaderSvgs(headerSlice, finalPageUrl, universityName)
    : [];

  const bodyWithoutFooter = stripFooterBlocks(safeHtml);
  const pageImgCandidates = collectImgsInHtmlSlice(
    bodyWithoutFooter,
    finalPageUrl,
    universityName,
    false,
  );

  const merged = rankAndFilterCandidates(
    [
      ...jsonLdCandidates,
      ...headerImgCandidates,
      ...headerSvgCandidates,
      ...pageImgCandidates,
    ],
    universityName,
  );

  // If HTML has no clear header logo yet (e.g. CSS background-image logo like University of Sussex),
  // inspect up to 2 same-origin primary stylesheets when header mentions logo/brand CSS classes.
  const headerMentionsCssLogo =
    /(?:class|id)\s*=\s*["'][^"']*(?:logo|brand)[^"']*["']/i.test(
      headerSlice || safeHtml.slice(0, 12000),
    );
  const hasStrongHtmlLogo = merged.some((c) => c.score >= 82);
  const stylesheetUrlsToCheck =
    !hasStrongHtmlLogo && headerMentionsCssLogo
      ? findPrimaryStylesheetUrls(safeHtml, finalPageUrl)
      : [];

  return {
    candidates: merged,
    stylesheetUrlsToCheck,
  };
}

export function rankAndFilterCandidates(
  rawList: RawLogoCandidate[],
  _universityName?: string,
): RawLogoCandidate[] {
  const deduped = new Map<string, RawLogoCandidate>();

  for (const item of rawList) {
    if (!item.rawSvg && isRejectedAsset(item.url, item.altText ?? '')) {
      continue;
    }
    const existing = deduped.get(item.url);
    if (!existing || item.score > existing.score) {
      deduped.set(item.url, item);
    }
  }

  return Array.from(deduped.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}
