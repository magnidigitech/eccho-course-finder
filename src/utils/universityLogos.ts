import type {
  CourseRecord,
  DiscoveredLogoCandidate,
  PendingExternalImageHost,
  UniversityLogoEntry,
  UniversityLogoMap,
} from '../types/course';
import type { DiscoverUniversityResponse } from '../extension/background';
import { isChromeExtensionTab } from './extensionSession';
import { normalizeUniversityWebsiteUrl } from './logoDiscovery';
import {
  processDiscoveredCandidate,
  resolveCandidateOutcome,
  type RawFetchedCandidatePayload,
} from './logoProcessor';

interface ChromeDiscoveryApi {
  permissions?: {
    contains?: (perms: { origins: string[] }) => Promise<boolean>;
    request?: (perms: { origins: string[] }) => Promise<boolean>;
  };
  runtime?: {
    sendMessage?: (msg: unknown) => Promise<unknown>;
  };
}

function getChromeDiscoveryApi(): ChromeDiscoveryApi | null {
  if (!isChromeExtensionTab()) return null;
  return (globalThis as { chrome?: ChromeDiscoveryApi }).chrome ?? null;
}

export function extractDomainFromUrl(href: string | null): string | null {
  const target = normalizeUniversityWebsiteUrl(href);
  return target ? target.hostname.replace(/^www\./i, '') : null;
}

export function getUniversityInitials(universityName: string): string {
  const cleaned = universityName
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim();

  const stopWords = new Set(['of', 'the', 'and', 'for', 'in', 'at', 'on', 'de']);
  const tokens = cleaned
    .split(/\s+/)
    .filter((word) => word.length > 0 && !stopWords.has(word.toLowerCase()));

  if (tokens.length === 0) return 'UN';
  if (tokens.length === 1) return tokens[0].slice(0, 3).toUpperCase();

  const lowerTokens = tokens.map((t) => t.toLowerCase());
  const uniIdx = lowerTokens.indexOf('university');

  if (uniIdx === 0) {
    const rest = tokens.filter(
      (t) => !['university', 'campus', 'college', 'institute'].includes(t.toLowerCase()),
    );
    if (rest.length >= 2) {
      return `U${rest[0][0]}${rest[1][0]}`.slice(0, 3).toUpperCase();
    }
    if (rest.length === 1) {
      return `U${rest[0][0]}`.toUpperCase();
    }
  } else if (uniIdx > 0) {
    const beforeUni = tokens.slice(0, uniIdx);
    if (beforeUni.length >= 2) {
      return `${beforeUni[0][0]}${beforeUni[1][0]}`.toUpperCase();
    }
    return `${beforeUni[0][0]}U`.toUpperCase();
  }

  return `${tokens[0][0]}${tokens[1][0]}`.toUpperCase();
}

export function initializeUniversityLogosForCourses(
  courses: CourseRecord[],
  existingMap: UniversityLogoMap = {},
): UniversityLogoMap {
  const nextMap: UniversityLogoMap = {};
  const seenKeys = new Set<string>();
  const inExtension = isChromeExtensionTab();

  for (const course of courses) {
    const key = course.universityKey;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const existing = existingMap[key];
    if (existing && (existing.source === 'uploaded' || existing.source === 'discovered') && existing.logo) {
      nextMap[key] = existing;
      continue;
    }

    const normalized = normalizeUniversityWebsiteUrl(course.websiteHref);
    const domain = normalized ? normalized.hostname.replace(/^www\./i, '') : null;
    const initials = getUniversityInitials(course.university);

    if (!normalized) {
      nextMap[key] = {
        universityKey: key,
        universityName: course.university,
        websiteHref: course.websiteHref,
        normalizedWebsiteUrl: null,
        finalWebsiteUrl: null,
        domain: null,
        requiredHostOrigins: [],
        initials,
        source: 'initials',
        status: 'unavailable',
        logo: null,
        statusMessage: 'No Website URL in workbook — using initials placeholder.',
      };
      continue;
    }

    nextMap[key] = {
      universityKey: key,
      universityName: course.university,
      websiteHref: course.websiteHref,
      normalizedWebsiteUrl: normalized.normalizedUrl,
      finalWebsiteUrl: null,
      domain,
      requiredHostOrigins: normalized.requiredOriginPatterns,
      initials,
      source: 'initials',
      status: inExtension ? 'permission_required' : 'unavailable',
      logo: null,
      statusMessage: inExtension
        ? `Requires host permission for ${normalized.hostname} to inspect public homepage HTML.`
        : 'Automatic cross-origin discovery runs in the Eccho Chrome Extension. Upload a logo manually here or keep initials.',
    };
  }

  return nextMap;
}

/**
 * Checks Chrome permissions silently (without prompting) to identify hosts already permitted.
 */
export async function findAlreadyPermittedUniversityKeys(
  logoMap: UniversityLogoMap,
): Promise<string[]> {
  const chromeApi = getChromeDiscoveryApi();
  if (!chromeApi?.permissions?.contains) return [];

  const permittedKeys: string[] = [];
  for (const entry of Object.values(logoMap)) {
    if (!entry.normalizedWebsiteUrl || entry.status === 'found') continue;
    try {
      const origin = `${new URL(entry.normalizedWebsiteUrl).origin}/*`;
      const granted = await chromeApi.permissions.contains({ origins: [origin] });
      if (granted) {
        permittedKeys.push(entry.universityKey);
      }
    } catch {
      // Ignore malformed origin
    }
  }
  return permittedKeys;
}

/**
 * Must be invoked directly from a user click handler (no prior `await`) so Chrome preserves the user gesture.
 */
export function requestHostPermissionsSync(
  originPatterns: string[],
): Promise<boolean> {
  const chromeApi = getChromeDiscoveryApi();
  const unique = Array.from(new Set(originPatterns.filter(Boolean)));
  if (!chromeApi?.permissions?.request || unique.length === 0) {
    return Promise.resolve(false);
  }
  return chromeApi.permissions.request({ origins: unique });
}

export async function discoverSingleUniversityEntry(
  entry: UniversityLogoEntry,
): Promise<UniversityLogoEntry> {
  const chromeApi = getChromeDiscoveryApi();
  if (!chromeApi?.runtime?.sendMessage) {
    return {
      ...entry,
      status: 'unavailable',
      statusMessage: 'Extension background worker unavailable.',
    };
  }

  if (!entry.normalizedWebsiteUrl) {
    return {
      ...entry,
      status: 'unavailable',
      statusMessage: 'No valid university Website URL to inspect.',
    };
  }

  const response = (await chromeApi.runtime.sendMessage({
    type: 'DISCOVER_UNIVERSITY_LOGO',
    universityName: entry.universityName,
    websiteHref: entry.normalizedWebsiteUrl,
  })) as DiscoverUniversityResponse | undefined;

  if (!response) {
    return {
      ...entry,
      status: 'unavailable',
      statusMessage: 'Background discovery service did not respond.',
    };
  }

  if (response.status === 'permission_required') {
    return {
      ...entry,
      status: 'permission_required',
      requiredHostOrigins:
        response.requiredOrigins ?? entry.requiredHostOrigins,
      statusMessage:
        response.reason ??
        `Host access permission required for ${entry.domain ?? 'university website'}.`,
    };
  }

  if (response.status === 'unavailable' || !response.candidates) {
    return {
      ...entry,
      finalWebsiteUrl: response.finalWebsiteUrl ?? entry.finalWebsiteUrl,
      status: 'unavailable',
      source: 'initials',
      logo: null,
      candidates: [],
      statusMessage:
        response.reason ??
        'Could not locate a verifiable official university logo.',
    };
  }

  const rawPayloads: RawFetchedCandidatePayload[] = response.candidates.map(
    (c) => ({
      id: c.id,
      sourceUrl: c.sourceUrl,
      sourceKind: c.sourceKind,
      sourceLabel: c.sourceLabel,
      score: c.score,
      rawSvg: c.rawSvg,
      base64Bytes: c.base64Bytes,
      contentType: c.contentType,
      likelyWhiteVariant: c.likelyWhiteVariant,
    }),
  );

  const processed = (
    await Promise.all(rawPayloads.map((p) => processDiscoveredCandidate(p)))
  ).filter((c): c is DiscoveredLogoCandidate => c !== null);

  const outcome = resolveCandidateOutcome(processed);
  const pendingExternalHosts = response.pendingExternalHosts ?? [];

  if (outcome.status === 'found' && outcome.selected) {
    const selected = outcome.selected;
    const isDarkBackdrop = Boolean(selected.logo.needsDarkBackdrop);
    return {
      ...entry,
      finalWebsiteUrl: response.finalWebsiteUrl ?? entry.finalWebsiteUrl,
      status: 'found',
      source: 'discovered',
      logo: selected.logo,
      logoSourceUrl: selected.sourceUrl,
      candidates: outcome.candidates,
      pendingExternalHosts,
      statusMessage: isDarkBackdrop
        ? `${selected.sourceLabel} (light logo placed on dark frame for contrast)`
        : selected.sourceLabel,
    };
  }

  if (outcome.status === 'needs_selection') {
    return {
      ...entry,
      finalWebsiteUrl: response.finalWebsiteUrl ?? entry.finalWebsiteUrl,
      status: 'needs_selection',
      source: 'initials',
      logo: null,
      candidates: outcome.candidates,
      pendingExternalHosts,
      statusMessage: `Found ${outcome.candidates.length} plausible logo candidates — choose one to confirm.`,
    };
  }

  if (pendingExternalHosts.length > 0) {
    return {
      ...entry,
      finalWebsiteUrl: response.finalWebsiteUrl ?? entry.finalWebsiteUrl,
      status: 'permission_required',
      source: 'initials',
      logo: null,
      candidates: [],
      pendingExternalHosts,
      statusMessage: `Homepage references a candidate logo on external host ${pendingExternalHosts[0].origin}. Grant read access to download it.`,
    };
  }

  return {
    ...entry,
    finalWebsiteUrl: response.finalWebsiteUrl ?? entry.finalWebsiteUrl,
    status: 'unavailable',
    source: 'initials',
    logo: null,
    candidates: [],
    pendingExternalHosts: [],
    statusMessage:
      'No candidate image passed format and resolution validation.',
  };
}

export async function fetchPendingExternalHostCandidate(
  entry: UniversityLogoEntry,
  pending: PendingExternalImageHost,
): Promise<UniversityLogoEntry> {
  const chromeApi = getChromeDiscoveryApi();
  if (!chromeApi?.runtime?.sendMessage) return entry;

  const res = (await chromeApi.runtime.sendMessage({
    type: 'FETCH_CANDIDATE_IMAGE',
    candidateUrl: pending.candidateUrl,
  })) as
    | {
        ok: boolean;
        base64Bytes?: string;
        finalUrl?: string;
        contentType?: string;
        reason?: string;
      }
    | undefined;

  if (!res?.ok || !res.base64Bytes) {
    return {
      ...entry,
      pendingExternalHosts: (entry.pendingExternalHosts ?? []).filter(
        (h) => h.candidateUrl !== pending.candidateUrl,
      ),
      status:
        (entry.candidates?.length ?? 0) > 0
          ? entry.status === 'found'
            ? 'found'
            : 'needs_selection'
          : 'unavailable',
      statusMessage: res?.reason ?? `Could not download logo from ${pending.origin}.`,
    };
  }

  const processed = await processDiscoveredCandidate({
    id: `ext_${Date.now()}`,
    sourceUrl: res.finalUrl ?? pending.candidateUrl,
    sourceKind: pending.sourceKind,
    sourceLabel: pending.sourceLabel,
    score: pending.score,
    base64Bytes: res.base64Bytes,
    contentType: res.contentType,
  });

  if (!processed) {
    return {
      ...entry,
      pendingExternalHosts: (entry.pendingExternalHosts ?? []).filter(
        (h) => h.candidateUrl !== pending.candidateUrl,
      ),
      status: (entry.candidates?.length ?? 0) > 0 ? 'needs_selection' : 'unavailable',
      statusMessage: `Downloaded file from ${pending.origin} was not a valid usable logo image.`,
    };
  }

  const nextCandidates = [...(entry.candidates ?? []), processed];
  const remainingExternal = (entry.pendingExternalHosts ?? []).filter(
    (h) => h.candidateUrl !== pending.candidateUrl,
  );

  return {
    ...entry,
    status: 'found',
    source: 'discovered',
    logo: processed.logo,
    logoSourceUrl: processed.sourceUrl,
    candidates: nextCandidates,
    pendingExternalHosts: remainingExternal,
    statusMessage: processed.logo.needsDarkBackdrop
      ? `${processed.sourceLabel} (light logo on dark frame)`
      : processed.sourceLabel,
  };
}

export function applyCandidateSelection(
  entry: UniversityLogoEntry,
  candidateId: string,
): UniversityLogoEntry {
  const chosen = entry.candidates?.find((c) => c.id === candidateId);
  if (!chosen) return entry;
  return {
    ...entry,
    status: 'found',
    source: 'discovered',
    logo: chosen.logo,
    logoSourceUrl: chosen.sourceUrl,
    statusMessage: chosen.logo.needsDarkBackdrop
      ? `${chosen.sourceLabel} (light logo on dark frame)`
      : chosen.sourceLabel,
  };
}

export async function runWithConcurrencyLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from(
    { length: Math.min(limit, queue.length) },
    async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next === undefined) break;
        await worker(next);
      }
    },
  );
  await Promise.all(workers);
}

export function revokeEntryCandidateUrls(
  entry: UniversityLogoEntry | undefined,
  keepLogoUrl?: string | null,
): void {
  if (!entry) return;
  if (
    entry.logo?.previewUrl?.startsWith('blob:') &&
    entry.logo.previewUrl !== keepLogoUrl
  ) {
    URL.revokeObjectURL(entry.logo.previewUrl);
  }
  for (const c of entry.candidates ?? []) {
    if (
      c.logo.previewUrl.startsWith('blob:') &&
      c.logo.previewUrl !== keepLogoUrl
    ) {
      URL.revokeObjectURL(c.logo.previewUrl);
    }
  }
}

export function revokeUniversityLogoUrls(logoMap: UniversityLogoMap): void {
  for (const entry of Object.values(logoMap)) {
    revokeEntryCandidateUrls(entry);
  }
}

export function collectPendingHostOrigins(logoMap: UniversityLogoMap): string[] {
  const origins = new Set<string>();
  for (const entry of Object.values(logoMap)) {
    if (entry.status === 'permission_required') {
      for (const p of entry.requiredHostOrigins) {
        origins.add(p);
      }
    }
  }
  return Array.from(origins);
}
